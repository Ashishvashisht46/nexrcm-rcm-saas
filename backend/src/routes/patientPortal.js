const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, authorize('PATIENT'));

router.get('/my-bills', auditLog('view', 'patient_bills'), async (req, res, next) => {
  try {
    const patient = await req.prisma.patient.findFirst({ where: { portalUserId: req.user.id } });
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    const claims = await req.prisma.claim.findMany({
      where: { patientId: patient.id, status: { in: ['PAID', 'PARTIAL', 'CLOSED'] } },
      select: { id: true, claimNumber: true, dateOfService: true, totalCharged: true, totalPaid: true, patientResponsibility: true, balance: true, status: true, payerName: true },
      orderBy: { dateOfService: 'desc' },
    });
    const ledger = await req.prisma.patientLedger.findMany({ where: { patientId: patient.id }, orderBy: { postedAt: 'desc' }, take: 30 });
    const balance = ledger.length > 0 ? parseFloat(ledger[0].balance) : 0;
    res.json({ claims, ledger, currentBalance: balance });
  } catch (err) { next(err); }
});

router.post('/pay', auditLog('create', 'patient_payment'), async (req, res, next) => {
  try {
    const patient = await req.prisma.patient.findFirst({ where: { portalUserId: req.user.id } });
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    const { amount, method } = req.body;
    // TODO: Process through Stripe
    const payment = await req.prisma.patientPayment.create({
      data: { patientId: patient.id, amount, method: method || 'card', status: 'completed', description: 'Online portal payment' },
    });
    res.status(201).json(payment);
  } catch (err) { next(err); }
});

router.get('/statements', auditLog('view', 'patient_statement'), async (req, res, next) => {
  try {
    const patient = await req.prisma.patient.findFirst({ where: { portalUserId: req.user.id } });
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    const statements = await req.prisma.patientStatement.findMany({ where: { patientId: patient.id }, orderBy: { statementDate: 'desc' } });
    res.json(statements);
  } catch (err) { next(err); }
});

module.exports = router;
