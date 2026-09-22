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
| `0002_jobs` | M2 | jobs, job_media, job_status_events |
| `0003_bidding` | M3-M4 | bids, bid_revisions, offers, booking_quotes, job_assignments |
| `0004_execution` | M5 | start_otps, price_revision_requests, chat_threads, chat_messages |
| `0005_materials` | M6 | material_requests, material_quotes, material_orders |
| `0006_finance` | M7 | payments, payment_events, ledger_entries, settlements, refunds, disputes, dispute_evidence, strikes, support_tickets, reviews, kyc_records |

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
`(id, job_id fk, bid_id fk, parent_offer_id fk, sender_id, receiver_id, labour_paise, visit_fee_paise, eta_minutes, warranty_days, scope_notes, material_responsibility, status offer_status(PENDING|ACCEPTED|REJECTED|EXPIRED|CANCELLED), expires_at, created_at, responded_at)`.

### booking_quotes (M4)
`(id, job_id fk, bid_id fk, offer_id fk, provider_id, labour_paise, visit_fee_paise, material_estimate_paise, platform_fee_paise, protection_fee_paise, tax_paise, total_paise, warranty_days, eta_minutes, locked_at, status(ACTIVE|SUPERSEDED|CANCELLED))`.
Unique partial `(job_id) where status='ACTIVE'`.

### job_assignments (M4/M5)
`(id, job_id fk, provider_id fk, technician_id fk nullable, assigned_by, status(ACTIVE|REPLACED|CANCELLED), replaced_by uuid, reason, created_at)`.
Unique partial `(job_id) where status='ACTIVE'`. Trigger: technician must be VERIFIED.

### start_otps (M5)
`(id, job_id fk unique, code_hash, attempts, max_attempts 5, verified_at, verified_by, overridden_by, override_reason, created_at)`.

### price_revision_requests (M5)
`(id, job_id fk, requested_by, reason, extra_labour_paise, extra_material_paise, extra_time_minutes, revised_total_paise, explanation, status(PENDING|APPROVED|REJECTED|CLARIFICATION|CANCELLED|SUPPORT), responded_by, responded_at, created_at)`.

### chat_threads / chat_messages (M5)
threads `(id, job_id fk unique, participant_ids uuid[])`; messages `(id, thread_id fk, sender_id, body, media_id, flagged bool, flag_reason, created_at)`.

### material_requests / material_quotes / material_orders (M6)
requests `(id, job_id, requested_by, items jsonb, needed_by, status)`; quotes `(id, request_id, vendor_id, items jsonb, subtotal_paise, delivery_paise, eta_minutes, status, expires_at)`; orders `(id, quote_id, selected_by, status(PENDING_PAYMENT|PREPARING|OUT_FOR_DELIVERY|DELIVERED|CONFIRMED|CANCELLED), delivered_at, confirmed_by, invoice_media_id, settlement_id)`.

### payments / payment_events (M7)
payments `(id, job_id, payer_id, purpose(BOOKING|MATERIAL|MILESTONE|PRICE_REVISION), amount_paise, currency, provider, provider_order_id, provider_payment_id, status(CREATED|AUTHORIZED|CAPTURED|FAILED|REFUNDED|PARTIALLY_REFUNDED|DISPUTE_HOLD), idempotency_key unique, created_at)`; events `(id, payment_id, provider_event_id unique, type, payload jsonb, signature_valid bool, processed_at)`.

### ledger_entries (M7, append-only)
`(id, job_id, payment_id, entry_type(CUSTOMER_CHARGE|PROVIDER_PAYABLE|VENDOR_PAYABLE|PLATFORM_REVENUE|PROTECTION_RESERVE|REFUND|DISPUTE_HOLD|GATEWAY_FEE|TAX|MANUAL_ADJUSTMENT), account_user_id, amount_paise (signed), currency, idempotency_key unique, reference_type, reference_id, note, created_by, created_at)`.

### settlements / refunds (M7)
settlements `(id, job_id, payee_id, payee_role, amount_paise, status(PENDING|INITIATED|PAID|FAILED|ON_HOLD), provider_transfer_id, idempotency_key unique, initiated_at, paid_at)` — trigger: job.status ∈ {COMPLETED, SETTLED} and payment CAPTURED. refunds `(id, payment_id, amount_paise, reason, status, provider_refund_id, idempotency_key unique)`.

### reviews (M7)
`(id, job_id, reviewer_id, reviewee_id, rating int check 1..5, comment, created_at)` — unique `(job_id, reviewer_id)`; trigger: job COMPLETED/SETTLED.

### disputes / dispute_evidence / strikes (M7)
disputes `(id, job_id, raised_by, against_user_id, category dispute_category, description, status(OPEN|UNDER_REVIEW|AWAITING_PARTY|RESOLVED|REJECTED|ESCALATED|REOPENED), resolution jsonb, resolved_by, resolved_at, sla_due_at)`; evidence `(id, dispute_id, uploaded_by, media_id, note)`; strikes `(id, user_id, reason, severity, issued_by, expires_at, dispute_id)`.

### kyc_records (M7/M8)
`(id, user_id, document_type, storage_key_encrypted, doc_number_last4, status verification_status, reviewed_by, reviewed_at, rejection_reason, created_at)` — admin-only access; every read is audited.

### support_tickets (M7)
`(id, opened_by, job_id, category, subject, body, status, assigned_to, priority, closed_at)`.

## Critical constraints (enforced in SQL + code)

| Rule | Mechanism |
| --- | --- |
| One active confirmed provider per job | partial unique on `job_assignments(job_id) where status='ACTIVE'` |
| One active booking quote per job | partial unique on `booking_quotes(job_id) where status='ACTIVE'` |
| No settlement before valid completion | trigger `settlements_require_completion` |
| No vendor payout without approved order | trigger on settlements where payee_role='VENDOR' |
| No review before completion | trigger `reviews_require_completion` |
| No technician assignment without verification | trigger `assignment_requires_verified_technician` |
| No bid from suspended provider | trigger `bids_require_active_provider` |
| No duplicate settlement/payment/refund | unique `idempotency_key` |
| Financial rows immutable | revoke UPDATE/DELETE on ledger_entries, audit_logs, job_status_events |
