# Implementation Plan

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## 1. Architecture (summary)

Modular monolith with three deployable units and one shared domain package:

| Unit | Tech | Responsibility |
| --- | --- | --- |
| `apps/api` | Node 20, Fastify, TypeScript | **Source of truth**. Auth, RBAC, job state machine, bidding, payments, ledger, admin. Talks to PostgreSQL (Supabase) or an in-memory store in demo mode. |
| `apps/mobile` | Expo SDK 53, expo-router, TypeScript | Customer, provider, contractor, technician, vendor UIs. Never contains business rules that decide money or state. |
| `packages/core` | Pure TypeScript | Domain rules shared by API and mobile: state machine, offer/bid validation, price math, permission matrix, geo helpers, zod contracts. |
| `supabase/` | SQL migrations, RLS | Schema and row-level security. Applied through Supabase CLI. |

Why a Node API instead of only edge functions: testability on any OS without Docker, single
transaction boundaries for bid acceptance/settlement, easy mock-mode. Edge functions remain
possible later for realtime fan-out. See `DECISIONS.md` D-003.

## 2. Folder structure

```
apps/api/src
  app.ts                   # Fastify factory (plugins, error handler, routes)
  server.ts                # bootstrap
  config/env.ts            # zod-validated env
  lib/                     # logger, errors, ids, crypto, idempotency, rate-limit
  adapters/                # sms, payment, maps, push, telephony, storage, monitoring (mock + live)
  data/                    # Repository interfaces + memory + postgres implementations
  modules/
    auth/ users/ roles/ addresses/ categories/ jobs/ bids/ negotiation/ assignments/
    materials/ payments/ ledger/ reviews/ disputes/ notifications/ admin/ audit/
  test/                    # integration tests (fastify inject)
apps/mobile
  app/                     # expo-router routes
    (auth)/ (customer)/ (provider)/ (contractor)/ (vendor)/
  src/theme/               # design tokens (single source for colours/spacing/type)
  src/ui/                  # reusable components
  src/api/                 # typed API client
  src/store/               # session + offline queue
  src/i18n/                # en / hi string tables
packages/core/src
  jobs/state-machine.ts    bidding/  pricing/  permissions/  geo/  otp/  contracts/
supabase/migrations/NNNN_*.sql
```

## 3. Database plan

PostgreSQL 15. UUID public ids, `created_at`/`updated_at`, soft delete via `deleted_at` where
allowed; financial rows are append-only. Schema in `DATABASE_SCHEMA.md`, migrations in
`supabase/migrations`. Constraints enforce: one active confirmed provider per job, one active
booking quote per job, no bid from a suspended provider, no unverified technician assignment,
no duplicate settlement (unique idempotency keys on ledger + payments). RLS policies restrict
direct client access; the API uses the service role and enforces authorization in code as well.

## 4. Authentication plan

Mobile-number OTP. Milestone 1 implements a first-party OTP challenge flow in the API
(`/auth/request-otp`, `/auth/verify-otp`) backed by an SMS adapter (mock in local). Session =
short-lived JWT access token + rotating refresh token stored in `expo-secure-store`. Supabase
Auth phone OTP can replace the OTP challenge table later behind the same adapter interface
(`AuthProvider`). Rate limits: 5 requests / phone / hour, 5 attempts / challenge, 5-minute TTL.

## 5. Role and permission model

`user_roles(user_id, role, status)` - a user may hold multiple roles; each API route declares
the roles it accepts and a resource-level check (`packages/core/permissions`). Roles:
`customer`, `provider`, `contractor`, `technician`, `vendor`, `admin`, `support`.
Admin/support high-risk actions require `reason` and are written to immutable `audit_logs`.

## 6. Payment adapter plan

`PaymentAdapter { createAuthorization, capture, refund, verifyWebhookSignature, parseWebhook }`.
Mock implementation returns deterministic ids and can simulate success/failure/delay/duplicate
webhooks for tests. Razorpay implementation is the intended production target (India). Every
payment operation is idempotent by `idempotency_key`. Job status and payment status are separate
columns. See `PAYMENT_FLOW.md`.

## 7. Mock integration plan

Every external dependency sits behind an interface in `apps/api/src/adapters/*` with a `mock`
implementation selected by env (`*_PROVIDER=mock`). Mocks are deterministic, log clearly with a
`[MOCK]` prefix, and never claim success for real-world side effects. `KNOWN_LIMITATIONS.md`
lists each mocked integration and the production replacement.

## 8. Testing plan

- Unit (vitest, `packages/core`): state machine, pricing, bid validation, offer expiry, radius,
  permissions, cancellation fees, refund math, strike logic.
- Integration (vitest + fastify `inject`, `apps/api`): end-to-end flows against the memory
  repository; same tests can run against Postgres with `DATA_MODE=postgres`.
- Security tests: unauthorized access, cross-role access, replayed webhooks, OTP reuse, rate limit.
- Mobile: component tests for critical UI states (loading/empty/error/offline) via jest-expo
  (added in Milestone 2+).
Full detail in `TEST_PLAN.md`.

## 9. Design-system placeholder plan

Tokens in `apps/mobile/src/theme/tokens.ts` derived from the reference design provided by the
user (mint background, deep teal primary, white rounded cards, soft chips). All components read
tokens only; screens never hard-code colours. Final design handoff protocol in `PRODUCT_SPEC.md`
§34 - swapping tokens/components must not touch `packages/core` or `apps/api`.

## 10. Milestones

- [x] **M0 Repository & architecture** - docs, env template, structure, adapters defined.
- [x] **M1 Foundation** - workspace setup, OTP auth, roles, DB migration 0001, base navigation,
  design tokens, error handling, logging/monitoring hooks.
- [x] **M2 Customer job flow** - profile, addresses, job create, media/voice upload, submit, status.
- [ ] **M3 Provider workflow** - profile, verification, radius, nearby feed, bids, revisions.
- [ ] **M4 Negotiation & confirmation** - offers, counter-offers, quote lock, acceptance tx, payment auth.
- [ ] **M5 Execution & completion** - assignment, technician, arrival, OTP start, price revision, approval.
- [ ] **M6 Materials & vendors** - material request, quotes, selection, delivery, invoice.
- [ ] **M7 Payments, settlement & disputes** - ledger, webhooks, refunds, disputes, tickets.
- [ ] **M8 Admin & operations** - dashboard, KYC review, user mgmt, job ops, reports, audit viewer.
- [ ] **M9 Hardening** - security review, edge-case tests, perf, a11y, backup test, deploy docs, seed, smoke.

## 11. Risk list

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Payment/legal structure ("escrow" wording) | Use hold/settlement vocabulary; flag for legal review before launch |
| R2 | Race conditions on bid acceptance | Single DB transaction + partial unique index on active assignment |
| R3 | Offline provider at job site | Client queue with idempotent status updates; OTP validated server-side when online |
| R4 | KYC document exposure | Encrypted storage, admin-only signed URLs, access audit |
| R5 | Off-platform leakage | Masked calls, contact-detection, in-app benefits |
| R6 | Mock vs live drift | Contract tests run against both mock and live adapters where sandboxes exist |
| R7 | Expo/RN dependency churn | Pin SDK, `expo install --fix` in CI |
| R8 | Windows dev without Docker | Memory data mode; Postgres optional |
