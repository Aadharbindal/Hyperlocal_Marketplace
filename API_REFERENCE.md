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
| GET | `/me/earnings` | PROVIDER, VENDOR | Paid, clearing and on-hold balances, the payout account money is going to, what is waiting for one, every settlement and the caller's own ledger lines |
| GET | `/me/payout-account` | any signed-in user | The masked account money is sent to, or `null`. Never returns an account number |
| POST | `/me/payout-account` | PROVIDER, VENDOR | `{ method: 'UPI', accountHolderName, vpa }` or `{ method: 'BANK_ACCOUNT', accountHolderName, accountNumber, ifsc }`. Registered with the payout provider first; only the last four digits are stored. Replaces any existing account and releases settlements parked for want of one *audited* |
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

## Milestone 8 (implemented)

### Console sign-in (second factor)
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/admin/mfa/setup` | ADMIN, SUPPORT | Starts enrolment. The TOTP secret is returned **exactly once**, here; afterwards only its encrypted form exists *audited* |
| POST | `/admin/mfa/enable` | ADMIN, SUPPORT | `{ code }` proves the authenticator works before the factor is switched on *audited* |
| POST | `/admin/mfa/verify` | ADMIN, SUPPORT | `{ code }` marks **this session** as satisfied for 8 hours. A code can never be replayed, and five wrong ones lock the factor for 15 minutes |
| GET | `/admin/mfa` | ADMIN, SUPPORT | Whether the account is enrolled, whether this session is verified, and whether the factor is required at all |

Every other console route below is refused unless the caller is staff **and** their session
satisfied the factor within the last 8 hours. `ADMIN_MFA_REQUIRED` gates the requirement; the API
refuses to boot in production with it off, and `/ready` reports it.

### Verification queue
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/admin/kyc?limit=` | staff + MFA | Submissions nobody has decided, **longest wait first**. Carries the document *type* and its last four characters only - never the number, never the file |
| POST | `/admin/kyc/:id/open` | staff + MFA | Issues a 5-minute signed link to the document and writes a `kyc_access_log` row naming the reviewer. Opening a document is a separate, recorded act *audited* |
| POST | `/admin/kyc/:id/review` | staff + MFA | `{ decision: APPROVE / REJECT / NEEDS_MORE, reason? }`. Anything but an approval needs a usable reason. Approving flips the provider, technician or vendor profile to VERIFIED, which is what actually lets someone work. Nobody may review their own submission *audited* |

### People
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/admin/users/:id` | staff + MFA | One person: roles, verification, reliability, strikes and what they are still owed. Support sees a masked number, an admin sees the whole one *audited* |
| POST | `/admin/users/:id/suspend-approved` | staff + MFA | `{ reason (20+ chars), secondApproverId, untilIso? }`. **Two different staff** are required, the approver must be staff, nobody may suspend themselves, and every session of theirs is revoked. What they have already earned stays theirs *audited* |

### Dispute queue and appeals
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/admin/disputes/:id/move` | staff + MFA | `{ to: UNDER_REVIEW / AWAITING_PARTY / ESCALATED, note? }`; assigns it to the caller *audited* |
| POST | `/disputes/:id/appeal` | either party | `{ reason (20+ chars) }`. One appeal per dispute, within 7 days of the decision; reopens it and clears the assignee so a different person picks it up *audited* |

### Payouts and reports
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/admin/settlements/:id/retry` | staff + MFA | Puts a failed or held payout back in the queue. Refused while a dispute is open, or once it is already paid *audited* |
| GET | `/admin/reports/overview` | staff + MFA | Jobs by status, charged, refunded, platform fee, payouts owed and paid, open disputes, disputes past SLA, KYC waiting |

Errors: `VALIDATION_ERROR` with `details.admin` - `MFA_ALREADY_ENROLLED`, `MFA_NOT_STARTED`,
`MFA_NOT_ENROLLED`, `MFA_LOCKED` (with `details.until`), `WRONG_CODE` (with
`details.attemptsLeft`), `CODE_REUSED`, `CANNOT_REVIEW_OWN`, `ALREADY_DECIDED`,
`REASON_REQUIRED`, `CANNOT_SUSPEND_SELF`, `SECOND_APPROVER_REQUIRED`,
`SECOND_APPROVER_MUST_DIFFER`, `SECOND_APPROVER_NOT_STAFF`, `NOT_ON_DISPUTE`, `NOT_RESOLVED`,
`ALREADY_REOPENED`, `APPEAL_WINDOW_CLOSED`, `ALREADY_PAID`, `DISPUTE_OPEN`; 403 with
`details.reason` of `mfa_enrolment_required` or `mfa_verification_required` when the second
factor is missing or stale, and for any non-staff caller.

## Milestone 9 (implemented)

### Live updates
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/events` | any signed-in user | A Server-Sent Events stream. Each event carries **only** what changed (`kind`, `jobId`, `at`); the client re-reads the endpoint it already trusts, so a delayed, duplicated or missed event can never put a wrong number on screen. Because `EventSource` cannot set headers, this one route also accepts the short-lived access token as `?access_token=` (never the refresh token), and the URL is redacted in logs |
| POST | `/events` | - | Always 403. Events are published by the server; a client can never inject one |

### Background work
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/admin/scheduler` | ADMIN, SUPPORT | Every task with its interval, last run, duration and last error, plus the live-stream count |
| POST | `/admin/scheduler/run` | staff + MFA | `{ task? }` runs one task, or everything that is due. Each task is idempotent, so this is safe to call during an incident *audited* |

### Operational gates (every route)
| Behaviour | Notes |
| --- | --- |
| `426 UPGRADE_REQUIRED` | An `x-app-version` below `MIN_APP_VERSION`, with the minimum in `details`. A caller with no version header is never blocked |
| `503 MAINTENANCE` | While `MAINTENANCE_MODE` is on, every state-changing request waits and reads keep working |
| `GET /ready` | Now also reports `maintenanceMode`, `minAppVersion`, `adminMfaRequired`, the scheduler's state and the number of live streams |

## Reaching people (post-M9)

### Devices and notifications
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/me/devices` | any signed-in user | `{ token, platform, deviceLabel?, appVersion? }`. Sent on **every launch**, because the OS rotates push tokens. A token already on another account moves to this one, so a handset that changed hands stops notifying its previous owner |
| GET | `/me/devices` | any signed-in user | The person's registered devices. The token itself is never returned; `x-device-token` marks which row is the phone asking |
| DELETE | `/me/devices/:id` | owner | Stops notifications to that device. The row is kept, so a device that returns is recognised rather than duplicated |
| GET | `/me/notifications` | any signed-in user | The list plus `unread` for the badge, each item carrying its `category` |
| POST | `/me/notifications/read` | any signed-in user | `{ ids? }`; omit `ids` to clear everything. Marking nothing is a success, not an error |
| GET | `/me/notification-settings` | any signed-in user | The three switches, plus `alwaysOn` naming the categories that deliberately have none |
| PATCH | `/me/notification-settings` | any signed-in user | `{ jobUpdates?, offers?, marketing? }`. **Money and account alerts have no switch** - finding out a payout failed by noticing the money never arrived is worse than an alert *audited* |

Every in-app notification is also a push, if the person has a device registered and has not turned
that category off. A push preview carries what happened, never what it is about: a body
containing an amount, an address or a phone number is replaced with "Open the app to see the
details", because a lock screen is read by whoever is holding the phone.

### Calling and rescheduling
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/jobs/:id/call` | any party on the job | `{ urgent? }`. Returns a number to dial that reaches the other person through the telephony provider. **Neither real number is ever in the response.** Ten calls per job per day; calling hours (07:00-22:00) apply only to a booking scheduled for later, never to a job already under way or in dispute. The call is logged - who, whom, when, how long - but never recorded |
| POST | `/jobs/:id/reschedule` | CUSTOMER, SUPPORT | `{ newStart, newEnd?, reason? }`. Two moves per booking, none once somebody may be travelling (2 h notice on a booked slot), nothing in the past or more than 30 days out. The provider who blocked the slot is notified. Refusals carry a plain-English `message` alongside the code *audited* |

## Receipts and growth (post-M9)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/jobs/:id/invoice` | customer | The bill for one booking, issued automatically when the money is captured. Every figure is snapshotted at issue: a later correction is a credit note, never an edit |
| GET | `/me/invoices` | customer | Every receipt this customer holds |
| GET | `/me/favourites` | customer | Saved professionals, each with whether they can actually be asked right now and the job worth repeating |
| POST | `/providers/:id/favourite` | customer | `{ note? }`. The note is a reminder to self and is **never shown to the provider** |
| DELETE | `/providers/:id/favourite` | customer | |
| POST | `/jobs/:id/rebook` | customer | `{ preferProviderId?, description?, preferredStart? }`. Opens a new job from an old one. `preferProviderId` is a **preference, not an assignment**: the job still goes out for bids and the preferred professional is simply told first *audited* |
| GET | `/promo/preview?code=&orderPaise=` | customer | What a code would take off, before committing. Re-checked at acceptance, because the answer can change between looking and booking |
| GET | `/me/referrals` | any signed-in user | The caller's own code, the terms in one sentence, and who has joined - first names only |
| POST | `/me/referrals/claim` | any signed-in user | `{ code }`. Only before a first completed booking: a code from somebody who already books here is a discount, not a referral |
| GET/POST | `/admin/promos` | ADMIN, SUPPORT | Creating a code. A percentage code without `maxDiscountPaise` is refused - an uncapped percentage is an unbounded liability *audited* |
| POST | `/admin/promos/:id/deactivate` | ADMIN, SUPPORT | Stops the code. Bookings already made keep the discount they were given *audited* |

`POST /bids/:id/accept` takes a strict body which may carry `{ promoCode }`. **A discount comes
off what the customer pays and nothing else** - the provider's payable is untouched, whatever
marketing was running.

`GET /provider/jobs/nearby` accepts `categoryIds`, `maxDistanceKm`, `priorities`, `requestTypes`,
`maxBids`, `hideMyBids`, `withMediaOnly` and `sort` (comma-separated lists, since they arrive in a
URL). It returns `facets` built from what is in that provider's feed today, and an `emptyReason`
when filters left nothing - "there is work nearby, but none within 3 km" is a different message
from "there is no work". **A filter can only narrow what the server already decided the provider
is eligible for.**

## Contractors and their crews (post-M9)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET/PUT | `/contractor/profile` | CONTRACTOR | Business name, radius, and how much of the crew is verified. `verificationStatus` is never something the applicant sets |
| GET | `/contractor/technicians` | CONTRACTOR | Their own crew, with full phone numbers - these are people they employ |
| POST | `/contractor/technicians` | CONTRACTOR | `{ phone, fullName, skills? }`. The person **must already have an account on that number**; a contractor cannot conjure one. Adding them is what grants the TECHNICIAN role, the grant records who did it, and they are notified *audited* |
| DELETE | `/contractor/technicians/:id` | CONTRACTOR | Deactivates. The profile is kept, so their history stays theirs *audited* |
| POST | `/contractor/technicians/:id/kyc` | CONTRACTOR | Submits documents to the same review queue as any other applicant. **Staff decide, never the contractor** - otherwise "verified" means "their employer says so" *audited* |
| GET | `/contractor/jobs` | CONTRACTOR | Live jobs and who is on each, flagging the ones with `needsTechnician` |

`TECHNICIAN` is deliberately absent from `SELF_SERVICE_ROLES`: nobody becomes a technician by
declaring it.

## Warranty, trust and search (post-M9)

### Warranty claims
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/jobs/:id/warranty` | customer | What cover this job carries, how long is left, and whether a claim can be raised right now - the app never works this out itself |
| POST | `/jobs/:id/warranty-claim` | customer | `{ description (20+ chars), mediaIds? }`. **Deliberately not a dispute**: a claim is "the work was fine and it has come back", and filing it as a dispute would hang a strike-shaped cloud over somebody who has done nothing wrong *audited* |
| GET | `/me/warranty-claims` | any signed-in user | A professional sees claims against their work; everybody else sees their own |
| POST | `/warranty-claims/:id/respond` | the professional | `{ response: ACCEPT\|DECLINE, reason?, proposedStart? }`. Declining is allowed - not everything that breaks later is the same fault - but never without an explanation *audited* |
| POST | `/warranty-claims/:id/revisit` | either party | Books the return visit. **It carries no money in either direction**: the professional already agreed to it when they offered the warranty *audited* |
| POST | `/warranty-claims/:id/resolve` | customer | `{ note }` *audited* |

A claim the professional leaves unanswered for 48 hours is escalated to support by the
`escalate-warranty` task. Silence must not be a way to run down somebody's warranty clock.

### Choosing a professional, and finding one
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/providers/:id` | any signed-in user | The profile a customer sees before booking: verification, ratings with a breakdown, jobs done, skills, bio, reviews. **Never a phone number, an address, a document or an exact location** - only a rounded "about 3 km away" |
| GET | `/search?q=&limit=` | any signed-in user | Matches the words people actually type - "geyser", "नल", "short circuit" - against categories and skills in both languages, and says what each hit `matchedOn`. With no `q` it returns suggestions rather than nothing, because a blank panel reads as broken |

### Trust and the law
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/me/export` | any signed-in user | The DPDP Act right of access. Returns the person's own data, names every section included, and names **what was left out and why** - identity documents, other people's messages, and internal fraud signals *audited* |
| GET | `/admin/flagged-messages` | ADMIN, SUPPORT | Messages the contact filter caught, oldest first, flagged `overdue` past 24 h. These have been flagged since M5 and nobody could read them |
| POST | `/admin/flagged-messages/:id/review` | ADMIN, SUPPORT | `{ outcome: ALLOWED\|WARNED\|STRIKE\|SUSPENDED, reason? }`. `ALLOWED` carries no consequence and needs no reason - most flags are somebody sharing a number so a delivery is let through the gate *audited* |
| POST | `/admin/mfa/recovery-codes` | ADMIN, SUPPORT | Ten codes, **shown once**, stored hashed. A new set invalidates the old outright *audited* |
| GET | `/admin/mfa/recovery-codes` | ADMIN, SUPPORT | How many are left. Never the codes |
| POST | `/admin/mfa/recover` | ADMIN, SUPPORT | `{ code }`. Burnt on use whatever happens next *audited* |

## Where each admin route is reachable from

Eleven route groups existed and three had screens; the rest meant running curl against
production, which is slow and is how a wrong id ends up in a destructive call.

| Screen | Covers |
| --- | --- |
| Disputes (`queue`) | `/admin/disputes`, resolution, strikes |
| Verify | `/admin/kyc` |
| Money | `/admin/jobs/:id/ledger`, refunds |
| **Chat** | `/admin/flagged-messages` and its review |
| **Console → Overview** | `/admin/reports/overview` |
| **Console → People** | `/admin/users`, `/admin/audit-logs` |
| **Console → Payouts** | `/admin/settlements`, retry |
| **Console → Promos** | `/admin/promos`, deactivate |
| **Console → Background** | `/admin/scheduler`, run one task |
| **Console → Security** | `/admin/mfa/recovery-codes` |

Suspension is deliberately **not** a button in the console: it needs a second approver's id, and
doing it properly means the dispute or verification screen where that person is already involved.

## Planned (by milestone)
_Nothing is left planned: all nine milestones are implemented. What is still missing is listed in `KNOWN_LIMITATIONS.md`._
