const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
router.use(authenticate, orgScope);

router.get('/', authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { action, resource, userId, startDate, endDate, page = 1, limit = 50 } = req.query;
    const where = { orgId: req.orgId };
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (userId) where.userId = userId;
    if (startDate || endDate) { where.timestamp = {}; if (startDate) where.timestamp.gte = new Date(startDate); if (endDate) where.timestamp.lte = new Date(endDate); }
    const [logs, total] = await Promise.all([
      req.prisma.auditLog.findMany({ where, skip: (page - 1) * limit, take: parseInt(limit), orderBy: { timestamp: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, email: true } } } }),
      req.prisma.auditLog.count({ where }),
    ]);
    res.json({ logs, total });
  } catch (err) { next(err); }
});

module.exports = router;
