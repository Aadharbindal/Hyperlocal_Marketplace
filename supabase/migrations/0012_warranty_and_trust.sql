-- 0012_warranty_and_trust.sql
-- The warranty the platform has been promising, a moderation queue somebody actually reads,
-- and a way back in when an admin loses their phone.
--
-- Forward-only. Nothing in 0001-0011 is rewritten.

-- ---------------------------------------------------------------------------
-- Warranty claims
-- ---------------------------------------------------------------------------

-- Every accepted quote has carried `warranty_days` since M4, and every completion has carried a
-- `warranty_note`. Neither did anything: a customer whose tap leaked again a week later had no
-- button, so they rang the professional directly - which is precisely the leakage PRODUCT_SPEC
-- section 17 exists to prevent. A warranty nobody can claim is not a warranty, it is a line in
-- a marketing page.
--
-- A claim is deliberately *not* a dispute. A dispute is an argument about what happened; a
-- warranty claim is "the work was fine and it has come back", which usually ends with the same
-- professional returning at no charge. Filing it as a dispute would put a strike-shaped cloud
-- over a professional who has done nothing wrong, and they would stop offering warranties.

create type warranty_claim_status as enum (
  'OPEN',            -- customer has raised it, the professional has not answered yet
  'ACCEPTED',        -- the professional agrees to return under warranty
  'DECLINED',        -- the professional says it is not covered; support may still step in
  'REVISIT_BOOKED',  -- a return visit exists
  'RESOLVED',        -- fixed
  'ESCALATED',       -- support is handling it
  'EXPIRED'          -- the warranty period ended before this was resolved
);

create table warranty_claims (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  customer_id uuid not null references users(id),
  provider_id uuid not null references users(id),

  description text not null,
  media_ids uuid[] not null default '{}',

  status warranty_claim_status not null default 'OPEN',
  -- Copied from the quote at claim time. The window is what was agreed on the day, and a later
  -- change to the provider's standard terms must not shorten a warranty somebody already holds.
  warranty_days int not null,
  covered_until timestamptz not null,

  provider_response text,
  responded_at timestamptz,
  decline_reason text,

  -- The return visit, when there is one. A revisit is a job of its own so it has its own status,
  -- its own evidence and its own completion - but it carries no money.
  revisit_job_id uuid references jobs(id),

  resolved_at timestamptz,
  resolution_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- One open claim per job. A second thing going wrong while the first is unresolved belongs on
-- the same claim, not on a new one.
create unique index warranty_claims_one_open_idx on warranty_claims(job_id)
  where status in ('OPEN', 'ACCEPTED', 'REVISIT_BOOKED', 'ESCALATED');
create index warranty_claims_customer_idx on warranty_claims(customer_id, created_at desc);
create index warranty_claims_provider_idx on warranty_claims(provider_id, status);
create trigger warranty_claims_updated before update on warranty_claims for each row execute function set_updated_at();

-- A claim cannot be raised after the window closes. Enforced here as well as in the service,
-- because "was this still under warranty" is exactly the question somebody will argue about.
create or replace function warranty_claim_in_window() returns trigger language plpgsql as $$
begin
  if new.covered_until < now() then
    raise exception 'the warranty period for job % has ended', new.job_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger warranty_claim_in_window_trg before insert on warranty_claims
  for each row execute function warranty_claim_in_window();

-- A claim is evidence in a later dispute about whether the platform honoured its promise.
revoke delete on warranty_claims from public;
alter table warranty_claims enable row level security;

-- Marks a job as a free return visit under warranty, so nothing tries to charge for it.
alter table jobs add column if not exists warranty_claim_id uuid references warranty_claims(id);

-- ---------------------------------------------------------------------------
-- Flagged messages somebody actually reads
-- ---------------------------------------------------------------------------

-- Messages carrying a phone number, an email or a UPI handle have been flagged since M5 and
-- nobody has ever looked at one. A flag that is never read is worse than no flag: it is the
-- appearance of moderation without the fact of it.
alter table chat_messages add column if not exists reviewed_by uuid references users(id);
alter table chat_messages add column if not exists reviewed_at timestamptz;
alter table chat_messages add column if not exists review_outcome text
  check (review_outcome is null or review_outcome in ('ALLOWED', 'WARNED', 'STRIKE', 'SUSPENDED'));

create index chat_messages_flagged_idx on chat_messages(created_at desc)
  where flagged and reviewed_at is null;

-- ---------------------------------------------------------------------------
-- Getting back in after losing the phone
-- ---------------------------------------------------------------------------

-- Admin MFA has had TOTP, single-use codes and a five-failure lock since M8, and no way back in
-- at all: a lost phone meant editing the database by hand, at speed, under pressure - which is
-- the situation in which mistakes get made on production.
--
-- Codes are stored hashed. We can tell somebody a code was accepted; we can never tell them what
-- their codes are, which is the same promise we make about passwords everywhere else.
create table admin_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  -- Which sign-in burnt it, for the audit trail.
  used_from_ip text,
  created_at timestamptz not null default now()
);

create index admin_recovery_codes_user_idx on admin_recovery_codes(user_id) where used_at is null;
-- A used code stays on the record: "this code was burnt on that day" is part of the story.
revoke delete on admin_recovery_codes from public;
alter table admin_recovery_codes enable row level security;

-- ---------------------------------------------------------------------------
-- Answering "what do you hold about me"
-- ---------------------------------------------------------------------------

-- Deletion has existed since M1; access has not. The DPDP Act 2023 gives people the right to
-- know what is held about them, and an export request is worth recording for the same reason a
-- deletion request is.
create table data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'READY' check (status in ('READY', 'FAILED')),
  requested_at timestamptz not null default now(),
  -- What was in it, so a later question about a past export can be answered.
  record_counts jsonb not null default '{}'::jsonb
);

create index data_export_requests_user_idx on data_export_requests(user_id, requested_at desc);
revoke update, delete on data_export_requests from public;
alter table data_export_requests enable row level security;
