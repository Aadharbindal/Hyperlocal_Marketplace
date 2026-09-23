# Security Checklist

Status: `[x]` implemented · `[~]` partial · `[ ]` not built (milestone in brackets)

Audited line by line against the code at the end of M9. An item is only ticked if a test or a
migration proves it; anything half-done says so and says what is missing.

## Authentication & sessions
- [x] Phone OTP, hashed at rest (SHA-256 + server pepper), 5-minute TTL, 5 attempts [M1]
- [x] OTP request rate limit per phone (5/h) and per IP [M1]
- [x] JWT access token (HS256, 1 h) + rotating refresh token (hash stored, 30 d) [M1]
- [x] Session revocation (single + all) [M1]
- [x] Suspended users rejected at auth time and on every request [M1]
- [x] Admin MFA (TOTP): enrolment, single-use codes, 8-hour session freshness, 5-failure lock; `ADMIN_MFA_REQUIRED` and the API refuses to boot in production without it [M8]
- [ ] Login abuse detection (new device / impossible travel). Sessions record device, IP and user agent, so the data is there; nothing looks at it yet [after pilot]

## Authorization
- [x] Role-based route guards; explicit role list per route [M1]
- [x] Resource ownership checks via `core/permissions` [M1, extended per module]
- [~] Row-level security is **enabled** on every table, but only `0001` defines policies. The API connects as the service role and re-checks ownership in code, so the effect today is "nothing reaches the database except through the API". Per-table policies are still needed before any direct client access [before launch]
- [x] Two-person approval for high-risk admin actions: refunds over Rs 5,000 [M7] and every suspension [M8], enforced in code and by SQL trigger, with the approver required to be staff and not the actor

## Input & API
- [x] zod validation on params/query/body; unknown keys stripped [M1]
- [x] Idempotency-Key support for mutating routes [M1]
- [x] Structured error responses, no stack traces to clients [M1]
- [x] Request ids in logs and responses [M1]
- [x] Global rate limiting: 300 requests/minute keyed by user id, falling back to IP [M2]
- [x] API min-version gate: `x-app-version` below `MIN_APP_VERSION` gets 426 with the minimum in the body; a caller with no version header is not blocked [M9]

## Data protection
- [x] Money as integer paise [M1]
- [~] KYC: only the last four characters of a document number are stored, never the number itself; submissions are audited without the number [M3]. Reviewer access is now a separate, logged act with a 5-minute signed URL and an append-only `kyc_access_log` [M8]. Envelope encryption of the file itself still to come [M9]
- [x] No secrets in mobile bundle (`EXPO_PUBLIC_*` only) [M1]
- [x] Secrets via env; `.env` gitignored; `.env.example` placeholders only [M0]
- [x] No phone numbers/OTP codes in logs (redaction in logger) [M1]
- [x] Media is served through short-lived signed URLs (`STORAGE_SIGNED_URL_TTL_SECONDS`), and a KYC document's URL lasts five minutes and is logged to `kyc_access_log` [M2, M8]
- [ ] Media moderation flags (hash duplicate, EXIF stripping). A sha256 is stored and duplicates are refused per job; nothing strips EXIF or scans content [after pilot]

## Payments
- [x] Signed webhook verification (HMAC), checked **before** the body is parsed [M4, M7]
- [x] Webhook dedupe by `payment_events.provider_event_id` (unique); a replay is a 200 no-op [M4]
- [x] Idempotent capture, refund and settlement: unique `idempotency_key` on payments, refunds, settlements and every ledger batch [M7]
- [x] Never trust the client: capture is not an endpoint at all, amounts come from the locked quote, and reconciliation asks the gateway rather than the app [M7, M9]
- [x] Bank account numbers are **never stored**: they go to the payment provider on submission and the row keeps only the last four digits. `POST /me/payout-account` never echoes the number back, and `accountNumber`, `ifsc` and `vpa` are in the logger's redaction list [post-M9]
- [x] A settlement cannot be *sent* to a payee with no verified payout account - enforced in the service, in the memory repo and by a SQL trigger - while what is owed is still recorded, so money is never quietly dropped [post-M9]
- [ ] The name on a payout account is not verified against the payee's KYC name; a penny-drop or name-match check is still to be wired (KNOWN_LIMITATIONS)

## Audit & immutability
- [x] `audit_logs` append-only (no UPDATE/DELETE grants) [M1]
- [x] `job_status_events`, `ledger_entries`, `payment_events`, `dispute_evidence`, `strikes` and `kyc_access_log` are append-only (UPDATE/DELETE revoked); chat messages allow only a read receipt to change [M2, M5, M7, M8]
- [x] Admin actions require `reason` [M1 shape, M8 routes]

## Operations
- [x] Separate env files per environment; `APP_ENV` gate [M1]
- [~] Backups and restore are **documented** in `DEPLOYMENT.md` with a step-by-step drill. They have not been executed: there is no provisioned database yet, so nothing has been restored [before launch]
- [x] Error monitoring adapter (mock now; Sentry later) [M1]
- [~] `npm audit --audit-level=high` runs in CI but with `|| true`, so it reports and never fails the build. Make it blocking once the current advisories are triaged [before launch]
- [x] Maintenance mode: `MAINTENANCE_MODE` answers 503 to every state-changing request while reads keep working, and `/ready` reports it [M9]

## Tests (see TEST_PLAN.md §Security)
- [x] Unauthorized job access, cross-role access [M1 baseline, extended]
- [x] Adversarial suite (`apps/api/src/test/security.test.ts`, 21 tests): accepted-quote tampering, post-acceptance price raising, provider cross-job access, customer cross-account access, address and phone leakage in the feed and the public tracking link, unsigned and wrongly signed webhooks, webhook replay, amount-mismatch webhooks, OTP reuse, per-phone rate limit across changing IPs, start-code leakage to the provider, self-granted staff roles, spoofed `x-active-role`, money endpoints for non-staff, client-published events, suspended and unverified accounts, idempotent acceptance, the version gate and maintenance mode [M9]

This suite found a real bug on its first run: `GET /jobs/:id/execution` checked the *permission*
but not *membership*, so any provider could read another job's execution panel. Fixed in the same
commit and now covered.
