# Security Checklist

Status: `[x]` implemented · `[~]` partial · `[ ]` planned (milestone in brackets)

## Authentication & sessions
- [x] Phone OTP, hashed at rest (SHA-256 + server pepper), 5-minute TTL, 5 attempts [M1]
- [x] OTP request rate limit per phone (5/h) and per IP [M1]
- [x] JWT access token (HS256, 1 h) + rotating refresh token (hash stored, 30 d) [M1]
- [x] Session revocation (single + all) [M1]
- [x] Suspended users rejected at auth time and on every request [M1]
- [ ] Admin MFA (TOTP) [M8]
- [ ] Login abuse detection (new device / impossible travel) [M9]

## Authorization
- [x] Role-based route guards; explicit role list per route [M1]
- [x] Resource ownership checks via `core/permissions` [M1, extended per module]
- [ ] Row-level security policies on every table [M1 SQL, extended per migration]
- [ ] Two-person approval for high-risk admin actions (refund > threshold, suspension) [M8]

## Input & API
- [x] zod validation on params/query/body; unknown keys stripped [M1]
- [x] Idempotency-Key support for mutating routes [M1]
- [x] Structured error responses, no stack traces to clients [M1]
- [x] Request ids in logs and responses [M1]
- [ ] Global rate limiting per user/IP on write routes [M2]
- [ ] API min-version gate (426) [M2]

## Data protection
- [x] Money as integer paise [M1]
- [~] KYC: only the last four characters of a document number are stored, never the number itself; submissions are audited without the number [M3]. Envelope encryption of the file and admin-only signed URLs still to come [M8]
- [x] No secrets in mobile bundle (`EXPO_PUBLIC_*` only) [M1]
- [x] Secrets via env; `.env` gitignored; `.env.example` placeholders only [M0]
- [x] No phone numbers/OTP codes in logs (redaction in logger) [M1]
- [ ] Media served through short-lived signed URLs [M2]
- [ ] Media moderation flags (hash duplicate, EXIF) [M9]

## Payments
- [ ] Signed webhook verification (HMAC) [M7]
- [ ] Webhook dedupe by provider event id [M7]
- [ ] Idempotent capture/refund/settlement [M7]
- [ ] Never trust client payment result [M7]

## Audit & immutability
- [x] `audit_logs` append-only (no UPDATE/DELETE grants) [M1]
- [ ] `job_status_events`, `ledger_entries` append-only [M2/M7]
- [x] Admin actions require `reason` [M1 shape, M8 routes]

## Operations
- [x] Separate env files per environment; `APP_ENV` gate [M1]
- [ ] Backups + restore test documented and executed [M9]
- [x] Error monitoring adapter (mock now; Sentry later) [M1]
- [ ] Dependency vulnerability check in CI (`npm audit --audit-level=high`) [M1 CI]
- [ ] Maintenance mode flag [M8]

## Tests (see TEST_PLAN.md §Security)
- [x] Unauthorized job access, cross-role access [M1 baseline, extended]
- [ ] Accepted-quote tampering, technician cross-job access, webhook replay, OTP reuse, rate-limit bypass, media URL leakage, admin privilege escalation [M4-M9]
