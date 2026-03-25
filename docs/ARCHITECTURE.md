# NexRCM — Full Production Architecture & Roadmap

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Backend** | Node.js 20 + Express.js | Fast, async-native, huge healthcare lib ecosystem |
| **Database** | PostgreSQL 16 | HIPAA-capable, JSONB for flexible data, robust relational model |
| **ORM** | Prisma | Type-safe queries, auto-migrations, great DX |
| **Auth** | JWT + bcrypt + RBAC | Stateless auth, role-based access control |
| **Cache** | Redis | Session store, job queues, real-time pub/sub |
| **Job Queue** | BullMQ (Redis-backed) | Scheduled tasks, async processing (ERA parsing, batch eligibility) |
| **File Storage** | AWS S3 (HIPAA BAA) | EDI files, documents, EOBs, patient uploads |
| **Email** | SendGrid / AWS SES | Patient statements, alerts, reports |
| **Payments** | Stripe (HIPAA-ready) | Patient payment processing, ACH, card |
| **Search** | PostgreSQL Full-Text + pg_trgm | Patient/claim search without external dependency |
| **Deployment** | Docker + AWS ECS / Railway | Containerized, scalable, HIPAA-eligible |
| **Monitoring** | Sentry + Datadog | Error tracking, performance, audit trails |
| **Frontend** | Existing HTML portals + fetch() API layer | Progressive enhancement of current UI |

---

## Database Schema Overview

### Core Entities

```
Organizations (multi-tenant root)
├── Users (staff with roles)
├── Locations (practice sites)
├── Providers (credentialed doctors)
├── Patients
│   ├── InsurancePolicies
│   ├── PatientDocuments
│   └── PatientLedger
├── Appointments
├── Encounters
│   ├── DiagnosisCodes (ICD-10)
│   ├── ProcedureCodes (CPT/HCPCS)
│   └── Charges
├── Claims
│   ├── ClaimLines
│   ├── ClaimStatusHistory
│   ├── ClaimNotes
│   └── Adjustments
├── Payments
│   ├── InsurancePayments (ERA/835)
│   ├── PatientPayments
│   └── PaymentAllocations
├── Denials
│   ├── DenialReasons (CARC/RARC)
│   └── Appeals
├── PriorAuthorizations
├── EligibilityChecks
├── Credentials
│   └── CredentialDocuments
├── FeeSchedules
│   └── FeeScheduleEntries
├── PayerContracts
│   └── ContractRates
├── AuditLog
└── AutomationRules
    └── AutomationExecutions
```

---

## Module Breakdown (9 Portals)

### Existing (Enhanced)
1. **Front Desk** — Check-in, scheduling, registration → now with real API
2. **Insurance Verification** — Real-time eligibility → clearinghouse integration
3. **Billing** — Claim lifecycle → EDI 837 generation, scrubbing engine
4. **AR Management** — Aging, follow-ups → automated workflows
5. **Admin** — Dashboard, analytics → real aggregated metrics

### New Modules
6. **Patient Portal** — Self-service payments, bill view, insurance card upload
7. **Coding & Charge Capture** — ICD-10/CPT lookup, charge entry, bundling rules
8. **Credentialing** — Provider enrollment, expiration tracking, CAQH sync
9. **Fee Schedule & Contracts** — Payer rates, allowed amounts, variance analysis

---

## Automation Engine

### Scheduled Jobs (BullMQ)
| Job | Frequency | Description |
|-----|-----------|-------------|
| `eligibility-batch` | Daily 6am | Check eligibility for next-day appointments |
| `claim-scrub` | On submission | Validate claims against 200+ rules before EDI generation |
| `era-fetch` | Every 4 hours | Pull ERAs from clearinghouse, auto-parse |
| `era-autopost` | On ERA receipt | Match payments to claims, post automatically |
| `denial-categorize` | On denial receipt | AI categorize denial, suggest appeal strategy |
| `ar-followup` | Daily 8am | Generate follow-up tasks for aging claims |
| `statement-generate` | Weekly Monday | Generate and email patient statements |
| `credential-alerts` | Daily | Check for expiring credentials (30/60/90 day) |
| `analytics-rollup` | Nightly | Aggregate daily metrics for dashboard |
| `audit-cleanup` | Monthly | Archive old audit logs (keep 7 years) |

### Real-time Automations (Event-driven)
- **Patient checks in** → trigger eligibility verification
- **Claim submitted** → scrub → generate 837 → send to clearinghouse
- **ERA received** → parse 835 → match claims → auto-post → flag exceptions
- **Claim denied** → categorize → create appeal task → assign to queue
- **Claim ages past 30 days** → escalate priority → generate follow-up letter
- **Payment received** → update patient ledger → check if balance due → auto-statement

### AI-Powered Features
- **Smart Coding Assistant** — Suggest CPT/ICD codes from clinical notes
- **Denial Pattern Detection** — Identify systemic denial patterns by payer
- **Revenue Forecasting** — Predict monthly collections based on AR pipeline
- **Appeal Letter Generation** — Auto-draft appeal letters with clinical justification
- **Work Queue Prioritization** — Rank tasks by expected recovery × probability

---

## API Structure

```
/api/v1
├── /auth
│   ├── POST /login
│   ├── POST /register
│   ├── POST /refresh
│   └── POST /forgot-password
├── /organizations
│   ├── GET / (current org)
│   ├── PUT / (update settings)
│   └── GET /dashboard-stats
├── /users
│   ├── CRUD operations
│   └── GET /me
├── /patients
│   ├── CRUD + search
│   ├── GET /:id/ledger
│   ├── GET /:id/claims
│   ├── GET /:id/insurance
│   └── POST /:id/insurance (add policy)
├── /appointments
│   ├── CRUD + calendar view
│   ├── POST /:id/check-in
│   └── POST /:id/check-out
├── /eligibility
│   ├── POST /verify (real-time single)
│   ├── POST /batch (batch check)
│   └── GET /history/:patientId
├── /claims
│   ├── CRUD
│   ├── POST /scrub (validate)
│   ├── POST /:id/submit (generate 837, send)
│   ├── POST /:id/void
│   ├── GET /:id/status-history
│   └── GET /work-queue
├── /payments
│   ├── POST /insurance (ERA auto-post)
│   ├── POST /patient (card/ACH)
│   ├── POST /:id/allocate
│   └── GET /unposted
├── /denials
│   ├── GET / (list)
│   ├── POST /:id/appeal
│   ├── GET /analytics
│   └── GET /carc-rarc-library
├── /coding
│   ├── GET /icd10/search
│   ├── GET /cpt/search
│   ├── POST /suggest (AI from notes)
│   └── GET /bundling-rules
├── /prior-auth
│   ├── CRUD
│   └── GET /status/:id
├── /credentials
│   ├── CRUD (providers)
│   ├── GET /expiring
│   ├── POST /:id/documents
│   └── GET /enrollment-status
├── /fee-schedules
│   ├── CRUD
│   ├── POST /import (CSV upload)
│   └── GET /compare
├── /contracts
│   ├── CRUD
│   ├── GET /:id/rates
│   └── GET /variance-analysis
├── /reports
│   ├── GET /aging-summary
│   ├── GET /denial-trends
│   ├── GET /payer-performance
│   ├── GET /provider-productivity
│   └── POST /export (CSV/PDF)
├── /audit-log
│   ├── GET / (paginated, filtered)
│   └── GET /export
├── /automation
│   ├── GET /rules
│   ├── POST /rules (create)
│   ├── PUT /rules/:id
│   └── GET /executions (history)
└── /portal (patient-facing)
    ├── GET /my-bills
    ├── POST /pay
    ├── GET /my-insurance
    ├── POST /upload-card
    └── GET /statements
```

---

## Build Phases

### Phase 1 — Foundation (Week 1-2)
- [x] Project scaffolding
- [ ] Database schema + Prisma setup
- [ ] Auth system (JWT + RBAC)
- [ ] User/Org/Patient CRUD APIs
- [ ] Seed data generation
- [ ] Connect frontend to API

### Phase 2 — Core Workflow (Week 3-4)
- [ ] Appointment + check-in flow
- [ ] Eligibility verification (mock → real)
- [ ] Claim builder + submission
- [ ] Payment posting (manual)
- [ ] Work queue with priority scoring

### Phase 3 — Automation Engine (Week 5-6)
- [ ] BullMQ job queue setup
- [ ] Claim scrubbing rules engine
- [ ] ERA/835 parser + auto-posting
- [ ] Denial auto-categorization
- [ ] AR follow-up automation
- [ ] Patient statement generation

### Phase 4 — New Modules (Week 7-8)
- [ ] Patient Portal (self-service)
- [ ] Coding & Charge Capture
- [ ] Credentialing Management
- [ ] Fee Schedule & Contract Management

### Phase 5 — AI & Intelligence (Week 9-10)
- [ ] AI coding suggestions
- [ ] Denial pattern detection
- [ ] Revenue forecasting
- [ ] Appeal letter generation
- [ ] Smart work queue prioritization

### Phase 6 — Production Hardening (Week 11-12)
- [ ] HIPAA audit controls
- [ ] Encryption (at-rest + in-transit)
- [ ] Rate limiting + DDoS protection
- [ ] Backup + disaster recovery
- [ ] Load testing
- [ ] Documentation + API docs

---

## HIPAA Compliance Checklist

- [ ] All data encrypted at rest (AES-256)
- [ ] TLS 1.3 for all connections
- [ ] Role-based access control (RBAC)
- [ ] Complete audit trail (7-year retention)
- [ ] Automatic session timeout (15 min)
- [ ] Password complexity requirements
- [ ] Two-factor authentication
- [ ] BAA with all vendors (AWS, Stripe, SendGrid)
- [ ] Data backup + recovery plan
- [ ] Breach notification procedure
- [ ] Employee training records
- [ ] Annual risk assessment
