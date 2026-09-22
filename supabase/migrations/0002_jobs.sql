-- 0002_jobs
-- Milestone 2: the customer job request - the job aggregate, its media and its status trail.
-- Forward-only; never edit after applying.

create type job_status as enum (
  'DRAFT','SUBMITTED','QUALIFYING','OPEN_FOR_BIDS','BID_RECEIVED','NEGOTIATING','PAYMENT_PENDING',
  'CONFIRMED','PROVIDER_ASSIGNED','EN_ROUTE','ARRIVED','STARTED','IN_PROGRESS',
  'PRICE_REVISION_PENDING','COMPLETION_PENDING','CUSTOMER_APPROVAL_PENDING','COMPLETED','SETTLED',
  'CANCELLED_BY_CUSTOMER','CANCELLED_BY_PROVIDER','AUTO_CANCELLED','DISPUTED','REFUNDED','ABANDONED'
);
create type payment_status as enum (
  'NONE','PENDING','AUTHORIZED','CAPTURED','SETTLED','FAILED','REFUNDED','PARTIALLY_REFUNDED','DISPUTE_HOLD'
);
create type job_priority as enum ('NORMAL','URGENT');
create type job_request_type as enum ('LABOUR_ONLY','LABOUR_AND_MATERIAL');
create type media_kind as enum ('PHOTO','VIDEO','VOICE_NOTE','DOCUMENT','INVOICE');
create type media_phase as enum ('REQUEST','PROGRESS','COMPLETION','DISPUTE','PRICE_REVISION');
create type media_review_status as enum ('PENDING','APPROVED','FLAGGED','REJECTED');

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id),

  -- booking on behalf of someone else
  booked_for_name text,
  booked_for_phone_e164 text check (booked_for_phone_e164 is null or booked_for_phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  recipient_tracking_token text unique,

  category_id uuid not null references service_categories(id),
  skill_ids uuid[] not null default '{}',
  description text,
  priority job_priority not null default 'NORMAL',
  request_type job_request_type not null default 'LABOUR_ONLY',
  inspection_required boolean not null default false,
  hazards text[] not null default '{}',

  preferred_start timestamptz,
  preferred_end timestamptz,
  check (preferred_end is null or preferred_start is null or preferred_end > preferred_start),

  address_id uuid references addresses(id),
  -- the address is snapshotted at submission: later edits to the saved address must not
  -- silently move a live job (EDGE_CASE_MATRIX JOB-04)
  address_snapshot jsonb,
  lat double precision,
  lng double precision,
  geohash text,

  status job_status not null default 'DRAFT',
  payment_status payment_status not null default 'NONE',

  bid_window_ends_at timestamptz,
  confirmed_provider_id uuid references users(id),
  active_quote_id uuid,

  cancelled_reason text,
  cancelled_by_role user_role,
  submitted_at timestamptz,
  completed_at timestamptz,
  settled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_idx on jobs(status, created_at desc);
create index jobs_category_status_idx on jobs(category_id, status);
create index jobs_customer_idx on jobs(customer_id, created_at desc) where deleted_at is null;
create index jobs_geohash_idx on jobs(geohash) where status in ('OPEN_FOR_BIDS','BID_RECEIVED','NEGOTIATING');
create index jobs_bid_window_idx on jobs(bid_window_ends_at) where status in ('OPEN_FOR_BIDS','BID_RECEIVED');
create trigger jobs_updated before update on jobs for each row execute function set_updated_at();

-- A customer may keep only one draft per category+address at a time, which also gives the
-- "resume your unfinished request" behaviour for free.
create unique index jobs_one_draft_per_target_idx
  on jobs(customer_id, category_id, coalesce(address_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'DRAFT' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- job_media
-- ---------------------------------------------------------------------------
create table job_media (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  uploader_id uuid not null references users(id),
  uploader_role user_role not null,
  kind media_kind not null,
  phase media_phase not null default 'REQUEST',
  storage_key text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds int check (duration_seconds is null or duration_seconds > 0),
  sha256 text,
  lat double precision,
  lng double precision,
  transcript text,
  review_status media_review_status not null default 'PENDING',
  uploaded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index job_media_job_idx on job_media(job_id, phase) where deleted_at is null;
-- the same file uploaded twice to the same job is almost always a retry (NET-06)
create unique index job_media_job_hash_idx on job_media(job_id, sha256) where sha256 is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- job_status_events (append-only trail; PRODUCT_SPEC section 9)
-- ---------------------------------------------------------------------------
create table job_status_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  actor_user_id uuid references users(id),
  actor_role user_role,
  from_status job_status,
  to_status job_status not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index job_status_events_job_idx on job_status_events(job_id, created_at);
revoke update, delete on job_status_events from public;

-- ---------------------------------------------------------------------------
-- Guard rails
-- ---------------------------------------------------------------------------

-- A job may only leave DRAFT once it carries enough for a provider to quote on
-- (EDGE_CASE_MATRIX JOB-01).
create or replace function jobs_require_submittable() returns trigger language plpgsql as $$
declare
  media_count int;
begin
  if new.status <> 'DRAFT' and old.status = 'DRAFT' then
    if new.address_id is null or new.address_snapshot is null then
      raise exception 'job % cannot be submitted without an address', new.id using errcode = 'check_violation';
    end if;
    select count(*) into media_count from job_media where job_id = new.id and deleted_at is null;
    if coalesce(length(btrim(new.description)), 0) < 12 and media_count = 0 then
      raise exception 'job % needs a description or at least one photo/voice note', new.id using errcode = 'check_violation';
    end if;
    if new.submitted_at is null then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger jobs_require_submittable_trg before update on jobs
  for each row execute function jobs_require_submittable();

-- Media can only be attached to a job that is still accepting it for that phase.
create or replace function job_media_phase_allowed() returns trigger language plpgsql as $$
declare
  s job_status;
begin
  select status into s from jobs where id = new.job_id;
  if new.phase = 'REQUEST' and s not in ('DRAFT','SUBMITTED','QUALIFYING') then
    raise exception 'request media cannot be added to a job in status %', s using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger job_media_phase_allowed_trg before insert on job_media
  for each row execute function job_media_phase_allowed();

alter table jobs enable row level security;
alter table job_media enable row level security;
alter table job_status_events enable row level security;
