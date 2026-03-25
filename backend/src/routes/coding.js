const router = require('express').Router();
const { authenticate, orgScope } = require('../middleware/auth');
router.use(authenticate, orgScope);

// GET /coding/icd10/search?q=back+pain
router.get('/icd10/search', async (req, res, next) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const codes = await req.prisma.iCD10Code.findMany({
      where: { OR: [
        { code: { startsWith: q.toUpperCase(), mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ]},
      take: parseInt(limit),
      orderBy: [{ isCommon: 'desc' }, { code: 'asc' }],
    });
    res.json(codes);
  } catch (err) { next(err); }
});

// GET /coding/cpt/search?q=office+visit
router.get('/cpt/search', async (req, res, next) => {
  try {
    const { q, category, limit = 20 } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const where = { OR: [
      { code: { startsWith: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ]};
    if (category) where.category = category;
    const codes = await req.prisma.cPTCode.findMany({ where, take: parseInt(limit), orderBy: [{ isCommon: 'desc' }, { code: 'asc' }] });
    res.json(codes);
  } catch (err) { next(err); }
});

// POST /coding/suggest — AI coding suggestion from clinical notes
router.post('/suggest', async (req, res, next) => {
  try {
    const { clinicalNotes, encounterContext } = req.body;
    if (!clinicalNotes) return res.status(400).json({ error: 'Clinical notes required.' });
    const ai = require('../services/ai');
    const suggestions = await ai.suggestCodesFromNotes(clinicalNotes, encounterContext || {});
    res.json({ aiModel: process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324', ...suggestions });
  } catch (err) { next(err); }
});

module.exports = router;
