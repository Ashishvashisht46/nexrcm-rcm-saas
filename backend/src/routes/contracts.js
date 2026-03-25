const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'payer_contract'), async (req, res, next) => {
  try {
    const contracts = await req.prisma.payerContract.findMany({
      where: { orgId: req.orgId }, orderBy: { effectiveDate: 'desc' },
      include: { _count: { select: { rates: true } } },
    });
    res.json(contracts);
  } catch (err) { next(err); }
});

router.get('/:id/rates', auditLog('view', 'contract_rate'), async (req, res, next) => {
  try {
    const rates = await req.prisma.contractRate.findMany({ where: { contractId: req.params.id }, orderBy: { cptCode: 'asc' } });
    res.json(rates);
  } catch (err) { next(err); }
});

// GET /contracts/variance-analysis — Compare contract rates vs charges vs payments
router.get('/variance-analysis', auditLog('view', 'variance_analysis'), async (req, res, next) => {
  try {
    // Get top CPT codes by volume
    const claims = await req.prisma.claimLine.groupBy({
      by: ['cptCode'], _sum: { chargedAmount: true, paidAmount: true, allowedAmount: true }, _count: true,
      orderBy: { _count: { cptCode: 'desc' } }, take: 20,
    });
    res.json({ analysis: claims.map(c => ({
      cptCode: c.cptCode, volume: c._count, totalCharged: c._sum.chargedAmount,
      totalPaid: c._sum.paidAmount, totalAllowed: c._sum.allowedAmount,
      avgReimbursement: c._count > 0 ? (parseFloat(c._sum.paidAmount || 0) / c._count).toFixed(2) : 0,
    })) });
  } catch (err) { next(err); }
});

router.post('/', authorize('ADMIN', 'BILLING_MANAGER'), auditLog('create', 'payer_contract'), async (req, res, next) => {
  try {
    const contract = await req.prisma.payerContract.create({ data: { orgId: req.orgId, ...req.body, effectiveDate: new Date(req.body.effectiveDate) } });
    res.status(201).json(contract);
  } catch (err) { next(err); }
});

module.exports = router;
