// ─── NexRCM Server Entry Point ──────────────────────────────
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const logger = require('./utils/logger');

const app = express();
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

// ── Global Middleware ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for frontend
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Attach Prisma to request
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// ── Static Frontend ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../frontend/public')));

// ── API Routes ──────────────────────────────────────────────
const prefix = process.env.API_PREFIX || '/api/v1';

app.use(`${prefix}/auth`, require('./routes/auth'));
app.use(`${prefix}/users`, require('./routes/users'));
app.use(`${prefix}/patients`, require('./routes/patients'));
app.use(`${prefix}/appointments`, require('./routes/appointments'));
app.use(`${prefix}/eligibility`, require('./routes/eligibility'));
app.use(`${prefix}/encounters`, require('./routes/encounters'));
app.use(`${prefix}/coding`, require('./routes/coding'));
app.use(`${prefix}/claims`, require('./routes/claims'));
app.use(`${prefix}/payments`, require('./routes/payments'));
app.use(`${prefix}/denials`, require('./routes/denials'));
app.use(`${prefix}/prior-auth`, require('./routes/priorAuth'));
app.use(`${prefix}/credentials`, require('./routes/credentials'));
app.use(`${prefix}/fee-schedules`, require('./routes/feeSchedules'));
app.use(`${prefix}/contracts`, require('./routes/contracts'));
app.use(`${prefix}/work-queue`, require('./routes/workQueue'));
app.use(`${prefix}/reports`, require('./routes/reports'));
app.use(`${prefix}/automation`, require('./routes/automation'));
app.use(`${prefix}/audit-log`, require('./routes/auditLog'));
app.use(`${prefix}/dashboard`, require('./routes/dashboard'));
app.use(`${prefix}/portal`, require('./routes/patientPortal'));
app.use(`${prefix}/ai`, require('./routes/ai'));

// ── Health Check ────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ── Error Handling ──────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message}`, {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    stack: err.stack,
  });

  if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A record with that value already exists.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Record not found.' });
    }
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token.' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Start Server ────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    app.listen(PORT, () => {
      logger.info(`NexRCM server running on port ${PORT}`);
      logger.info(`API: http://localhost:${PORT}${prefix}`);
      logger.info(`Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start();

module.exports = app; // for testing
