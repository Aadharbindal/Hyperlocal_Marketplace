# Payment Flow

> Vocabulary: **authorization**, **hold**, **milestone**, **settlement**, **refund**, **dispute
> hold**. The word "escrow" is not used (D-007). The structure must be reviewed by a qualified
> Indian payments/legal professional before public launch.

## 1. Actors and records

| Record | Purpose |
| --- | --- |
| `payments` | one row per customer-facing charge (booking, milestone, material, price revision) |
| `payment_events` | every gateway webhook/callback, keyed by `provider_event_id` (dedupe) |
| `ledger_entries` | append-only, signed amounts, one row per financial component |
| `settlements` | payouts to providers/vendors/contractors |
| `refunds` | full/partial refunds against a payment |

Job status and payment status are independent columns on `jobs`:

```
payment_status: NONE → PENDING → AUTHORIZED → CAPTURED → SETTLED
                                   ↘ FAILED        ↘ REFUNDED / PARTIALLY_REFUNDED / DISPUTE_HOLD
```

## 2. Small job (single milestone)

```
1. Quote locked (booking_quotes.status=ACTIVE)             job: NEGOTIATING → PAYMENT_PENDING
2. POST /jobs/:id/confirm  → payments row CREATED, gateway order created (idempotency key)
3. Customer completes checkout in app (gateway SDK)
4. Signed webhook payment.authorized → payment AUTHORIZED   job: PAYMENT_PENDING → CONFIRMED
5. Start OTP verified → work → completion evidence          job: … → CUSTOMER_APPROVAL_PENDING
6. Customer approves → capture (idempotent)                 job: → COMPLETED, payment CAPTURED
7. Ledger split written in one transaction:
     CUSTOMER_CHARGE      +total
     PROVIDER_PAYABLE     -labour -visit_fee (+ approved revisions)
     VENDOR_PAYABLE       -materials (if via platform)
     PLATFORM_REVENUE     -platform_fee -lead_fee
     PROTECTION_RESERVE   -protection_fee (if enabled)
     GATEWAY_FEE          -gateway_fee
     TAX                  -tax
8. Settlement rows PENDING → INITIATED (T+1 batch) → PAID   job: COMPLETED → SETTLED
```

Auto-approval: if the customer does not respond within 48 h of completion evidence and no
dispute is open, support is notified; capture happens only after support review in the pilot.

## 3. Large job (milestones)

Inspection fee → material milestone → labour milestone → completion approval → final settlement.
Each milestone is its own `payments` row with `purpose`; ledger entries reference the milestone.

## 4. Price revision

Approved revision creates an additional `payments` row (`purpose=PRICE_REVISION`) authorized
before the work continues, or is added to capture amount when the gateway supports partial
capture increases. Never charged without `price_revision_requests.status=APPROVED`.

## 5. Materials

Selected material quote → `material_orders.PENDING_PAYMENT` → payment authorized → vendor
prepares → delivered → confirmed → invoice uploaded → `VENDOR_PAYABLE` settlement. Vendor payout
trigger requires order `CONFIRMED` and invoice present.

## 6. Refunds and cancellations

| Scenario | Treatment |
| --- | --- |
| Customer cancels before confirmation | no charge |
| Customer cancels after confirmation, before EN_ROUTE | full release of authorization |
| Customer cancels after EN_ROUTE | visit fee captured, rest released (policy configurable) |
| Provider cancels | full release; provider strike |
| Material already purchased | material cost handled per `DISPUTE_POLICY.md`; unused material returned to vendor where possible |
| Partial completion | support-mediated partial capture + partial refund with ledger `MANUAL_ADJUSTMENT` |

Refunds are idempotent (`refunds.idempotency_key`) and always write a `REFUND` ledger entry.

## 7. Webhooks

- Verify HMAC signature with `PAYMENT_WEBHOOK_SECRET` before parsing.
- Dedupe by `provider_event_id` (unique). Replays are acknowledged with 200 and ignored.
- Out-of-order events are reconciled against the gateway state (`fetchPayment`).
- Processing is transactional: payment status + job payment_status + ledger in one commit.
- Failed processing returns 500 so the gateway retries; retries are safe due to idempotency.

## 8. Failure handling

| Failure | Handling |
| --- | --- |
| Client reports success, no webhook | status stays PENDING; reconciliation job polls gateway every 2 min for 30 min |
| Bank debited, app shows failure | reconciliation resolves; user message "We are confirming your payment" |
| Duplicate payment | second gateway order blocked by idempotency key; if gateway double-charged, auto-refund |
| Gateway outage | booking held in PAYMENT_PENDING with retry; customer notified |
| Payout failure | settlement FAILED, retried, support alerted after 3 failures |
| Payee has not said where to get paid | the settlement is still written, then parked `ON_HOLD` with `NO_PAYOUT_ACCOUNT` and the payee is asked for their details. Adding them releases it on the next sweep. The debt is never dropped, and the ledger already carries it either way |
| Chargeback | payment → DISPUTE_HOLD, dispute auto-opened, evidence pack exported |

## 8b. Where the money actually goes

A payout rail does not pay a person. RazorpayX pays a `fund_account_id`, created from a Contact
plus bank details or a UPI id. So before anyone can be paid:

1. The payee submits `POST /me/payout-account` once - UPI id, or account number and IFSC.
2. The details are checked against the same rules the gateway uses (`checkPayoutAccount`), then
   handed straight to the payment provider, which creates the contact and fund account.
3. **Only the last four digits are stored.** The full account number never touches our database,
   our logs or any response body; the row keeps `account_last4`, the IFSC or a UPI id, and the
   provider's two ids.
4. The account is marked `VERIFIED`. That means *the account exists and is payable* - it does
   **not** mean the name on it belongs to the payee. A penny-drop or name-match check is a
   separate paid API and is not wired (KNOWN_LIMITATIONS).

Adding a new account replaces the previous one, so there is never a question about where money
went. Both the service and a SQL trigger refuse to move a settlement to INITIATED or PAID without
a verified account - but neither refuses to *record* what is owed. A debt the payee cannot see
would be worse than one that is visibly waiting.

## 9. Mock adapter behaviour

`PAYMENT_PROVIDER=mock`: orders/payments get deterministic ids, `simulate` hooks let tests
trigger authorized/failed/duplicate/late webhooks, signatures are HMAC with the local secret.
The mock never moves real money and logs `[MOCK payment]`.

### Implemented in M4

Booking authorization is live in code (mock gateway): `POST /bids/:id/accept` locks the quote and
creates the payment order, `POST /payments/:id/mock-complete` stands in for the checkout, and
`POST /payments/webhook` is the real code path - signature checked before parsing,
`provider_event_id` deduped, amount mismatch refused, failed authorization releasing the booking
back to `BID_RECEIVED`. Capture, ledger entries, settlements and refunds are still M7.

### Implemented in M7

Capture, the ledger, settlements, refunds and dispute holds are live in code against the mock
gateway. Labour is captured when the customer approves (`POST /jobs/:id/approve`), materials when
the customer confirms the delivery. Every movement writes a balanced `batch_id` set to
`ledger_entries`, which has UPDATE and DELETE revoked - corrections are new `MANUAL_ADJUSTMENT`
entries, never edits. Payouts wait 24 hours after capture, are blocked outright by an open
dispute, and park for a human after three failures. Refunds are capped by what the *ledger* says
was captured, not by what a payment row claims, and are split back across the same lines the
capture created so the books still balance. What is still missing is listed in
`KNOWN_LIMITATIONS.md`: no scheduler, no gateway reconciliation, no chargeback handling.
