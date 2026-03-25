const router = require('express').Router();
const { authenticate, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'prior_auth'), async (req, res, next) => {
  try {
    const auths = await req.prisma.priorAuthorization.findMany({
      where: { patient: { orgId: req.orgId } },
      orderBy: { requestDate: 'desc' },
    });
    res.json(auths);
  } catch (err) { next(err); }
});

router.post('/', auditLog('create', 'prior_auth'), async (req, res, next) => {
  try {
    const auth = await req.prisma.priorAuthorization.create({ data: { ...req.body, requestDate: new Date(req.body.requestDate || Date.now()) } });
    res.status(201).json(auth);
  } catch (err) { next(err); }
});

router.put('/:id', auditLog('update', 'prior_auth'), async (req, res, next) => {
  try {
    const auth = await req.prisma.priorAuthorization.update({ where: { id: req.params.id }, data: req.body });
    res.json(auth);
  } catch (err) { next(err); }
});

module.exports = router;
