// ─── NexRCM AI Engine ────────────────────────────────────────
// Central AI service powering all intelligent automation
// Uses OpenRouter API — supports 100+ models at various price points
// Switch models via AI_MODEL env var. Cheapest good options:
//   - deepseek/deepseek-chat-v3-0324        ($0.27/M input)  ← DEFAULT, best value
//   - google/gemini-2.0-flash-001           ($0.10/M input)  ← cheapest
//   - meta-llama/llama-3.1-70b-instruct    ($0.52/M input)  ← open source
//   - anthropic/claude-3.5-haiku            ($0.80/M input)  ← fast Claude
//   - qwen/qwen-2.5-72b-instruct           ($0.36/M input)  ← strong coding

const logger = require('../utils/logger');

// ─── Configuration ──────────────────────────────────────────
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324';

// ─── Core API Call (OpenRouter — OpenAI-compatible format) ──
async function callAI(systemPrompt, userMessage, { maxTokens = 2000, temperature = 0.3 } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn('OPENROUTER_API_KEY not set — AI features running in fallback mode');
    return null;
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'https://nexrcm.com',
        'X-Title': 'NexRCM RCM Platform',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`OpenRouter API error ${response.status}: ${err}`);
      return null;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || null;

    // Log usage for cost tracking
    if (data.usage) {
      logger.info(`AI usage [${AI_MODEL}]: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`);
    }

    return text;
  } catch (err) {
    logger.error('AI API call failed:', err.message);
    return null;
  }
}

// Backward compatibility alias
const callClaude = callAI;

// Parse JSON from Claude response, stripping markdown fences
function parseJSON(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(clean);
  } catch {
    logger.warn('Failed to parse AI JSON response');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. AI MEDICAL CODING — Clinical Notes → ICD-10 + CPT
// ═══════════════════════════════════════════════════════════════
async function suggestCodesFromNotes(clinicalNotes, encounterContext = {}) {
  const system = `You are an expert medical coder (CPC, CCS certified) working in a healthcare revenue cycle management system.

Your job: Analyze clinical notes and suggest the most accurate ICD-10-CM diagnosis codes and CPT procedure codes.

Rules:
- Suggest primary + secondary diagnoses in order of specificity
- Match CPT codes to documented services (E&M level based on complexity)
- Flag any coding compliance risks (upcoding, unbundling, missing documentation)
- Consider medical necessity linkage between dx and procedure codes
- Always provide confidence scores (0.0-1.0)

Respond ONLY in JSON format:
{
  "diagnoses": [{ "code": "M54.5", "description": "...", "sequence": 1, "confidence": 0.92, "rationale": "..." }],
  "procedures": [{ "code": "99214", "description": "...", "modifiers": [], "units": 1, "confidence": 0.88, "rationale": "...", "fee_estimate": 220 }],
  "compliance_flags": [{ "severity": "warning|error", "message": "...", "suggestion": "..." }],
  "documentation_gaps": ["...", "..."],
  "e_m_level_justification": "..."
}`;

  const user = `Clinical Notes:\n${clinicalNotes}\n\nEncounter Context: ${JSON.stringify(encounterContext)}`;
  const result = await callClaude(system, user, { maxTokens: 2500 });
  return parseJSON(result) || getFallbackCodingSuggestions(clinicalNotes);
}

// Fallback when API unavailable
function getFallbackCodingSuggestions(notes) {
  const lower = notes.toLowerCase();
  const diagnoses = [];
  const procedures = [];

  // Rule-based fallback
  const dxMap = [
    { keywords: ['back pain', 'lumbar', 'lumbago'], code: 'M54.5', desc: 'Low back pain', conf: 0.7 },
    { keywords: ['hypertension', 'high blood pressure', 'htn'], code: 'I10', desc: 'Essential hypertension', conf: 0.75 },
    { keywords: ['diabetes', 'diabetic', 'dm2', 'a1c'], code: 'E11.9', desc: 'Type 2 diabetes', conf: 0.7 },
    { keywords: ['anxiety', 'anxious', 'gad'], code: 'F41.1', desc: 'Generalized anxiety disorder', conf: 0.65 },
    { keywords: ['depression', 'depressed', 'mdd'], code: 'F32.9', desc: 'Major depressive disorder', conf: 0.65 },
    { keywords: ['upper respiratory', 'uri', 'cold', 'cough', 'sore throat'], code: 'J06.9', desc: 'Acute upper respiratory infection', conf: 0.7 },
    { keywords: ['headache', 'migraine'], code: 'G43.909', desc: 'Migraine, unspecified', conf: 0.6 },
    { keywords: ['knee pain', 'knee'], code: 'M25.561', desc: 'Pain in right knee', conf: 0.6 },
    { keywords: ['shoulder pain', 'shoulder'], code: 'M25.511', desc: 'Pain in right shoulder', conf: 0.6 },
    { keywords: ['annual', 'physical', 'wellness', 'preventive'], code: 'Z00.00', desc: 'General adult medical exam', conf: 0.8 },
  ];

  let seq = 1;
  for (const dx of dxMap) {
    if (dx.keywords.some(k => lower.includes(k))) {
      diagnoses.push({ code: dx.code, description: dx.desc, sequence: seq++, confidence: dx.conf, rationale: 'Rule-based match (AI unavailable)' });
    }
  }

  // Determine E&M level
  const isNew = lower.includes('new patient');
  const isComplex = lower.includes('complex') || lower.includes('multiple') || diagnoses.length > 2;
  const cptCode = isNew ? (isComplex ? '99204' : '99203') : (isComplex ? '99214' : '99213');
  const fees = { '99203': 175, '99204': 285, '99213': 150, '99214': 220 };
  procedures.push({ code: cptCode, description: `Office visit, ${isNew ? 'new' : 'est.'} patient`, modifiers: [], units: 1, confidence: 0.6, rationale: 'Rule-based (AI unavailable)', fee_estimate: fees[cptCode] });

  return { diagnoses, procedures, compliance_flags: [], documentation_gaps: ['AI analysis unavailable — manual review recommended'], e_m_level_justification: 'Estimated based on keyword complexity' };
}


// ═══════════════════════════════════════════════════════════════
// 2. AI DENIAL ANALYSIS — Categorize + Recovery Prediction
// ═══════════════════════════════════════════════════════════════
async function analyzeDenial(denial, claim, claimHistory = []) {
  const system = `You are a denial management expert in medical billing. Analyze denied claims and provide:
1. Root cause categorization
2. Recovery probability (0-100%)
3. Recommended action steps
4. Appeal strategy if applicable
5. Systemic pattern identification

Respond ONLY in JSON:
{
  "category": "coding|coverage|auth|timely_filing|medical_necessity|duplicate|coordination_of_benefits|other",
  "root_cause": "...",
  "recovery_likelihood": 75,
  "recovery_estimate_dollars": 450.00,
  "is_appealable": true,
  "appeal_deadline_days": 60,
  "recommended_actions": [
    { "step": 1, "action": "...", "priority": "high|medium|low", "deadline_days": 7 }
  ],
  "appeal_strategy": "...",
  "documentation_needed": ["...", "..."],
  "systemic_pattern": "...",
  "prevention_tip": "..."
}`;

  const user = `Denial Details:
- CARC Code: ${denial.carcCode || 'Unknown'}
- RARC Code: ${denial.rarcCode || 'N/A'}
- Denial Reason: ${denial.denialReason || 'Not specified'}
- Amount Denied: $${denial.amountDenied}

Claim Details:
- Claim Number: ${claim.claimNumber}
- CPT Codes: ${claim.lines?.map(l => l.cptCode).join(', ')}
- Payer: ${claim.payerName}
- Date of Service: ${claim.dateOfService}
- Total Charged: $${claim.totalCharged}
- Filing Date: ${claim.filingDate}

Claim History for this payer: ${JSON.stringify(claimHistory.slice(0, 5))}`;

  const result = await callClaude(system, user);
  return parseJSON(result) || getFallbackDenialAnalysis(denial);
}

function getFallbackDenialAnalysis(denial) {
  const code = (denial.carcCode || '').toUpperCase();
  const categoryMap = {
    'CO-4': { cat: 'coding', recovery: 70 }, 'CO-11': { cat: 'coding', recovery: 65 },
    'CO-15': { cat: 'auth', recovery: 45 }, 'CO-16': { cat: 'other', recovery: 60 },
    'CO-18': { cat: 'duplicate', recovery: 80 }, 'CO-22': { cat: 'coordination_of_benefits', recovery: 50 },
    'CO-27': { cat: 'coverage', recovery: 25 }, 'CO-29': { cat: 'timely_filing', recovery: 15 },
    'CO-50': { cat: 'medical_necessity', recovery: 55 }, 'CO-97': { cat: 'coverage', recovery: 40 },
  };
  const match = Object.entries(categoryMap).find(([k]) => code.includes(k));
  return {
    category: match?.[1]?.cat || 'other',
    root_cause: 'Automated categorization (AI unavailable)',
    recovery_likelihood: match?.[1]?.recovery || 40,
    recovery_estimate_dollars: parseFloat(denial.amountDenied) * ((match?.[1]?.recovery || 40) / 100),
    is_appealable: (match?.[1]?.recovery || 40) > 30,
    recommended_actions: [{ step: 1, action: 'Review denial details and gather documentation', priority: 'high', deadline_days: 14 }],
    appeal_strategy: 'Manual review needed — AI analysis unavailable',
    documentation_needed: ['Clinical notes', 'Medical records'],
    systemic_pattern: null,
    prevention_tip: 'Ensure complete documentation before claim submission',
  };
}


// ═══════════════════════════════════════════════════════════════
// 3. AI APPEAL LETTER GENERATION
// ═══════════════════════════════════════════════════════════════
async function generateAppealLetter(denial, claim, patient, provider, additionalContext = '') {
  const system = `You are a medical billing appeal specialist. Write a professional, persuasive appeal letter to an insurance company to overturn a claim denial.

The letter must:
- Be formatted as a formal business letter
- Reference specific denial codes and explain why the denial is incorrect
- Cite relevant medical necessity using clinical evidence
- Reference applicable payer policies, CMS guidelines, or AMA CPT guidelines
- Include a clear, specific request for reconsideration
- Be professional but assertive
- Include placeholders like [ATTACH: clinical notes] where supporting documents should be attached

Return ONLY the letter text, no JSON wrapping.`;

  const user = `Write an appeal letter for:

Denial: ${denial.carcCode} — ${denial.denialReason || 'Not specified'}
Amount: $${denial.amountDenied}
Claim: ${claim.claimNumber}, DOS: ${claim.dateOfService}
CPT Codes: ${claim.lines?.map(l => `${l.cptCode} (${l.units} units, $${l.chargedAmount})`).join('; ')}
Patient: ${patient.firstName} ${patient.lastName}, DOB: ${patient.dateOfBirth}
Provider: Dr. ${provider.firstName} ${provider.lastName}, NPI: ${provider.npi}
Payer: ${claim.payerName}
${additionalContext ? `\nAdditional Context: ${additionalContext}` : ''}`;

  const letter = await callClaude(system, user, { maxTokens: 3000, temperature: 0.4 });
  return letter || generateFallbackAppealLetter(denial, claim, patient, provider);
}

function generateFallbackAppealLetter(denial, claim, patient, provider) {
  return `[Date]

${claim.payerName}
Claims Department
[Payer Address]

RE: Appeal of Claim Denial
Claim Number: ${claim.claimNumber}
Patient: ${patient.firstName} ${patient.lastName}
Date of Service: ${claim.dateOfService}
Denial Code: ${denial.carcCode}
Amount: $${denial.amountDenied}

Dear Claims Review Department,

I am writing to formally appeal the denial of the above-referenced claim. After careful review of the denial reason (${denial.carcCode}), we believe this claim was incorrectly denied and respectfully request reconsideration.

The services rendered on ${claim.dateOfService} by Dr. ${provider.firstName} ${provider.lastName} (NPI: ${provider.npi}) were medically necessary and appropriately documented.

[ATTACH: Clinical notes and supporting documentation]

We respectfully request that you review the enclosed documentation and reconsider this claim for payment.

Sincerely,

Dr. ${provider.firstName} ${provider.lastName}
NPI: ${provider.npi}

[NOTE: This is an auto-generated template. AI-powered personalized letters require API key configuration.]`;
}


// ═══════════════════════════════════════════════════════════════
// 4. AI CLAIM SCRUBBING (Enhanced Beyond Rules)
// ═══════════════════════════════════════════════════════════════
async function aiScrubClaim(claim, rules = []) {
  const system = `You are a medical billing compliance expert reviewing a claim before submission. Analyze the claim for:

1. Coding accuracy (correct CPT for the diagnosis, proper modifiers)
2. Bundling/unbundling issues (NCCI edits)
3. Medical necessity (dx supports procedure)
4. Missing information likely to cause denial
5. Payer-specific gotchas based on the payer name
6. Timely filing risks
7. Modifier requirements (25, 59, XE, XS, etc.)
8. Place of service consistency

Respond in JSON:
{
  "overall_risk": "low|medium|high",
  "confidence_score": 0.92,
  "issues": [
    { "severity": "error|warning|info", "category": "coding|bundling|medical_necessity|demographics|payer|modifier|timely_filing",
      "message": "...", "suggestion": "...", "auto_fixable": false }
  ],
  "payer_specific_notes": "...",
  "estimated_denial_risk": 0.15,
  "recommended_changes": ["..."]
}`;

  const user = `Review this claim:
Claim: ${claim.claimNumber}
Payer: ${claim.payerName} (${claim.payerId})
Patient DOB: ${claim.patient?.dateOfBirth}, Gender: ${claim.patient?.gender}
Provider NPI: ${claim.provider?.npi}, Specialty: ${claim.provider?.specialty}
DOS: ${claim.dateOfService}, POS: ${claim.placeOfService}
Filing Date: ${claim.filingDate || 'Not yet filed'}
Prior Auth: ${claim.priorAuthNumber || 'None'}

Service Lines:
${claim.lines?.map(l => `  Line ${l.lineNumber}: CPT ${l.cptCode} ${l.modifiers?.length ? `(Mod: ${l.modifiers.join(',')})` : ''} x${l.units} = $${l.chargedAmount}`).join('\n')}

Diagnoses linked: ${claim.encounter?.diagnoses?.map(d => `${d.icdCode} (${d.description})`).join(', ') || 'Not specified'}`;

  const result = await callClaude(system, user);
  return parseJSON(result) || { overall_risk: 'unknown', issues: [], estimated_denial_risk: null, note: 'AI scrubbing unavailable — using rule-based only' };
}


// ═══════════════════════════════════════════════════════════════
// 5. AI REVENUE FORECASTING
// ═══════════════════════════════════════════════════════════════
async function forecastRevenue(historicalData, arPipeline, denialPatterns) {
  const system = `You are a healthcare revenue cycle analytics expert. Based on historical collection data, current AR pipeline, and denial patterns, forecast revenue for the next 30, 60, and 90 days.

Respond in JSON:
{
  "forecast_30_days": { "expected": 125000, "low": 110000, "high": 140000, "confidence": 0.82 },
  "forecast_60_days": { "expected": 250000, "low": 215000, "high": 285000, "confidence": 0.74 },
  "forecast_90_days": { "expected": 370000, "low": 310000, "high": 430000, "confidence": 0.65 },
  "key_drivers": ["...", "..."],
  "risks": ["...", "..."],
  "opportunities": ["...", "..."],
  "collection_rate_trend": "improving|stable|declining",
  "recommendations": ["...", "..."]
}`;

  const user = `Historical Collections (last 6 months): ${JSON.stringify(historicalData)}
Current AR Pipeline: ${JSON.stringify(arPipeline)}
Denial Patterns: ${JSON.stringify(denialPatterns)}`;

  const result = await callClaude(system, user);
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 6. AI WORK QUEUE PRIORITIZATION
// ═══════════════════════════════════════════════════════════════
async function prioritizeWorkQueue(items) {
  const system = `You are a revenue cycle work queue optimization engine. Given a list of tasks (claim follow-ups, denial reviews, payment postings), assign optimal priority scores (1-100) and recommended sequence.

Consider: dollar value, days in AR, payer responsiveness, denial recoverability, deadline urgency, and expected ROI per hour of work.

Respond in JSON:
{
  "prioritized_items": [
    { "id": "...", "priority": 95, "reason": "...", "estimated_recovery": 450, "recommended_action": "...", "time_estimate_minutes": 15 }
  ],
  "daily_focus": "...",
  "estimated_daily_recovery": 5400
}`;

  const user = `Work queue items to prioritize:\n${JSON.stringify(items.slice(0, 30))}`;
  const result = await callClaude(system, user);
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 7. AI CHAT ASSISTANT (Staff-facing)
// ═══════════════════════════════════════════════════════════════
async function chatAssistant(message, context = {}) {
  const system = `You are NexRCM AI Assistant — an expert in medical billing, revenue cycle management, and healthcare compliance. You assist billing staff, coders, and administrators with:

- Explaining denial codes (CARC/RARC) and suggesting resolution steps
- Answering coding questions (ICD-10, CPT, HCPCS, modifiers)
- Explaining payer policies and timely filing limits
- Providing billing compliance guidance
- Analyzing claim data and suggesting improvements
- Helping with appeal strategies
- Explaining RCM metrics (collection rate, days in AR, etc.)

You have access to the user's current data context. Be concise, actionable, and accurate.
Always cite specific codes, guidelines, or policies when relevant.

If the user asks about their specific data, use the provided context. If you don't have enough info, ask clarifying questions.`;

  const user = `${message}\n\nCurrent Context: ${JSON.stringify(context)}`;
  const response = await callClaude(system, user, { maxTokens: 1500, temperature: 0.5 });
  return response || "I'm unable to process your request right now. Please check that the AI service is configured correctly in system settings.";
}


// ═══════════════════════════════════════════════════════════════
// 8. AI ERA/PAYMENT MATCHING
// ═══════════════════════════════════════════════════════════════
async function matchUnpostedPayment(paymentDetails, unmatchedClaims) {
  const system = `You are a payment posting specialist. Given an insurance payment that couldn't be auto-matched by claim number, find the best matching claim(s) from the list.

Match by: patient name similarity, date of service proximity, charged amount vs paid amount, payer match, CPT code overlap.

Respond in JSON:
{
  "matches": [
    { "claim_id": "...", "claim_number": "...", "confidence": 0.92, "match_reason": "..." }
  ],
  "unmatched_amount": 0,
  "notes": "..."
}`;

  const user = `Payment: ${JSON.stringify(paymentDetails)}\n\nPossible Claims: ${JSON.stringify(unmatchedClaims.slice(0, 20))}`;
  const result = await callClaude(system, user);
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 9. AI PRIOR AUTH PREDICTION
// ═══════════════════════════════════════════════════════════════
async function predictPriorAuthNeed(cptCodes, payerName, diagnosis) {
  const system = `You are a prior authorization specialist. Based on the CPT codes, payer, and diagnosis, predict whether prior authorization is likely required.

Respond in JSON:
{
  "auth_likely_required": true,
  "confidence": 0.88,
  "reason": "...",
  "codes_requiring_auth": ["27447"],
  "suggested_action": "...",
  "typical_turnaround_days": 5,
  "documentation_needed": ["...", "..."]
}`;

  const user = `CPT Codes: ${cptCodes.join(', ')}\nPayer: ${payerName}\nDiagnosis: ${diagnosis}`;
  const result = await callClaude(system, user);
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 10. AI PAYER BEHAVIOR ANALYSIS
// ═══════════════════════════════════════════════════════════════
async function analyzePayerBehavior(payerName, claimHistory) {
  const system = `You are a payer relations analyst. Analyze claim history for a specific payer and identify patterns in payment behavior, common denial reasons, typical processing time, and reimbursement trends.

Respond in JSON:
{
  "payer_rating": "A|B|C|D|F",
  "avg_days_to_pay": 28,
  "avg_reimbursement_rate": 0.78,
  "top_denial_reasons": [{ "code": "CO-50", "frequency": 15, "percentage": 12 }],
  "payment_trend": "improving|stable|declining",
  "filing_deadline_days": 365,
  "tips": ["...", "..."],
  "risk_factors": ["...", "..."],
  "negotiation_opportunities": ["...", "..."]
}`;

  const user = `Payer: ${payerName}\nClaim History (last 50): ${JSON.stringify(claimHistory.slice(0, 50))}`;
  const result = await callClaude(system, user);
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 11. AI PATIENT COMMUNICATION
// ═══════════════════════════════════════════════════════════════
async function generatePatientMessage(type, patient, context = {}) {
  const templates = {
    statement_reminder: 'Generate a friendly but firm patient statement reminder email',
    balance_due: 'Generate a balance due notification with payment options',
    insurance_issue: 'Notify patient about an insurance coverage issue requiring their action',
    appointment_reminder: 'Generate an appointment reminder with insurance verification instructions',
    payment_plan: 'Offer a payment plan for a large outstanding balance',
  };

  const system = `You are a patient communications specialist for a medical practice. Write a professional, empathetic, HIPAA-compliant message to a patient.

Rules:
- Be warm but clear about the action needed
- Don't include specific medical details in the subject line
- Include relevant reference numbers
- Provide clear next steps and contact information
- Use plain language (no medical jargon for billing terms)

Respond in JSON:
{
  "subject": "...",
  "body": "...",
  "sms_version": "...(under 160 chars)..."
}`;

  const user = `Message type: ${templates[type] || type}
Patient: ${patient.firstName} ${patient.lastName}
Context: ${JSON.stringify(context)}`;

  const result = await callClaude(system, user, { temperature: 0.5 });
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 12. AI CLINICAL NOTE EXTRACTION
// ═══════════════════════════════════════════════════════════════
async function extractBillableServices(clinicalNotes) {
  const system = `You are a medical coding auditor. Extract all billable services, procedures, and diagnoses from clinical notes.

Identify:
- Chief complaint and HPI elements
- Exam components performed
- Medical decision making complexity
- Procedures performed (injections, labs ordered, imaging)
- Time spent (if documented)
- Counseling/coordination (if documented)

Respond in JSON:
{
  "chief_complaint": "...",
  "hpi_elements": ["location", "quality", "severity", "duration", "timing", "context", "modifying_factors", "associated_signs"],
  "exam_systems_reviewed": 3,
  "mdm_complexity": "low|moderate|high",
  "procedures_identified": [{ "description": "...", "suggested_cpt": "99213", "confidence": 0.85 }],
  "diagnoses_identified": [{ "description": "...", "suggested_icd10": "M54.5", "confidence": 0.9 }],
  "time_documented_minutes": null,
  "recommended_em_level": "99214",
  "documentation_quality": "excellent|good|fair|poor",
  "improvement_suggestions": ["...", "..."]
}`;

  const result = await callClaude(system, clinicalNotes, { maxTokens: 2500 });
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// 13. AI DENIAL PATTERN DETECTION (Systemic)
// ═══════════════════════════════════════════════════════════════
async function detectDenialPatterns(denials, timeframe = '90 days') {
  const system = `You are a denial management analytics expert. Analyze a batch of denials to identify systemic patterns, root causes, and actionable recommendations to reduce future denials.

Respond in JSON:
{
  "patterns_detected": [
    {
      "pattern": "...",
      "affected_claims": 15,
      "total_amount": 12500,
      "root_cause": "...",
      "fix": "...",
      "estimated_savings_monthly": 4200
    }
  ],
  "top_actionable_items": [
    { "priority": 1, "action": "...", "impact": "high", "effort": "low", "expected_reduction": "25% fewer coding denials" }
  ],
  "payer_specific_issues": [{ "payer": "...", "issue": "...", "recommendation": "..." }],
  "overall_denial_rate": 0.12,
  "benchmark_comparison": "above|at|below industry average",
  "projected_savings_if_addressed": 15000
}`;

  const user = `Denial data for last ${timeframe}:\n${JSON.stringify(denials.slice(0, 100))}`;
  const result = await callClaude(system, user, { maxTokens: 3000 });
  return parseJSON(result);
}


// ═══════════════════════════════════════════════════════════════
// EXPORT ALL AI FUNCTIONS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  // Core
  callAI,
  callClaude, // backward compat alias

  // Coding
  suggestCodesFromNotes,
  extractBillableServices,

  // Claims
  aiScrubClaim,
  predictPriorAuthNeed,

  // Denials
  analyzeDenial,
  generateAppealLetter,
  detectDenialPatterns,

  // Payments
  matchUnpostedPayment,

  // Revenue
  forecastRevenue,

  // Operations
  prioritizeWorkQueue,
  analyzePayerBehavior,

  // Communication
  generatePatientMessage,
  chatAssistant,
};
