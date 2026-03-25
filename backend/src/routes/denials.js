const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'denial'), async (req, res, next) => {
  try {
    const { category, isAppealable, page = 1, limit = 25 } = req.query;
    const where = { claim: { orgId: req.orgId } };
    if (category) where.denialCategory = category;
    if (isAppealable !== undefined) where.isAppealable = isAppealable === 'true';
    const [denials, total] = await Promise.all([
      req.prisma.denial.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        orderBy: { amountDenied: 'desc' },
        include: { claim: { select: { claimNumber: true, payerName: true, patient: { select: { firstName: true, lastName: true } } } }, appeals: true },
      }),
      req.prisma.denial.count({ where }),
    ]);
    res.json({ denials, total });
  } catch (err) { next(err); }
});

router.post('/:id/appeal', authorize('ADMIN', 'BILLING_MANAGER', 'BILLER', 'AR_SPECIALIST'),
auditLog('create', 'appeal'), async (req, res, next) => {
  try {
    const { appealLevel, notes, additionalContext } = req.body;
    const denial = await req.prisma.denial.findUnique({
      where: { id: req.params.id },
      include: { claim: { include: { lines: true, patient: true, provider: true } } },
    });
    if (!denial) return res.status(404).json({ error: 'Denial not found.' });

    // AI-generate appeal letter
    const ai = require('../services/ai');
    const letter = await ai.generateAppealLetter(
      denial, denial.claim, denial.claim.patient, denial.claim.provider, additionalContext
    );

    const appeal = await req.prisma.appeal.create({
      data: { denialId: req.params.id, appealLevel: appealLevel || 1, status: 'DRAFT', notes: letter, aiGenerated: true },
    });
    await req.prisma.claim.updateMany({
      where: { denial: { id: req.params.id }, orgId: req.orgId },
      data: { status: 'APPEALED' },
    });
    res.status(201).json({ appeal, letter });
  } catch (err) { next(err); }
});

// GET /denials/analytics — Denial trends and patterns
router.get('/analytics', auditLog('view', 'denial_analytics'), async (req, res, next) => {
  try {
    const denials = await req.prisma.denial.findMany({
      where: { claim: { orgId: req.orgId } },
      select: { carcCode: true, denialCategory: true, amountDenied: true, recoveryLikelihood: true, claim: { select: { payerName: true } } },
    });
    // Aggregate
    const byCategory = {}, byPayer = {}, byCode = {};
    let totalDenied = 0;
    denials.forEach(d => {
      totalDenied += parseFloat(d.amountDenied);
      const cat = d.denialCategory || 'unknown';
      byCategory[cat] = (byCategory[cat] || { count: 0, amount: 0 });
      byCategory[cat].count++; byCategory[cat].amount += parseFloat(d.amountDenied);
      const payer = d.claim.payerName || 'Unknown';
      byPayer[payer] = (byPayer[payer] || { count: 0, amount: 0 });
      byPayer[payer].count++; byPayer[payer].amount += parseFloat(d.amountDenied);
      if (d.carcCode) { byCode[d.carcCode] = (byCode[d.carcCode] || 0) + 1; }
    });
    res.json({ totalDenials: denials.length, totalDenied, byCategory, byPayer, topCodes: Object.entries(byCode).sort((a, b) => b[1] - a[1]).slice(0, 10) });
  } catch (err) { next(err); }
});

// GET /denials/carc-rarc-library
router.get('/carc-rarc-library', async (req, res, next) => {
  try {
    const { search } = req.query;
    const where = search ? { OR: [{ code: { contains: search } }, { description: { contains: search, mode: 'insensitive' } }] } : {};
    const [carcs, rarcs] = await Promise.all([
      req.prisma.cARCCode.findMany({ where, take: 50 }),
      req.prisma.rARCCode.findMany({ where, take: 50 }),
    ]);
    res.json({ carcs, rarcs });
  } catch (err) { next(err); }
});

module.exports = router;
