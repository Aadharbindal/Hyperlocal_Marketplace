# Hyperlocal Services and Materials Marketplace

> Working brand name: **[FINAL BRAND NAME]** (placeholder, see `DECISIONS.md` D-001)

A trust-first, hyperlocal marketplace connecting customers with verified local service
professionals (plumbing, electrical, carpentry, appliance repair), contractors managing
technicians, and nearby material vendors. Customers receive multiple qualified offers, compare,
negotiate, approve scope changes digitally, and complete jobs securely with OTP-gated start,
evidence-based completion, and auditable settlement.

## Repository layout

```
.
├── apps/
│   ├── mobile/          # Expo (React Native) app - customer / provider / contractor / vendor
│   └── api/             # Fastify + TypeScript backend service (modular monolith, source of truth)
├── packages/
│   └── core/            # Pure domain logic + API contracts (state machine, pricing, permissions)
├── supabase/
│   ├── migrations/      # Versioned PostgreSQL migrations (never rewrite applied ones)
│   └── seed/            # Demo seed SQL
├── scripts/             # Repo tooling (migration checks, etc.)
└── *.md                 # Living documentation (see below)
```

## Documentation index

| File | Purpose |
| --- | --- |
| `PRODUCT_SPEC.md` | Product scope, roles, flows, rules (source of truth) |
| `ARCHITECTURE.md` | System architecture, module boundaries, adapters |
| `IMPLEMENTATION_PLAN.md` | Milestones, folder structure, plans, risks |
| `DECISIONS.md` | Architecture decision records |
| `DATABASE_SCHEMA.md` | Tables, constraints, indexes, RLS |
| `API_REFERENCE.md` | Endpoint contracts |
| `PAYMENT_FLOW.md` | Payment authorization, hold, settlement, refund |
| `DISPUTE_POLICY.md` | Dispute categories, SLAs, resolution |
| `EDGE_CASE_MATRIX.md` | Edge-case matrix per feature |
| `SECURITY_CHECKLIST.md` | Security controls and status |
| `PRIVACY_DATA_MAP.md` | Personal data inventory and retention |
| `INCIDENT_RESPONSE.md` | Incident runbook |
| `TEST_PLAN.md` | Test strategy and coverage rules |
| `DEPLOYMENT.md` | Local setup, staging, production |
| `ENVIRONMENT_VARIABLES.md` | Every env var, purpose, and mock behaviour |
| `KNOWN_LIMITATIONS.md` | Mocked integrations and gaps |
| `PROGRESS_LOG.md` | Milestone reports |

## Quick start (local demo mode, no external services required)

```bash
npm install
cp .env.example .env
npm run api:dev          # API on http://localhost:4000 (DATA_MODE=memory, SMS mock -> OTP 123456)
npm run mobile:start     # Expo dev server
```

Demo accounts are seeded automatically in memory mode (see `apps/api/src/data/seed.ts`).
Any phone number works in mock SMS mode; the OTP is printed in the API log and is `123456`.

## Quality gates

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run migrate:check
```

## Status

See `PROGRESS_LOG.md` for the latest milestone report and `KNOWN_LIMITATIONS.md` for what is
mocked versus live. **No external integration is live yet** - every provider adapter runs in mock
mode until credentials are supplied.
