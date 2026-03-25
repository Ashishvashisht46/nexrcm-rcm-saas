// ─── NexRCM Automation Worker ────────────────────────────────
// Runs as a separate process: `npm run worker`
// Handles all background jobs: eligibility batch, ERA parsing,
// claim aging, denial categorization, statement generation, etc.

require('dotenv').config();
const { Worker, Queue, QueueScheduler } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

const REDIS_CONFIG = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },
};

// ── Define Queues ───────────────────────────────────────────
const queues = {
  eligibility: new Queue('eligibility', REDIS_CONFIG),
  claims: new Queue('claims', REDIS_CONFIG),
  payments: new Queue('payments', REDIS_CONFIG),
  denials: new Queue('denials', REDIS_CONFIG),
  ar: new Queue('ar-followup', REDIS_CONFIG),
  statements: new Queue('statements', REDIS_CONFIG),
  credentials: new Queue('credentials', REDIS_CONFIG),
  analytics: new Queue('analytics', REDIS_CONFIG),
};

// ── Schedule Recurring Jobs ─────────────────────────────────
async function scheduleRecurringJobs() {
  // Daily 6am: Batch eligibility for next-day appointments
  await queues.eligibility.add('batch-eligibility', {}, {
    repeat: { pattern: '0 6 * * *' }, // cron: 6am daily
    removeOnComplete: 50,
  });

  // Every 4 hours: Fetch ERAs from clearinghouse
  await queues.payments.add('fetch-eras', {}, {
    repeat: { pattern: '0 */4 * * *' },
    removeOnComplete: 20,
  });

  // Daily 8am: Generate AR follow-up tasks
  await queues.ar.add('generate-followups', {}, {
    repeat: { pattern: '0 8 * * *' },
    removeOnComplete: 50,
  });

  // Daily midnight: Update claim aging (days in AR)
  await queues.claims.add('update-aging', {}, {
    repeat: { pattern: '0 0 * * *' },
    removeOnComplete: 30,
  });

  // Weekly Monday 7am: Generate patient statements
  await queues.statements.add('generate-statements', {}, {
    repeat: { pattern: '0 7 * * 1' },
    removeOnComplete: 10,
  });

  // Daily 9am: Check expiring credentials
  await queues.credentials.add('check-expiring', {}, {
    repeat: { pattern: '0 9 * * *' },
    removeOnComplete: 30,
  });

  // Nightly 2am: Analytics rollup
  await queues.analytics.add('daily-rollup', {}, {
    repeat: { pattern: '0 2 * * *' },
    removeOnComplete: 14,
  });

  logger.info('Recurring jobs scheduled');
}

// ═══════════════════════════════════════════════════════════════
// JOB PROCESSORS
// ═══════════════════════════════════════════════════════════════

// ── Eligibility Worker ──────────────────────────────────────
const eligibilityWorker = new Worker('eligibility', async (job) => {
  logger.info(`Processing eligibility job: ${job.name}`);

  if (job.name === 'batch-eligibility') {
    return await batchEligibilityCheck();
  }
  if (job.name === 'verify-single') {
    return await verifySingleEligibility(job.data);
  }
}, REDIS_CONFIG);

async function batchEligibilityCheck() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });

  let totalVerified = 0, totalFailed = 0;

  for (const org of orgs) {
    const appointments = await prisma.appointment.findMany({
      where: {
        orgId: org.id,
        scheduledAt: { gte: tomorrow, lt: dayAfter },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        eligibilityVerified: false,
      },
      include: {
        patient: {
          include: { insurancePolicies: { where: { isActive: true, priority: 1 }, take: 1 } },
        },
      },
    });

    for (const appt of appointments) {
      const policy = appt.patient.insurancePolicies[0];
      if (!policy) continue;

      try {
        // TODO: Replace with real clearinghouse API call
        // const result = await clearinghouse.verify({ memberId: policy.memberId, payerId: policy.payerId, ... });

        await prisma.eligibilityCheck.create({
          data: {
            patientId: appt.patientId,
            insurancePolicyId: policy.id,
            type: 'batch',
            status: 'verified',
            isEligible: true,
            coverageActive: true,
            copay: policy.copay,
            deductible: policy.deductible,
            deductibleMet: policy.deductibleMet,
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        });

        await prisma.appointment.update({
          where: { id: appt.id },
          data: { eligibilityVerified: true },
        });

        totalVerified++;
      } catch (err) {
        totalFailed++;
        logger.error(`Eligibility check failed for patient ${appt.patientId}:`, err.message);
      }
    }
  }

  logger.info(`Batch eligibility complete: ${totalVerified} verified, ${totalFailed} failed`);
  return { verified: totalVerified, failed: totalFailed };
}

async function verifySingleEligibility({ patientId, insurancePolicyId }) {
  // Real-time single patient verification triggered by check-in
  const policy = await prisma.insurancePolicy.findUnique({ where: { id: insurancePolicyId } });
  if (!policy) throw new Error('Policy not found');

  // TODO: Real API call
  const result = {
    isEligible: true,
    coverageActive: true,
    copay: policy.copay || 25,
    deductible: policy.deductible || 1500,
    deductibleMet: policy.deductibleMet || 800,
  };

  await prisma.eligibilityCheck.create({
    data: {
      patientId,
      insurancePolicyId,
      type: 'real_time',
      status: result.isEligible ? 'verified' : 'failed',
      isEligible: result.isEligible,
      coverageActive: result.coverageActive,
      copay: result.copay,
      deductible: result.deductible,
      deductibleMet: result.deductibleMet,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return result;
}

// ── Claims Worker ───────────────────────────────────────────
const claimsWorker = new Worker('claims', async (job) => {
  logger.info(`Processing claims job: ${job.name}`);

  if (job.name === 'update-aging') {
    return await updateClaimAging();
  }
  if (job.name === 'scrub-claim') {
    return await scrubClaimJob(job.data);
  }
  if (job.name === 'submit-claim') {
    return await submitClaimJob(job.data);
  }
}, REDIS_CONFIG);

async function updateClaimAging() {
  // Update daysInAR for all outstanding claims
  const outstandingClaims = await prisma.claim.findMany({
    where: { status: { in: ['SUBMITTED', 'PENDING', 'PARTIAL', 'DENIED', 'APPEALED'] } },
    select: { id: true, filingDate: true, dateOfService: true },
  });

  const today = new Date();
  let updated = 0;

  for (const claim of outstandingClaims) {
    const refDate = claim.filingDate || claim.dateOfService;
    const daysInAR = Math.floor((today - new Date(refDate)) / (1000 * 60 * 60 * 24));

    await prisma.claim.update({
      where: { id: claim.id },
      data: { daysInAR },
    });
    updated++;
  }

  logger.info(`Aging updated for ${updated} claims`);
  return { updated };
}

// ── Payments Worker (ERA Processing) ────────────────────────
const paymentsWorker = new Worker('payments', async (job) => {
  logger.info(`Processing payments job: ${job.name}`);

  if (job.name === 'fetch-eras') {
    return await fetchAndProcessERAs();
  }
  if (job.name === 'auto-post-era') {
    return await autoPostERA(job.data);
  }
}, REDIS_CONFIG);

async function fetchAndProcessERAs() {
  // TODO: Connect to clearinghouse API to fetch 835 files
  // const eraFiles = await clearinghouse.fetchERAs();
  // for (const era of eraFiles) {
  //   const parsed = parse835(era.content);
  //   await queues.payments.add('auto-post-era', { parsed, fileUrl: era.url });
  // }
  logger.info('ERA fetch job completed (clearinghouse integration pending)');
  return { message: 'Awaiting clearinghouse integration' };
}

async function autoPostERA({ parsed, fileUrl }) {
  // Auto-match ERA payments to claims and post
  if (!parsed?.claims) return { posted: 0 };

  let posted = 0, exceptions = 0;

  const payment = await prisma.insurancePayment.create({
    data: {
      payerName: parsed.payerName,
      payerId: parsed.payerId,
      paymentDate: new Date(parsed.paymentDate),
      totalAmount: parsed.totalAmount,
      checkNumber: parsed.checkNumber,
      eraFileUrl: fileUrl,
      autoPosted: true,
      parsedData: parsed,
    },
  });

  for (const eraClaim of parsed.claims) {
    // Try to match by claim number
    const claim = await prisma.claim.findFirst({
      where: { claimNumber: eraClaim.claimNumber },
    });

    if (!claim) {
      exceptions++;
      continue;
    }

    await prisma.insurancePaymentAllocation.create({
      data: {
        insurancePaymentId: payment.id,
        claimId: claim.id,
        paidAmount: eraClaim.paidAmount,
        allowedAmount: eraClaim.allowedAmount,
        adjustmentAmount: eraClaim.adjustmentAmount || 0,
        adjustmentReasonCode: eraClaim.adjustmentReasonCode,
        patientResponsibility: eraClaim.patientResponsibility || 0,
      },
    });

    // Update claim
    const newPaid = parseFloat(claim.totalPaid) + eraClaim.paidAmount;
    const newAdj = parseFloat(claim.adjustments) + (eraClaim.adjustmentAmount || 0);
    const newBalance = parseFloat(claim.totalCharged) - newPaid - newAdj;
    const newStatus = newBalance <= 0.01 ? 'PAID' : eraClaim.paidAmount > 0 ? 'PARTIAL' : 'DENIED';

    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        totalPaid: newPaid,
        totalAllowed: eraClaim.allowedAmount,
        adjustments: newAdj,
        balance: Math.max(0, newBalance),
        patientResponsibility: eraClaim.patientResponsibility || 0,
        status: newStatus,
        statusHistory: {
          create: {
            fromStatus: claim.status,
            toStatus: newStatus,
            note: `ERA auto-posted: paid $${eraClaim.paidAmount}, adj $${eraClaim.adjustmentAmount || 0}`,
          },
        },
      },
    });

    // If denied, create denial record
    if (newStatus === 'DENIED' && eraClaim.adjustmentReasonCode) {
      await prisma.denial.create({
        data: {
          claimId: claim.id,
          denialDate: new Date(),
          carcCode: eraClaim.adjustmentReasonCode,
          amountDenied: parseFloat(claim.totalCharged) - eraClaim.paidAmount,
          denialCategory: categorizeDenial(eraClaim.adjustmentReasonCode),
        },
      });

      // Queue denial categorization
      await queues.denials.add('categorize', { claimId: claim.id });
    }

    posted++;
  }

  await prisma.insurancePayment.update({
    where: { id: payment.id },
    data: { postedAmount: parsed.totalAmount, status: exceptions === 0 ? 'posted' : 'partial' },
  });

  logger.info(`ERA auto-posted: ${posted} claims, ${exceptions} exceptions`);
  return { posted, exceptions };
}

// ── Denials Worker ──────────────────────────────────────────
const denialsWorker = new Worker('denials', async (job) => {
  logger.info(`Processing denials job: ${job.name}`);

  if (job.name === 'categorize') {
    return await categorizeDenialJob(job.data);
  }
}, REDIS_CONFIG);

async function categorizeDenialJob({ claimId }) {
  const denial = await prisma.denial.findUnique({
    where: { claimId },
    include: { claim: { include: { lines: true, patient: { select: { firstName: true, lastName: true } } } } },
  });
  if (!denial) return;

  // Use AI for analysis
  const ai = require('../services/ai');
  const analysis = await ai.analyzeDenial(denial, denial.claim, []);

  const category = analysis?.category || categorizeDenial(denial.carcCode);
  const recoveryLikelihood = analysis?.recovery_likelihood || estimateRecovery(category, denial.carcCode);

  await prisma.denial.update({
    where: { id: denial.id },
    data: {
      aiCategory: category,
      denialCategory: category,
      recoveryLikelihood,
      isAppealable: analysis?.is_appealable ?? recoveryLikelihood > 30,
      appealDeadline: new Date(Date.now() + (analysis?.appeal_deadline_days || 60) * 24 * 60 * 60 * 1000),
    },
  });

  // Create work queue item with AI-generated context
  if (parseFloat(denial.amountDenied) > 100 || recoveryLikelihood > 40) {
    const actionSummary = analysis?.recommended_actions?.[0]?.action || 'Review denial and gather documentation for appeal';
    await prisma.workQueueItem.create({
      data: {
        claimId,
        type: 'denial_review',
        priority: Math.min(100, Math.round(parseFloat(denial.amountDenied) / 10 + recoveryLikelihood)),
        title: `Denial: ${denial.carcCode || 'Unknown'} — $${denial.amountDenied} (${recoveryLikelihood}% recoverable)`,
        description: `AI Analysis: ${analysis?.root_cause || 'Unknown root cause'}. Action: ${actionSummary}`,
        dueDate: denial.appealDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        aiGenerated: true,
        aiReason: `Recovery estimate: $${analysis?.recovery_estimate_dollars || 0}. ${analysis?.appeal_strategy || ''}`.trim(),
      },
    });
  }

  // If AI detected a systemic pattern, auto-generate appeal letter
  if (analysis?.is_appealable && parseFloat(denial.amountDenied) > 500) {
    try {
      const claimFull = await prisma.claim.findUnique({
        where: { id: claimId },
        include: { patient: true, provider: true, lines: true },
      });
      const letter = await ai.generateAppealLetter(denial, claimFull, claimFull.patient, claimFull.provider);
      if (letter) {
        await prisma.appeal.create({
          data: {
            denialId: denial.id,
            appealLevel: 1,
            status: 'DRAFT',
            notes: letter,
            aiGenerated: true,
          },
        });
        logger.info(`Auto-generated appeal letter for claim ${claimId} ($${denial.amountDenied})`);
      }
    } catch (err) {
      logger.warn(`Failed to auto-generate appeal letter: ${err.message}`);
    }
  }

  return { category, recoveryLikelihood, hasAutoAppeal: parseFloat(denial.amountDenied) > 500 };
}

function categorizeDenial(carcCode) {
  if (!carcCode) return 'unknown';
  const code = carcCode.toUpperCase();
  // Common CARC categorizations
  if (['CO-4', 'CO-11', 'CO-18', 'CO-97'].some(c => code.includes(c))) return 'coding';
  if (['CO-15', 'CO-22', 'CO-27'].some(c => code.includes(c))) return 'auth';
  if (['CO-29', 'CO-50', 'CO-55'].some(c => code.includes(c))) return 'coverage';
  if (['CO-29'].some(c => code.includes(c))) return 'timely_filing';
  if (['CO-16', 'CO-96'].some(c => code.includes(c))) return 'medical_necessity';
  if (['CO-18'].some(c => code.includes(c))) return 'duplicate';
  return 'other';
}

function estimateRecovery(category, carcCode) {
  const rates = {
    coding: 70,
    auth: 45,
    coverage: 35,
    timely_filing: 20,
    medical_necessity: 55,
    duplicate: 80,
    other: 50,
    unknown: 40,
  };
  return rates[category] || 40;
}

// ── AR Follow-up Worker ─────────────────────────────────────
const arWorker = new Worker('ar-followup', async (job) => {
  logger.info(`Processing AR job: ${job.name}`);

  if (job.name === 'generate-followups') {
    return await generateARFollowups();
  }
}, REDIS_CONFIG);

async function generateARFollowups() {
  let created = 0;

  // Find claims needing follow-up (30+ days, no recent activity)
  const staleClaims = await prisma.claim.findMany({
    where: {
      status: { in: ['SUBMITTED', 'PENDING'] },
      daysInAR: { gte: 30 },
      lastWorkedAt: {
        OR: [
          { equals: null },
          { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        ],
      },
    },
    select: { id: true, claimNumber: true, daysInAR: true, balance: true, payerName: true, totalCharged: true },
    orderBy: { balance: 'desc' },
    take: 200,
  });

  // Use AI to prioritize if available
  const ai = require('../services/ai');
  let aiPriorities = null;
  try {
    aiPriorities = await ai.prioritizeWorkQueue(staleClaims.map(c => ({
      id: c.id, type: 'follow_up', claimNumber: c.claimNumber,
      balance: c.balance, daysInAR: c.daysInAR, payer: c.payerName,
    })));
  } catch (err) {
    logger.warn('AI prioritization unavailable, using score-based fallback');
  }

  for (const claim of staleClaims) {
    const existing = await prisma.workQueueItem.findFirst({
      where: { claimId: claim.id, status: { in: ['open', 'in_progress'] } },
    });
    if (existing) continue;

    // Use AI priority if available, otherwise calculate
    const aiItem = aiPriorities?.prioritized_items?.find(i => i.id === claim.id);
    const priority = aiItem?.priority || calculateFollowupPriority(claim);
    const urgency = claim.daysInAR > 90 ? 'URGENT' : claim.daysInAR > 60 ? 'HIGH' : 'NORMAL';

    await prisma.workQueueItem.create({
      data: {
        claimId: claim.id,
        type: 'follow_up',
        priority,
        title: `[${urgency}] Follow-up: ${claim.claimNumber} — ${claim.payerName}`,
        description: aiItem?.recommended_action || `${claim.daysInAR} days in AR. Balance: $${claim.balance}. Contact payer for claim status.`,
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        aiGenerated: true,
        aiReason: aiItem?.reason || `Claim stale for ${claim.daysInAR} days with $${claim.balance} balance`,
      },
    });
    created++;
  }

  logger.info(`Generated ${created} AR follow-up tasks ${aiPriorities ? '(AI-prioritized)' : '(score-based)'}`);
  return { created, aiPowered: !!aiPriorities };
}

function calculateFollowupPriority(claim) {
  let priority = 50;
  // Higher balance = higher priority
  const balance = parseFloat(claim.balance);
  if (balance > 5000) priority += 30;
  else if (balance > 1000) priority += 20;
  else if (balance > 500) priority += 10;
  // Older = higher priority
  if (claim.daysInAR > 90) priority += 20;
  else if (claim.daysInAR > 60) priority += 10;
  return Math.min(100, priority);
}

// ── Statements Worker ───────────────────────────────────────
const statementsWorker = new Worker('statements', async (job) => {
  logger.info(`Processing statements job: ${job.name}`);

  if (job.name === 'generate-statements') {
    return await generatePatientStatements();
  }
}, REDIS_CONFIG);

async function generatePatientStatements() {
  // Find patients with outstanding balances
  const patientsWithBalance = await prisma.$queryRaw`
    SELECT DISTINCT p.id, p."firstName", p."lastName", p.email,
      (SELECT balance FROM patient_ledger WHERE "patientId" = p.id ORDER BY "postedAt" DESC LIMIT 1) as balance
    FROM patients p
    INNER JOIN patient_ledger pl ON pl."patientId" = p.id
    WHERE p."isActive" = true
    ORDER BY balance DESC
  `;

  let generated = 0;

  for (const patient of patientsWithBalance) {
    if (!patient.balance || parseFloat(patient.balance) <= 0) continue;

    const statement = await prisma.patientStatement.create({
      data: {
        patientId: patient.id,
        statementDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Due in 30 days
        totalDue: Math.abs(parseFloat(patient.balance)),
        sentVia: patient.email ? 'email' : 'mail',
      },
    });

    // TODO: Generate PDF and email
    // const pdf = await generateStatementPDF(patient, statement);
    // await sendEmail(patient.email, 'Your Statement from NexRCM', pdf);

    generated++;
  }

  logger.info(`Generated ${generated} patient statements`);
  return { generated };
}

// ── Credentials Worker ──────────────────────────────────────
const credentialsWorker = new Worker('credentials', async (job) => {
  logger.info(`Processing credentials job: ${job.name}`);

  if (job.name === 'check-expiring') {
    return await checkExpiringCredentials();
  }
}, REDIS_CONFIG);

async function checkExpiringCredentials() {
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  // Check credentials expiring in 90 days
  const expiring = await prisma.credential.findMany({
    where: {
      expirationDate: { lte: in90Days },
      status: { notIn: ['EXPIRED'] },
    },
    include: {
      provider: { select: { firstName: true, lastName: true } },
      org: { select: { id: true, name: true } },
    },
  });

  let alerts = 0;

  for (const cred of expiring) {
    const daysUntilExpiry = Math.floor((new Date(cred.expirationDate) - new Date()) / (1000 * 60 * 60 * 24));

    // Mark expired ones
    if (daysUntilExpiry <= 0) {
      await prisma.credential.update({
        where: { id: cred.id },
        data: { status: 'EXPIRED' },
      });
    } else if (daysUntilExpiry <= 30) {
      await prisma.credential.update({
        where: { id: cred.id },
        data: { status: 'RENEWAL_NEEDED' },
      });
    }

    // TODO: Send notification email to admin
    // await sendCredentialAlert(cred, daysUntilExpiry);
    alerts++;
  }

  // Also check provider licenses
  const expiringLicenses = await prisma.provider.findMany({
    where: {
      isActive: true,
      licenseExpiry: { lte: in90Days },
    },
  });

  logger.info(`Credential alerts: ${alerts} credentials, ${expiringLicenses.length} licenses expiring`);
  return { credentialAlerts: alerts, licenseAlerts: expiringLicenses.length };
}

// ── Analytics Worker ────────────────────────────────────────
const analyticsWorker = new Worker('analytics', async (job) => {
  logger.info(`Processing analytics job: ${job.name}`);

  if (job.name === 'daily-rollup') {
    return await dailyAnalyticsRollup();
  }
}, REDIS_CONFIG);

async function dailyAnalyticsRollup() {
  // Aggregate daily metrics per organization
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });

  for (const org of orgs) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [claimsSubmitted, claimsPaid, totalCollected, denials, newPatients] = await Promise.all([
      prisma.claim.count({ where: { orgId: org.id, filingDate: { gte: today, lt: tomorrow } } }),
      prisma.claim.count({ where: { orgId: org.id, status: 'PAID', updatedAt: { gte: today, lt: tomorrow } } }),
      prisma.claim.aggregate({
        where: { orgId: org.id, status: { in: ['PAID', 'PARTIAL'] }, updatedAt: { gte: today, lt: tomorrow } },
        _sum: { totalPaid: true },
      }),
      prisma.denial.count({ where: { claim: { orgId: org.id }, denialDate: { gte: today, lt: tomorrow } } }),
      prisma.patient.count({ where: { orgId: org.id, createdAt: { gte: today, lt: tomorrow } } }),
    ]);

    // Store in audit log as analytics snapshot
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        action: 'analytics_rollup',
        resource: 'daily_metrics',
        details: {
          date: today.toISOString().slice(0, 10),
          claimsSubmitted,
          claimsPaid,
          totalCollected: parseFloat(totalCollected._sum.totalPaid || 0),
          denials,
          newPatients,
        },
      },
    });
  }

  logger.info('Daily analytics rollup completed');
  return { orgsProcessed: orgs.length };
}

// ── Error Handlers ──────────────────────────────────────────
[eligibilityWorker, claimsWorker, paymentsWorker, denialsWorker, arWorker, statementsWorker, credentialsWorker, analyticsWorker].forEach(worker => {
  worker.on('completed', (job) => {
    logger.info(`Job ${job.name} completed (${job.queue.name})`);
  });
  worker.on('failed', (job, err) => {
    logger.error(`Job ${job.name} failed (${job.queue.name}):`, err.message);
  });
});

// ── Exported Queue Helpers (used by routes) ─────────────────
async function triggerEligibilityCheck(patientId, insurancePolicyId) {
  return queues.eligibility.add('verify-single', { patientId, insurancePolicyId }, { priority: 1 });
}

async function triggerClaimScrub(claimId) {
  return queues.claims.add('scrub-claim', { claimId }, { priority: 2 });
}

async function triggerClaimSubmit(claimId) {
  return queues.claims.add('submit-claim', { claimId }, { priority: 2 });
}

async function triggerERAAutoPost(parsedERA) {
  return queues.payments.add('auto-post-era', parsedERA, { priority: 1 });
}

// ── Start Worker ────────────────────────────────────────────
async function start() {
  logger.info('NexRCM Automation Worker starting...');
  await scheduleRecurringJobs();
  logger.info('Worker ready. Listening for jobs...');
}

start().catch(err => {
  logger.error('Worker failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Worker shutting down...');
  await Promise.all([
    eligibilityWorker.close(),
    claimsWorker.close(),
    paymentsWorker.close(),
    denialsWorker.close(),
    arWorker.close(),
    statementsWorker.close(),
    credentialsWorker.close(),
    analyticsWorker.close(),
  ]);
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = {
  queues,
  triggerEligibilityCheck,
  triggerClaimScrub,
  triggerClaimSubmit,
  triggerERAAutoPost,
};
