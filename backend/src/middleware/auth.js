// ─── Authentication & Authorization Middleware ──────────────
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Verify JWT token and attach user to request
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Provide Bearer token.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.userId,
      orgId: payload.orgId,
      email: payload.email,
      role: payload.role,
      firstName: payload.firstName,
      lastName: payload.lastName,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please refresh or login again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

// Role-based access control — accepts array of allowed roles
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`Access denied: ${req.user.email} (${req.user.role}) attempted ${req.method} ${req.path}`);
      return res.status(403).json({ error: 'Insufficient permissions for this action.' });
    }
    next();
  };
}

// Ensure user can only access their own org's data
function orgScope(req, res, next) {
  if (!req.user?.orgId) {
    return res.status(403).json({ error: 'Organization context required.' });
  }
  // Attach org filter to be used in queries
  req.orgId = req.user.orgId;
  next();
}

// Optional auth — doesn't fail if no token, but attaches user if present
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        id: payload.userId,
        orgId: payload.orgId,
        email: payload.email,
        role: payload.role,
      };
    } catch (err) {
      // Token invalid — continue without user
    }
  }
  next();
}

// Generate JWT tokens
function generateTokens(user) {
  const accessToken = jwt.sign(
    {
      userId: user.id,
      orgId: user.orgId,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id, orgId: user.orgId },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY = {
  SUPER_ADMIN: 100,
  ADMIN: 90,
  BILLING_MANAGER: 70,
  BILLER: 60,
  CODER: 60,
  AR_SPECIALIST: 60,
  CREDENTIALING: 50,
  FRONT_DESK: 40,
  PROVIDER: 50,
  PATIENT: 10,
};

function hasHigherRole(userRole, requiredRole) {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}

module.exports = {
  authenticate,
  authorize,
  orgScope,
  optionalAuth,
  generateTokens,
  hasHigherRole,
  ROLE_HIERARCHY,
};
