const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { authenticate, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

// GET /appointments — Calendar view
router.get('/', auditLog('list', 'appointment'), async (req, res, next) => {
  try {
    const { startDate, endDate, providerId, locationId, status, page = 1, limit = 50 } = req.query;
    const where = { orgId: req.orgId };
    if (startDate || endDate) {
      where.scheduledAt = {};
      if (startDate) where.scheduledAt.gte = new Date(startDate);
      if (endDate) where.scheduledAt.lte = new Date(endDate);
    }
    if (providerId) where.providerId = providerId;
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;

    const [appointments, total] = await Promise.all([
      req.prisma.appointment.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        orderBy: { scheduledAt: 'asc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true, mrn: true } },
          provider: { select: { id: true, firstName: true, lastName: true } },
          location: { select: { id: true, name: true } },
        },
      }),
      req.prisma.appointment.count({ where }),
    ]);
    res.json({ appointments, total });
  } catch (err) { next(err); }
});

// POST /appointments — Schedule appointment
router.post('/', [body('patientId').isUUID(), body('providerId').isUUID(), body('locationId').isUUID(), body('scheduledAt').isISO8601()],
auditLog('create', 'appointment'), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const appt = await req.prisma.appointment.create({ data: { orgId: req.orgId, ...req.body, scheduledAt: new Date(req.body.scheduledAt) } });
    res.status(201).json(appt);
  } catch (err) { next(err); }
});

// POST /appointments/:id/check-in
router.post('/:id/check-in', auditLog('check_in', 'appointment'), async (req, res, next) => {
  try {
    const appt = await req.prisma.appointment.updateMany({
      where: { id: req.params.id, orgId: req.orgId },
      data: { status: 'CHECKED_IN', checkedInAt: new Date(), copayCollected: req.body.copayAmount || null },
    });
    if (appt.count === 0) return res.status(404).json({ error: 'Appointment not found.' });
    // Trigger eligibility check automation
    res.json({ message: 'Patient checked in successfully.' });
  } catch (err) { next(err); }
});

// POST /appointments/:id/check-out
router.post('/:id/check-out', auditLog('check_out', 'appointment'), async (req, res, next) => {
  try {
    await req.prisma.appointment.updateMany({
      where: { id: req.params.id, orgId: req.orgId },
      data: { status: 'CHECKED_OUT', checkedOutAt: new Date() },
    });
    res.json({ message: 'Patient checked out.' });
  } catch (err) { next(err); }
});

module.exports = router;
