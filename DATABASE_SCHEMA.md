# Database Schema

PostgreSQL 15 (Supabase). Conventions:

- Primary keys: `id uuid default gen_random_uuid()`.
- Every table: `created_at timestamptz default now()`, `updated_at timestamptz` (trigger).
- Soft delete: `deleted_at timestamptz` only on non-financial tables.
- Money: `bigint` paise (INR × 100). Never float.
- Enums: PostgreSQL enums mirrored in `packages/core/src/contracts/enums.ts`.
- RLS enabled on every table; API uses service role and re-checks in code.
- Migrations: `supabase/migrations/NNNN_name.sql`, forward-only, never rewritten once applied.

## Migration map

| Migration | Milestone | Tables |
| --- | --- | --- |
| `0001_foundation` | M1 | extensions, enums, users, user_roles, otp_challenges, sessions, customer/provider/contractor/technician/vendor profiles, addresses, service_categories, service_skills, provider_skills, consents, audit_logs, notifications, retention_events |
| `0002_jobs` | M2 | jobs, job_media, job_status_events (+ enums, submission and media-phase triggers) |
| `0003_bidding` | M3 | kyc_records, bids, bid_revisions (+ eligibility and open-job triggers) |
| `0004_negotiation` | M4 | offers, booking_quotes, job_assignments, payments, payment_events (+ verified-technician trigger, single-winner partial uniques) |
| `0005_execution` | M5 | start_otps, price_revision_requests, job_completions, chat_threads, chat_messages (+ revision-actor, chat-sender and message-immutability triggers) |
| `0006_materials` | M6 | material_requests, material_quotes, material_orders (+ requester, vendor-verified and invoice-match triggers) |
| `0008_admin` | M8 | admin_mfa, kyc_access_log (+ sessions.mfa_verified_at, dispute queue columns, the two-person suspension trigger) |
| `0007_finance` | M7 | ledger_entries, settlements, refunds, disputes, dispute_evidence, strikes, reviews, support_tickets (+ payment_status gains RELEASED, and the completion, invoice, refund-cap, two-person and review triggers) |

## Tables

### users
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| phone_e164 | text unique not null | +91… normalized |
| phone_verified_at | timestamptz | |
| display_name | text | |
| avatar_url | text | storage reference |
| preferred_language | text default 'en' | en / hi |
| status | user_status enum | ACTIVE, SUSPENDED, DELETED |
| suspended_reason | text | |
| last_login_at | timestamptz | |
| deleted_at | timestamptz | anonymised on deletion, financial rows retained |

### user_roles
`(user_id fk, role user_role enum, status role_status enum default ACTIVE, granted_by uuid, created_at)` — unique `(user_id, role)`. Roles: CUSTOMER, PROVIDER, CONTRACTOR, TECHNICIAN, VENDOR, ADMIN, SUPPORT.

### otp_challenges
`(id, phone_e164, code_hash, purpose otp_purpose(LOGIN|START_JOB), attempts int default 0, max_attempts int, expires_at, consumed_at, request_ip, created_at)`. Index on `(phone_e164, created_at desc)`. Rows retained 30 days then purged (retention_events).

### sessions
`(id, user_id fk, refresh_token_hash text unique, device_label, user_agent, ip, expires_at, revoked_at, rotated_from uuid, created_at, last_used_at)`.

### customer_profiles
`(user_id pk fk, full_name, email, default_address_id fk, marketing_opt_in bool default false, notes_for_provider text)`.

### provider_profiles
`(user_id pk fk, business_name, bio, experience_years int, service_radius_km numeric(4,1) default 3, base_lat, base_lng, is_available bool default false, verification_status verification_status enum default UNVERIFIED, reliability_score numeric(4,2) default 5.00, rating_avg numeric(3,2), rating_count int default 0, completed_jobs int default 0, strike_count int default 0, contractor_id uuid fk users (null if independent), suspended_until timestamptz)`.

### contractor_profiles
`(user_id pk fk, business_name, gst_number_encrypted, verification_status, base_lat, base_lng, service_radius_km)`.

### technician_profiles
`(user_id pk fk, contractor_id fk users not null, full_name, verification_status, skills text[], active bool)`.

### vendor_profiles
`(user_id pk fk, shop_name, shop_address_id fk, delivery_radius_km, material_categories text[], operating_hours jsonb, delivery_available bool, verification_status, bank_details_encrypted, bank_changed_at)`.

### addresses
`(id, user_id fk, label, line1, line2, landmark, society_name, city, pincode, lat, lng, geohash, is_default, in_pilot_zone bool, deleted_at)`. Index `(user_id)`, `(geohash)`.

### service_categories
`(id, slug unique, name_en, name_hi, icon_key, is_enabled bool, requires_inspection_default bool, sort_order)`.

### service_skills
`(id, category_id fk, slug unique, name_en, name_hi, risk_level(LOW|MEDIUM|HIGH))`.

### provider_skills
`(provider_id fk, skill_id fk, verified bool, pk(provider_id, skill_id))`.

### consents
`(id, user_id fk, consent_type(TERMS|PRIVACY|MARKETING|LOCATION|VOICE_RECORDING), version, granted bool, granted_at, withdrawn_at, ip)`.

### audit_logs (append-only, no UPDATE/DELETE grants)
`(id, actor_user_id, actor_role, action text, entity_type, entity_id, reason text, before jsonb, after jsonb, ip, request_id, created_at)`. Index `(entity_type, entity_id)`, `(actor_user_id, created_at)`.

### idempotency_keys
`(key, user_id fk, route, status int, body jsonb, created_at)` — pk `(user_id, key)`; purged after 24 h.

### notifications
`(id, user_id fk, type, title, body, data jsonb, channel(IN_APP|PUSH|SMS), read_at, sent_at, created_at)`.

### retention_events
`(id, entity_type, entity_id, action(ANONYMISE|PURGE|EXPORT), scheduled_for, executed_at, reason)`.

### jobs (M2)
`(id, customer_id fk, booked_for_name, booked_for_phone_e164, recipient_tracking_token, category_id fk, skill_ids uuid[], title, description, priority(NORMAL|URGENT), request_type(LABOUR_ONLY|LABOUR_AND_MATERIAL), inspection_required bool, preferred_start timestamptz, preferred_end timestamptz, address_id fk, address_snapshot jsonb, lat, lng, status job_status, payment_status payment_status default NONE, bid_window_ends_at, confirmed_provider_id uuid, active_quote_id uuid, cancelled_reason, cancelled_by_role, completed_at, settled_at, deleted_at)`.
Indexes: `(status, created_at)`, `(category_id, status)`, `(customer_id, created_at desc)`, `(geohash)`.

### job_media (M2)
`(id, job_id fk, uploader_id fk, uploader_role, kind(PHOTO|VIDEO|VOICE_NOTE|DOCUMENT|INVOICE), phase(REQUEST|PROGRESS|COMPLETION|DISPUTE|PRICE_REVISION), storage_key, mime, size_bytes, duration_seconds, sha256, lat, lng, transcript, review_status(PENDING|APPROVED|FLAGGED|REJECTED), created_at)`.

### job_status_events (M2, append-only)
`(id, job_id fk, actor_user_id, actor_role, from_status, to_status, reason, metadata jsonb, request_id, created_at)`.

### bids (M3)
`(id, job_id fk, provider_id fk, labour_paise, visit_fee_paise, eta_minutes, warranty_days, material_responsibility(PROVIDER|CUSTOMER|VENDOR), notes, revision_no int default 0, status bid_status(ACTIVE|WITHDRAWN|REJECTED|ACCEPTED|EXPIRED|INACTIVE), expires_at, created_at)`.
Unique partial: `(job_id, provider_id) where status='ACTIVE'`. Check: revision_no ≤ 2.

### bid_revisions (M3)
`(id, bid_id fk, revision_no, labour_paise, visit_fee_paise, eta_minutes, warranty_days, notes, created_at)`.

### offers (M4)
One pending offer per bid at a time (unique partial `(bid_id) where status='PENDING'`); a new
counter-offer from the same side supersedes the sender's own pending one.
`(id, job_id fk, bid_id fk, parent_offer_id fk, sender_id, receiver_id, labour_paise, visit_fee_paise, eta_minutes, warranty_days, scope_notes, material_responsibility, status offer_status(PENDING|ACCEPTED|REJECTED|EXPIRED|CANCELLED|SUPERSEDED), expires_at, created_at, responded_at)`.

### booking_quotes (M4)
`(id, job_id fk, bid_id fk, offer_id fk, provider_id, labour_paise, visit_fee_paise, material_estimate_paise, platform_fee_paise, protection_fee_paise, tax_paise, total_paise, warranty_days, eta_minutes, locked_at, status(ACTIVE|SUPERSEDED|CANCELLED))`.
Unique partial `(job_id) where status='ACTIVE'`.

### job_assignments (M4)
`(id, job_id fk, provider_id fk, technician_id fk nullable, assigned_by, status(ACTIVE|REPLACED|CANCELLED), replaced_by uuid, reason, created_at)`.
Unique partial `(job_id) where status='ACTIVE'`. Trigger: technician must be VERIFIED.

### start_otps (M5)
`(id, job_id fk unique, code_hash, attempts, max_attempts 5, expires_at, verified_at, verified_by, overridden_by, override_reason, created_at)`.
Only the HMAC is stored; the four digits are re-derived from the server secret and this row's id,
so a database dump alone never yields a working code. Check: an override must carry a reason of at
least 10 characters.

### price_revision_requests (M5)
`(id, job_id fk, quote_id fk, requested_by, reason, extra_labour_paise, extra_material_paise, extra_time_minutes, original_total_paise, revised_total_paise, explanation, media_ids uuid[], status(PENDING|APPROVED|REJECTED|CLARIFICATION|CANCELLED|SUPPORT), responded_by, responded_at, response_message, created_at)`.
Unique partial `(job_id) where status in ('PENDING','CLARIFICATION')` - a customer is never asked
two money questions at once. Checks: the request must add something and must cost more than the
locked quote. Trigger `price_revision_actors_valid`: the customer can never raise one, only the
customer (or an admin) may answer, and the job must have an active assignment.

### job_completions (M5)
`(id, job_id fk, submitted_by, summary, warranty_note, media_ids uuid[], submitted_at, approved_by, approved_at, rejection_reason)`.
Unique partial `(job_id) where approved_at is null`, check: at least one media id. This is the
evidence a settlement is later built on.

### chat_threads / chat_messages (M5)
threads `(id, job_id fk unique, participant_ids uuid[], closed_at)`; messages `(id, thread_id fk, sender_id, sender_party, body, media_id, flagged bool, flag_reason, read_at, created_at)`.
Trigger `chat_sender_on_thread`: only a participant may write. DELETE is revoked and
`chat_messages_immutable` refuses any edit to the body, sender, thread or timestamp - only the read
receipt may change.

### material_requests (M6)
`(id, job_id fk, requested_by, items jsonb, note, needed_by, quote_window_ends_at, status(OPEN|QUOTED|ORDERED|CANCELLED|EXPIRED), created_at)`.
Unique partial `(job_id) where status in ('OPEN','QUOTED')` - one material list in play per job.
Check: 1-15 items. Trigger `material_request_actor_valid`: the customer can never raise one, and
the job must have an active assignment.

### material_quotes (M6)
`(id, request_id fk, vendor_id fk, items jsonb, subtotal_paise, delivery_paise, total_paise, eta_minutes, note, status(ACTIVE|SELECTED|REJECTED|EXPIRED|CANCELLED), expires_at, created_at)`.
Unique partial `(request_id, vendor_id) where status in ('ACTIVE','SELECTED')`. Check:
`total = subtotal + delivery`. Trigger `material_quote_vendor_verified`: only a verified vendor
may price a list.

### material_orders (M6)
`(id, request_id fk, quote_id fk, job_id fk, vendor_id, selected_by, items jsonb, subtotal_paise, delivery_paise, total_paise, vendor_payable_paise, eta_minutes, status(PENDING_PAYMENT|PREPARING|OUT_FOR_DELIVERY|DELIVERED|CONFIRMED|ON_HOLD|CANCELLED), delivered_at, confirmed_by, confirmed_at, issue, issue_note, issue_media_ids uuid[], cancel_reason, invoice_media_id, invoice_number, invoice_amount_paise)`.
Unique partial `(request_id) where status <> 'CANCELLED'` - a list is bought once. Checks:
totals add up, and an order on hold must name the issue. `vendor_payable_paise = total_paise`:
the platform takes no margin on materials in the pilot (DECISIONS D-013). Trigger
`material_invoice_matches_order`: an invoice may only be filed against a CONFIRMED order and must
equal its total to the paisa.

### payments / payment_events (M4)
Booking payments land in M4; material, milestone and revision purposes are used from M6/M7 on.
payments `(id, job_id, payer_id, purpose(BOOKING|MATERIAL|MILESTONE|PRICE_REVISION), amount_paise, currency, provider, provider_order_id, provider_payment_id, status(CREATED|AUTHORIZED|CAPTURED|FAILED|REFUNDED|PARTIALLY_REFUNDED|DISPUTE_HOLD), idempotency_key unique, created_at)` - unique partial `(job_id) where purpose='BOOKING' and status in ('CREATED','PENDING','AUTHORIZED','CAPTURED')` so a job can never carry two live booking payments; events `(id, payment_id, provider_event_id unique, type, payload jsonb, signature_valid bool, processed_at)` - UPDATE/DELETE revoked, `provider_event_id` makes webhook replays a no-op.

### ledger_entries (M7, append-only)
`(id, job_id, payment_id, entry_type(CUSTOMER_CHARGE|PROVIDER_PAYABLE|VENDOR_PAYABLE|PLATFORM_REVENUE|PROTECTION_RESERVE|REFUND|DISPUTE_HOLD|GATEWAY_FEE|TAX|MANUAL_ADJUSTMENT), account_user_id, amount_paise (signed), currency, batch_id, idempotency_key unique, reference_type, reference_id, note, created_by, created_at)`.
Signs are from the platform's point of view: **positive = received, negative = owed**. Every
event writes one `batch_id`, and a batch must sum to zero - the service refuses to write one that
does not. UPDATE and DELETE are revoked: a mistake is corrected with a new `MANUAL_ADJUSTMENT`,
never by editing history. Check: `amount_paise <> 0`.

### settlements (M7)
`(id, job_id, payee_id, payee_role, material_order_id, amount_paise, status(PENDING|INITIATED|PAID|FAILED|ON_HOLD), attempts, failure_reason, provider_transfer_id, idempotency_key unique, initiated_at, paid_at)`.
Trigger `settlements_require_completion`: the job must be COMPLETED or SETTLED **and** have no
open dispute. Trigger `settlements_vendor_needs_invoice`: a vendor settlement must name a
CONFIRMED material order that has an invoice on file.

### refunds (M7)
`(id, payment_id, job_id, amount_paise, reason, status(PENDING|PROCESSING|COMPLETED|FAILED), provider_refund_id, idempotency_key unique, requested_by, dispute_id)`.
Trigger `refunds_within_capture`: a refund can only be written against a captured payment and
the running total can never exceed what was captured.

### reviews (M7)
`(id, job_id, reviewer_id, reviewee_id, rating int check 1..5, comment, created_at)` - unique
`(job_id, reviewer_id)`. Trigger `reviews_require_completion`: the job must be COMPLETED or
SETTLED and the reviewer must have been on it.

### disputes / dispute_evidence / strikes (M7)
disputes `(id, job_id, raised_by, against_user_id, category, description, status(OPEN|UNDER_REVIEW|AWAITING_PARTY|RESOLVED|REJECTED|ESCALATED|REOPENED), resolution, resolution_reason, refund_paise, resolved_by, second_approver_id, resolved_at, reopened_count, sla_due_at)`.
Unique partial `(job_id)` while the dispute is open. Checks: a resolution needs a 20+ character
reason, and a partial refund needs an amount. Trigger `disputes_two_person_refund`: a refund over
Rs 5,000 needs a `second_approver_id` that is **not** the resolver.
evidence `(id, dispute_id, uploaded_by, media_id, note)` - UPDATE/DELETE revoked;
strikes `(id, user_id, severity, reason, issued_by, dispute_id, job_id, expires_at)` - also immutable.

### kyc_records (M7/M8)
`(id, user_id, document_type, storage_key_encrypted, doc_number_last4, status verification_status, reviewed_by, reviewed_at, rejection_reason, created_at)` — admin-only access; every read is audited.

### admin_mfa (M8)
`(user_id pk, secret_encrypted, enabled_at, last_used_step, failed_attempts, locked_until)`.
The TOTP seed is AES-256-GCM encrypted with the server key and returned in plaintext exactly
once, at enrolment. `last_used_step` is what makes a code single-use: a code from a step at or
before it is refused even if it is still inside the drift window.

### kyc_access_log (M8, append-only)
`(id, kyc_record_id, viewed_by, purpose, ip, created_at)`. Written every time a reviewer asks
for a document. UPDATE and DELETE are revoked: this log is the evidence that access was
legitimate.

### sessions (M8 addition)
`mfa_verified_at timestamptz` - when this session last satisfied a second factor. Console routes
check its age (8 hours) rather than trusting a role claim alone.

### support_tickets (M7)
`(id, opened_by, job_id, category, subject, body, status, assigned_to, priority, closed_at)`.

## Critical constraints (enforced in SQL + code)

| Rule | Mechanism |
| --- | --- |
| One active confirmed provider per job | partial unique on `job_assignments(job_id) where status='ACTIVE'` |
| One active booking quote per job | partial unique on `booking_quotes(job_id) where status='ACTIVE'` |
| No settlement before valid completion | trigger `settlements_require_completion` |
| No vendor payout without approved order | trigger on settlements where payee_role='VENDOR' |
| One material list in play per job | partial unique on `material_requests(job_id) where status in ('OPEN','QUOTED')` |
| One live quote per vendor per list | partial unique on `material_quotes(request_id, vendor_id)` |
| A material list is bought once | partial unique on `material_orders(request_id) where status <> 'CANCELLED'` |
| Only a verified vendor may quote | trigger `material_quote_vendor_verified` |
| An invoice must match its order | trigger `material_invoice_matches_order` |
| No review before completion | trigger `reviews_require_completion` |
| No technician assignment without verification | trigger `assignment_requires_verified_technician` |
| One open price revision per job | partial unique on `price_revision_requests(job_id) where status in ('PENDING','CLARIFICATION')` |
| A revision must cost more and add something | checks `price_revision_is_higher`, `price_revision_adds_something` |
| Only the customer answers a revision | trigger `price_revision_actors_valid` |
| Completion needs evidence | check `job_completion_needs_evidence` |
| Chat is participants-only and immutable | triggers `chat_sender_on_thread`, `chat_messages_immutable` |
| No bid from suspended provider | trigger `bids_require_active_provider` |
| No duplicate settlement/payment/refund | unique `idempotency_key` |
| One pending counter-offer per offer thread | partial unique on `offers(bid_id) where status='PENDING'` |
| One live booking payment per job | partial unique on `payments(job_id) where purpose='BOOKING'` and status is live |
| Webhook replays are a no-op | unique `payment_events.provider_event_id` |
| Financial rows immutable | revoke UPDATE/DELETE on ledger_entries, audit_logs, job_status_events, payment_events, dispute_evidence, strikes |
| Every money batch sums to zero | `batch_id` + the service's balance check before any write |
| No payout before completion, or during a dispute | trigger `settlements_require_completion` |
| No vendor payout without a confirmed order and invoice | trigger `settlements_vendor_needs_invoice` |
| A refund can never exceed the capture | trigger `refunds_within_capture` |
| A large refund needs two people | trigger `disputes_two_person_refund` |
| One open dispute per job | partial unique on `disputes(job_id)` while open |
| A suspension needs two different people | trigger `users_suspension_needs_two` |
| A suspension must carry a reason | same trigger, 20 character minimum |
| Identity-document access is never silent | `kyc_access_log`, UPDATE/DELETE revoked |
