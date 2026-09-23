# API Reference

Base URL: `http://localhost:4000` (local). All responses are JSON.

## Conventions

- **Auth**: `Authorization: Bearer <access_token>`. Multi-role users send `X-Active-Role: PROVIDER`
  (defaults to the first active role).
- **Idempotency**: mutating routes accept `Idempotency-Key: <uuid>`; the same key + same user
  returns the cached first response for 24 h. Required on payment and acceptance routes.
- **Request id**: every response carries `X-Request-Id`.
- **Errors**:
  ```json
  { "error": { "code": "JOB_INVALID_TRANSITION", "message": "This booking can't be started yet.", "details": {}, "requestId": "…" } }
  ```
  HTTP: 400 validation · 401 unauthenticated · 403 forbidden · 404 not found · 409 conflict ·
  422 business rule · 429 rate limited · 500 internal.
- **Rate limits**: default 300 req/min per user; OTP routes stricter (below).
- **Audit**: routes marked *audited* write `audit_logs`.
- **Schemas**: zod in `packages/core/src/contracts/*`; the API validates with them.

## Milestone 1 (implemented)

### Health
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | none | liveness |
| GET | `/ready` | none | data store + adapters status, `mode` and mocked adapter list |

### Auth
| Method | Path | Auth | Body | Response | Limits |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/request-otp` | none | `{ phone: "+919876543210" }` | `{ challengeId, expiresInSeconds, resendAfterSeconds, demoCode? }` (`demoCode` only when SMS mock) | 5/phone/hour, 20/IP/hour |
| POST | `/auth/verify-otp` | none | `{ challengeId, code }` | `{ accessToken, refreshToken, expiresIn, user, isNewUser }` | 5 attempts/challenge |
| POST | `/auth/refresh` | none | `{ refreshToken }` | new token pair (old refresh revoked) | |
| POST | `/auth/logout` | bearer | `{ refreshToken? , all?: boolean }` | `{ ok: true }` | |

Errors: `OTP_RATE_LIMITED`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_LOCKED`, `AUTH_SUSPENDED`,
`AUTH_INVALID_TOKEN`.

### Users & roles
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/me` | bearer | user, roles, profiles summary, consents |
| PATCH | `/me` | bearer | `{ displayName?, preferredLanguage? }` |
| POST | `/me/roles` | bearer | `{ role: CUSTOMER|PROVIDER|VENDOR|CONTRACTOR }` self-service; ADMIN/SUPPORT/TECHNICIAN not self-grantable. *audited* |
| POST | `/me/consents` | bearer | `{ type, version, granted }` *audited* |
| DELETE | `/me` | bearer | schedules deletion (30 d), *audited* |

### Addresses
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/me/addresses` | bearer | |
| POST | `/me/addresses` | bearer | body: `AddressCreate`; geocodes via maps adapter; returns `inPilotZone` |
| PATCH | `/me/addresses/:id` | bearer (owner) | |
| DELETE | `/me/addresses/:id` | bearer (owner) | soft delete |

### Categories
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | none | enabled categories + skills, localized names |

### Admin (foundation)
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/admin/users?q=` | ADMIN, SUPPORT | search by phone/name/id (phone masked for SUPPORT) |
| POST | `/admin/users/:id/suspend` | ADMIN | `{ reason }` required, *audited* |
| POST | `/admin/users/:id/reactivate` | ADMIN | `{ reason }` *audited* |
| GET | `/admin/audit-logs?entityType=&entityId=` | ADMIN | |

## Milestone 2 (implemented)

### Jobs
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs` | CUSTOMER | Creates or resumes the DRAFT for that category+address. Body: `JobCreate`. Validates category is enabled and the address belongs to the caller. *audited* |
| PATCH | `/jobs/:id` | CUSTOMER (owner) | Edits a DRAFT only; 409 once submitted (JOB-04) |
| GET | `/jobs/:id` | owner | Full `JobView`: status, plain-language key, media with signed URLs, status trail, hazards |
| GET | `/me/jobs?scope=active\|past\|all&limit=` | any role | `JobListItem[]` for the signed-in customer |
| POST | `/jobs/:id/media` | CUSTOMER (owner) | Registers a file and returns an upload target. `upload.required` is false in mock storage mode. Enforces kind/mime/size/duration/count limits |
| DELETE | `/jobs/:id/media/:mediaId` | uploader | DRAFT only |
| POST | `/jobs/:id/submit` | CUSTOMER (owner) | DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS in one call, opens the bid window (30 min normal, 10 min urgent), mints the tracking token, notifies the customer. Returns `{ job, duplicateOf }` *audited* |
| POST | `/jobs/:id/cancel` | CUSTOMER (owner) | `{ reason }` required *audited* |
| GET | `/track/:token` | none | Minimal public status for the person at home: status, category, name, provider business name. No address, phone or media |

Errors: `JOB_INVALID_TRANSITION` (422) for an illegal state change; `VALIDATION_ERROR` with
`details.blockers` (submission) or `details.media` (uploads); 403 for a job or address that is
not the caller's.

## Milestone 3 (implemented)

### Provider profile and verification
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/provider/profile` | PROVIDER, CONTRACTOR | Profile, skills, KYC records (last four characters only) and `blockers` explaining why the feed may be empty |
| PUT | `/provider/profile` | PROVIDER, CONTRACTOR | Business name, bio, experience, service radius, base address (must be the caller's), skill ids *audited* |
| POST | `/provider/availability` | PROVIDER, CONTRACTOR | `{ isAvailable }`; refused with `verification_pending` until the provider is VERIFIED *audited* |
| POST | `/provider/kyc` | PROVIDER, CONTRACTOR, TECHNICIAN, VENDOR | Submits one document. Only the last four characters are stored; the number is never persisted or logged. One open submission per document type (409 otherwise) *audited* |

### Feed and offers
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/provider/jobs/nearby?limit=` | PROVIDER, CONTRACTOR | Eligible open jobs, nearest first. Eligibility = verified + available + in radius + category and skill match + reliability + not suspended. Returns `{ items, blockers }`; the exact address is never included, only distance and area |
| POST | `/jobs/:id/bids` | PROVIDER, CONTRACTOR | Places an offer; re-checks eligibility, one live offer per provider per job, bid window and the job status. The first offer moves the job to `BID_RECEIVED` and notifies the customer *audited* |
| POST | `/bids/:id/revise` | offer owner | Up to two revisions (`TOO_MANY_REVISIONS` after that); every price is kept in `bid_revisions` *audited* |
| POST | `/bids/:id/withdraw` | offer owner | `{ reason }` required; frees the provider to bid again *audited* |
| GET | `/provider/bids` | PROVIDER, CONTRACTOR | The provider's own offers with job context |
| GET | `/jobs/:id/offers` | job owner | Ranked offers for the customer: total, breakdown, ETA, warranty, and limited provider identity (business name, verified badge, rating, jobs done, distance). No phone numbers or addresses. Ranking uses skill, distance, ETA, experience, reliability, rating and price - never price alone |

Errors: `FORBIDDEN` with `details.eligibility` (feed rules), `VALIDATION_ERROR` with `details.bid`
(`WINDOW_CLOSED`, `DUPLICATE_ACTIVE_BID`, `TOO_MANY_REVISIONS`, `JOB_FULL`, `ETA_OUT_OF_RANGE`),
`CONFLICT` with `job_not_accepting_offers`.

## Milestone 4 (implemented)

### Negotiation
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs/:id/counter-offer` | job owner | `{ bidId, labourPaise, visitFeePaise?, scopeNotes? }`. Opens or continues a negotiation on one offer, moves the job to `NEGOTIATING`, and supersedes the customer's own pending offer on that bid. Expires after 20 minutes *audited* |
| POST | `/offers/:id/respond` | the side the offer is waiting on | `{ action: ACCEPT / REJECT / COUNTER, labourPaise?, visitFeePaise?, scopeNotes? }`. `ACCEPT` freezes the offered terms onto the bid, `COUNTER` sends one more round (max 6 rounds per job) *audited* |
| GET | `/jobs/:id/offer-chain` | job owner or bidding provider | The full back-and-forth for the job, newest first, each item flagged `awaitingYou` |

### Acceptance, booking and payment
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/bids/:id/accept` | job owner | Single transaction: locks a `booking_quote` at the agreed price, marks every other offer `INACTIVE`, cancels pending counter-offers, creates the `job_assignment` and a `PENDING` payment order, and moves the job `PAYMENT_PENDING -> CONFIRMED -> PROVIDER_ASSIGNED` once authorization lands. Exactly one acceptance can win: a second concurrent call gets 409 *audited* |
| GET | `/jobs/:id/booking` | job owner | The locked quote, the assignment (business, technician, verified badge) and the payment list. Never exposes the provider's phone number or documents |
| POST | `/payments/:id/mock-complete` | payment owner | **Mock mode only** (`PAYMENT_PROVIDER=mock`). `{ outcome: authorized / failed }`, used by the app and tests to stand in for the gateway checkout |
| POST | `/payments/webhook` | signature | Gateway callback. The HMAC signature is verified **before** the body is parsed; `provider_event_id` makes replays a no-op; an amount mismatch is refused and recorded. A failed authorization releases the booking back to `BID_RECEIVED` so other offers become live again |

Money is only ever *authorized* at this point - nothing is captured until the customer approves the
finished work (see `PAYMENT_FLOW.md`).

Errors: `VALIDATION_ERROR` with `details.negotiation` (`OFFER_EXPIRED`, `OFFER_NOT_PENDING`,
`ROUND_LIMIT_REACHED`, `JOB_NOT_NEGOTIABLE`, `BID_NOT_ACTIVE`) or `details.acceptance`
(`BID_NOT_ACTIVE`, `BID_EXPIRED`, `JOB_NOT_ACCEPTABLE`), `CONFLICT` with `ALREADY_CONFIRMED`,
401 `INVALID_SIGNATURE` on the webhook, 404 when the offer or payment is not the caller's.

## Milestone 5 (implemented)

### Execution
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs/:id/technician` | booked provider | `{ technicianId }`. The technician must be VERIFIED and belong to this provider, mirroring `assignment_requires_verified_technician` *audited* |
| POST | `/jobs/:id/progress` | provider side | `{ to: EN_ROUTE / ARRIVED, etaMinutes? }`. Moving to EN_ROUTE is what tells the customer their start code matters *audited* |
| POST | `/jobs/:id/start` | provider side, or ADMIN/SUPPORT with `override` | `{ code }` verifies the 4-digit start code in constant time and walks the job `ARRIVED -> STARTED -> IN_PROGRESS`. Five wrong attempts lock the code. `{ override: true, reason }` starts without it - admin only, reason of 10+ characters, recorded on the job forever *audited* |
| GET | `/jobs/:id/execution` | any party on the job | The live panel: start code (**customer only**, and only until it is used), attempts left, technician with a *masked* number, the open price revision, every past revision, the completion and the unread chat count |
| POST | `/jobs/:id/evidence` | provider side | Creates a media row and upload target. The phase is derived from the job's status (PROGRESS / PRICE_REVISION / COMPLETION) and can never be chosen by the caller |

### Price revision
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs/:id/price-revision` | provider side | `{ reason, extraLabourPaise, extraMaterialPaise, extraTimeMinutes, explanation, mediaIds }`. Needs a real explanation (20+ chars) and at least one photo. Moves the job to `PRICE_REVISION_PENDING`; max 3 per job, one open at a time *audited* |
| POST | `/price-revisions/:id/respond` | job owner | `{ action: APPROVE / REJECT / CLARIFY, message? }`. APPROVE supersedes the locked quote with a new ACTIVE one and opens a **separate** `PRICE_REVISION` payment for the difference - the original hold is never silently increased. REJECT keeps the original quote exactly as it was. Either way the job returns to `IN_PROGRESS` *audited* |

### Completion
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs/:id/complete` | provider side | `{ summary, mediaIds, warrantyNote? }`. At least one photo and a 10+ character summary; refused while a revision is still open. Walks `IN_PROGRESS -> COMPLETION_PENDING -> CUSTOMER_APPROVAL_PENDING` *audited* |
| POST | `/jobs/:id/approve` | job owner | `{ approved, reason?, rating? }`. Approving moves the job to `COMPLETED` and closes the chat; rejecting sends it back to `IN_PROGRESS` with the reason attached. **Nothing is captured here** - settlement is M7 *audited* |

### Chat
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/jobs/:id/chat` | any party on the job | The thread, oldest first, and marks the caller's unread messages read |
| POST | `/jobs/:id/chat` | any party on the job | `{ body }`. Open only while the job is live; messages containing a phone number, email or UPI handle are stored `flagged` for review rather than blocked |

Errors: `VALIDATION_ERROR` with `details.execution` - `JOB_NOT_ARRIVED`, `WRONG_CODE` (with
`details.attemptsLeft`), `TOO_MANY_ATTEMPTS`, `CODE_EXPIRED`, `CODE_ALREADY_USED`,
`OVERRIDE_NOT_ALLOWED`, `OVERRIDE_NEEDS_REASON`, `NOT_A_TECHNICIAN`, `TECHNICIAN_NOT_VERIFIED`,
`TECHNICIAN_NOT_YOURS`, `JOB_NOT_IN_PROGRESS`, `REVISION_ALREADY_OPEN`, `REVISION_LIMIT_REACHED`,
`NOTHING_EXTRA`, `EXPLANATION_TOO_SHORT`, `EVIDENCE_REQUIRED`, `PHOTOS_REQUIRED`,
`SUMMARY_TOO_SHORT`, `NOT_AWAITING_APPROVAL`, `CHAT_CLOSED`; 403 for anyone not on the job.

## Milestone 6 (implemented)

### Materials - provider side
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs/:id/material-request` | provider side | `{ items[], neededByMinutes?, note? }`. Only from ARRIVED/STARTED/IN_PROGRESS, never by the customer, never when the booking says the customer supplies materials. One open request per job, max 3 per job, 15 items. Vendors have 45 minutes to answer *audited* |
| GET | `/jobs/:id/materials` | any party on the job | The whole material leg: the request, the ranked quotes, the live order and the history |

### Materials - vendor side
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/vendor/profile` | VENDOR | Shop name, verification, delivery radius and whether deliveries are on |
| POST | `/vendor/availability` | VENDOR | `{ deliveryAvailable }`. MAT-10: a closed shop stops receiving requests. Refused with `verification_pending` until the shop is verified *audited* |
| GET | `/vendor/material-requests?limit=` | VENDOR | Open requests inside the delivery radius. Returns `{ items, blockers }`; the item list and the **area** only - never the customer's address |
| POST | `/material-requests/:id/quote` | verified VENDOR | `{ items[], deliveryPaise, etaMinutes, note? }`. The quote must answer the whole list so quotes are comparable; each line carries a brand and a stock flag, and an out-of-stock line is never charged for. One live quote per vendor per request, valid 120 minutes *audited* |
| GET | `/vendor/material-orders?limit=` | VENDOR | The vendor's own orders with their payment status |

### Selection, delivery and invoice
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/material-quotes/:id/select` | job owner | One transaction: freezes the quote, rejects the others, creates the order and opens a **separate `MATERIAL` authorization**. The labour hold is never touched. The vendor is asked to prepare only once that authorization lands *audited* |
| POST | `/material-orders/:id/status` | order's vendor, or ADMIN | `{ to: OUT_FOR_DELIVERY / DELIVERED / CANCELLED, reason? }`, checked against the order state machine - nothing ships before the money is authorized *audited* |
| POST | `/material-orders/:id/confirm` | customer or provider side | `{ ok, issue?, note?, mediaIds? }`. `ok` confirms receipt; anything else parks the order at `ON_HOLD` with the reason (MAT-02/03/12) so the vendor is not paid while it is disputed *audited* |
| POST | `/material-orders/:id/invoice` | order's vendor | `{ mediaId, amountPaise, invoiceNumber? }`. Only against a CONFIRMED order, only once, and the amount must equal the order total to the paisa (MAT-07) *audited* |

Materials are always a separate leg of money from labour, and the platform takes no margin on
them in the pilot: what the customer authorizes is what the vendor is owed (DECISIONS D-013).

Errors: `VALIDATION_ERROR` with `details.materials` - `JOB_NOT_ON_SITE`,
`CUSTOMER_SUPPLIES_MATERIAL`, `REQUEST_ALREADY_OPEN`, `REQUEST_LIMIT_REACHED`, `NO_ITEMS`,
`TOO_MANY_ITEMS`, `VENDOR_NOT_VERIFIED`, `VENDOR_UNAVAILABLE`, `WINDOW_CLOSED`, `ALREADY_QUOTED`,
`ITEM_COUNT_MISMATCH`, `NOTHING_IN_STOCK`, `QUOTE_EXPIRED`, `QUOTE_NOT_ACTIVE`, `ALREADY_ORDERED`,
`INVALID_ORDER_TRANSITION`, `ORDER_NOT_DELIVERED`, `ORDER_NOT_CONFIRMED`, `AMOUNT_MISMATCH`
(with `details.orderTotalPaise`), `INVOICE_ALREADY_FILED`; 403 for anyone not on the job or not
the order's vendor.

## Milestone 7 (implemented)

### Money on a job
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/jobs/:id/money` | any party on the job | What is held, what was captured, what was refunded and the material leg, read from the server's own records |
| GET | `/jobs/:id/cancellation-quote` | job owner | What cancelling *right now* would cost, and why, before the customer commits to it |
| POST | `/jobs/:id/cancel` | job owner | Now a money decision: the policy charge is captured, the rest of the authorization is **released** (not refunded - the money never left), and both are recorded. Refused with `CANCELLATION_NEEDS_SUPPORT` once work has started *audited* |
| POST | `/jobs/:id/cancel-as-provider` | assigned provider side | Always free for the customer, always a MAJOR strike for the provider *audited* |

Capture is not an endpoint. Labour money is taken by the server at `POST /jobs/:id/approve`
(M5) and material money at `POST /material-orders/:id/confirm` (M6) - the client can never ask
for a capture, and the amount always comes from the locked quote.

### Earnings, disputes and reviews
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/me/earnings` | PROVIDER, VENDOR | Paid, clearing and on-hold balances, every settlement and the caller's own ledger lines |
| POST | `/jobs/:id/dispute` | any party on the job | `{ category, description, mediaIds? }`. Freezes the money: the payment goes to `DISPUTE_HOLD`, pending settlements go `ON_HOLD`, and a live job moves to `DISPUTED`. One open dispute per job; 20+ character description required *audited* |
| GET | `/jobs/:id/disputes` | any party on the job | The job's disputes, flagged `raisedByMe` / `againstMe`, with the SLA deadline |
| POST | `/disputes/:id/evidence` | any party on the job | `{ mediaIds, note? }`; moves an OPEN dispute to UNDER_REVIEW |
| POST | `/jobs/:id/review` | any party on a finished job | `{ rating 1-5, comment? }`. One per person per job, within 30 days; updates the provider's running average |
| GET | `/providers/:id/reviews` | public | Ratings and comments with a **first name only** |

### Support and admin
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/admin/disputes` | ADMIN, SUPPORT | The open queue, soonest SLA first |
| POST | `/admin/disputes/:id/resolve` | ADMIN, SUPPORT | `{ resolution, reason, refundPaise?, strike?, secondApproverId? }`. Writes the refund, releases or keeps the hold, optionally strikes a party, and moves the job where the decision leaves it. A refund over Rs 5,000 is refused without a **different** second approver *audited* |
| POST | `/admin/settlements/run?limit=` | ADMIN, SUPPORT | Sends what is due. Every guard re-runs per settlement, so it is safe to call repeatedly; three payout failures park a settlement for a human *audited* |
| GET | `/admin/settlements?status=` | ADMIN, SUPPORT | The payout queue |
| POST | `/admin/jobs/:id/refund` | ADMIN, SUPPORT | A refund outside a dispute; needs a reason and can never exceed what was captured *audited* |
| GET | `/admin/jobs/:id/ledger` | ADMIN, SUPPORT | Every entry on the job plus `netPaise`, which is what the platform still holds for it |
| POST | `/support/tickets` | any signed-in user | Opens a ticket |
| GET | `/support/tickets` | own tickets, or all for ADMIN/SUPPORT | |

Errors: `VALIDATION_ERROR` with `details.finance` - `JOB_NOT_COMPLETED`, `NOTHING_AUTHORIZED`,
`ALREADY_CAPTURED`, `DISPUTE_OPEN`, `CANCELLATION_NEEDS_SUPPORT`, `NOTHING_CAPTURED`,
`REFUND_EXCEEDS_CAPTURE` (with `details.capturedPaise` and `details.alreadyRefundedPaise`),
`NOT_ON_JOB`, `ALREADY_OPEN`, `REASON_TOO_SHORT`, `WINDOW_CLOSED`, `JOB_TOO_EARLY`,
`DISPUTE_CLOSED`, `SECOND_APPROVER_REQUIRED`, `SECOND_APPROVER_MUST_DIFFER`,
`ALREADY_REVIEWED`, `JOB_NOT_COMPLETE`; `CONFLICT` with `ledger_batch_unbalanced` if a money
batch would ever fail to sum to zero; 403 for anyone not on the job and for non-support callers
on `/admin/*`.

## Planned (by milestone)
- **M8** `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`, KYC review, reports, overrides
