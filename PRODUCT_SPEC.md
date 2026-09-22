# Product Specification (source of truth)

Version 1.0 · Derived from the "Final Autonomous Build Prompt". Section numbers match the prompt.

## 1. Positioning
**[FINAL BRAND NAME]** — a Hyperlocal Services and Materials Marketplace connecting customers,
independent providers, contractors with technicians, material vendors, and platform admins/support.
Not a fixed-price gig platform: customers get multiple qualified offers, compare, negotiate scope
and price, approve changes digitally, and complete jobs securely.

Priorities (ordered): trust & safety → job completion → transparent scope/pricing → provider
reliability/earnings → local supply density → operational simplicity → data security/privacy →
auditability → sustainable unit economics. Never optimise only for lowest price.

## 3. Launch scope
- One city, one ~3 km pilot zone, limited societies, manually verified supply.
- Categories: Plumbing, Electrical, Carpentry, Basic appliance repair (feature-flagged).
  Category model is extensible; disabled categories never render in production.
- Roles: Customer, Provider, Contractor, Technician, Vendor, Admin, Support. Multi-role users
  allowed; every permission is role-specific and explicit.

## 4. Customer app (MVP)
Mobile OTP auth · profile · saved addresses & multiple locations · category selection · photo
upload · voice note ≤ 60 s · short description · normal/urgent · preferred date-time · labour-only
or labour+material · inspection-required · offer list & comparison · counter-offer · in-app chat ·
masked call (adapter) · booking confirmation · payment authorization (adapter) · assignment ·
arrival updates · 4-digit start OTP · material approval · price-revision approval · completion
evidence · completion confirmation · review/rating · dispute · book for another person +
tracking link · history · receipts/invoices · cancel/reschedule.
Customer always sees what is **fixed**, what is **estimated**, and what **needs approval**.

## 5. Provider app (MVP)
Mobile auth · profile (business name, photo, categories/skills, experience, radius,
availability toggle, KYC status) · nearby feed + filters · push · job details with
photos/transcript · quick bid (labour, visit fee, ETA, warranty, material responsibility) ·
counter-offer handling · accepted jobs · customer location after confirmation · navigation
handoff · start OTP · status updates · material request · price-revision request ·
progress/completion photos · earnings · settlement status · reviews · reliability score ·
strike/suspension status. Voice-first bidding = Phase 2.

## 6. Contractor & technician
Add technicians · submit verification · assign to confirmed jobs · replace before arrival ·
track status · job-wise payouts · performance · agency earnings. Customer sees booked business,
assigned technician name, verification status. Unverified technicians cannot be assigned.
Replacement after confirmation notifies the customer; approval required where risk demands.

## 7. Vendor app
Profile, shop address, delivery radius, categories, hours, delivery availability, stock status,
verification · material request feed · quotation with availability/ETA · invoice upload ·
delivery confirmation · order history · settlement status.
Flow: provider creates request → eligible vendors quote → customer/provider selects → payment
authorized → prepare → deliver/collect → confirm → invoice → settlement. **No credit/loans.**

## 8. Admin & support
User search · roles/verification · KYC review · vendor verification · job search/filters ·
bid/offer timeline · payment status · full job timeline · media review · disputes ·
refund/adjustment · strikes · suspend/reactivate · demand/supply reports · audit-log viewer ·
support tickets · manual fallbacks with mandatory reasons. High-risk actions need elevated
permission or two-person approval.

## 9. Job state machine (server-side only)
```
DRAFT → SUBMITTED → QUALIFYING → OPEN_FOR_BIDS → BID_RECEIVED → NEGOTIATING → PAYMENT_PENDING
→ CONFIRMED → PROVIDER_ASSIGNED → EN_ROUTE → ARRIVED → STARTED → IN_PROGRESS
→ PRICE_REVISION_PENDING → COMPLETION_PENDING → CUSTOMER_APPROVAL_PENDING → COMPLETED → SETTLED
Terminal: CANCELLED_BY_CUSTOMER, CANCELLED_BY_PROVIDER, AUTO_CANCELLED, DISPUTED, REFUNDED, ABANDONED
```
Rules: only server transitions; every transition writes a status event (actor, timestamp,
old, new, reason, metadata); invalid transitions rejected; payment status separate; completed
jobs never silently reopened (adjustment events instead); client never source of truth.
Implemented in `packages/core/src/jobs/state-machine.ts`.

## 10. Bidding & negotiation
Only verified, eligible providers (category, radius, availability, reliability, status) see a
job. Bid window 30 min normal / 10 min urgent. One initial bid + max two revisions. Bids =
labour, visit fee, ETA, warranty, notes; materials separate. Customer accepts / rejects /
counters. Exactly one provider confirmed via DB transaction; other bids → INACTIVE. Accepted
price immutable without a price-revision request. Offer fields: id, parent id, sender,
receiver, price breakdown, expiry, timestamp, status (PENDING/ACCEPTED/REJECTED/EXPIRED/
CANCELLED). Accepted terms → locked `booking_quote`. Ranking = skill, distance, ETA, completed
jobs, reliability, rating, price. Sponsored placement labelled.

## 11. Price revision
Request requires reason, photos/video, extra labour, extra material, revised total, extra time,
plain-language explanation. Customer: approve / reject / clarify / contact support / cancel per
policy. No extra charge without digital approval; rejection keeps original quote.

## 12. Start OTP & execution
4-digit OTP generated on confirmation, shown only to customer/recipient, entered by
provider/technician at arrival, attempts limited and logged, no manual start, admin override
needs reason + audit, final payment never relies solely on override.
User-facing statuses: Request submitted · Finding providers · Offers received · Provider
confirmed · Provider is on the way · Provider has arrived · Work started · Additional approval
required · Work completed · Awaiting customer approval · Payment completed.

## 13. Materials & labour separation
Every quote/financial record separates labour, visit/inspection fee, materials, delivery,
platform fee, protection fee (if enabled), taxes/payment charges, refunds/adjustments.
Substitution requires approval unless within pre-approved budget.

## 14. Payments & settlement
Vocabulary: authorization, hold, milestone, settlement, refund, dispute hold (never "escrow").
Small job: authorize → OTP start → complete → evidence → approve → settle → payouts/fees
recorded. Large job: inspection fee → material milestone → labour milestone → completion →
final settlement. Auditable records for every component. Idempotent, signed webhooks, never
trust client payment result. Detail: `PAYMENT_FLOW.md`.

## 15. Trust & safety
Verification states UNVERIFIED → SUBMITTED → UNDER_REVIEW → VERIFIED / REJECTED / SUSPENDED.
Identity documents never exposed to customers. Media metadata: job, user, role, timestamp,
approx location, hash, source, review status. AI may flag, never decide serious disputes.
Dispute categories in `DISPUTE_POLICY.md`.

## 16. Edge cases → `EDGE_CASE_MATRIX.md`.

## 17. Anti-leakage
Masked calling adapter, phone/email/UPI/QR detection, external-contact warning, in-platform
warranty/support benefits, repeat incentives, digital invoices. Retention policy in
`PRIVACY_DATA_MAP.md` (no immediate deletion of chat/location).

## 18–19. Database & API → `DATABASE_SCHEMA.md`, `API_REFERENCE.md`.

## 20. Stack
Expo/React Native + TypeScript · Fastify API · PostgreSQL (Supabase) · Supabase Realtime/Storage
· adapters for maps, payments, push, telephony, SMS, monitoring, analytics. Modular monolith.
No Kafka/microservices.

## 21. Security → `SECURITY_CHECKLIST.md`.

## 22. UX & accessibility
Neutral, polished design system until final design; large touch targets, high contrast, Hindi
+ English string architecture, simple language, clear cost breakdown, clear status messaging,
loading/empty/error/offline states, no hidden charges.

## 23. Testing → `TEST_PLAN.md`. Feature is complete only with happy, failure, loading, empty,
permission, network-failure, audit and business-critical coverage.

## 24. Analytics events
signup_completed, kyc_submitted, job_created, job_submitted, job_viewed_by_provider,
bid_submitted, counter_offer_sent, bid_accepted, payment_authorized, provider_assigned,
provider_arrived, job_started, price_revision_requested, price_revision_approved,
job_completed, job_disputed, job_cancelled, review_submitted, material_request_created,
material_quote_submitted, material_order_completed. Minimal personal data.

## 25. Business metrics
Time to first qualified bid, bids/job, bid→booking, booking→completion, arrival rate,
cancellation rate, dispute rate, repeat rate, WAP, provider earnings, vendor conversion, AJV,
CAC, contribution margin, support cost/job. **North star: completed verified jobs per active
pilot zone per week.**

## 26. Monetisation
Customer protection fee (optional), qualified lead fee, vendor transaction contribution,
vendor subscription pilot, labelled promoted placements, society subscriptions (later). Never
charge for invalid/duplicate/out-of-area/already-assigned/withdrawn leads. No hidden commission.

## 27. Rollout: preparation → controlled pilot (manual monitoring) → local launch via societies
→ expansion only on proven metrics.

## 31. Deferred (not in MVP)
Regional voice UI, AI categorisation, AI damage assessment, voice bidding, live traffic
tracking, offline Bluetooth OTP, micro-loans, automated protection claims, credit system,
heatmaps, provider academy, multi-city, complex loyalty, family delegation, Kafka.

## 32. Legal/privacy/payment boundaries — flag for professional review before launch:
marketplace terms, consumer protection, privacy notice/consent, retention, payment structure,
tax/invoicing, KYC, provider/technician/vendor agreements, protection-fee wording, insurance
wording, financing partners, grievance handling. No unverified legal/insurance/lending claims.

## 34. Design handoff protocol
Until final design: neutral polished tokens (currently derived from the user's reference
screenshot — see `DECISIONS.md` D-008), reusable components, centralised tokens, business
logic independent of visuals, realistic loading/empty/error/offline states.
On handoff: inspect every screen → map to routes/states → list missing screens/states/
permissions → preserve safety/error states → implement tokens centrally → apply across roles →
visual + functional regression → update docs and progress log. Backend must not change.

## 35. Completion standard
Lifecycle works end-to-end · invalid transitions blocked · duplicate payments prevented · role
permissions tested · price changes need approval · dispute evidence available · refund/settlement
auditable · KYC restricted · suspended accounts keep balances · network failure graceful ·
admin actions logged · errors understandable · critical edge cases tested · security checklist
done · integrations labelled live/mocked · manual fallbacks documented · setup/test/deploy docs
complete · final design applicable without core changes.
