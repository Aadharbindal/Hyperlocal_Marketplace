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
