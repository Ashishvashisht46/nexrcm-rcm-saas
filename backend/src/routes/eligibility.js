const router = require('express').Router();
const { authenticate, orgScope } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
router.use(authenticate, orgScope);

// POST /eligibility/verify — Real-time single patient verification
router.post('/verify', auditLog('verify', 'eligibility'), async (req, res, next) => {
  try {
    const { patientId, insurancePolicyId } = req.body;
    const policy = await req.prisma.insurancePolicy.findUnique({
      where: { id: insurancePolicyId },
      include: { patient: true },
    });
    if (!policy) return res.status(404).json({ error: 'Insurance policy not found.' });

    // TODO: Replace with real clearinghouse API call
    // const response = await clearinghouse.verifyEligibility({ memberId: policy.memberId, ... });

    // Simulated response
    const eligibilityData = {
      isEligible: true,
      coverageActive: true,
      copay: policy.copay || 25.00,
      deductible: policy.deductible || 1500.00,
      deductibleMet: policy.deductibleMet || 850.00,
      oopMax: policy.oopMax || 6000.00,
      oopMet: policy.oopMet || 2100.00,
      coinsurance: policy.coinsurance || 20,
      planType: 'PPO',
      warnings: [],
    };

    // Store the eligibility check
    const check = await req.prisma.eligibilityCheck.create({
      data: {
        patientId,
        insurancePolicyId,
        type: 'real_time',
        status: eligibilityData.isEligible ? 'verified' : 'failed',
        isEligible: eligibilityData.isEligible,
        copay: eligibilityData.copay,
        deductible: eligibilityData.deductible,
        deductibleMet: eligibilityData.deductibleMet,
        oopMax: eligibilityData.oopMax,
        oopMet: eligibilityData.oopMet,
        coinsurance: eligibilityData.coinsurance,
        coverageActive: eligibilityData.coverageActive,
        responseData: eligibilityData,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Valid for 24 hours
      },
    });

    // Update insurance policy with fresh data
    await req.prisma.insurancePolicy.update({
      where: { id: insurancePolicyId },
      data: {
        copay: eligibilityData.copay,
        deductible: eligibilityData.deductible,
        deductibleMet: eligibilityData.deductibleMet,
        oopMax: eligibilityData.oopMax,
        oopMet: eligibilityData.oopMet,
        coinsurance: eligibilityData.coinsurance,
        verifiedAt: new Date(),
        verificationData: eligibilityData,
      },
    });

    res.json(check);
  } catch (err) { next(err); }
});

// POST /eligibility/batch — Batch eligibility check for tomorrow's appointments
router.post('/batch', auditLog('batch_verify', 'eligibility'), async (req, res, next) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const appointments = await req.prisma.appointment.findMany({
      where: {
        orgId: req.orgId,
        scheduledAt: { gte: tomorrow, lt: dayAfter },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        eligibilityVerified: false,
      },
      include: {
        patient: { include: { insurancePolicies: { where: { isActive: true, priority: 1 } } } },
      },
    });

    const results = { total: appointments.length, verified: 0, failed: 0, skipped: 0 };

    for (const appt of appointments) {
      const policy = appt.patient.insurancePolicies[0];
      if (!policy) { results.skipped++; continue; }

      // TODO: Real clearinghouse batch call
      const check = await req.prisma.eligibilityCheck.create({
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

      await req.prisma.appointment.update({
        where: { id: appt.id },
        data: { eligibilityVerified: true },
      });

      results.verified++;
    }

    res.json({ message: 'Batch eligibility check completed.', results });
  } catch (err) { next(err); }
});

// GET /eligibility/history/:patientId
router.get('/history/:patientId', auditLog('view', 'eligibility'), async (req, res, next) => {
  try {
    const checks = await req.prisma.eligibilityCheck.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { checkedAt: 'desc' },
      take: 20,
      include: { insurancePolicy: { select: { payerName: true, memberId: true } } },
    });
    res.json(checks);
  } catch (err) { next(err); }
});

module.exports = router;
