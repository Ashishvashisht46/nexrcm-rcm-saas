const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/rules', auditLog('list', 'automation_rule'), async (req, res, next) => {
  try {
    const rules = await req.prisma.automationRule.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    res.json(rules);
  } catch (err) { next(err); }
});

router.post('/rules', authorize('ADMIN', 'BILLING_MANAGER'), auditLog('create', 'automation_rule'), async (req, res, next) => {
  try {
    const rule = await req.prisma.automationRule.create({ data: { orgId: req.orgId, ...req.body } });
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.put('/rules/:id', authorize('ADMIN', 'BILLING_MANAGER'), auditLog('update', 'automation_rule'), async (req, res, next) => {
  try {
    await req.prisma.automationRule.updateMany({ where: { id: req.params.id, orgId: req.orgId }, data: req.body });
    res.json({ message: 'Rule updated.' });
  } catch (err) { next(err); }
});

router.get('/executions', auditLog('list', 'automation_execution'), async (req, res, next) => {
  try {
    const execs = await req.prisma.automationExecution.findMany({
      where: { rule: { orgId: req.orgId } }, orderBy: { executedAt: 'desc' }, take: 100,
      include: { rule: { select: { name: true, trigger: true } } },
    });
    res.json(execs);
  } catch (err) { next(err); }
});

module.exports = router;
