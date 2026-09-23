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

## Planned (by milestone)
- **M4** `POST /jobs/:id/counter-offer`, `POST /offers/:id/respond`, `POST /bids/:id/accept`,
  `POST /jobs/:id/confirm` (payment authorization)
- **M5** `POST /jobs/:id/assign-technician`, `POST /jobs/:id/status` (EN_ROUTE/ARRIVED),
  `POST /jobs/:id/start` (OTP), `POST /jobs/:id/price-revision`, `POST /price-revisions/:id/respond`,
  `POST /jobs/:id/complete`, `POST /jobs/:id/approve`, chat routes
- **M6** `POST /jobs/:id/material-request`, `POST /material-requests/:id/quote`,
  `POST /material-quotes/:id/select`, `POST /material-orders/:id/deliver|confirm|invoice`
- **M7** `POST /payments/webhook`, `POST /jobs/:id/dispute`, `GET /me/earnings`, refunds, tickets, reviews
- **M8** `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`, KYC review, reports, overrides
