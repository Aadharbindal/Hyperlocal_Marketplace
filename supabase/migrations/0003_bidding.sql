-- 0003_bidding
-- Milestone 3: provider verification and the offers providers place on open jobs.
-- Forward-only; never edit after applying.

create type bid_status as enum ('ACTIVE','WITHDRAWN','REJECTED','ACCEPTED','EXPIRED','INACTIVE');
create type material_responsibility as enum ('PROVIDER','CUSTOMER','VENDOR');
create type kyc_document_type as enum ('AADHAAR','PAN','DRIVING_LICENCE','VOTER_ID','SHOP_LICENCE','GST');

-- ---------------------------------------------------------------------------
-- kyc_records
-- Identity documents are never exposed to customers (PRODUCT_SPEC section 15). Only the
-- storage key and the last four digits are kept here; the file itself is encrypted at rest.
-- ---------------------------------------------------------------------------
create table kyc_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  document_type kyc_document_type not null,
  storage_key_encrypted text not null,
  doc_number_last4 text check (doc_number_last4 is null or doc_number_last4 ~ '^[0-9A-Z]{4}$'),
  status verification_status not null default 'SUBMITTED',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kyc_records_user_idx on kyc_records(user_id, created_at desc);
-- one open submission per user and document type (EDGE_CASE_MATRIX AUTH-11)
create unique index kyc_records_open_idx on kyc_records(user_id, document_type)
  where status in ('SUBMITTED','UNDER_REVIEW');
create trigger kyc_records_updated before update on kyc_records for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- bids
-- ---------------------------------------------------------------------------
create table bids (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  provider_id uuid not null references users(id),
  -- set when a contractor bids on behalf of their business
  contractor_id uuid references users(id),

  labour_paise bigint not null check (labour_paise >= 0),
  visit_fee_paise bigint not null default 0 check (visit_fee_paise >= 0),
  eta_minutes int not null check (eta_minutes between 10 and 4320),
  warranty_days int not null default 0 check (warranty_days between 0 and 365),
  material_responsibility material_responsibility not null default 'PROVIDER',
  notes text,

  revision_no int not null default 0 check (revision_no <= 2),
  status bid_status not null default 'ACTIVE',
  expires_at timestamptz not null,
  withdrawn_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (labour_paise > 0 or visit_fee_paise > 0)
);
-- one live offer per provider per job (PRODUCT_SPEC section 10)
create unique index bids_one_active_per_provider_idx on bids(job_id, provider_id) where status = 'ACTIVE';
create index bids_job_idx on bids(job_id, status);
create index bids_provider_idx on bids(provider_id, created_at desc);
create trigger bids_updated before update on bids for each row execute function set_updated_at();

-- Every price the provider has ever offered on this job, so the customer and support can see
-- how an offer moved (PRODUCT_SPEC section 10).
create table bid_revisions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references bids(id),
  revision_no int not null,
  labour_paise bigint not null,
  visit_fee_paise bigint not null,
  eta_minutes int not null,
  warranty_days int not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (bid_id, revision_no)
);

-- ---------------------------------------------------------------------------
-- Guard rails
-- ---------------------------------------------------------------------------

-- A suspended or unverified provider cannot place an offer (EDGE_CASE_MATRIX BID-08).
create or replace function bids_require_eligible_provider() returns trigger language plpgsql as $$
declare
  u_status user_status;
  p_verification verification_status;
  p_suspended_until timestamptz;
begin
  select status into u_status from users where id = new.provider_id;
  if u_status <> 'ACTIVE' then
    raise exception 'provider % is not active', new.provider_id using errcode = 'check_violation';
  end if;
  select verification_status, suspended_until into p_verification, p_suspended_until
    from provider_profiles where user_id = new.provider_id;
  if p_verification is distinct from 'VERIFIED' then
    raise exception 'provider % is not verified', new.provider_id using errcode = 'check_violation';
  end if;
  if p_suspended_until is not null and p_suspended_until > now() then
    raise exception 'provider % is suspended', new.provider_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bids_require_eligible_provider_trg before insert on bids
  for each row execute function bids_require_eligible_provider();

-- Offers are only accepted while the job is actually open for them.
create or replace function bids_require_open_job() returns trigger language plpgsql as $$
declare
  j_status job_status;
  j_window timestamptz;
begin
  select status, bid_window_ends_at into j_status, j_window from jobs where id = new.job_id;
  if j_status not in ('OPEN_FOR_BIDS','BID_RECEIVED','NEGOTIATING') then
    raise exception 'job % is not accepting offers (status %)', new.job_id, j_status using errcode = 'check_violation';
  end if;
  if j_window is not null and j_window < now() then
    raise exception 'the offer window for job % has closed', new.job_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bids_require_open_job_trg before insert on bids
  for each row execute function bids_require_open_job();

alter table kyc_records enable row level security;
alter table bids enable row level security;
alter table bid_revisions enable row level security;
