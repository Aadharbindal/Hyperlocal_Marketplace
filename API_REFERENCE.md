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

## Planned (by milestone)
- **M6** `POST /jobs/:id/material-request`, `POST /material-requests/:id/quote`,
  `POST /material-quotes/:id/select`, `POST /material-orders/:id/deliver|confirm|invoice`
- **M7** `POST /jobs/:id/dispute`, `GET /me/earnings`, refunds, tickets, reviews
- **M8** `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`, KYC review, reports, overrides
