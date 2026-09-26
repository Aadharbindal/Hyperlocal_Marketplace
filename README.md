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
npm run a11y          # WCAG contrast + screen-reader labelling; fails on a miss
npm run test
npm run build
npm run migrate:check

npm run check         # all of the above, in order
```

Two of these are worth a word. `npm run a11y` computes the contrast of every colour pairing the
app actually renders, reading the palette straight out of `tokens.ts` so it cannot drift from the
real values, and also refuses an icon-only control with no label. It is arithmetic, so it belongs
in CI rather than in a review.

`npm run load-test` is not in the gates because it needs a running API and a real database:

```bash
DATA_MODE=postgres DATABASE_URL=... npm run api:dev
node scripts/load-test.mjs --users 100 --ramp 5000
```

Each virtual user walks a whole booking rather than hitting one endpoint, because nothing in this
product is a single request. It reports per-endpoint percentiles and counts anything slower than
three seconds.

## What is built

All nine milestones are complete. The whole journey works end to end:

| | |
| --- | --- |
| **Customer** | describes the job with photos, gets ranked offers, negotiates, authorizes payment, shares a 4-digit start code, approves extra work, picks a material supplier, signs off the finished job, rates it, and can report a problem |
| **Provider** | sees nearby jobs without the address, bids, negotiates, marks on-the-way and arrived, starts with the customer's code, asks for materials, requests approval for extra work, submits completion evidence, and watches their earnings clear |
| **Vendor** | receives material lists from nearby jobs, prices them line by line with a stock flag, delivers, and files an invoice that must match the order |
| **Support** | signs in with a second factor, reviews identity documents, decides disputes, retries payouts, and reads the ops report |

Behind it: a job state machine the server alone executes, offers and quotes that freeze when
accepted, an append-only double-entry ledger, settlements that wait out a hold and stop for
disputes, and a background worker that closes windows and chases stuck payments.

**308 automated tests** (179 API integration, 129 domain unit) run on every push, along with
type checking, linting, a migration check and a build of both apps.

## What is not built

**No external integration is live.** SMS, payments, maps, push, storage, telephony, monitoring
and analytics all run as mock adapters: no money has moved, no message has been sent, no file has
been stored. The flows, the rules and the guards around them are real.

`KNOWN_LIMITATIONS.md` is the full list, each row marked *before launch* or *after pilot*. The
short version of what a pilot needs first:

1. Real gateway, SMS and storage credentials, then the same test suite run against Postgres
   rather than the in-memory store - the SQL has never been executed
2. A restore drill actually performed (`DEPLOYMENT.md` has the steps; nobody has run them)
3. Legal and tax review of the payment structure and the 18% GST placeholder
4. The final licensed artwork to replace the derived welcome illustration (D-011)

## Status

`PROGRESS_LOG.md` carries a full report for every milestone, newest first.
