# Test Plan

## Definition of done (per feature)
Happy path · failure path · loading state · empty state · permission denial · network failure ·
audit event asserted · business-critical rule asserted. A feature without these is not complete.

## Layers

| Layer | Tool | Location | Command |
| --- | --- | --- | --- |
| Unit (domain) | vitest | `packages/core/src/**/*.test.ts` | `npm run test:unit` |
| Integration (API) | vitest + `app.inject()` on memory repo (optionally Postgres) | `apps/api/src/test/**` | `npm run test:integration` |
| Security | vitest (API) | `apps/api/src/test/security/**` | included above |
| Mobile components | jest-expo + RNTL | `apps/mobile/src/**/*.test.tsx` | `npm test -w apps/mobile` (from M2) |
| Migrations | node script | `scripts/check-migrations.mjs` | `npm run migrate:check` |
| Static | tsc, eslint | all | `npm run typecheck && npm run lint` |

## Unit test matrix (packages/core)

| Area | Cases |
| --- | --- |
| State machine | every allowed edge, every disallowed edge rejected, terminal states immutable, actor-role restrictions |
| Pricing | integer paise, platform fee rounding, tax, protection fee toggle, revision addition, refund math, cancellation fee per stage |
| Bid validation | window open/closed, revisions ≤ 2, one active bid, fields > 0, suspended provider |
| Offer expiry | expiry respected, parent chain, single acceptance |
| Service radius | haversine, inside/outside, pilot-zone check |
| Permissions | role × action matrix, ownership, multi-role |
| Strikes | thresholds, suspension windows, expiry |
| OTP | code generation, hashing, attempts |

## Integration flows (apps/api)

AUTH-01..09 · JOB-01..13 · BID-01..12 · SCH · OTP · SCO · MAT · PAY · DIS · FRA · SAF · PRI · NET ·
INF — ids from `EDGE_CASE_MATRIX.md`. Core flows:

1. Customer creates job → provider sees eligible job → bid → counter-offer → accept → payment
   authorization → OTP start → price revision → completion approval → settlement webhook.
2. Material request → vendor quote → selection → delivery → invoice → vendor settlement.
3. Dispute creation → hold → resolution → refund.
4. Account suspension → balances retained → reactivation.

## Security tests

Unauthorized job access · cross-provider data access · accepted-quote tampering · technician
access to unrelated jobs · webhook replay · OTP reuse · rate-limit bypass · media URL leakage ·
admin privilege escalation · cross-role access · suspended login.

## Running against Postgres

```
DATA_MODE=postgres DATABASE_URL=... npm run test:integration
```
The same suite must pass. CI runs memory mode on every push; Postgres mode nightly (M9).

## What actually exists at the end of M9

| Suite | File | Tests |
| --- | --- | --- |
| Auth, roles, admin foundation | `auth.test.ts`, `users-roles-admin.test.ts` | 24 |
| Customer job flow | `jobs.test.ts` | 20 |
| Provider workflow | `provider.test.ts` | 17 |
| Negotiation, acceptance, authorization | `negotiation.test.ts` | 17 |
| Execution: arrival, start code, revisions, completion, chat | `execution.test.ts` | 20 |
| Materials and vendors | `materials.test.ts` | 16 |
| Payments, settlement, disputes, reviews | `finance.test.ts` | 18 |
| Support console and MFA | `admin.test.ts` | 13 |
| Scheduled work | `scheduler.test.ts` | 10 |
| Adversarial security pass | `security.test.ts` | 21 |
| **API integration total** | | **179** |
| Domain rules | `packages/core/src/**/*.test.ts` | **129** |

Run everything with `npm test`; `npm run typecheck && npm run lint && npm run migrate:check &&
npm run build` is the rest of the gate. All of it runs in CI on every push.

### What these tests are written to prove

They are not coverage for its own sake. Each suite asserts the claims the product makes to the
people using it:

- **Money is what was agreed.** Capture uses the locked quote whatever the client sends, refunds
  can never exceed what the ledger says was taken, and every batch nets to zero.
- **Privacy holds.** The nearby feed, the offer list, the vendor feed and the public tracking
  link are searched for the address and phone number that must not be in them.
- **Nobody skips a step.** Work cannot start without the customer's code; a payout cannot go out
  during a dispute; a vendor cannot sign for their own delivery; an invoice must match its order.
- **Two people where it matters.** Large refunds and every suspension are refused with one.

### Gaps, stated plainly

- **No mobile component tests.** The app is exercised by hand and through the web build; there is
  no jest-expo suite yet. This is the largest gap in the plan above.
- **Postgres repositories are written but untested.** Every suite runs against the in-memory
  store, which mirrors each SQL constraint by hand. The SQL itself has never been executed.
  Running the same suite against a real Postgres is the first thing to do before launch.
- **No load or soak test.** Nothing has measured what happens at a hundred concurrent bookings,
  and the ops report walks the store rather than querying aggregates, which will not hold at
  scale.
- **No accessibility audit.** Labels and hit areas were written with care; nobody has run a
  screen reader through a booking.
