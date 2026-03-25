const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

// POST /payments/insurance — Post insurance payment (ERA auto-post)
router.post('/insurance', authorize('ADMIN', 'BILLING_MANAGER', 'BILLER'),
auditLog('create', 'insurance_payment'), async (req, res, next) => {
  try {
    const { payerName, payerId, paymentDate, totalAmount, checkNumber, eftNumber, allocations } = req.body;
    const payment = await req.prisma.$transaction(async (tx) => {
      const pmt = await tx.insurancePayment.create({
        data: { payerName, payerId, paymentDate: new Date(paymentDate), totalAmount, checkNumber, eftNumber },
      });
      let postedTotal = 0;
      for (const alloc of (allocations || [])) {
        await tx.insurancePaymentAllocation.create({
          data: { insurancePaymentId: pmt.id, claimId: alloc.claimId, lineNumber: alloc.lineNumber,
            paidAmount: alloc.paidAmount, allowedAmount: alloc.allowedAmount, adjustmentAmount: alloc.adjustmentAmount || 0,
            patientResponsibility: alloc.patientResponsibility || 0 },
        });
        // Update claim balances
        const claim = await tx.claim.findUnique({ where: { id: alloc.claimId } });
        if (claim) {
          const newPaid = parseFloat(claim.totalPaid) + parseFloat(alloc.paidAmount);
          const newAdj = parseFloat(claim.adjustments) + parseFloat(alloc.adjustmentAmount || 0);
          const newBalance = parseFloat(claim.totalCharged) - newPaid - newAdj;
          const newStatus = newBalance <= 0 ? 'PAID' : parseFloat(alloc.paidAmount) > 0 ? 'PARTIAL' : claim.status;
          await tx.claim.update({
            where: { id: alloc.claimId },
            data: { totalPaid: newPaid, adjustments: newAdj, balance: Math.max(0, newBalance),
              patientResponsibility: alloc.patientResponsibility || 0, status: newStatus,
              statusHistory: { create: { fromStatus: claim.status, toStatus: newStatus, note: `Insurance payment posted: $${alloc.paidAmount}` } } },
          });
        }
        postedTotal += parseFloat(alloc.paidAmount);
      }
      await tx.insurancePayment.update({ where: { id: pmt.id }, data: { postedAmount: postedTotal, status: postedTotal >= totalAmount ? 'posted' : 'partial' } });
      return pmt;
    });
    res.status(201).json(payment);
  } catch (err) { next(err); }
});

// POST /payments/patient — Post patient payment (card/cash/check)
router.post('/patient', auditLog('create', 'patient_payment'), async (req, res, next) => {
  try {
    const { patientId, amount, method, reference, description } = req.body;
    // TODO: If card payment, process through Stripe first
    const payment = await req.prisma.patientPayment.create({
      data: { patientId, amount, method: method || 'card', reference, description, status: 'completed' },
    });
    // Update patient ledger
    const lastEntry = await req.prisma.patientLedger.findFirst({ where: { patientId }, orderBy: { postedAt: 'desc' } });
    const prevBalance = lastEntry ? parseFloat(lastEntry.balance) : 0;
    await req.prisma.patientLedger.create({
      data: { patientId, type: 'patient_payment', description: description || `Payment - ${method}`,
        amount: -Math.abs(amount), balance: prevBalance - Math.abs(amount), referenceId: payment.id },
    });
    res.status(201).json(payment);
  } catch (err) { next(err); }
});

// GET /payments/unposted — List unposted ERA payments
router.get('/unposted', auditLog('list', 'insurance_payment'), async (req, res, next) => {
  try {
    const payments = await req.prisma.insurancePayment.findMany({
      where: { status: { in: ['unposted', 'partial'] } },
      orderBy: { createdAt: 'desc' },
      include: { allocations: { include: { claim: { select: { claimNumber: true, patient: { select: { firstName: true, lastName: true } } } } } } },
    });
    res.json(payments);
  } catch (err) { next(err); }
});

module.exports = router;
