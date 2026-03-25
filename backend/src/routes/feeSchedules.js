const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'fee_schedule'), async (req, res, next) => {
  try {
    const schedules = await req.prisma.feeSchedule.findMany({
      where: { orgId: req.orgId },
      include: { _count: { select: { entries: true } } },
      orderBy: { effectiveDate: 'desc' },
    });
    res.json(schedules);
  } catch (err) { next(err); }
});

router.get('/:id/entries', auditLog('view', 'fee_schedule'), async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const where = { feeScheduleId: req.params.id };
    if (search) where.OR = [{ cptCode: { startsWith: search } }, { description: { contains: search, mode: 'insensitive' } }];
    const entries = await req.prisma.feeScheduleEntry.findMany({ where, skip: (page - 1) * limit, take: parseInt(limit), orderBy: { cptCode: 'asc' } });
    res.json(entries);
  } catch (err) { next(err); }
});

router.post('/', authorize('ADMIN', 'BILLING_MANAGER'), auditLog('create', 'fee_schedule'), async (req, res, next) => {
  try {
    const { name, type, effectiveDate, entries } = req.body;
    const schedule = await req.prisma.feeSchedule.create({
      data: { orgId: req.orgId, name, type: type || 'standard', effectiveDate: new Date(effectiveDate),
        entries: entries ? { create: entries.map(e => ({ cptCode: e.cptCode, description: e.description, fee: e.fee })) } : undefined },
    });
    res.status(201).json(schedule);
  } catch (err) { next(err); }
});

// POST /fee-schedules/:id/import — Bulk import from CSV data
router.post('/:id/import', authorize('ADMIN', 'BILLING_MANAGER'), auditLog('import', 'fee_schedule'), async (req, res, next) => {
  try {
    const { entries } = req.body; // Array of { cptCode, description, fee }
    if (!entries?.length) return res.status(400).json({ error: 'No entries to import.' });
    const created = await req.prisma.feeScheduleEntry.createMany({
      data: entries.map(e => ({ feeScheduleId: req.params.id, cptCode: e.cptCode, description: e.description, fee: e.fee })),
      skipDuplicates: true,
    });
    res.json({ imported: created.count });
  } catch (err) { next(err); }
});

module.exports = router;
