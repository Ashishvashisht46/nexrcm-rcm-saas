// ─── Patient Routes ─────────────────────────────────────────
const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate, orgScope);

// GET /patients — List/search patients
router.get('/', auditLog('list', 'patient'), async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25, sortBy = 'lastName', sortDir = 'asc' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { orgId: req.orgId };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { mrn: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [patients, total] = await Promise.all([
      req.prisma.patient.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortDir },
        select: {
          id: true, mrn: true, firstName: true, lastName: true,
          dateOfBirth: true, gender: true, phone: true, email: true,
          isActive: true, createdAt: true,
          insurancePolicies: {
            where: { isActive: true },
            select: { id: true, payerName: true, memberId: true, priority: true },
            orderBy: { priority: 'asc' },
            take: 2,
          },
          _count: { select: { claims: true, appointments: true } },
        },
      }),
      req.prisma.patient.count({ where }),
    ]);

    res.json({
      patients,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) { next(err); }
});

// GET /patients/:id — Full patient detail
router.get('/:id', auditLog('view', 'patient'), async (req, res, next) => {
  try {
    const patient = await req.prisma.patient.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: {
        insurancePolicies: { orderBy: { priority: 'asc' } },
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 10 },
        claims: { orderBy: { createdAt: 'desc' }, take: 20, select: {
          id: true, claimNumber: true, status: true, totalCharged: true,
          totalPaid: true, balance: true, dateOfService: true, payerName: true,
        }},
        ledgerEntries: { orderBy: { postedAt: 'desc' }, take: 30 },
        eligibilityChecks: { orderBy: { checkedAt: 'desc' }, take: 5 },
        documents: { orderBy: { uploadedAt: 'desc' } },
      },
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    res.json(patient);
  } catch (err) { next(err); }
});

// POST /patients — Create patient
router.post('/', [
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('dateOfBirth').isISO8601(),
], auditLog('create', 'patient'), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { firstName, lastName, dateOfBirth, gender, email, phone, address, city, state, zip, mrn } = req.body;

    // Auto-generate MRN if not provided
    const patientMrn = mrn || `MRN-${Date.now().toString(36).toUpperCase()}`;

    const patient = await req.prisma.patient.create({
      data: {
        orgId: req.orgId, firstName, lastName,
        dateOfBirth: new Date(dateOfBirth),
        gender, email, phone, address, city, state, zip,
        mrn: patientMrn,
      },
    });

    res.status(201).json(patient);
  } catch (err) { next(err); }
});

// PUT /patients/:id — Update patient
router.put('/:id', auditLog('update', 'patient'), async (req, res, next) => {
  try {
    const { firstName, lastName, dateOfBirth, gender, email, phone, address, city, state, zip } = req.body;
    const patient = await req.prisma.patient.updateMany({
      where: { id: req.params.id, orgId: req.orgId },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(dateOfBirth && { dateOfBirth: new Date(dateOfBirth) }),
        ...(gender && { gender }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zip !== undefined && { zip }),
      },
    });
    if (patient.count === 0) return res.status(404).json({ error: 'Patient not found.' });

    const updated = await req.prisma.patient.findFirst({ where: { id: req.params.id, orgId: req.orgId } });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /patients/:id/insurance — Add insurance policy
router.post('/:id/insurance', [
  body('payerName').trim().notEmpty(),
  body('memberId').trim().notEmpty(),
], auditLog('create', 'insurance_policy'), async (req, res, next) => {
  try {
    const patient = await req.prisma.patient.findFirst({ where: { id: req.params.id, orgId: req.orgId } });
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const policy = await req.prisma.insurancePolicy.create({
      data: { patientId: req.params.id, ...req.body },
    });

    res.status(201).json(policy);
  } catch (err) { next(err); }
});

// GET /patients/:id/ledger — Patient account ledger
router.get('/:id/ledger', auditLog('view', 'patient_ledger'), async (req, res, next) => {
  try {
    const entries = await req.prisma.patientLedger.findMany({
      where: { patientId: req.params.id },
      orderBy: { postedAt: 'desc' },
    });
    const balance = entries.length > 0 ? entries[0].balance : 0;
    res.json({ entries, currentBalance: balance });
  } catch (err) { next(err); }
});

module.exports = router;
