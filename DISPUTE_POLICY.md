# Dispute Policy

> Operational policy for the pilot. Requires legal review before public launch (§32).

## 1. Categories

| Code | Category | Raised by | Default SLA | Payment effect |
| --- | --- | --- | --- | --- |
| LATE_ARRIVAL | Late arrival | customer | 24 h | none unless > 2 h late (visit fee waived) |
| NO_SHOW | No-show | customer / provider | 12 h | release authorization; strike to no-show party |
| INCORRECT_PRICING | Incorrect pricing | either | 48 h | capture held at locked quote |
| POOR_WORKMANSHIP | Poor workmanship | customer | 72 h | DISPUTE_HOLD; rework or partial refund |
| PROPERTY_DAMAGE | Property damage | customer | 72 h (human review mandatory) | DISPUTE_HOLD; protection reserve where enabled |
| INCOMPLETE_WORK | Incomplete work | customer | 48 h | partial capture per completed scope |
| MATERIAL_MISMATCH | Material mismatch | customer / provider | 48 h | vendor payout held |
| PAYMENT_ISSUE | Payment issue | any | 24 h | reconciliation |
| ABUSIVE_BEHAVIOUR | Abusive behaviour | any | 12 h | account review; safety first |
| SUSPECTED_FRAUD | Suspected fraud | any / system | 24 h | all payouts held |

## 2. Lifecycle

```
OPEN → UNDER_REVIEW → AWAITING_PARTY (48 h to respond) → RESOLVED | REJECTED
                    ↘ ESCALATED (senior support / two-person approval)
RESOLVED → REOPENED (once, within 7 days, with new evidence) → UNDER_REVIEW
```

- Raising a dispute on an active job moves `jobs.status → DISPUTED` and `payment_status →
  DISPUTE_HOLD`; settlements for that job are frozen.
- Both parties are notified and may upload evidence (`dispute_evidence`).
- Support reviews the full timeline (status events, media with hashes, chat, offers, OTP log).
- Resolutions: no action · rework by original provider · replacement provider · partial refund ·
  full refund · adjustment credit · strike · suspension · escalate to legal.
- Every resolution records `resolved_by`, reason, financial effect (ledger `MANUAL_ADJUSTMENT`
  or `REFUND`), and an audit log entry. Refunds above a configurable threshold (default ₹5,000)
  need two-person approval.

## 3. Evidence rules

- Media uploaded during REQUEST, PROGRESS, COMPLETION phases is immutable once a dispute opens.
- Missing evidence from the provider (no completion photos) weighs against the provider.
- Missing evidence from the customer does not automatically reject the dispute; support may
  arrange a verification visit in the pilot.
- AI/automated flags are advisory only; property damage and safety disputes require a human.

## 4. Abuse controls

- Repeated refund claims (≥ 3 in 90 days) trigger manual review before any further refund.
- Fake complaints proven by evidence → strike to the complainant; repeat → suspension.
- Provider uploading false evidence → immediate suspension pending review.

## 5. Strikes

| Severity | Examples | Effect |
| --- | --- | --- |
| MINOR | late without notice, missed status update | reliability score −0.25 |
| MAJOR | no-show, informal extra-charge demand, off-platform payment request | −1.0, warning |
| CRITICAL | fraud, abuse, safety violation, false evidence | immediate suspension |

Three MAJOR strikes in 90 days → 14-day suspension. Suspended accounts retain earned balances;
settlement of legitimate completed jobs continues after review.

## 6. Appeals

A resolved dispute may be appealed once within 7 days. Appeals are reviewed by a different
support agent (or admin). Support agent mistakes are corrected via adjustment entries — never by
editing history.
