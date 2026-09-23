# Incident Response

## Severity

| Sev | Definition | Examples | Response |
| --- | --- | --- | --- |
| S1 | Safety, money or data at risk now | data breach, duplicate charges at scale, payouts to wrong account, safety incident | immediate; page on-call; maintenance mode if needed |
| S2 | Core flow broken | bookings/payments failing, OTP outage | within 30 min |
| S3 | Degraded | slow feeds, notification delays | within 4 h |
| S4 | Minor | copy/UI bugs | next release |

## Runbook

1. **Detect**: monitoring adapter alerts, support tickets, gateway dashboards, health checks
   (`GET /health`, `GET /ready`).
2. **Triage**: assign severity, open incident ticket, name incident lead.
3. **Contain**:
   - Security: rotate `API_JWT_SECRET` (forces re-login), revoke admin sessions, disable affected
     adapter (`*_PROVIDER=mock` is NOT a containment for production — use maintenance mode).
   - Payments: pause settlements (`admin.maintenance` scope `payouts`), stop capture jobs.
   - Data: snapshot DB, preserve logs, do not delete evidence.
4. **Communicate**: in-app banner (maintenance flag), support scripts, affected users notified
   within legal timelines for breaches (legal review).
5. **Recover**: fix forward; corrections via adjustment/refund entries, never edits.
6. **Review**: postmortem within 5 working days; add tests and edge-case rows.

## Specific playbooks

- **Suspected data breach**: isolate, rotate secrets, audit `kyc_records` access, notify legal,
  prepare user notification, preserve `audit_logs`.
- **Duplicate charges**: identify via `payments.idempotency_key` collisions or gateway report,
  auto-refund duplicates, notify customers, verify webhook dedupe.
- **Payout to wrong account**: freeze settlements, contact gateway for reversal, ledger
  `MANUAL_ADJUSTMENT` with reason and two-person approval.
- **Safety incident at a job**: support calls both parties, pauses job, records `safety.incident`,
  cooperates with authorities, preserves media/chat.
- **Database restore**: use managed PITR; verify with `scripts/check-migrations.mjs` and smoke
  tests; reconcile payments against the gateway for the gap window.
- **Lost admin device**: revoke sessions, rotate MFA, review audit log for that admin.

## Contacts

Maintained outside the repository (ops runbook). Placeholders only here.

## Runbook: the things most likely to go wrong

Each of these assumes you can reach `GET /ready`, which reports the data mode, mocked adapters,
maintenance mode, the minimum app version, the scheduler's state and the number of live streams.

### Payouts have stopped
1. `GET /admin/scheduler` - is `run-settlements` running, and what is `lastError`?
2. `GET /admin/settlements?status=ON_HOLD` - held settlements name their reason.
   `dispute_open` is correct behaviour, not a fault.
3. A payout that failed three times sits at `ON_HOLD`. Fix the cause, then
   `POST /admin/settlements/:id/retry` and `POST /admin/scheduler/run` with
   `{"task":"run-settlements"}`.
4. Never pay someone by hand outside the ledger. If it is truly urgent, record it afterwards as a
   `MANUAL_ADJUSTMENT` batch so the books still balance.

### A customer says they paid and the app disagrees
1. `GET /admin/jobs/:id/ledger` - `netPaise` should be zero; if it is not, stop and escalate.
2. The payment sits at PENDING when no webhook arrived. `reconcile-payments` asks the gateway
   every two minutes and opens a support ticket after thirty.
3. Tell the customer "we are confirming your payment" - never "it failed" - until the gateway has
   actually said so.

### The live stream is dead for everyone
Not an outage. The apps fall back to polling every 60 s. Check the proxy is not buffering
`/events` before changing anything in the API.

### A migration needs the database quiet
`MAINTENANCE_MODE=true`, wait for in-flight requests, run the migration, turn it back off. Reads
keep working throughout, so customers see their bookings rather than an error page.

### Somebody has to be suspended right now
It takes two staff by design. If only one is available, the faster lever is verification:
rejecting a provider's KYC stops them taking new work immediately, and the suspension can follow
with a second approver.
