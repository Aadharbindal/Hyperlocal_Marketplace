# Architecture

## 1. Overview

```
┌──────────────────────────┐        HTTPS/JSON         ┌───────────────────────────────┐
│  apps/mobile (Expo/RN)   │ ─────────────────────────▶│  apps/api (Fastify, Node 20)  │
│  customer/provider/      │ ◀───────────────────────  │  modular monolith             │
│  contractor/vendor UIs   │   realtime (Supabase)     │  - auth, RBAC, audit          │
└──────────────────────────┘                           │  - job state machine          │
            │                                          │  - bidding / negotiation      │
            │ uses                                     │  - payments / ledger          │
            ▼                                          │  - materials / disputes       │
┌──────────────────────────┐                           │  - admin                      │
│  packages/core           │ ◀──── uses ──────────────│                               │
│  pure domain rules       │                           └──────────────┬────────────────┘
│  + zod contracts         │                                          │ Repository interface
└──────────────────────────┘                                          ▼
                                                    ┌──────────────────────────────────┐
                                                    │ data/memory  (demo, tests)       │
                                                    │ data/postgres (Supabase Postgres)│
                                                    └──────────────────────────────────┘
                                                                     │
                     Adapters (mock | live): SMS · Payment · Maps · Push · Telephony · Storage · Monitoring
```

Principles:

1. **Server is the source of truth.** Every state transition, price lock, payment action and
   permission decision is made in `apps/api`. The mobile client renders and requests.
2. **Modular monolith.** One deployable service; domain modules are isolated folders with
   explicit public interfaces. No Kafka, no microservices, one database.
3. **Adapters for everything external.** Each provider has an interface, a `mock`
   implementation and (when credentials exist) a live implementation. Selection is by env.
4. **Domain rules are shared, not duplicated.** `packages/core` holds the state machine,
   price math and permission matrix so the client can pre-validate, but the server re-validates.
5. **Everything is auditable.** Status events, ledger entries and admin actions are append-only.

## 2. Modules (`apps/api/src/modules`)

| Module | Owns | Depends on |
| --- | --- | --- |
| `auth` | OTP challenges, sessions, tokens, rate limits | `sms` adapter, `users` |
| `users` | users, roles, profiles (customer/provider/contractor/technician/vendor), consents | `audit` |
| `addresses` | saved addresses, service locations, pilot-zone check | `maps` adapter |
| `categories` | service categories and skills, enabled flags | - |
| `jobs` | job aggregate, media, status events, state machine execution | `core/jobs`, `storage` |
| `bids` | bids, revisions, eligibility, bid windows | `jobs`, `users` |
| `negotiation` | offers, counter-offers, quote locking | `bids`, `jobs` |
| `assignments` | provider/technician assignment, replacement, start OTP | `jobs`, `users` |
| `materials` | material requests, vendor quotes, orders, delivery, invoices | `jobs`, `payments` |
| `payments` | authorizations, captures, refunds, webhooks, idempotency | `payment` adapter, `ledger` |
| `ledger` | double-entry style ledger entries, settlement records | - |
| `reviews` | ratings, review gating | `jobs` |
| `disputes` | disputes, evidence, resolutions, strikes | `jobs`, `payments`, `audit` |
| `notifications` | in-app + push notifications | `push` adapter |
| `chat` | threads, messages, contact-leak detection | `jobs` |
| `admin` | KYC review, suspensions, overrides, reports, audit viewer, tickets | all |
| `audit` | immutable audit log writes | - |

Cross-module calls go through exported service functions, never through another module's
repository directly.

## 3. Request lifecycle

1. `onRequest`: request id, structured logger child, rate limiter.
2. `authenticate`: verify JWT, load user + active roles, reject suspended sessions.
3. `authorize(route)`: role check + resource ownership check (`core/permissions`).
4. `validate`: zod schema for params/query/body (shared contracts).
5. `idempotency` (mutating money/state routes): `Idempotency-Key` header cached per user.
6. Handler → service → repository inside a transaction when the operation touches more than
   one table.
7. `audit` + `status event` writes happen in the same transaction.
8. Error handler maps `AppError` codes to HTTP responses with plain-language messages.

## 4. Data layer

`Repository` interfaces in `apps/api/src/data/types.ts`. Two implementations:

- `memory`: in-process maps, deterministic ids, used for local demo and integration tests.
- `postgres`: `pg` pool against Supabase Postgres, migrations in `supabase/migrations`.

Both must pass the same integration test-suite. Business constraints are enforced in **both**
code (portable) and SQL (defence in depth).

## 5. Realtime

Bid feed and chat use polling in M1-M3 (simple, works in memory mode). Supabase Realtime
channels are introduced in M4 behind a `RealtimeAdapter`; the client falls back to polling.

## 6. Security architecture

See `SECURITY_CHECKLIST.md`. Highlights: JWT access tokens (1h) + rotating refresh tokens,
role-based route guards, per-resource ownership checks, RLS on all tables, signed webhook
verification, idempotency keys, OTP rate limiting, KYC document encryption at rest, no secrets in
the mobile bundle (`EXPO_PUBLIC_*` only).

## 7. Mobile architecture

- `expo-router` file-based routes grouped by role.
- `src/theme` tokens → `src/ui` components → screens. No colour or spacing literal in screens.
- `src/api` typed client generated from `packages/core/contracts` (zod).
- `src/store` (zustand): session, active role, offline queue of idempotent mutations.
- Global error boundary, offline banner, toast for recoverable errors.
- i18n string tables (`en`, `hi`) from day one; no hard-coded user-facing strings in screens.

## 8. Environments

`local` (memory or local Supabase), `staging` (Supabase project + sandbox adapters),
`production`. Separate credentials per environment. See `DEPLOYMENT.md`.
