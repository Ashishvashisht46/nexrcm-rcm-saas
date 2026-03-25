const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/aging-summary', auditLog('view', 'report'), async (req, res, next) => {
  try {
    const claims = await req.prisma.claim.findMany({
      where: { orgId: req.orgId, status: { in: ['SUBMITTED', 'PENDING', 'PARTIAL', 'DENIED'] } },
      select: { daysInAR: true, balance: true, payerName: true },
    });
    const buckets = { '0-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '91-120': { count: 0, amount: 0 }, '120+': { count: 0, amount: 0 } };
    claims.forEach(c => {
      const b = c.daysInAR <= 30 ? '0-30' : c.daysInAR <= 60 ? '31-60' : c.daysInAR <= 90 ? '61-90' : c.daysInAR <= 120 ? '91-120' : '120+';
      buckets[b].count++; buckets[b].amount += parseFloat(c.balance);
    });
    res.json({ buckets, totalClaims: claims.length, totalOutstanding: claims.reduce((s, c) => s + parseFloat(c.balance), 0) });
  } catch (err) { next(err); }
});

router.get('/denial-trends', auditLog('view', 'report'), async (req, res, next) => {
  try {
    const denials = await req.prisma.denial.findMany({
      where: { claim: { orgId: req.orgId } },
      select: { denialDate: true, carcCode: true, denialCategory: true, amountDenied: true },
      orderBy: { denialDate: 'desc' },
    });
    res.json(denials);
  } catch (err) { next(err); }
});

router.get('/payer-performance', auditLog('view', 'report'), async (req, res, next) => {
  try {
    const claims = await req.prisma.claim.groupBy({
      by: ['payerName'], where: { orgId: req.orgId, payerName: { not: null } },
      _count: true, _sum: { totalCharged: true, totalPaid: true, adjustments: true, balance: true },
    });
    res.json(claims.map(c => ({ payer: c.payerName, claims: c._count, charged: c._sum.totalCharged, paid: c._sum.totalPaid, adjustments: c._sum.adjustments, outstanding: c._sum.balance })));
  } catch (err) { next(err); }
});

router.get('/provider-productivity', auditLog('view', 'report'), async (req, res, next) => {
  try {
    const providers = await req.prisma.claim.groupBy({
      by: ['providerId'], where: { orgId: req.orgId },
      _count: true, _sum: { totalCharged: true, totalPaid: true },
    });
    const enriched = await Promise.all(providers.map(async p => {
      const prov = await req.prisma.provider.findUnique({ where: { id: p.providerId }, select: { firstName: true, lastName: true, specialty: true } });
      return { provider: prov, claims: p._count, charged: p._sum.totalCharged, collected: p._sum.totalPaid };
    }));
    res.json(enriched);
  } catch (err) { next(err); }
});

module.exports = router;
