const router = require('express').Router();
const { authenticate, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'work_queue'), async (req, res, next) => {
  try {
    const { type, status = 'open', assignedTo } = req.query;
    const where = { status, claim: { orgId: req.orgId } };
    if (type) where.type = type;
    if (assignedTo) where.assignedTo = assignedTo;
    const items = await req.prisma.workQueueItem.findMany({
      where, orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      include: { claim: { select: { claimNumber: true, totalCharged: true, balance: true, payerName: true, daysInAR: true, patient: { select: { firstName: true, lastName: true } } } }, assignee: { select: { firstName: true, lastName: true } } },
      take: 100,
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.put('/:id/assign', auditLog('assign', 'work_queue'), async (req, res, next) => {
  try {
    await req.prisma.workQueueItem.update({ where: { id: req.params.id }, data: { assignedTo: req.body.userId, status: 'in_progress' } });
    res.json({ message: 'Task assigned.' });
  } catch (err) { next(err); }
});

router.put('/:id/complete', auditLog('complete', 'work_queue'), async (req, res, next) => {
  try {
    await req.prisma.workQueueItem.update({ where: { id: req.params.id }, data: { status: 'completed', completedAt: new Date() } });
    res.json({ message: 'Task completed.' });
  } catch (err) { next(err); }
});

module.exports = router;
