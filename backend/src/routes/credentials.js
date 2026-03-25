const router = require('express').Router();
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'credential'), async (req, res, next) => {
  try {
    const { status, providerId } = req.query;
    const where = { orgId: req.orgId };
    if (status) where.status = status;
    if (providerId) where.providerId = providerId;
    const credentials = await req.prisma.credential.findMany({
      where, orderBy: { expirationDate: 'asc' },
      include: { provider: { select: { firstName: true, lastName: true, npi: true } }, documents: true },
    });
    res.json(credentials);
  } catch (err) { next(err); }
});

router.get('/expiring', auditLog('list', 'credential'), async (req, res, next) => {
  try {
    const in90Days = new Date(); in90Days.setDate(in90Days.getDate() + 90);
    const expiring = await req.prisma.credential.findMany({
      where: { orgId: req.orgId, expirationDate: { lte: in90Days }, status: { not: 'EXPIRED' } },
      include: { provider: { select: { firstName: true, lastName: true } } },
      orderBy: { expirationDate: 'asc' },
    });
    res.json(expiring);
  } catch (err) { next(err); }
});

router.post('/', authorize('ADMIN', 'CREDENTIALING'), auditLog('create', 'credential'), async (req, res, next) => {
  try {
    const cred = await req.prisma.credential.create({ data: { orgId: req.orgId, ...req.body } });
    res.status(201).json(cred);
  } catch (err) { next(err); }
});

router.put('/:id', authorize('ADMIN', 'CREDENTIALING'), auditLog('update', 'credential'), async (req, res, next) => {
  try {
    const cred = await req.prisma.credential.updateMany({ where: { id: req.params.id, orgId: req.orgId }, data: req.body });
    res.json({ updated: cred.count });
  } catch (err) { next(err); }
});

module.exports = router;
