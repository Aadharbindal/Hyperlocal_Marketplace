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
