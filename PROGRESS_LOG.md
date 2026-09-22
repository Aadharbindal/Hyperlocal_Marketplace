# Progress Log

Newest first. Every milestone ends with this report (PRODUCT_SPEC section 30).

---

## Milestone 2: Customer job flow

**Milestone:** M2 - Customer job flow
**Date:** 2026-09-22
**Status:** Complete

**Implemented:**
- `packages/core`: job rules module - media limits (8 photos, 1 voice note capped at 60 s, size and
  mime allow-lists), submission readiness checks, prohibited-request blocklist kept separate from
  safety-hazard detection (hazards warn, they never block), duplicate-request detection, and the
  zod contracts for every job payload and view.
- `supabase/migrations/0002_jobs.sql`: `jobs`, `job_media`, `job_status_events` with job/payment
  status enums, a partial unique index giving one live draft per category+address, a hash index
  that turns a retried upload into a no-op, an append-only status trail, and triggers that refuse
  to let a job leave DRAFT without an address plus a description or media, and that refuse request
  media once the job has moved on.
- `apps/api` jobs module: a single `transition()` that validates the state machine, re-reads the
  row inside the transaction and writes the status event atomically; draft create/resume, draft
  edit, media upload targets, submit (DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS with the
  bid window and tracking token), cancel, customer list with active/past scopes, and a deliberately
  minimal public `/track/:token` view.
- `apps/mobile`: booking flow (category strip, description, photos via expo-image-picker, urgent and
  materials toggles, time slot, address picker with out-of-zone guard, sticky CTA above the tab bar,
  staggered entrance animations, inline hazard warnings); job status screen with a live bid-window
  countdown, milestone timeline, request summary, activity trail, share-tracking and cancel; bookings
  list wired to the API with active/past tabs and live status pills; home categories open the flow.

**Changed files:** `packages/core/src/{jobs/job-rules.ts,jobs/job-rules.test.ts,contracts/jobs.ts,index.ts}`,
`supabase/migrations/0002_jobs.sql`, `apps/api/src/{data/types.ts,data/memory/{index,jobs}.ts,data/postgres/{index,jobs}.ts,modules/jobs/{service,routes}.ts,app.ts,test/{jobs.test.ts,helpers.ts}}`,
`apps/mobile/{src/api/jobs.ts,app/(customer)/{book.tsx,bookings.tsx,home.tsx,job/[id].tsx}}`, docs.

**Database changes:** migration `0002_jobs` (see above). `migrate:check` passes with 2 migrations.

**API changes:** `POST /jobs`, `PATCH /jobs/:id`, `GET /jobs/:id`, `GET /me/jobs`,
`POST /jobs/:id/media`, `DELETE /jobs/:id/media/:mediaId`, `POST /jobs/:id/submit`,
`POST /jobs/:id/cancel`, `GET /track/:token`. Documented in `API_REFERENCE.md`.

**Tests added:**
- Unit (core, 15 new): media mime/size/duration/count limits, submission blockers, clock-skew
  tolerance on the preferred start, prohibited vs hazard wording, duplicate window.
- Integration (api, 24 new): draft create with status trail, draft resume, disabled category,
  address ownership, hazard flagging, upload targets and every media limit, retried upload dedupe,
  media delete, full submit walk with a 30-minute window, 10-minute urgent window, wordless job
  with a photo, out-of-zone refusal, prohibited request, duplicate warning, double-submit rejection,
  post-submit lock, active/past listing, cancel with mandatory reason, public tracking link leaking
  nothing sensitive, and five cross-user/role/suspension security checks.

**Tests passed:** 96/96 (53 unit + 43 integration). Type check clean across 3 workspaces. Lint clean.
Migration check OK.

**Manual verification completed:** ran the API and the app in the in-app browser at 390x844 - logged
in as the seeded customer, opened the booking flow from the Plumbing tile, described the problem and
submitted. Server log shows `POST /jobs 201` -> `POST /jobs/:id/submit 200` -> `GET /jobs/:id 200`;
the app landed on the status screen with the live countdown at 29:41, the milestone timeline at
"Finding providers", and the booking appeared under the Bookings > Active tab.

**Known limitations:** voice-note recording is not in the app yet (the API accepts and validates
voice notes); media bytes are not stored because the storage adapter is mocked, so photo thumbnails
fall back to an icon; auto-cancel when a bid window expires is not scheduled yet (the helper exists);
provider-side job feed arrives in M3. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** every job route re-checks ownership against the signed-in user (five
tests cover cross-user access); a provider cannot create a customer job; a suspended customer keeps
read access to history but cannot create anything; the public tracking link exposes no address,
phone number or media; status changes only happen through the guarded transition, which is also
enforced by SQL triggers; media is validated server-side before any storage target is issued.
The test helper now gives each test user its own IP so the per-IP OTP limit stays active in tests
rather than being loosened.

**External integrations mocked or live:** ALL MOCKED - storage returns fake signed URLs and skips
the byte transfer; SMS, payment, maps, push, telephony, monitoring and analytics unchanged.

**Next milestone:** M3 - Provider workflow (provider profile and verification status, service
radius, nearby job feed with eligibility filtering, bid creation and revisions, provider active jobs).

---

## Milestone 1: Foundation

**Milestone:** M1 - Foundation
**Date:** 2026-09-22
**Status:** Complete

**Implemented:**
- npm-workspaces monorepo: `packages/core` (domain rules + zod contracts), `apps/api` (Fastify), `apps/mobile` (Expo SDK 53 + expo-router 5).
- `packages/core`: job state machine (all 24 statuses, actor-restricted edges, terminal guards), integer-paise pricing with fee/tax/cancellation/refund math, bid window + eligibility + validation + non-price-only ranking, permission matrix (41 actions x 7 roles, high-risk set), haversine/geohash/pilot-zone helpers, OTP policy helpers, Indian phone normalisation, en/hi shared strings.
- `apps/api`: zod-validated env with production guard against mock adapters; adapter interfaces + deterministic mocks for SMS, maps, push, storage, payment, telephony, monitoring, analytics; repository abstraction with `memory` and `postgres` implementations; OTP auth (HMAC-hashed codes, 5 attempts, 5/hour, 60 s resend cooldown, IP limit), JWT access + rotating refresh sessions, revoke single/all; `/me` (profile, roles, consents), self-service role grant with profile bootstrap, consents, deletion scheduling with retention event, notifications feed; addresses with geocoding + pilot-zone flag + ownership checks; localised categories; admin user search (masked for support), suspend/reactivate with mandatory reason, audit-log viewer; global rate limit, per-route OTP limits, `Idempotency-Key` replay, request ids, PII-redacting logger, plain-language localised error envelope, `/health` + `/ready` (lists mocked adapters); demo seed (8 accounts).
- `apps/mobile`: design tokens derived from the user's reference screenshot (mint ground, deep-teal primary/gradient, white rounded cards, pastel icon chips, floating pill tab bar); UI kit (Text, Button, Card, TextField, IconChip, IconButton, Badge, Avatar, SectionHeader, Dots, Skeleton, EmptyState, ErrorState, OfflineBanner, Screen, FloatingTabBar); typed API client with refresh-on-401 and error mapping; zustand session (SecureStore) + NetInfo store; en/hi i18n; AuthGate routing (auth -> role picker -> role tabs); screens: phone, OTP (6-box, auto-submit, resend timer, demo-code badge), role picker, customer Home (matches reference), Bookings/Messages empty states, Profile (roles, role switch, language toggle, sign out), provider Jobs/Active/Earnings/Profile with verification badge and empty states; global error boundary.
- Tooling: ESLint flat config, Prettier, CI workflow, migration checker, esbuild API bundle, Dockerfile, `.claude/launch.json`.

**Changed files:** all files under `packages/core/src`, `apps/api/src`, `apps/mobile/{app,src}`, `supabase/migrations/0001_foundation.sql`, root configs, all 18 documentation files.

**Database changes:** `0001_foundation.sql` - enums, users, user_roles, otp_challenges, sessions, customer/provider/contractor/technician/vendor profiles, addresses, service_categories, service_skills, provider_skills, consents, audit_logs (append-only grants), notifications, retention_events, idempotency_keys; RLS enabled on all tables; category/skill seed rows.

**API changes:** `/health`, `/ready`, `/auth/request-otp|verify-otp|refresh|logout`, `/me` (GET/PATCH/DELETE), `/me/roles`, `/me/consents`, `/me/notifications`, `/me/addresses` (CRUD), `/categories`, `/admin/users`, `/admin/users/:id/suspend|reactivate`, `/admin/audit-logs`. See `API_REFERENCE.md`.

**Tests added:**
- Unit (core, 38): state machine happy path/invalid/actor/terminal, pricing breakdown/min fee/revisions/rounding/cancellation/refund/format, bid windows/eligibility/validation/expiry/ranking, permissions matrix, geo, OTP/phone helpers.
- Integration (api, 19): ready reports mocks; signup; invalid phone; wrong-code attempts + lock; OTP reuse blocked; resend cooldown; refresh rotation + replay rejection; tampered token; logout-all; Hindi error localisation; self-service vs privileged roles; provider profile bootstrap; address create/geocode/pilot-zone/default/cross-user 403/validation; role-gated address access; idempotency replay + key reuse across routes; support masked search; support cannot suspend; reason mandatory; suspension revokes sessions, blocks actions, keeps read access; audit entries with actor/reason; support cannot read audit; admin cannot self-suspend; consents + deletion scheduling; categories localisation.

**Tests passed:** 57/57 (`npm test`). Type check: 3/3 workspaces clean. Lint: 0 errors. Build: API bundle + Expo web export OK. Migration check: OK.

**Manual verification completed:** API booted in demo mode (`/ready` lists 8 mocked adapters); mobile web run in the in-app browser at 420x880: phone -> OTP auto-submit -> seeded customer Home renders categories from the API; Profile tab; Hindi toggle persists via `PATCH /me` and re-renders every string; viewport reset afterwards.

**Known limitations:** every external adapter is mocked; Postgres repository written but not yet exercised by the suite (memory mode only); realtime not started; no mobile component tests yet (M2); `query-string` pinned in mobile because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it; hero illustration is an icon placeholder until the final design supplies artwork; category tiles show only the 3 enabled categories (appliance repair disabled per spec). Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** OTP codes stored as HMAC (server secret) and compared in constant time; refresh tokens stored hashed and single-use; suspended users authenticate read-only, all mutations 403; roles re-read per request so revocation is immediate; admin actions need `reason` and write immutable audit rows; logger redacts phone/OTP/tokens; production boot refuses mock SMS/payment and non-Postgres data mode; no secrets in mobile bundle. Open items: admin MFA, KYC encryption, two-person approval (M8).

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage, telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M2 - Customer job flow (job creation with media/voice upload, submission, status timeline, `0002_jobs` migration, Postgres-mode integration run).

---

## Milestone 0: Repository and architecture

**Milestone:** M0
**Date:** 2026-09-22
**Status:** Complete

**Implemented:** cloned empty `Aadharbindal/Hyperlocal_Marketplace`; created all 18 required documents (README, PRODUCT_SPEC, ARCHITECTURE, DECISIONS D-001..D-010, KNOWN_LIMITATIONS, SECURITY_CHECKLIST, PRIVACY_DATA_MAP, PAYMENT_FLOW, DISPUTE_POLICY, EDGE_CASE_MATRIX with 150+ scenarios across 13 areas, TEST_PLAN, INCIDENT_RESPONSE, IMPLEMENTATION_PLAN, PROGRESS_LOG, API_REFERENCE, DATABASE_SCHEMA, DEPLOYMENT, ENVIRONMENT_VARIABLES); `.env.example` with placeholder names only; `.gitignore`, editor/prettier/eslint configs; CI workflow; migration checker; stack confirmed (Expo + Fastify + Postgres/Supabase, modular monolith, adapters with mocks).

**Changed files:** root `*.md`, `.env.example`, `.gitignore`, `.editorconfig`, `.prettierrc`, `eslint.config.mjs`, `package.json`, `tsconfig.base.json`, `.github/workflows/ci.yml`, `scripts/check-migrations.mjs`.
**Database changes:** none (schema designed in `DATABASE_SCHEMA.md`).
**API changes:** none (contracts designed in `API_REFERENCE.md`).
**Tests added / passed:** n/a.
**Manual verification completed:** documentation cross-links reviewed.
**Known limitations:** brand name placeholder (D-001).
**Security considerations:** secrets policy established; checklist created.
**External integrations mocked or live:** none yet.
**Next milestone:** M1 - Foundation.
