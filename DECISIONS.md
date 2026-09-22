# Architecture Decision Records

Format: ID · Date · Status · Context · Decision · Consequences

---

## D-001 · 2026-09-22 · Accepted · Brand name placeholder
**Context.** Final brand name is not yet decided.
**Decision.** Use `BRAND_NAME` env var and `[FINAL BRAND NAME]` placeholder in docs/UI strings.
**Consequences.** Single point of change; no rename churn later.

## D-002 · 2026-09-22 · Accepted · npm workspaces monorepo
**Context.** Three units (mobile, api, core) must share types and domain rules.
**Decision.** npm workspaces (npm 10 is present; no extra tooling). `packages/core` is consumed
as a workspace dependency by both apps.
**Consequences.** Metro needs `watchFolders` for the monorepo root (configured in
`apps/mobile/metro.config.js`).

## D-003 · 2026-09-22 · Accepted · Node/Fastify API as server of record instead of edge-functions-only
**Context.** Spec allows "edge functions or backend service". Bid acceptance, settlement and
admin overrides need multi-table transactions, integration tests must run on Windows without
Docker, and mock-mode must be first-class.
**Decision.** `apps/api` (Fastify + TypeScript) is the only writer of business state. Supabase
provides Postgres, Storage, Realtime; Supabase Auth may replace the first-party OTP later.
**Consequences.** One more service to deploy (documented in `DEPLOYMENT.md`). RLS still applied
as defence in depth.

## D-004 · 2026-09-22 · Accepted · Repository abstraction with memory + postgres implementations
**Context.** Local demo and CI must work with no database; production needs Postgres.
**Decision.** `data/types.ts` repository interfaces; `DATA_MODE=memory|postgres`.
**Consequences.** Integration tests run against memory by default and can run against Postgres.
Business constraints are duplicated in SQL for safety.

## D-005 · 2026-09-22 · Accepted · First-party OTP challenge table behind `SmsAdapter`
**Context.** Supabase Auth phone OTP requires a live SMS provider; local demo must work offline.
**Decision.** API owns `otp_challenges` and issues its own JWT. SMS delivery is an adapter.
**Consequences.** Swapping to Supabase Auth later touches only `modules/auth/provider.ts`.

## D-006 · 2026-09-22 · Accepted · Money stored as integer paise
**Context.** Floating-point money is unsafe.
**Decision.** All amounts are `bigint`/integer paise (INR × 100) in DB and API; formatting on client.
**Consequences.** `core/pricing` does integer math with explicit rounding rules.

## D-007 · 2026-09-22 · Accepted · No "escrow" terminology
**Context.** Regulated term in India.
**Decision.** Use authorization / hold / milestone / settlement / refund / dispute hold.
**Consequences.** Copy and code use these words; legal review flagged in `PRODUCT_SPEC.md` §32.

## D-008 · 2026-09-22 · Accepted · Design tokens derived from user reference design
**Context.** User supplied a reference screenshot (mint background, deep teal primary, white
rounded cards, soft coloured icon chips, pill tab bar). Final designs come later.
**Decision.** Encode palette/spacing/radius/typography as tokens in `apps/mobile/src/theme`.
Screens consume components only.
**Consequences.** Final handoff is a token + component swap; no business logic change.

## D-009 · 2026-09-22 · Accepted · Polling first, realtime later
**Context.** Realtime adds infra coupling early.
**Decision.** Bid feed/chat poll (5-10 s) through M3; `RealtimeAdapter` in M4 with polling fallback.

## D-010 · 2026-09-22 · Accepted · Job status ≠ payment status
**Context.** Spec §9. **Decision.** `jobs.status` and `jobs.payment_status` are separate columns,
each with its own event log. Settlement requires both `COMPLETED` and `CAPTURED`.
