// ─── Claims Routes ──────────────────────────────────────────
const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { authenticate, authorize, orgScope } = require('../middleware/auth');
const { auditLog, logAudit } = require('../middleware/audit');
const { v4: uuid } = require('uuid');

router.use(authenticate, orgScope);

// GET /claims — List claims with filters
router.get('/', auditLog('list', 'claim'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25, search, payerName, providerId, agingBucket, sortBy = 'createdAt', sortDir = 'desc' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { orgId: req.orgId };

    if (status) where.status = status;
    if (payerName) where.payerName = { contains: payerName, mode: 'insensitive' };
    if (providerId) where.providerId = providerId;
    if (search) {
      where.OR = [
        { claimNumber: { contains: search, mode: 'insensitive' } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (agingBucket) {
      const now = new Date();
      const buckets = {
        '0-30': { gte: 0, lte: 30 },
        '31-60': { gte: 31, lte: 60 },
        '61-90': { gte: 61, lte: 90 },
        '90+': { gte: 91 },
      };
      if (buckets[agingBucket]) where.daysInAR = buckets[agingBucket];
    }

    const [claims, total] = await Promise.all([
      req.prisma.claim.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { [sortBy]: sortDir },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          provider: { select: { id: true, firstName: true, lastName: true } },
          lines: true,
          _count: { select: { notes: true } },
        },
      }),
      req.prisma.claim.count({ where }),
    ]);

    res.json({
      claims,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) { next(err); }
});

// GET /claims/work-queue — Prioritized work queue
router.get('/work-queue', auditLog('list', 'work_queue'), async (req, res, next) => {
  try {
    const { type, assignedTo, status = 'open' } = req.query;
    const where = { status };
    if (type) where.type = type;
    if (assignedTo) where.assignedTo = assignedTo;

    const items = await req.prisma.workQueueItem.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        claim: {
          select: {
            id: true, claimNumber: true, status: true, totalCharged: true,
            balance: true, daysInAR: true, payerName: true,
            patient: { select: { firstName: true, lastName: true } },
          },
        },
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
      take: 100,
    });

    res.json(items);
  } catch (err) { next(err); }
});

// GET /claims/:id — Claim detail
router.get('/:id', auditLog('view', 'claim'), async (req, res, next) => {
  try {
    const claim = await req.prisma.claim.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: {
        patient: true,
        provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
        insurancePolicy: true,
        lines: { orderBy: { lineNumber: 'asc' } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
        notes: { orderBy: { createdAt: 'desc' }, include: { user: { select: { firstName: true, lastName: true } } } },
        denial: { include: { appeals: { orderBy: { createdAt: 'desc' } } } },
        insurancePayments: true,
      },
    });
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    res.json(claim);
  } catch (err) { next(err); }
});

// POST /claims — Create new claim
router.post('/', [
  body('patientId').isUUID(),
  body('providerId').isUUID(),
  body('dateOfService').isISO8601(),
], auditLog('create', 'claim'), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { patientId, providerId, dateOfService, insurancePolicyId, lines, placeOfService, priorAuthNumber } = req.body;

    // Generate claim number: CLM-YYYYMMDD-XXXX
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await req.prisma.claim.count({ where: { orgId: req.orgId } });
    const claimNumber = `CLM-${today}-${String(count + 1).padStart(4, '0')}`;

    // Get payer info from insurance policy if provided
    let payerName = null, payerId = null;
    if (insurancePolicyId) {
      const policy = await req.prisma.insurancePolicy.findUnique({ where: { id: insurancePolicyId } });
      if (policy) { payerName = policy.payerName; payerId = policy.payerId; }
    }

    const totalCharged = (lines || []).reduce((sum, l) => sum + (parseFloat(l.chargedAmount) * (l.units || 1)), 0);

    const claim = await req.prisma.claim.create({
      data: {
        orgId: req.orgId,
        claimNumber,
        patientId,
        providerId,
        dateOfService: new Date(dateOfService),
        insurancePolicyId,
        payerName,
        payerId,
        placeOfService: placeOfService || '11',
        priorAuthNumber,
        totalCharged,
        balance: totalCharged,
        status: 'DRAFT',
        lines: lines ? {
          create: lines.map((l, i) => ({
            lineNumber: i + 1,
            cptCode: l.cptCode,
            modifiers: l.modifiers || [],
            icdPointers: l.icdPointers || [1],
            units: l.units || 1,
            chargedAmount: l.chargedAmount,
          })),
        } : undefined,
        statusHistory: {
          create: {
            toStatus: 'DRAFT',
            changedBy: req.user.id,
            note: 'Claim created',
          },
        },
      },
      include: { lines: true },
    });

    res.status(201).json(claim);
  } catch (err) { next(err); }
});

// POST /claims/:id/scrub — Run claim scrubbing (rules + AI)
router.post('/:id/scrub', auditLog('scrub', 'claim'), async (req, res, next) => {
  try {
    const claim = await req.prisma.claim.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: { lines: true, patient: true, provider: true, insurancePolicy: true, encounter: { include: { diagnoses: true } } },
    });
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });

    // Phase 1: Rule-based scrubbing
    const ruleResults = await scrubClaim(claim, req.prisma);

    // Phase 2: AI-enhanced scrubbing (runs in parallel)
    const ai = require('../services/ai');
    const aiResults = await ai.aiScrubClaim(claim);

    // Merge results: rule-based errors + AI insights
    const allIssues = [
      ...ruleResults.map(r => ({ ...r, source: 'rules' })),
      ...(aiResults?.issues || []).map(i => ({ ...i, source: 'ai' })),
    ];

    const hasErrors = allIssues.some(r => r.severity === 'error');
    const combinedResults = {
      passed: !hasErrors,
      overall_risk: aiResults?.overall_risk || (hasErrors ? 'high' : 'low'),
      denial_risk: aiResults?.estimated_denial_risk || null,
      confidence: aiResults?.confidence_score || null,
      issues: allIssues,
      payer_notes: aiResults?.payer_specific_notes || null,
      recommended_changes: aiResults?.recommended_changes || [],
    };

    await req.prisma.claim.update({
      where: { id: claim.id },
      data: {
        scrubPassed: !hasErrors,
        scrubResults: combinedResults,
        status: hasErrors ? 'SCRUB_FAILED' : 'READY',
        statusHistory: {
          create: {
            fromStatus: claim.status,
            toStatus: hasErrors ? 'SCRUB_FAILED' : 'READY',
            changedBy: req.user.id,
            note: hasErrors
              ? `Scrub failed: ${allIssues.filter(r => r.severity === 'error').length} errors (AI risk: ${combinedResults.overall_risk})`
              : `Scrub passed (AI denial risk: ${((combinedResults.denial_risk || 0) * 100).toFixed(0)}%)`,
          },
        },
      },
    });

    res.json(combinedResults);
  } catch (err) { next(err); }
});

// POST /claims/:id/submit — Submit claim to clearinghouse
router.post('/:id/submit', authorize('ADMIN', 'BILLING_MANAGER', 'BILLER'), auditLog('submit', 'claim'), async (req, res, next) => {
  try {
    const claim = await req.prisma.claim.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: { lines: true, patient: true, provider: true, insurancePolicy: true },
    });
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    if (!claim.scrubPassed) return res.status(400).json({ error: 'Claim must pass scrubbing before submission.' });

    // Generate EDI 837 file
    const edi837 = generate837(claim);

    // TODO: Send to clearinghouse API
    // const response = await clearinghouse.submit(edi837);

    await req.prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: 'SUBMITTED',
        filingDate: new Date(),
        daysInAR: 0,
        statusHistory: {
          create: {
            fromStatus: claim.status,
            toStatus: 'SUBMITTED',
            changedBy: req.user.id,
            note: 'Claim submitted to clearinghouse',
          },
        },
      },
    });

    res.json({ message: 'Claim submitted successfully.', claimNumber: claim.claimNumber });
  } catch (err) { next(err); }
});

// POST /claims/:id/notes — Add note to claim
router.post('/:id/notes', [body('content').trim().notEmpty()], auditLog('create', 'claim_note'), async (req, res, next) => {
  try {
    const note = await req.prisma.claimNote.create({
      data: {
        claimId: req.params.id,
        userId: req.user.id,
        type: 'manual',
        content: req.body.content,
      },
    });
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// ─── Claim Scrubbing Engine ─────────────────────────────────
async function scrubClaim(claim, prisma) {
  const results = [];

  // Load active scrub rules
  const rules = await prisma.scrubRule.findMany({ where: { isActive: true } });

  // Rule 1: Patient demographics check
  if (!claim.patient.dateOfBirth) {
    results.push({ rule: 'DEMOGRAPHICS', severity: 'error', message: 'Patient date of birth is required.' });
  }
  if (!claim.patient.gender) {
    results.push({ rule: 'DEMOGRAPHICS', severity: 'warning', message: 'Patient gender not specified. Some payers require this.' });
  }

  // Rule 2: Provider NPI check
  if (!claim.provider.npi || claim.provider.npi.length !== 10) {
    results.push({ rule: 'NPI', severity: 'error', message: 'Valid 10-digit provider NPI required.' });
  }

  // Rule 3: Insurance info check
  if (!claim.insurancePolicy) {
    results.push({ rule: 'INSURANCE', severity: 'error', message: 'No insurance policy linked to claim.' });
  } else if (!claim.insurancePolicy.memberId) {
    results.push({ rule: 'INSURANCE', severity: 'error', message: 'Insurance member ID is required.' });
  }

  // Rule 4: Claim line checks
  if (!claim.lines || claim.lines.length === 0) {
    results.push({ rule: 'CLAIM_LINES', severity: 'error', message: 'At least one claim line (CPT code) is required.' });
  } else {
    for (const line of claim.lines) {
      if (!line.cptCode || line.cptCode.length < 5) {
        results.push({ rule: 'CPT', severity: 'error', message: `Line ${line.lineNumber}: Invalid CPT code "${line.cptCode}".` });
      }
      if (parseFloat(line.chargedAmount) <= 0) {
        results.push({ rule: 'AMOUNT', severity: 'error', message: `Line ${line.lineNumber}: Charged amount must be greater than $0.` });
      }
    }

    // Rule 5: Duplicate CPT check
    const cptCounts = {};
    claim.lines.forEach(l => { cptCounts[l.cptCode] = (cptCounts[l.cptCode] || 0) + 1; });
    Object.entries(cptCounts).forEach(([code, count]) => {
      if (count > 1) {
        results.push({ rule: 'DUPLICATE', severity: 'warning', message: `CPT ${code} appears ${count} times. Verify this is intentional (may need modifier 59/XE).` });
      }
    });
  }

  // Rule 6: Date checks
  const dos = new Date(claim.dateOfService);
  const today = new Date();
  if (dos > today) {
    results.push({ rule: 'DATE', severity: 'error', message: 'Date of service cannot be in the future.' });
  }
  const daysDiff = Math.floor((today - dos) / (1000 * 60 * 60 * 24));
  if (daysDiff > 365) {
    results.push({ rule: 'TIMELY_FILING', severity: 'warning', message: `Date of service is ${daysDiff} days ago. Check payer timely filing limits.` });
  }

  // Rule 7: Prior auth check for high-cost procedures
  const highCostCodes = ['27447', '27130', '63030', '22551', '22612'];
  const needsAuth = claim.lines?.some(l => highCostCodes.includes(l.cptCode));
  if (needsAuth && !claim.priorAuthNumber) {
    results.push({ rule: 'PRIOR_AUTH', severity: 'warning', message: 'High-cost procedure detected. Prior authorization may be required.' });
  }

  // Rule 8: Place of service validation
  const validPOS = ['11', '12', '21', '22', '23', '31', '32', '41', '42', '51', '52', '53', '54', '55', '56', '61', '65', '71', '72', '81', '99'];
  if (claim.placeOfService && !validPOS.includes(claim.placeOfService)) {
    results.push({ rule: 'POS', severity: 'error', message: `Invalid place of service code: ${claim.placeOfService}.` });
  }

  if (results.length === 0) {
    results.push({ rule: 'ALL_CLEAR', severity: 'info', message: 'All scrubbing rules passed. Claim is ready for submission.' });
  }

  return results;
}

// ─── EDI 837 Generator (Professional) ───────────────────────
function generate837(claim) {
  // Simplified 837P generation — production would use a full EDI library
  const segments = [];
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 16).replace(/:/g, '');

  segments.push(`ISA*00*          *00*          *ZZ*NEXRCM         *ZZ*CLEARINGHOUSE  *${date.slice(2)}*${time}*^*00501*000000001*0*P*:~`);
  segments.push(`GS*HC*NEXRCM*CLEARINGHOUSE*${date}*${time}*1*X*005010X222A1~`);
  segments.push(`ST*837*0001*005010X222A1~`);
  segments.push(`BHT*0019*00*${claim.claimNumber}*${date}*${time}*CH~`);

  // Billing provider
  segments.push(`NM1*85*1*${claim.provider.lastName}*${claim.provider.firstName}****XX*${claim.provider.npi}~`);

  // Subscriber/Patient
  segments.push(`NM1*IL*1*${claim.patient.lastName}*${claim.patient.firstName}****MI*${claim.insurancePolicy?.memberId || ''}~`);

  // Claim info
  segments.push(`CLM*${claim.claimNumber}*${claim.totalCharged}***${claim.placeOfService || '11'}:B:1*Y*A*Y*Y~`);

  // Service lines
  claim.lines.forEach(line => {
    const mod = line.modifiers?.length > 0 ? ':' + line.modifiers.join(':') : '';
    segments.push(`SV1*HC:${line.cptCode}${mod}*${line.chargedAmount}*UN*${line.units}***1~`);
    segments.push(`DTP*472*D8*${date}~`);
  });

  segments.push(`SE*${segments.length - 1}*0001~`);
  segments.push(`GE*1*1~`);
  segments.push(`IEA*1*000000001~`);

  return segments.join('\n');
}

module.exports = router;
