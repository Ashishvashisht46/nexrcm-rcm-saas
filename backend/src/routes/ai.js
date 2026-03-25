// ─── AI Routes — All AI-Powered Endpoints ──────────────────
const router = require('express').Router();
const { authenticate, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const ai = require('../services/ai');

router.use(authenticate, orgScope);

// ─── 1. AI Coding Suggestions ───────────────────────────────
// POST /ai/code-from-notes — Analyze clinical notes → ICD-10 + CPT
router.post('/code-from-notes', auditLog('ai_coding', 'encounter'), async (req, res, next) => {
  try {
    const { clinicalNotes, encounterContext } = req.body;
    if (!clinicalNotes) return res.status(400).json({ error: 'Clinical notes are required.' });
    const suggestions = await ai.suggestCodesFromNotes(clinicalNotes, encounterContext);
    res.json({ aiModel: process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324', ...suggestions });
  } catch (err) { next(err); }
});

// ─── 2. AI Clinical Note Extraction ─────────────────────────
// POST /ai/extract-billable — Extract all billable services from notes
router.post('/extract-billable', auditLog('ai_extraction', 'encounter'), async (req, res, next) => {
  try {
    const { clinicalNotes } = req.body;
    if (!clinicalNotes) return res.status(400).json({ error: 'Clinical notes are required.' });
    const extraction = await ai.extractBillableServices(clinicalNotes);
    res.json(extraction);
  } catch (err) { next(err); }
});

// ─── 3. AI Claim Scrubbing ──────────────────────────────────
// POST /ai/scrub-claim/:id — AI-enhanced claim validation
router.post('/scrub-claim/:id', auditLog('ai_scrub', 'claim'), async (req, res, next) => {
  try {
    const claim = await req.prisma.claim.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: {
        lines: true,
        patient: { select: { dateOfBirth: true, gender: true, firstName: true, lastName: true } },
        provider: { select: { npi: true, firstName: true, lastName: true, specialty: true } },
        insurancePolicy: true,
        encounter: { include: { diagnoses: true } },
      },
    });
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    const aiResults = await ai.aiScrubClaim(claim);

    // Save results to claim
    await req.prisma.claim.update({
      where: { id: claim.id },
      data: {
        scrubResults: aiResults,
        scrubPassed: aiResults.overall_risk !== 'high' && !aiResults.issues?.some(i => i.severity === 'error'),
      },
    });

    res.json(aiResults);
  } catch (err) { next(err); }
});

// ─── 4. AI Denial Analysis ──────────────────────────────────
// POST /ai/analyze-denial/:denialId
router.post('/analyze-denial/:denialId', auditLog('ai_denial_analysis', 'denial'), async (req, res, next) => {
  try {
    const denial = await req.prisma.denial.findUnique({
      where: { id: req.params.denialId },
      include: {
        claim: {
          include: {
            lines: true,
            patient: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!denial) return res.status(404).json({ error: 'Denial not found.' });

    // Get historical claims for this payer
    const history = await req.prisma.claim.findMany({
      where: { orgId: req.orgId, payerName: denial.claim.payerName, status: 'DENIED' },
      select: { claimNumber: true, totalCharged: true, status: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    const analysis = await ai.analyzeDenial(denial, denial.claim, history);

    // Update denial with AI analysis
    await req.prisma.denial.update({
      where: { id: denial.id },
      data: {
        aiCategory: analysis.category,
        denialCategory: analysis.category,
        recoveryLikelihood: analysis.recovery_likelihood,
        isAppealable: analysis.is_appealable,
      },
    });

    res.json(analysis);
  } catch (err) { next(err); }
});

// ─── 5. AI Appeal Letter Generation ─────────────────────────
// POST /ai/generate-appeal/:denialId
router.post('/generate-appeal/:denialId', auditLog('ai_appeal', 'denial'), async (req, res, next) => {
  try {
    const denial = await req.prisma.denial.findUnique({
      where: { id: req.params.denialId },
      include: {
        claim: {
          include: {
            lines: true,
            patient: true,
            provider: true,
          },
        },
      },
    });
    if (!denial) return res.status(404).json({ error: 'Denial not found.' });

    const letter = await ai.generateAppealLetter(
      denial, denial.claim, denial.claim.patient, denial.claim.provider,
      req.body.additionalContext
    );

    // Create appeal record with AI letter
    const appeal = await req.prisma.appeal.create({
      data: {
        denialId: denial.id,
        appealLevel: req.body.appealLevel || 1,
        status: 'DRAFT',
        aiGenerated: true,
        notes: letter,
      },
    });

    res.json({ appeal, letter });
  } catch (err) { next(err); }
});

// ─── 6. AI Denial Pattern Detection ─────────────────────────
// GET /ai/denial-patterns
router.get('/denial-patterns', auditLog('ai_denial_patterns', 'denial'), async (req, res, next) => {
  try {
    const { timeframe = '90' } = req.query;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parseInt(timeframe));

    const denials = await req.prisma.denial.findMany({
      where: { claim: { orgId: req.orgId }, denialDate: { gte: sinceDate } },
      select: {
        carcCode: true, rarcCode: true, denialCategory: true, amountDenied: true, denialDate: true,
        claim: { select: { payerName: true, claimNumber: true, lines: { select: { cptCode: true } } } },
      },
    });

    const patterns = await ai.detectDenialPatterns(denials, `${timeframe} days`);
    res.json(patterns);
  } catch (err) { next(err); }
});

// ─── 7. AI Revenue Forecast ─────────────────────────────────
// GET /ai/revenue-forecast
router.get('/revenue-forecast', auditLog('ai_forecast', 'report'), async (req, res, next) => {
  try {
    // Get historical monthly collections
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const paidClaims = await req.prisma.claim.findMany({
      where: { orgId: req.orgId, status: { in: ['PAID', 'PARTIAL'] }, updatedAt: { gte: sixMonthsAgo } },
      select: { totalPaid: true, updatedAt: true },
    });

    // Group by month
    const monthlyCollections = {};
    paidClaims.forEach(c => {
      const month = c.updatedAt.toISOString().slice(0, 7);
      monthlyCollections[month] = (monthlyCollections[month] || 0) + parseFloat(c.totalPaid);
    });

    // Get current AR pipeline
    const arPipeline = await req.prisma.claim.groupBy({
      by: ['status'],
      where: { orgId: req.orgId, status: { in: ['SUBMITTED', 'PENDING', 'PARTIAL', 'DENIED', 'APPEALED'] } },
      _sum: { balance: true },
      _count: true,
    });

    // Get denial stats
    const denialStats = await req.prisma.denial.groupBy({
      by: ['denialCategory'],
      where: { claim: { orgId: req.orgId } },
      _sum: { amountDenied: true },
      _count: true,
    });

    const forecast = await ai.forecastRevenue(monthlyCollections, arPipeline, denialStats);
    res.json(forecast);
  } catch (err) { next(err); }
});

// ─── 8. AI Work Queue Prioritization ────────────────────────
// POST /ai/prioritize-queue
router.post('/prioritize-queue', auditLog('ai_prioritize', 'work_queue'), async (req, res, next) => {
  try {
    const items = await req.prisma.workQueueItem.findMany({
      where: { status: { in: ['open', 'in_progress'] }, claim: { orgId: req.orgId } },
      include: {
        claim: {
          select: {
            claimNumber: true, totalCharged: true, balance: true, daysInAR: true,
            payerName: true, status: true, denial: { select: { carcCode: true, recoveryLikelihood: true } },
          },
        },
      },
      take: 50,
    });

    const prioritized = await ai.prioritizeWorkQueue(items.map(i => ({
      id: i.id,
      type: i.type,
      title: i.title,
      currentPriority: i.priority,
      claimNumber: i.claim?.claimNumber,
      balance: i.claim?.balance,
      daysInAR: i.claim?.daysInAR,
      payer: i.claim?.payerName,
      denialCode: i.claim?.denial?.carcCode,
      recoveryLikelihood: i.claim?.denial?.recoveryLikelihood,
    })));

    // Apply updated priorities
    if (prioritized?.prioritized_items) {
      for (const item of prioritized.prioritized_items) {
        await req.prisma.workQueueItem.update({
          where: { id: item.id },
          data: { priority: item.priority, aiReason: item.reason },
        }).catch(() => {}); // Skip if item doesn't exist
      }
    }

    res.json(prioritized);
  } catch (err) { next(err); }
});

// ─── 9. AI Chat Assistant ───────────────────────────────────
// POST /ai/chat
router.post('/chat', auditLog('ai_chat', 'assistant'), async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    // Build context from current user's data
    const [claimStats, denialStats, arStats] = await Promise.all([
      req.prisma.claim.groupBy({
        by: ['status'], where: { orgId: req.orgId }, _count: true, _sum: { totalCharged: true, totalPaid: true, balance: true },
      }),
      req.prisma.denial.findMany({
        where: { claim: { orgId: req.orgId } }, take: 5, orderBy: { createdAt: 'desc' },
        select: { carcCode: true, denialCategory: true, amountDenied: true },
      }),
      req.prisma.claim.aggregate({
        where: { orgId: req.orgId, status: { in: ['SUBMITTED', 'PENDING'] } }, _avg: { daysInAR: true }, _sum: { balance: true },
      }),
    ]);

    const context = {
      userRole: req.user.role,
      claimSummary: claimStats,
      recentDenials: denialStats,
      arSummary: { avgDaysInAR: arStats._avg.daysInAR, totalOutstanding: arStats._sum.balance },
    };

    const response = await ai.chatAssistant(message, context);
    res.json({ response, context: { role: req.user.role } });
  } catch (err) { next(err); }
});

// ─── 10. AI Prior Auth Prediction ───────────────────────────
// POST /ai/predict-auth
router.post('/predict-auth', auditLog('ai_prior_auth', 'prior_auth'), async (req, res, next) => {
  try {
    const { cptCodes, payerName, diagnosis } = req.body;
    if (!cptCodes?.length) return res.status(400).json({ error: 'CPT codes required.' });
    const prediction = await ai.predictPriorAuthNeed(cptCodes, payerName, diagnosis);
    res.json(prediction);
  } catch (err) { next(err); }
});

// ─── 11. AI Payer Analysis ──────────────────────────────────
// GET /ai/payer-analysis/:payerName
router.get('/payer-analysis/:payerName', auditLog('ai_payer_analysis', 'report'), async (req, res, next) => {
  try {
    const claims = await req.prisma.claim.findMany({
      where: { orgId: req.orgId, payerName: { contains: req.params.payerName, mode: 'insensitive' } },
      select: { claimNumber: true, status: true, totalCharged: true, totalPaid: true, adjustments: true, daysInAR: true, dateOfService: true },
      orderBy: { dateOfService: 'desc' },
      take: 50,
    });
    const analysis = await ai.analyzePayerBehavior(req.params.payerName, claims);
    res.json(analysis);
  } catch (err) { next(err); }
});

// ─── 12. AI Patient Message Generation ──────────────────────
// POST /ai/generate-message
router.post('/generate-message', auditLog('ai_message', 'patient'), async (req, res, next) => {
  try {
    const { type, patientId, context } = req.body;
    const patient = await req.prisma.patient.findFirst({
      where: { id: patientId, orgId: req.orgId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    const message = await ai.generatePatientMessage(type, patient, context);
    res.json(message);
  } catch (err) { next(err); }
});

// ─── 13. AI Payment Matching ────────────────────────────────
// POST /ai/match-payment
router.post('/match-payment', auditLog('ai_payment_match', 'payment'), async (req, res, next) => {
  try {
    const { paymentDetails } = req.body;
    const unmatchedClaims = await req.prisma.claim.findMany({
      where: { orgId: req.orgId, status: { in: ['SUBMITTED', 'PENDING'] }, payerName: { contains: paymentDetails.payerName, mode: 'insensitive' } },
      select: { id: true, claimNumber: true, totalCharged: true, dateOfService: true, payerName: true, patient: { select: { firstName: true, lastName: true } } },
      take: 30,
    });
    const matches = await ai.matchUnpostedPayment(paymentDetails, unmatchedClaims);
    res.json(matches);
  } catch (err) { next(err); }
});

// ─── AI Health Check ────────────────────────────────────────
router.get('/status', async (req, res) => {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  const model = process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324';

  // Cost per 1M tokens (approx) for common models
  const costMap = {
    'deepseek/deepseek-chat-v3-0324': '$0.27 input / $1.10 output',
    'google/gemini-2.0-flash-001': '$0.10 input / $0.40 output',
    'meta-llama/llama-3.1-70b-instruct': '$0.52 input / $0.75 output',
    'qwen/qwen-2.5-72b-instruct': '$0.36 input / $0.80 output',
    'anthropic/claude-3.5-haiku': '$0.80 input / $4.00 output',
    'anthropic/claude-sonnet-4': '$3.00 input / $15.00 output',
    'openai/gpt-4o': '$2.50 input / $10.00 output',
  };

  const mode = hasKey ? 'ai' : 'fallback-rules';
  res.json({
    ai_enabled: hasKey,
    provider: 'openrouter',
    model,
    cost_per_million_tokens: costMap[model] || 'unknown',
    mode,
    features: {
      coding_suggestions: hasKey ? 'ai' : 'rule-based',
      clinical_extraction: hasKey ? 'ai' : 'unavailable',
      claim_scrubbing: hasKey ? 'ai-enhanced' : 'rule-based',
      denial_analysis: hasKey ? 'ai' : 'rule-based',
      appeal_generation: hasKey ? 'ai' : 'template',
      denial_patterns: hasKey ? 'ai' : 'unavailable',
      revenue_forecast: hasKey ? 'ai' : 'unavailable',
      queue_prioritization: hasKey ? 'ai' : 'score-based',
      chat_assistant: hasKey ? 'ai' : 'unavailable',
      prior_auth_prediction: hasKey ? 'ai' : 'unavailable',
      payer_analysis: hasKey ? 'ai' : 'unavailable',
      patient_messages: hasKey ? 'ai' : 'template',
      payment_matching: hasKey ? 'ai' : 'exact-match-only',
    },
    available_models: Object.keys(costMap),
  });
});

module.exports = router;
