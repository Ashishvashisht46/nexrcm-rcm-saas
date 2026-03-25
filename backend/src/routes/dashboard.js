const router = require('express').Router();
const { authenticate, orgScope } = require('../middleware/auth');
router.use(authenticate, orgScope);

router.get('/stats', async (req, res, next) => {
  try {
    const [totalPatients, todayAppts, openClaims, totalAR, deniedClaims, collectedThisMonth, pendingEligibility] = await Promise.all([
      req.prisma.patient.count({ where: { orgId: req.orgId, isActive: true } }),
      req.prisma.appointment.count({ where: { orgId: req.orgId, scheduledAt: { gte: new Date(new Date().setHours(0,0,0,0)), lt: new Date(new Date().setHours(23,59,59,999)) } } }),
      req.prisma.claim.count({ where: { orgId: req.orgId, status: { in: ['SUBMITTED', 'PENDING', 'PARTIAL'] } } }),
      req.prisma.claim.aggregate({ where: { orgId: req.orgId, status: { in: ['SUBMITTED', 'PENDING', 'PARTIAL', 'DENIED'] } }, _sum: { balance: true } }),
      req.prisma.claim.count({ where: { orgId: req.orgId, status: 'DENIED' } }),
      req.prisma.claim.aggregate({ where: { orgId: req.orgId, updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }, status: { in: ['PAID', 'PARTIAL'] } }, _sum: { totalPaid: true } }),
      req.prisma.appointment.count({ where: { orgId: req.orgId, eligibilityVerified: false, status: 'SCHEDULED', scheduledAt: { gte: new Date() } } }),
    ]);
    const totalARAmount = totalAR._sum.balance || 0;
    const collected = collectedThisMonth._sum.totalPaid || 0;
    res.json({ totalPatients, todayAppointments: todayAppts, openClaims, totalAR: parseFloat(totalARAmount), deniedClaims, collectedThisMonth: parseFloat(collected), pendingEligibility });
  } catch (err) { next(err); }
});

module.exports = router;
