// ─── HIPAA Audit Logging Middleware ──────────────────────────
const logger = require('../utils/logger');

// Automatically log all data access and modifications
function auditLog(action, resource) {
  return async (req, res, next) => {
    const originalEnd = res.end;
    const startTime = Date.now();

    res.end = function (...args) {
      // Only log if response was successful (2xx/3xx) or is meaningful
      const statusCode = res.statusCode;
      const shouldLog = statusCode < 400 || action === 'delete';

      if (shouldLog && req.user && req.prisma) {
        const resourceId = req.params.id || req.body?.id || null;
        const duration = Date.now() - startTime;

        req.prisma.auditLog.create({
          data: {
            orgId: req.user.orgId,
            userId: req.user.id,
            action,
            resource,
            resourceId,
            details: {
              method: req.method,
              path: req.originalUrl,
              statusCode,
              duration,
              // Don't log sensitive fields
              body: sanitizeBody(req.body),
              query: req.query,
            },
            ipAddress: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers['user-agent'],
          },
        }).catch(err => {
          logger.error('Failed to write audit log:', err.message);
        });
      }

      originalEnd.apply(res, args);
    };

    next();
  };
}

// Remove sensitive fields from audit log body
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return null;
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'passwordHash', 'ssn', 'mfaSecret', 'token', 'refreshToken', 'creditCard'];
  for (const field of sensitiveFields) {
    if (sanitized[field]) sanitized[field] = '[REDACTED]';
  }
  return sanitized;
}

// Quick helper to manually log an audit event
async function logAudit(prisma, { orgId, userId, action, resource, resourceId, details }) {
  try {
    await prisma.auditLog.create({
      data: { orgId, userId, action, resource, resourceId, details },
    });
  } catch (err) {
    logger.error('Audit log write failed:', err.message);
  }
}

module.exports = { auditLog, logAudit };
