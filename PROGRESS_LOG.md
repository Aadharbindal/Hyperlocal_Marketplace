# Progress Log

Newest first. Every milestone ends with this report (PRODUCT_SPEC section 30).

---

## Milestone 6: Materials and vendors

**Milestone:** M6 - The material leg: requests, vendor quotes, selection, delivery, invoice
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core` material rules: `checkMaterialRequest` (only from a job someone is on, never
  from the customer, never when the customer said they would supply the material, one open
  request and max 3 per job), `checkMaterialQuote` (verified and available vendor, whole list
  answered, window open, one quote each), `materialSubtotal` / `materialTotals` (out-of-stock
  lines are never charged for; `vendorPayable = total`), `checkCanSelect`, the material order
  state machine with actor restrictions, `checkInvoice` and `materialQuoteScore`.
- `supabase/migrations/0006_materials.sql`: `material_requests` (one open per job, 1-15 items,
  a trigger that refuses a request raised by the customer or on a job with no active assignment),
  `material_quotes` (one live quote per vendor per list, totals must add up, a trigger that
  refuses an unverified vendor), `material_orders` (bought once, an on-hold order must name the
  issue, and a trigger that refuses an invoice unless the order is CONFIRMED and the amount
  matches to the paisa).
- `apps/api` materials module: the provider's request, the vendor feed (area and distance only,
  never the address), quoting, the customer's ranked quote list, selection in one transaction,
  fulfilment, delivery confirmation with a mismatch path, and the invoice. Plus
  `GET /vendor/profile` and `POST /vendor/availability` so a closed shop stops receiving requests
  (MAT-10).
- Selection creates a **separate `MATERIAL` authorization**; the labour hold is untouched and the
  vendor is only asked to prepare once that authorization lands. The booking webhook now hands a
  non-booking leg back to its owner through `onSideLegSettled` instead of moving the job.
- `apps/mobile`: a new vendor area (`Requests`, `Orders`, `Shop` tabs) with a per-line price sheet
  that has an in-stock switch and shows the customer total live; the customer's material panel
  with the ranked quotes, the transparent line-by-line split, authorization and the
  received / something's-wrong buttons; and a "Need materials" form on the provider's job runner.

**Changed files:** `packages/core/src/{materials/materials.ts,materials/materials.test.ts,contracts/materials.ts,index.ts}`,
`supabase/migrations/0006_materials.sql`,
`apps/api/src/{modules/materials/{service,routes}.ts,modules/negotiation/service.ts,data/types.ts,data/memory/{index,materials}.ts,data/postgres/{index,materials}.ts,app.ts,test/materials.test.ts}`,
`apps/mobile/src/{api/materials.ts,features/customer/MaterialPanel.tsx,features/provider/MaterialRequestForm.tsx,features/provider/JobRunner.tsx}`,
`apps/mobile/app/(vendor)/{_layout,requests,orders,shop}.tsx`, `apps/mobile/app/_layout.tsx`,
`apps/mobile/app/(customer)/job/[id].tsx`, `apps/mobile/src/i18n/index.ts`, docs.

**Database changes:** migration `0006_materials`. `migrate:check` passes with 6 migrations.
Forward-only: nothing in 0001-0005 was touched.

**API changes:** `POST /jobs/:id/material-request`, `GET /jobs/:id/materials`,
`GET /vendor/profile`, `POST /vendor/availability`, `GET /vendor/material-requests`,
`POST /material-requests/:id/quote`, `GET /vendor/material-orders`,
`POST /material-quotes/:id/select`, `POST /material-orders/:id/status`,
`POST /material-orders/:id/confirm`, `POST /material-orders/:id/invoice`. Documented in
`API_REFERENCE.md`.

**Tests added / passed:** 16 new API integration tests (`materials.test.ts`) and 14 new core unit
tests. Totals: **117/117 API**, **89/89 core**. Type check clean in 3/3 workspaces, lint 0 errors,
API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the suite runs the whole leg against a job that is genuinely
under way - submitted, quoted, accepted, authorized, started with the code - then a request for
two items, a vendor quote of Rs 390 plus Rs 40 delivery, a second dearer quote, selection,
authorization, out for delivery, delivered, confirmed and invoiced. The claims that matter are
asserted rather than assumed: the vendor feed contains the area but not the street address, the
labour quote total is re-read after selection and is unchanged, the order sits at PENDING_PAYMENT
until the material authorization lands and only then becomes PREPARING, the job itself stays
IN_PROGRESS throughout, a second selection is refused, an expired quote is refused, a partial or
duplicate quote is refused, an unverified vendor is refused and told why, a reported mismatch
parks the order at ON_HOLD where it cannot be invoiced, and an invoice that is Rs 1 off is refused
with the order total in the error.

**Known limitations:** the vendor app has no invoice upload screen yet, so the endpoint is
exercised by tests rather than by a person. A held order can only be released by an admin and
there is no admin screen until M8. Substitution (MAT-05) is not built: a vendor quotes the list as
given. Photos everywhere are still fixed metadata rather than camera captures because mock storage
has nowhere to put bytes. Vendor payouts are M7 - a confirmed order with a matching invoice is the
evidence a payout will need, but nothing is settled yet. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** the vendor feed exposes the item list, the area and a distance, and
nothing else - no address, no phone, no customer name, and a test greps the payload to prove it.
Only a verified vendor may quote, in SQL as well as in code. Selection re-reads the quote inside
the transaction and the partial unique index makes a double order impossible; the same transaction
rejects every other quote so a stale price cannot be revived. Material money never touches the
labour hold, and the vendor is asked to spend money on stock only after the authorization exists.
Delivery confirmation is a record, so a mismatch parks the order rather than accepting it, and an
invoice must match the order exactly - the payout evidence cannot be inflated after the fact. The
new decision D-013 records that the platform takes no margin on materials, so the price the
customer sees is the shop's price.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M7 - Payments, settlement and disputes: capture on approval, the append-only
ledger, provider and vendor settlements, refunds and cancellation charges, the dispute flow and
reviews.

---

## Milestone 5: Execution and completion

**Milestone:** M5 - Doorstep to done: arrival, the start code, price revisions, completion
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core` execution rules: `checkCanStart` (ARRIVED only, spent/expired/locked codes),
  `checkCanOverrideStart` (admin or support, reason of 10+ characters), `checkRevisionRequest`
  (one open at a time, max 3 per job, explanation and evidence required), `revisionNeedsSupport`
  (a jump past 1.5x the locked total is routed to support, not a one-tap approval),
  `checkCompletion`, `mediaPhaseFor` and `flagChatMessage`.
- `supabase/migrations/0005_execution.sql`: `start_otps` (one per job, attempt-capped, an override
  must carry a reason), `price_revision_requests` (one open per job, must add something and must
  cost more than the locked quote, plus a trigger that refuses a revision raised by the customer or
  answered by anyone but the customer), `job_completions` (evidence required), `chat_threads` and
  `chat_messages` (participants-only trigger, DELETE revoked, an immutability trigger so only the
  read receipt can ever change).
- `apps/api` execution module: technician handoff (verified, and only the provider's own people),
  EN_ROUTE/ARRIVED, start-code verification in constant time with the attempt counter, the admin
  override, price-revision request and response, completion and customer approval, the shared
  execution panel, phase-derived evidence upload, and in-job chat.
- The start code is never stored in plaintext: only its HMAC is kept, and the four digits are
  re-derived from the server secret plus the row's id, so the customer's app can show it again
  while a database dump alone yields nothing.
- Approving a revision supersedes the locked quote inside one transaction and opens a **separate**
  `PRICE_REVISION` authorization for the difference. The original hold is never silently increased,
  and a rejection leaves the original quote byte-for-byte unchanged.
- `apps/mobile`: the customer's live panel (start code, technician with a masked number, the
  approve/decline card for extra work with the full before/after split, the completion sign-off),
  the provider's job runner (on my way, arrived, start-code entry with attempts left, extra-work
  request, mark done), and a shared chat sheet that shows the off-platform flag inline.

**Changed files:** `packages/core/src/{execution/execution.ts,execution/execution.test.ts,contracts/execution.ts,index.ts}`,
`supabase/migrations/0005_execution.sql`,
`apps/api/src/{modules/execution/{service,routes}.ts,modules/jobs/service.ts,data/types.ts,data/memory/{index,execution}.ts,data/postgres/{index,execution}.ts,data/seed.ts,lib/crypto.ts,app.ts,test/execution.test.ts}`,
`apps/mobile/src/{api/execution.ts,features/customer/LiveJobPanel.tsx,features/provider/JobRunner.tsx,features/shared/ChatSheet.tsx}`,
`apps/mobile/app/(customer)/job/[id].tsx`, `apps/mobile/app/(provider)/active.tsx`, docs.

**Database changes:** migration `0005_execution`. `migrate:check` passes with 5 migrations.
Forward-only: nothing in 0001-0004 was touched. `technician_profiles` (created back in 0001) got
its first repository methods.

**API changes:** `POST /jobs/:id/technician`, `POST /jobs/:id/progress`, `POST /jobs/:id/start`,
`GET /jobs/:id/execution`, `POST /jobs/:id/evidence`, `POST /jobs/:id/price-revision`,
`POST /price-revisions/:id/respond`, `POST /jobs/:id/complete`, `POST /jobs/:id/approve`,
`GET|POST /jobs/:id/chat`. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 20 new API integration tests (`execution.test.ts`) and 12 new core unit
tests. Totals: **101/101 API**, **75/75 core**. Type check clean in 3/3 workspaces, lint 0 errors,
API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the integration suite drives the whole milestone end to end:
a job is taken from submission through offer, acceptance and authorization, then
`PROVIDER_ASSIGNED -> EN_ROUTE -> ARRIVED -> STARTED -> IN_PROGRESS`, a price revision is raised
with evidence, approved, and the quote and the extra authorization are re-read to prove the numbers
moved together, then completion is submitted and approved to `COMPLETED`. The privacy and safety
claims are asserted rather than assumed: the provider's own view of the panel returns
`startCode: null`, a second provider holding the correct code gets a 403, five wrong codes lock the
job in ARRIVED, a provider override is refused while an admin override with a reason succeeds and
is flagged on the job, and a stranger cannot read the chat.

**Known limitations:** the mobile evidence flow sends fixed image metadata instead of opening the
camera, because mock storage has nowhere to put the bytes. Chat flags are recorded but nothing
reviews them. There is no start-code resend, no chase or auto-approval when a customer ignores a
finished job, and masked calling still cannot place a call. Capture, settlement and refunds remain
M7 - approving completion moves the job to COMPLETED and releases nothing. Full list in
`KNOWN_LIMITATIONS.md`.

**Security considerations:** the start code exists only as an HMAC plus a derivation from the
server secret, is shown exclusively to the customer, is compared in constant time, and is spent on
first use; every wrong attempt is counted and analytics-tracked. The code never enters the audit
log - only the fact of the start does. An admin override cannot be silent: it needs a reason, is
stored on the row, and surfaces as `startWasOverridden` in both parties' views so a later
settlement can weigh it. Media phase is derived from the job's status, never chosen by the caller,
so a provider cannot backdate "completion" evidence onto a job that has not started. Chat is
participants-only in SQL as well as in code, messages are immutable, and contact details are
flagged rather than silently dropped. The customer's view of a technician carries a masked number.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M6 - Materials and vendors: material requests, vendor quotes, selection,
delivery confirmation and invoices, with the material leg priced and approved separately from
labour.

---

## Milestone 4: Negotiation and confirmation

**Milestone:** M4 - Negotiation, quote lock, acceptance and payment authorization
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core`: a negotiation module (20-minute counter-offer TTL, a hard limit of 6 rounds per
  job, `checkCanRespond` / `checkCanAccept`, counterparty resolution) and the contracts for
  counter-offers, offer chains, the locked booking quote, the assignment and the payment view.
  `OFFER_STATUSES` gained `SUPERSEDED` so a sender replacing their own pending offer is a distinct,
  readable state rather than a cancellation.
- `supabase/migrations/0004_negotiation.sql`: `offers` (unique partial: one PENDING offer per bid),
  `booking_quotes` (unique partial: one ACTIVE quote per job), `job_assignments` (one ACTIVE
  assignment per job + a trigger refusing an unverified technician), `payments` (unique
  `idempotency_key`, unique partial so a job can never carry two live booking payments) and
  `payment_events` (unique `provider_event_id`, UPDATE/DELETE revoked).
- `apps/api` negotiation module: `counter`, `respond` (ACCEPT / REJECT / COUNTER), `accept` and
  `applyPaymentEvent`. Acceptance is a single transaction that re-reads the bid and the job inside
  the lock, freezes a `booking_quote`, marks every other offer INACTIVE, cancels pending
  counter-offers, creates the assignment and the payment order, and walks the job
  `PAYMENT_PENDING -> CONFIRMED -> PROVIDER_ASSIGNED` as authorization lands. Two concurrent
  acceptances give exactly one 200 and one 409.
- Payments: a deterministic mock gateway plus a signed webhook whose HMAC is verified **before**
  the body is parsed. Replays are a no-op via `provider_event_id`, an amount mismatch is refused and
  recorded, and a failed authorization releases the booking back to `BID_RECEIVED` so the other
  offers become live again.
- `apps/mobile`: the customer offers list now accepts and counters; `ConfirmSheet` runs
  review -> authorize -> "Booking confirmed" with the exact frozen price; `BookingCard` shows the
  locked quote, who is coming and what is still owed; the provider gets a counter-offer card on the
  My offers tab with decline / meet-halfway / accept.
- Fixed an opaque 400: a request with `content-type: application/json` and an empty body is now
  parsed as `{}` instead of failing in the JSON parser.

**Changed files:** `packages/core/src/{bidding/negotiation.ts,bidding/negotiation.test.ts,contracts/negotiation.ts,contracts/enums.ts,index.ts}`,
`supabase/migrations/0004_negotiation.sql`,
`apps/api/src/{app.ts,modules/negotiation/{service,routes}.ts,data/types.ts,data/memory/{index,negotiation}.ts,data/postgres/{index,negotiation}.ts,test/negotiation.test.ts}`,
`apps/mobile/src/{api/negotiation.ts,features/customer/{OffersList,ConfirmSheet,BookingCard}.tsx,features/provider/CounterOfferCard.tsx}`,
`apps/mobile/app/(customer)/job/[id].tsx`, `apps/mobile/app/(provider)/active.tsx`, docs.

**Database changes:** migration `0004_negotiation` (offers, booking_quotes, job_assignments,
payments, payment_events). `migrate:check` passes with 4 migrations. Forward-only: nothing in
0001-0003 was touched.

**API changes:** `POST /jobs/:id/counter-offer`, `POST /offers/:id/respond`,
`GET /jobs/:id/offer-chain`, `POST /bids/:id/accept`, `GET /jobs/:id/booking`,
`POST /payments/:id/mock-complete` (mock mode only, owner only), `POST /payments/webhook`.
Documented in `API_REFERENCE.md`.

**Tests added / passed:** 17 new API integration tests (`negotiation.test.ts`) and 10 new core unit
tests. Totals: **81/81 API**, **63/63 core**. Type check clean in 3/3 workspaces, lint 0 errors,
API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the whole loop was run twice. Through the API: submit -> bid ->
customer counters Rs 600 -> provider counters Rs 700 -> customer accepts -> quote locked at
Rs 847.20 (labour Rs 700) -> payment authorized -> job PROVIDER_ASSIGNED, with the trail
`DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS -> BID_RECEIVED -> NEGOTIATING ->
PAYMENT_PENDING -> CONFIRMED -> PROVIDER_ASSIGNED`. Through the app (in-app browser, 390x844,
demo customer +919000000001): a job with two competing offers showed the ranked list with the
transparent split (Rs 794.25 all-in vs Rs 550.68), accept opened `ConfirmSheet` with the identical
breakdown, authorize flipped the card to "Confirmed / Authorized / Price locked", the offers list
disappeared, the timeline gained "Offer accepted / Payment authorized / Provider assigned", and
every request returned 200 with no console errors.

**Known limitations:** the payment gateway is **mocked** - the booking flow is real end to end but
no money moves; capture, settlement and refunds arrive in M7. Counter-offer and bid-window expiry
are checked on read but nothing sweeps them in the background (M9). The app polls rather than using
realtime. Postgres repositories are written but the suite still runs in memory mode. Full list in
`KNOWN_LIMITATIONS.md`.

**Security considerations:** the webhook signature is verified before the payload is parsed, so an
unsigned body is never deserialized; `provider_event_id` makes replays idempotent and an amount
mismatch is refused rather than trusted. `mock-complete` exists only when `PAYMENT_PROVIDER=mock`
and only for the payment's own payer. Acceptance is guarded three times - in shared code, again
inside the transaction after re-reading the row, and by partial unique indexes in SQL - so a race
cannot double-book a job. The offer chain and booking views expose business name, verified badge,
distance and price only: never the provider's phone number, address or documents. The word
"escrow" is used nowhere; the flow is authorization -> hold -> settlement.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M5 - Execution and completion: technician assignment, EN_ROUTE/ARRIVED,
the 4-digit start OTP, price-revision requests with customer approval, completion proof, customer
approval, and in-job chat.

---

## Milestone 3: Provider workflow

**Milestone:** M3 - Provider workflow
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core`: contracts for the provider profile, KYC submission, the nearby feed item, and
  bids/offers. The bidding rules (windows, eligibility, validation, non-price-only ranking) were
  already written in M1 and are now wired up for real.
- `supabase/migrations/0003_bidding.sql`: `kyc_records` (one open submission per document type),
  `bids` (one live offer per provider per job, revisions capped at two, labour or visit fee must be
  positive) and `bid_revisions` (every price ever offered). Triggers refuse an offer from a provider
  who is not active and verified, and refuse an offer on a job that is not accepting them.
- `apps/api` provider module: profile update with base location and skills, availability toggle
  that refuses to switch on before verification, KYC submission that stores only the last four
  characters of a document number, an eligibility-filtered nearby feed that exposes distance and
  area but never the address, bid place/revise/withdraw, the provider's own offer list, and the
  customer-facing ranked offer list.
- `apps/mobile`: provider Jobs tab (availability switch, verification banner, live offer-window
  countdown per job, blocker-aware empty states), a quick-bid sheet with a live fee breakdown
  showing exactly what the customer pays and what the provider receives, the My offers tab with
  withdraw, a provider profile screen (verification, document submission, radius, skills), and an
  offers card on the customer's job screen with the transparent split and a best-match badge.
- Demo seed now gives demo providers their skills so the nearby feed works out of the box.

**Changed files:** `packages/core/src/{contracts/provider.ts,index.ts}`,
`supabase/migrations/0003_bidding.sql`,
`apps/api/src/{data/types.ts,data/memory/{index,jobs,bids}.ts,data/postgres/{index,jobs,bids}.ts,modules/provider/{service,routes}.ts,app.ts,data/seed.ts,test/provider.test.ts}`,
`apps/mobile/src/{api/{provider.ts,client.ts},features/provider/BidSheet.tsx,features/customer/OffersList.tsx}`,
`apps/mobile/app/(provider)/{jobs,active,profile}.tsx`, `apps/mobile/app/(customer)/job/[id].tsx`, docs.

**Database changes:** migration `0003_bidding`. `migrate:check` passes with 3 migrations.

**API changes:** `GET/PUT /provider/profile`, `POST /provider/availability`, `POST /provider/kyc`,
`GET /provider/jobs/nearby`, `POST /jobs/:id/bids`, `POST /bids/:id/revise`,
`POST /bids/:id/withdraw`, `GET /provider/bids`, `GET /jobs/:id/offers`. See `API_REFERENCE.md`.

**Tests added:** 21 integration tests - unverified provider cannot go available and is told why;
profile, skills and base location persist; KYC stores only the last four characters and the number
never reaches the response or the audit log; duplicate KYC refused; feed shows an in-radius matching
job and hides the street address; feed hides other categories and out-of-radius jobs; empty feed
returns blockers; a customer cannot read the provider feed; placing an offer moves the job to
BID_RECEIVED and notifies the customer; duplicate live offer refused; unverified and
category-mismatched offers refused; terms validated; offers refused on a cancelled job; two
revisions allowed and the third refused; withdraw frees the provider to bid again and cannot be
repeated; provider offer list carries job context; ranking does not simply pick the cheapest;
cross-customer and cross-provider access refused; a customer cannot place an offer.

**Tests passed:** 117/117 (53 unit + 64 integration). Type check clean across 3 workspaces.
Lint clean. Migration check OK.

**Manual verification completed:** seeded an open plumbing job through the API, then in the browser
at 390x844 signed in as the demo provider - the Jobs tab showed the job at 1.4 km with a live 28:43
window, the bid sheet computed labour 650, platform fee 32.50, tax 5.85, customer pays 688.35 and
"you receive 650", and sending it flipped the card to "1 offer so far - 650 - Edit". Signing back in
as the customer, the job showed "Offers received", the milestone timeline advanced, and the offer
card rendered with the verified badge, 4.7 stars, 120 jobs, 1.4 km, the split and a BEST MATCH
badge. The API confirmed the offer payload contains no phone number.

**A bug the tests caught:** a provider could place an offer on a cancelled job. The SQL trigger
blocked it in Postgres but the service did not, so the memory store accepted it. The service now
checks the job status before anything else, mirroring `bids_require_open_job`.

**Known limitations:** nothing flips a provider to VERIFIED yet - the admin review queue is M8, so
tests and the demo seed set it directly; KYC document bytes are not stored (mock storage); accepting
an offer is M4, so the accept button is deliberately disabled; nothing expires the bid window in the
background yet. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** eligibility is re-checked on every bid, not just when building the
feed, so a provider cannot quote on something they were never shown; the feed and the offer list
expose distance and area but never the address, phone number or media; offer ownership is enforced
on revise and withdraw; a customer cannot place an offer and a provider cannot create a job; the
KYC document number is never stored, returned or logged (asserted by a test that greps the audit
log); bids from suspended or unverified providers are refused in both the service and SQL.

**External integrations mocked or live:** ALL MOCKED - storage (KYC and job media), SMS, payment,
maps, push, telephony, monitoring, analytics.

**Next milestone:** M4 - Negotiation and confirmation (counter-offers, offer expiry, quote locking,
the single-winner acceptance transaction, and payment authorization through the mock gateway).

---

## Milestone 2: Customer job flow

**Milestone:** M2 - Customer job flow
**Date:** 2026-09-22
**Status:** Complete

**Implemented:**
- `packages/core`: job rules module - media limits (8 photos, 1 voice note capped at 60 s, size and
  mime allow-lists), submission readiness checks, prohibited-request blocklist kept separate from
  safety-hazard detection (hazards warn, they never block), duplicate-request detection, and the
  zod contracts for every job payload and view.
- `supabase/migrations/0002_jobs.sql`: `jobs`, `job_media`, `job_status_events` with job/payment
  status enums, a partial unique index giving one live draft per category+address, a hash index
  that turns a retried upload into a no-op, an append-only status trail, and triggers that refuse
  to let a job leave DRAFT without an address plus a description or media, and that refuse request
  media once the job has moved on.
- `apps/api` jobs module: a single `transition()` that validates the state machine, re-reads the
  row inside the transaction and writes the status event atomically; draft create/resume, draft
  edit, media upload targets, submit (DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS with the
  bid window and tracking token), cancel, customer list with active/past scopes, and a deliberately
  minimal public `/track/:token` view.
- `apps/mobile`: booking flow (category strip, description, photos via expo-image-picker, urgent and
  materials toggles, time slot, address picker with out-of-zone guard, sticky CTA above the tab bar,
  staggered entrance animations, inline hazard warnings); job status screen with a live bid-window
  countdown, milestone timeline, request summary, activity trail, share-tracking and cancel; bookings
  list wired to the API with active/past tabs and live status pills; home categories open the flow.

**Changed files:** `packages/core/src/{jobs/job-rules.ts,jobs/job-rules.test.ts,contracts/jobs.ts,index.ts}`,
`supabase/migrations/0002_jobs.sql`, `apps/api/src/{data/types.ts,data/memory/{index,jobs}.ts,data/postgres/{index,jobs}.ts,modules/jobs/{service,routes}.ts,app.ts,test/{jobs.test.ts,helpers.ts}}`,
`apps/mobile/{src/api/jobs.ts,app/(customer)/{book.tsx,bookings.tsx,home.tsx,job/[id].tsx}}`, docs.

**Database changes:** migration `0002_jobs` (see above). `migrate:check` passes with 2 migrations.

**API changes:** `POST /jobs`, `PATCH /jobs/:id`, `GET /jobs/:id`, `GET /me/jobs`,
`POST /jobs/:id/media`, `DELETE /jobs/:id/media/:mediaId`, `POST /jobs/:id/submit`,
`POST /jobs/:id/cancel`, `GET /track/:token`. Documented in `API_REFERENCE.md`.

**Tests added:**
- Unit (core, 15 new): media mime/size/duration/count limits, submission blockers, clock-skew
  tolerance on the preferred start, prohibited vs hazard wording, duplicate window.
- Integration (api, 24 new): draft create with status trail, draft resume, disabled category,
  address ownership, hazard flagging, upload targets and every media limit, retried upload dedupe,
  media delete, full submit walk with a 30-minute window, 10-minute urgent window, wordless job
  with a photo, out-of-zone refusal, prohibited request, duplicate warning, double-submit rejection,
  post-submit lock, active/past listing, cancel with mandatory reason, public tracking link leaking
  nothing sensitive, and five cross-user/role/suspension security checks.

**Tests passed:** 96/96 (53 unit + 43 integration). Type check clean across 3 workspaces. Lint clean.
Migration check OK.

**Manual verification completed:** ran the API and the app in the in-app browser at 390x844 - logged
in as the seeded customer, opened the booking flow from the Plumbing tile, described the problem and
submitted. Server log shows `POST /jobs 201` -> `POST /jobs/:id/submit 200` -> `GET /jobs/:id 200`;
the app landed on the status screen with the live countdown at 29:41, the milestone timeline at
"Finding providers", and the booking appeared under the Bookings > Active tab.

**Known limitations:** voice-note recording is not in the app yet (the API accepts and validates
voice notes); media bytes are not stored because the storage adapter is mocked, so photo thumbnails
fall back to an icon; auto-cancel when a bid window expires is not scheduled yet (the helper exists);
provider-side job feed arrives in M3. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** every job route re-checks ownership against the signed-in user (five
tests cover cross-user access); a provider cannot create a customer job; a suspended customer keeps
read access to history but cannot create anything; the public tracking link exposes no address,
phone number or media; status changes only happen through the guarded transition, which is also
enforced by SQL triggers; media is validated server-side before any storage target is issued.
The test helper now gives each test user its own IP so the per-IP OTP limit stays active in tests
rather than being loosened.

**External integrations mocked or live:** ALL MOCKED - storage returns fake signed URLs and skips
the byte transfer; SMS, payment, maps, push, telephony, monitoring and analytics unchanged.

**Next milestone:** M3 - Provider workflow (provider profile and verification status, service
radius, nearby job feed with eligibility filtering, bid creation and revisions, provider active jobs).

---

## Milestone 1: Foundation

**Milestone:** M1 - Foundation
**Date:** 2026-09-22
**Status:** Complete

**Implemented:**
- npm-workspaces monorepo: `packages/core` (domain rules + zod contracts), `apps/api` (Fastify), `apps/mobile` (Expo SDK 53 + expo-router 5).
- `packages/core`: job state machine (all 24 statuses, actor-restricted edges, terminal guards), integer-paise pricing with fee/tax/cancellation/refund math, bid window + eligibility + validation + non-price-only ranking, permission matrix (41 actions x 7 roles, high-risk set), haversine/geohash/pilot-zone helpers, OTP policy helpers, Indian phone normalisation, en/hi shared strings.
- `apps/api`: zod-validated env with production guard against mock adapters; adapter interfaces + deterministic mocks for SMS, maps, push, storage, payment, telephony, monitoring, analytics; repository abstraction with `memory` and `postgres` implementations; OTP auth (HMAC-hashed codes, 5 attempts, 5/hour, 60 s resend cooldown, IP limit), JWT access + rotating refresh sessions, revoke single/all; `/me` (profile, roles, consents), self-service role grant with profile bootstrap, consents, deletion scheduling with retention event, notifications feed; addresses with geocoding + pilot-zone flag + ownership checks; localised categories; admin user search (masked for support), suspend/reactivate with mandatory reason, audit-log viewer; global rate limit, per-route OTP limits, `Idempotency-Key` replay, request ids, PII-redacting logger, plain-language localised error envelope, `/health` + `/ready` (lists mocked adapters); demo seed (8 accounts).
- `apps/mobile`: design tokens derived from the user's reference screenshot (mint ground, deep-teal primary/gradient, white rounded cards, pastel icon chips, floating pill tab bar); UI kit (Text, Button, Card, TextField, IconChip, IconButton, Badge, Avatar, SectionHeader, Dots, Skeleton, EmptyState, ErrorState, OfflineBanner, Screen, FloatingTabBar); typed API client with refresh-on-401 and error mapping; zustand session (SecureStore) + NetInfo store; en/hi i18n; AuthGate routing (auth -> role picker -> role tabs); screens: phone, OTP (6-box, auto-submit, resend timer, demo-code badge), role picker, customer Home (matches reference), Bookings/Messages empty states, Profile (roles, role switch, language toggle, sign out), provider Jobs/Active/Earnings/Profile with verification badge and empty states; global error boundary.
- Tooling: ESLint flat config, Prettier, CI workflow, migration checker, esbuild API bundle, Dockerfile, `.claude/launch.json`.

**Changed files:** all files under `packages/core/src`, `apps/api/src`, `apps/mobile/{app,src}`, `supabase/migrations/0001_foundation.sql`, root configs, all 18 documentation files.

**Database changes:** `0001_foundation.sql` - enums, users, user_roles, otp_challenges, sessions, customer/provider/contractor/technician/vendor profiles, addresses, service_categories, service_skills, provider_skills, consents, audit_logs (append-only grants), notifications, retention_events, idempotency_keys; RLS enabled on all tables; category/skill seed rows.

**API changes:** `/health`, `/ready`, `/auth/request-otp|verify-otp|refresh|logout`, `/me` (GET/PATCH/DELETE), `/me/roles`, `/me/consents`, `/me/notifications`, `/me/addresses` (CRUD), `/categories`, `/admin/users`, `/admin/users/:id/suspend|reactivate`, `/admin/audit-logs`. See `API_REFERENCE.md`.

**Tests added:**
- Unit (core, 38): state machine happy path/invalid/actor/terminal, pricing breakdown/min fee/revisions/rounding/cancellation/refund/format, bid windows/eligibility/validation/expiry/ranking, permissions matrix, geo, OTP/phone helpers.
- Integration (api, 19): ready reports mocks; signup; invalid phone; wrong-code attempts + lock; OTP reuse blocked; resend cooldown; refresh rotation + replay rejection; tampered token; logout-all; Hindi error localisation; self-service vs privileged roles; provider profile bootstrap; address create/geocode/pilot-zone/default/cross-user 403/validation; role-gated address access; idempotency replay + key reuse across routes; support masked search; support cannot suspend; reason mandatory; suspension revokes sessions, blocks actions, keeps read access; audit entries with actor/reason; support cannot read audit; admin cannot self-suspend; consents + deletion scheduling; categories localisation.

**Tests passed:** 57/57 (`npm test`). Type check: 3/3 workspaces clean. Lint: 0 errors. Build: API bundle + Expo web export OK. Migration check: OK.

**Manual verification completed:** API booted in demo mode (`/ready` lists 8 mocked adapters); mobile web run in the in-app browser at 420x880: phone -> OTP auto-submit -> seeded customer Home renders categories from the API; Profile tab; Hindi toggle persists via `PATCH /me` and re-renders every string; viewport reset afterwards.

**Known limitations:** every external adapter is mocked; Postgres repository written but not yet exercised by the suite (memory mode only); realtime not started; no mobile component tests yet (M2); `query-string` pinned in mobile because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it; hero illustration is an icon placeholder until the final design supplies artwork; category tiles show only the 3 enabled categories (appliance repair disabled per spec). Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** OTP codes stored as HMAC (server secret) and compared in constant time; refresh tokens stored hashed and single-use; suspended users authenticate read-only, all mutations 403; roles re-read per request so revocation is immediate; admin actions need `reason` and write immutable audit rows; logger redacts phone/OTP/tokens; production boot refuses mock SMS/payment and non-Postgres data mode; no secrets in mobile bundle. Open items: admin MFA, KYC encryption, two-person approval (M8).

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage, telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M2 - Customer job flow (job creation with media/voice upload, submission, status timeline, `0002_jobs` migration, Postgres-mode integration run).

---

## Milestone 0: Repository and architecture

**Milestone:** M0
**Date:** 2026-09-22
**Status:** Complete

**Implemented:** cloned empty `Aadharbindal/Hyperlocal_Marketplace`; created all 18 required documents (README, PRODUCT_SPEC, ARCHITECTURE, DECISIONS D-001..D-010, KNOWN_LIMITATIONS, SECURITY_CHECKLIST, PRIVACY_DATA_MAP, PAYMENT_FLOW, DISPUTE_POLICY, EDGE_CASE_MATRIX with 150+ scenarios across 13 areas, TEST_PLAN, INCIDENT_RESPONSE, IMPLEMENTATION_PLAN, PROGRESS_LOG, API_REFERENCE, DATABASE_SCHEMA, DEPLOYMENT, ENVIRONMENT_VARIABLES); `.env.example` with placeholder names only; `.gitignore`, editor/prettier/eslint configs; CI workflow; migration checker; stack confirmed (Expo + Fastify + Postgres/Supabase, modular monolith, adapters with mocks).

**Changed files:** root `*.md`, `.env.example`, `.gitignore`, `.editorconfig`, `.prettierrc`, `eslint.config.mjs`, `package.json`, `tsconfig.base.json`, `.github/workflows/ci.yml`, `scripts/check-migrations.mjs`.
**Database changes:** none (schema designed in `DATABASE_SCHEMA.md`).
**API changes:** none (contracts designed in `API_REFERENCE.md`).
**Tests added / passed:** n/a.
**Manual verification completed:** documentation cross-links reviewed.
**Known limitations:** brand name placeholder (D-001).
**Security considerations:** secrets policy established; checklist created.
**External integrations mocked or live:** none yet.
**Next milestone:** M1 - Foundation.
