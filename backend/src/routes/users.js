// ─── User Management Routes ─────────────────────────────────
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate, orgScope);

// GET /users — List staff
router.get('/', authorize('ADMIN', 'SUPER_ADMIN', 'BILLING_MANAGER'), auditLog('list', 'user'), async (req, res, next) => {
  try {
    const users = await req.prisma.user.findMany({
      where: { orgId: req.orgId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { lastName: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

// POST /users — Invite/create staff
router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), [
  body('email').isEmail().normalizeEmail(),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('role').isIn(['ADMIN', 'BILLING_MANAGER', 'BILLER', 'CODER', 'FRONT_DESK', 'PROVIDER', 'AR_SPECIALIST', 'CREDENTIALING']),
], auditLog('create', 'user'), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, firstName, lastName, role, phone } = req.body;
    const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
    const user = await req.prisma.user.create({
      data: { orgId: req.orgId, email, firstName, lastName, role, phone, passwordHash: await bcrypt.hash(tempPassword, 12) },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    // TODO: Send invitation email with temp password
    res.status(201).json({ ...user, message: 'User created. Invitation email will be sent.' });
  } catch (err) { next(err); }
});

// PUT /users/:id — Update user
router.put('/:id', authorize('ADMIN', 'SUPER_ADMIN'), auditLog('update', 'user'), async (req, res, next) => {
  try {
    const { firstName, lastName, role, phone, isActive } = req.body;
    const user = await req.prisma.user.updateMany({
      where: { id: req.params.id, orgId: req.orgId },
      data: { ...(firstName && { firstName }), ...(lastName && { lastName }), ...(role && { role }), ...(phone !== undefined && { phone }), ...(isActive !== undefined && { isActive }) },
    });
    if (user.count === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User updated.' });
  } catch (err) { next(err); }
});

module.exports = router;
