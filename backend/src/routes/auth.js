// ─── Auth Routes ────────────────────────────────────────────
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { authenticate, generateTokens } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const jwt = require('jsonwebtoken');

// POST /auth/register — Create new org + admin user
router.post('/register', [
  body('orgName').trim().notEmpty().withMessage('Organization name required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be 8+ characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password needs uppercase, lowercase, and number'),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { orgName, email, password, firstName, lastName, npi, phone } = req.body;

    // Check if email already exists
    const existing = await req.prisma.user.findFirst({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);

    // Create org + admin user in transaction
    const result = await req.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: orgName, npi, phone, email },
      });

      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email,
          passwordHash,
          firstName,
          lastName,
          role: 'ADMIN',
          phone,
        },
      });

      // Create default fee schedule
      await tx.feeSchedule.create({
        data: {
          orgId: org.id,
          name: 'Standard Fee Schedule',
          type: 'standard',
          isDefault: true,
          effectiveDate: new Date(),
        },
      });

      // Create default location
      await tx.location.create({
        data: {
          orgId: org.id,
          name: 'Main Office',
          address: '',
          city: '',
          state: '',
          zip: '',
        },
      });

      return { org, user };
    });

    const tokens = generateTokens(result.user);

    await logAudit(req.prisma, {
      orgId: result.org.id,
      userId: result.user.id,
      action: 'register',
      resource: 'organization',
      resourceId: result.org.id,
      details: { orgName },
    });

    res.status(201).json({
      message: 'Organization created successfully',
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
      organization: {
        id: result.org.id,
        name: result.org.name,
      },
      ...tokens,
    });
  } catch (err) { next(err); }
});

// POST /auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    const user = await req.prisma.user.findFirst({
      where: { email, isActive: true },
      include: { org: { select: { id: true, name: true, settings: true } } },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Update last login
    await req.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = generateTokens(user);

    await logAudit(req.prisma, {
      orgId: user.orgId,
      userId: user.id,
      action: 'login',
      resource: 'user',
      resourceId: user.id,
      details: { ip: req.ip },
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
      organization: user.org,
      ...tokens,
    });
  } catch (err) { next(err); }
});

// POST /auth/refresh — Refresh access token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required.' });

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const user = await req.prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive.' });

    const tokens = generateTokens(user);
    res.json(tokens);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expired. Please login again.' });
    }
    next(err);
  }
});

// GET /auth/me — Get current user profile
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await req.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, phone: true, avatarUrl: true, mfaEnabled: true,
        createdAt: true, lastLoginAt: true,
        org: { select: { id: true, name: true, settings: true, subscriptionTier: true } },
      },
    });
    res.json(user);
  } catch (err) { next(err); }
});

// POST /auth/change-password
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const user = await req.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    await req.prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await bcrypt.hash(req.body.newPassword, 12) },
    });

    res.json({ message: 'Password changed successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
