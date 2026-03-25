const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

router.get('/', auditLog('list', 'encounter'), async (req, res, next) => {
  try {
    const { status, providerId, startDate, endDate, page = 1, limit = 25 } = req.query;
    const where = { patient: { orgId: req.orgId } };
    if (status) where.status = status;
    if (providerId) where.providerId = providerId;
    if (startDate || endDate) { where.dateOfService = {}; if (startDate) where.dateOfService.gte = new Date(startDate); if (endDate) where.dateOfService.lte = new Date(endDate); }
    const [encounters, total] = await Promise.all([
      req.prisma.encounter.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        orderBy: { dateOfService: 'desc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          provider: { select: { id: true, firstName: true, lastName: true } },
          diagnoses: { orderBy: { sequence: 'asc' } },
          procedures: { orderBy: { sequence: 'asc' } },
          _count: { select: { charges: true, claims: true } },
        },
      }),
      req.prisma.encounter.count({ where }),
    ]);
    res.json({ encounters, total });
  } catch (err) { next(err); }
});

router.post('/', [body('patientId').isUUID(), body('providerId').isUUID(), body('dateOfService').isISO8601()],
auditLog('create', 'encounter'), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { patientId, providerId, dateOfService, appointmentId, placeOfService, clinicalNotes, diagnoses, procedures } = req.body;
    const encounter = await req.prisma.encounter.create({
      data: {
        patientId, providerId, dateOfService: new Date(dateOfService), appointmentId: appointmentId || null,
        placeOfService: placeOfService || '11', clinicalNotes,
        diagnoses: diagnoses ? { create: diagnoses.map((d, i) => ({ icdCode: d.code, description: d.description, sequence: i + 1 })) } : undefined,
        procedures: procedures ? { create: procedures.map((p, i) => ({
          cptCode: p.code, description: p.description, modifiers: p.modifiers || [], units: p.units || 1,
          fee: p.fee, sequence: i + 1, diagnosisPointers: p.diagnosisPointers || [1],
        })) } : undefined,
      },
      include: { diagnoses: true, procedures: true },
    });
    res.status(201).json(encounter);
  } catch (err) { next(err); }
});

router.post('/:id/charge-capture', authorize('ADMIN', 'BILLING_MANAGER', 'BILLER', 'CODER'),
auditLog('charge_capture', 'encounter'), async (req, res, next) => {
  try {
    const encounter = await req.prisma.encounter.findUnique({ where: { id: req.params.id }, include: { procedures: true } });
    if (!encounter) return res.status(404).json({ error: 'Encounter not found.' });
    const charges = await Promise.all(encounter.procedures.map(proc =>
      req.prisma.charge.create({ data: {
        encounterId: encounter.id, cptCode: proc.cptCode, description: proc.description,
        modifiers: proc.modifiers, units: proc.units, chargeAmount: proc.fee, status: 'POSTED', postedAt: new Date(),
      }})
    ));
    await req.prisma.encounter.update({ where: { id: encounter.id }, data: { status: 'CHARGE_CAPTURED' } });
    res.json({ message: `${charges.length} charges captured.`, charges });
  } catch (err) { next(err); }
});

module.exports = router;
