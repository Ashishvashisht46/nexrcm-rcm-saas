# NexRCM — Revenue Cycle Management SaaS Platform

A complete, production-grade medical billing and revenue cycle management system built for healthcare practices.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Nginx)                        │
│  admin.html │ front-desk.html │ billing.html │ ar-mgmt │ ins   │
│  + patient-portal.html │ coding.html │ credentialing.html      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API (JSON)
┌───────────────────────────▼─────────────────────────────────────┐
│                   BACKEND (Node.js + Express)                   │
│                                                                 │
│  Auth (JWT+RBAC) │ Patients │ Claims │ Payments │ Denials       │
│  Eligibility │ Coding │ Credentials │ Fee Schedules │ Reports   │
│  Work Queue │ Automation │ Patient Portal │ Audit Log           │
│                                                                 │
│  Middleware: Auth │ Audit Logger │ Rate Limit │ Validation      │
└──────┬──────────────────────────────────────┬───────────────────┘
       │                                      │
┌──────▼──────┐                    ┌──────────▼──────────┐
│ PostgreSQL  │                    │   Redis + BullMQ    │
│ (Data Store)│                    │   (Job Queues)      │
│             │                    │                     │
│ 40+ tables  │                    │  Workers:           │
│ Multi-tenant│                    │  · Eligibility      │
│ HIPAA-ready │                    │  · ERA Auto-Post    │
└─────────────┘                    │  · Claim Aging      │
                                   │  · Denial Categorize│
                                   │  · AR Follow-ups    │
                                   │  · Statements       │
                                   │  · Credentials      │
                                   │  · Analytics        │
                                   └─────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express.js |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Auth | JWT + bcrypt + RBAC (10 roles) |
| Job Queue | BullMQ + Redis |
| Frontend | HTML/CSS/JS (9 portals) |
| Containerization | Docker + Docker Compose |

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone and start everything
git clone <repo>
cd nexrcm
docker-compose up --build

# Access:
# Frontend: http://localhost:3000
# API:      http://localhost:4000/api/v1
# Health:   http://localhost:4000/health
```

### Option 2: Manual Setup

```bash
# Prerequisites: Node.js 20+, PostgreSQL 16, Redis 7

# 1. Setup database
createdb nexrcm

# 2. Install & configure
cd backend
cp .env.example .env
# Edit .env with your database URL
npm install

# 3. Run migrations & seed
npx prisma migrate dev --name init
npx prisma generate
npm run db:seed

# 4. Start server
npm run dev          # API server on :4000

# 5. Start worker (separate terminal)
npm run worker       # Background job processor

# 6. Serve frontend
cd ../frontend/public
npx serve .          # or any static server on :3000
```

## Login Credentials (Demo)

| Email | Password | Role |
|-------|----------|------|
| admin@summithealthmg.com | NexRCM2024! | Admin |
| sarah@summithealthmg.com | NexRCM2024! | Billing Manager |
| mike@summithealthmg.com | NexRCM2024! | Biller |
| jessica@summithealthmg.com | NexRCM2024! | Front Desk |
| lisa@summithealthmg.com | NexRCM2024! | AR Specialist |
| tom@summithealthmg.com | NexRCM2024! | Coder |
| maria@summithealthmg.com | NexRCM2024! | Credentialing |

## 9 Portal Modules

| # | Portal | File | Purpose |
|---|--------|------|---------|
| 1 | **Admin** | admin.html | Executive dashboard, analytics, staff, audit log |
| 2 | **Front Desk** | front-desk.html | Scheduling, check-in/out, patient registration |
| 3 | **Billing** | billing.html | Claim builder, submission, ERA posting, work queue |
| 4 | **AR Management** | ar-management.html | Aging, follow-ups, collections, priority scoring |
| 5 | **Insurance Verify** | insurance-verification.html | Real-time eligibility, coverage details |
| 6 | **Patient Portal** | patient-portal.html | Self-service bills, payments, statements |
| 7 | **Coding** | coding.html | ICD-10/CPT lookup, charge capture, AI suggestions |
| 8 | **Credentialing** | credentialing.html | Provider enrollment, expiry tracking |
| 9 | **Fee Schedules** | fee-schedules.html | Contract rates, variance analysis |

## API Endpoints (20 Route Groups, 80+ Endpoints)

```
POST   /api/v1/auth/register          # Create org + admin
POST   /api/v1/auth/login             # Login → JWT tokens
POST   /api/v1/auth/refresh           # Refresh token
GET    /api/v1/auth/me                # Current user

GET    /api/v1/patients               # List/search patients
POST   /api/v1/patients               # Create patient
GET    /api/v1/patients/:id           # Full patient detail
PUT    /api/v1/patients/:id           # Update patient
POST   /api/v1/patients/:id/insurance # Add insurance policy
GET    /api/v1/patients/:id/ledger    # Patient account ledger

GET    /api/v1/appointments           # Calendar view
POST   /api/v1/appointments           # Schedule
POST   /api/v1/appointments/:id/check-in
POST   /api/v1/appointments/:id/check-out

POST   /api/v1/eligibility/verify     # Real-time check
POST   /api/v1/eligibility/batch      # Batch (next-day)
GET    /api/v1/eligibility/history/:patientId

GET    /api/v1/claims                 # List + filter
POST   /api/v1/claims                 # Create claim
GET    /api/v1/claims/:id             # Claim detail
POST   /api/v1/claims/:id/scrub       # Run scrubbing engine
POST   /api/v1/claims/:id/submit      # Submit to clearinghouse
GET    /api/v1/claims/work-queue      # Prioritized queue

POST   /api/v1/payments/insurance     # Post ERA payment
POST   /api/v1/payments/patient       # Post patient payment
GET    /api/v1/payments/unposted      # Unposted ERAs

GET    /api/v1/denials                # List denials
POST   /api/v1/denials/:id/appeal     # File appeal
GET    /api/v1/denials/analytics      # Denial trends
GET    /api/v1/denials/carc-rarc-library

GET    /api/v1/coding/icd10/search    # ICD-10 code search
GET    /api/v1/coding/cpt/search      # CPT code search
POST   /api/v1/coding/suggest         # AI coding suggestion

GET    /api/v1/credentials            # List credentials
GET    /api/v1/credentials/expiring   # Expiring in 90 days

GET    /api/v1/fee-schedules          # List fee schedules
POST   /api/v1/fee-schedules/:id/import # Bulk import

GET    /api/v1/contracts/variance-analysis

GET    /api/v1/reports/aging-summary
GET    /api/v1/reports/denial-trends
GET    /api/v1/reports/payer-performance
GET    /api/v1/reports/provider-productivity

GET    /api/v1/dashboard/stats        # Aggregated KPIs

GET    /api/v1/portal/my-bills        # Patient self-service
POST   /api/v1/portal/pay
GET    /api/v1/portal/statements

GET    /api/v1/audit-log              # HIPAA audit trail
```

## Automation Engine (8 Scheduled Jobs)

| Job | Schedule | What It Does |
|-----|----------|-------------|
| Batch Eligibility | Daily 6am | Verifies insurance for next-day appointments |
| Fetch ERAs | Every 4 hours | Downloads and parses 835 files from clearinghouse |
| Update Aging | Daily midnight | Recalculates days-in-AR for all outstanding claims |
| AR Follow-ups | Daily 8am | Creates prioritized work queue items for stale claims |
| Denial Categorize | On receipt | AI-categorizes denial reason and estimates recovery |
| Patient Statements | Weekly Monday | Generates and sends statements for open balances |
| Credential Alerts | Daily 9am | Flags credentials expiring within 90 days |
| Analytics Rollup | Daily 2am | Aggregates daily metrics per organization |

## Database Schema

40+ tables including: organizations, users, locations, providers, patients, insurance_policies, appointments, encounters, diagnoses, procedures, charges, claims, claim_lines, denials, appeals, insurance_payments, patient_payments, patient_ledger, eligibility_checks, prior_authorizations, credentials, fee_schedules, payer_contracts, work_queue_items, automation_rules, scrub_rules, icd10_codes, cpt_codes, carc_codes, audit_logs, and more.

## Security & HIPAA

- JWT authentication with refresh tokens
- Role-based access control (10 roles)
- Complete audit trail on every data access
- Password complexity requirements
- Session timeout support
- Rate limiting
- Helmet security headers
- Encrypted sensitive fields (SSN)
- Docker isolation
- CORS protection

## TODO (Integration Points)

These are marked with `// TODO` in the codebase:

- [ ] **Clearinghouse API** — Connect to Change Healthcare / Availity for real 837/835 EDI
- [ ] **Stripe Payments** — Wire up patient credit card / ACH processing
- [ ] **SendGrid Email** — Patient statements, credential alerts, notifications
- [ ] **AI Coding** — Replace rule-based with OpenAI/Claude for clinical note coding
- [ ] **CAQH Integration** — Auto-sync provider credentialing data
- [ ] **EHR/FHIR** — HL7 FHIR R4 integration for patient/encounter data
- [ ] **Real-time Eligibility** — Connect to payer 270/271 EDI transactions
