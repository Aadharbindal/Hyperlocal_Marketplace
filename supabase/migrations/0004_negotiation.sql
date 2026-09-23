-- 0004_negotiation
-- Milestone 4: counter-offers, the locked booking quote, the confirmed assignment and the
-- payment authorization that turns an agreement into a booking.
-- Forward-only; never edit after applying.

create type offer_status as enum ('PENDING','ACCEPTED','REJECTED','EXPIRED','CANCELLED','SUPERSEDED');
create type offer_party as enum ('CUSTOMER','PROVIDER');
create type quote_status as enum ('ACTIVE','SUPERSEDED','CANCELLED');
create type assignment_status as enum ('ACTIVE','REPLACED','CANCELLED');
create type payment_purpose as enum ('BOOKING','MATERIAL','MILESTONE','PRICE_REVISION');

-- ---------------------------------------------------------------------------
-- offers
-- One row per step of a negotiation. The chain is walkable through parent_offer_id so the
-- customer, the provider and support can all see how the terms moved (PRODUCT_SPEC section 10).
-- ---------------------------------------------------------------------------
create table offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  bid_id uuid not null references bids(id),
  parent_offer_id uuid references offers(id),

  sender_id uuid not null references users(id),
  sender_party offer_party not null,
  receiver_id uuid not null references users(id),

  labour_paise bigint not null check (labour_paise >= 0),
  visit_fee_paise bigint not null default 0 check (visit_fee_paise >= 0),
  eta_minutes int not null check (eta_minutes between 10 and 4320),
  warranty_days int not null default 0 check (warranty_days between 0 and 365),
  material_responsibility material_responsibility not null default 'PROVIDER',
  scope_notes text,

  status offer_status not null default 'PENDING',
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (labour_paise > 0 or visit_fee_paise > 0)
);
create index offers_job_idx on offers(job_id, created_at);
create index offers_bid_idx on offers(bid_id, created_at);
create index offers_receiver_idx on offers(receiver_id, status);
-- only one live counter-offer per negotiation thread at a time
create unique index offers_one_pending_per_bid_idx on offers(bid_id) where status = 'PENDING';
create trigger offers_updated before update on offers for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- booking_quotes
-- The agreed terms, frozen. Once this exists the price cannot move without an approved
-- price revision (PRODUCT_SPEC section 11).
-- ---------------------------------------------------------------------------
create table booking_quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  bid_id uuid not null references bids(id),
  offer_id uuid references offers(id),
  provider_id uuid not null references users(id),

  labour_paise bigint not null,
  visit_fee_paise bigint not null,
  material_estimate_paise bigint not null default 0,
  delivery_paise bigint not null default 0,
  platform_fee_paise bigint not null,
  protection_fee_paise bigint not null default 0,
  tax_paise bigint not null,
  total_paise bigint not null,
  provider_payable_paise bigint not null,

  warranty_days int not null,
  eta_minutes int not null,
  material_responsibility material_responsibility not null,

  status quote_status not null default 'ACTIVE',
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one live quote per job (DATABASE_SCHEMA critical constraints)
create unique index booking_quotes_one_active_idx on booking_quotes(job_id) where status = 'ACTIVE';
create index booking_quotes_provider_idx on booking_quotes(provider_id);
create trigger booking_quotes_updated before update on booking_quotes for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- job_assignments
-- ---------------------------------------------------------------------------
create table job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  provider_id uuid not null references users(id),
  technician_id uuid references users(id),
  contractor_id uuid references users(id),
  assigned_by uuid references users(id),
  status assignment_status not null default 'ACTIVE',
  replaced_by uuid references job_assignments(id),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- exactly one confirmed provider per job (DATABASE_SCHEMA critical constraints)
create unique index job_assignments_one_active_idx on job_assignments(job_id) where status = 'ACTIVE';
create index job_assignments_provider_idx on job_assignments(provider_id, status);
create trigger job_assignments_updated before update on job_assignments for each row execute function set_updated_at();

-- A technician may only be assigned once their own verification passed.
create or replace function assignment_requires_verified_technician() returns trigger language plpgsql as $$
declare
  v verification_status;
begin
  if new.technician_id is not null then
    select verification_status into v from technician_profiles where user_id = new.technician_id;
    if v is distinct from 'VERIFIED' then
      raise exception 'technician % is not verified', new.technician_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger assignment_requires_verified_technician_trg before insert or update on job_assignments
  for each row execute function assignment_requires_verified_technician();

-- ---------------------------------------------------------------------------
-- payments and payment_events
-- Authorization only in this milestone; capture, refunds and the ledger arrive in M7.
-- The vocabulary is authorization / hold / settlement, never "escrow" (DECISIONS D-007).
-- ---------------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  payer_id uuid not null references users(id),
  quote_id uuid references booking_quotes(id),
  purpose payment_purpose not null default 'BOOKING',

  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),

  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  status payment_status not null default 'PENDING',

  -- every money call is idempotent (PAYMENT_FLOW.md)
  idempotency_key text not null unique,
  failure_reason text,
  authorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_job_idx on payments(job_id, created_at desc);
create unique index payments_one_live_booking_idx on payments(job_id)
  where purpose = 'BOOKING' and status in ('PENDING','AUTHORIZED','CAPTURED');
create trigger payments_updated before update on payments for each row execute function set_updated_at();

create table payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id),
  -- the gateway's own event id; the unique index is what makes replays harmless (PAY-04)
  provider_event_id text not null unique,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_events_payment_idx on payment_events(payment_id, created_at);
revoke update, delete on payment_events from public;

alter table offers enable row level security;
alter table booking_quotes enable row level security;
alter table job_assignments enable row level security;
alter table payments enable row level security;
alter table payment_events enable row level security;
