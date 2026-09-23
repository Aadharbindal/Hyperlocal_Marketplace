-- 0005_execution.sql - Milestone 5
-- Doorstep to done: the start code, price revisions the customer must approve,
-- completion evidence, and the in-job chat.
-- Forward-only. Nothing in 0001-0004 is rewritten.

create type price_revision_status as enum ('PENDING','APPROVED','REJECTED','CLARIFICATION','CANCELLED','SUPPORT');
create type chat_party as enum ('CUSTOMER','PROVIDER','TECHNICIAN','SUPPORT');

-- ---------------------------------------------------------------------------
-- start_otps: one four-digit code per job, hashed, attempt-limited
-- ---------------------------------------------------------------------------
create table start_otps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  -- HMAC of the code with the server secret; the plaintext is only ever shown to the customer
  code_hash text not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  expires_at timestamptz not null,
  verified_at timestamptz,
  verified_by uuid references users(id),
  overridden_by uuid references users(id),
  override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint start_otps_attempts_sane check (attempts >= 0 and attempts <= max_attempts),
  -- an override has to say why, and cannot pretend the code was entered
  constraint start_otps_override_needs_reason check (overridden_by is null or length(coalesce(override_reason,'')) >= 10)
);
create unique index start_otps_one_per_job_idx on start_otps(job_id);
create trigger start_otps_updated before update on start_otps for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- price_revision_requests: no extra charge without a written approval
-- ---------------------------------------------------------------------------
create table price_revision_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  quote_id uuid not null references booking_quotes(id),
  requested_by uuid not null references users(id),
  reason text not null,
  extra_labour_paise bigint not null default 0 check (extra_labour_paise >= 0),
  extra_material_paise bigint not null default 0 check (extra_material_paise >= 0),
  extra_time_minutes int not null default 0 check (extra_time_minutes >= 0),
  original_total_paise bigint not null check (original_total_paise > 0),
  revised_total_paise bigint not null check (revised_total_paise > 0),
  explanation text not null,
  media_ids uuid[] not null default '{}',
  status price_revision_status not null default 'PENDING',
  responded_by uuid references users(id),
  responded_at timestamptz,
  response_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- a revision must actually add something, and must cost more than the locked quote
  constraint price_revision_adds_something check (extra_labour_paise + extra_material_paise > 0),
  constraint price_revision_is_higher check (revised_total_paise > original_total_paise)
);
-- one open request per job: a customer is never asked two questions about money at once
create unique index price_revision_one_open_idx on price_revision_requests(job_id)
  where status in ('PENDING','CLARIFICATION');
create index price_revision_job_idx on price_revision_requests(job_id, created_at desc);
create trigger price_revision_updated before update on price_revision_requests for each row execute function set_updated_at();

-- Only the customer on the job may answer a revision, and only the assigned provider
-- side may raise one. Enforced here as well as in the service.
create or replace function price_revision_actors_valid() returns trigger language plpgsql as $$
declare
  cust uuid;
  prov uuid;
begin
  select customer_id into cust from jobs where id = new.job_id;
  select provider_id into prov from job_assignments where job_id = new.job_id and status = 'ACTIVE';
  if new.requested_by = cust then
    raise exception 'a price revision cannot be raised by the customer' using errcode = 'check_violation';
  end if;
  if prov is null then
    raise exception 'job % has no active assignment', new.job_id using errcode = 'check_violation';
  end if;
  if new.responded_by is not null and new.responded_by <> cust then
    -- support/admin resolutions are recorded on the audit log, not here
    if not exists (select 1 from user_roles where user_id = new.responded_by and role in ('ADMIN','SUPPORT') and status = 'ACTIVE') then
      raise exception 'only the customer may answer a price revision' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger price_revision_actors_valid_trg before insert or update on price_revision_requests
  for each row execute function price_revision_actors_valid();

-- ---------------------------------------------------------------------------
-- job_completions: the evidence a settlement is later built on
-- ---------------------------------------------------------------------------
create table job_completions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  submitted_by uuid not null references users(id),
  summary text not null,
  warranty_note text,
  media_ids uuid[] not null default '{}',
  submitted_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint job_completion_needs_evidence check (array_length(media_ids, 1) >= 1)
);
create unique index job_completions_one_open_idx on job_completions(job_id) where approved_at is null;
create index job_completions_job_idx on job_completions(job_id, submitted_at desc);
create trigger job_completions_updated before update on job_completions for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- chat: one thread per job, open only while the job is live
-- ---------------------------------------------------------------------------
create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  participant_ids uuid[] not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index chat_threads_one_per_job_idx on chat_threads(job_id);
create trigger chat_threads_updated before update on chat_threads for each row execute function set_updated_at();

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null references users(id),
  sender_party chat_party not null,
  body text not null check (length(body) between 1 and 1000),
  media_id uuid references job_media(id),
  flagged boolean not null default false,
  flag_reason text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index chat_messages_thread_idx on chat_messages(thread_id, created_at);
-- messages are a record of what was agreed: they are never deleted, and only the read
-- receipt may ever change - the words themselves are immutable
revoke delete on chat_messages from public;
create or replace function chat_messages_immutable() returns trigger language plpgsql as $$
begin
  if new.body <> old.body or new.sender_id <> old.sender_id or new.thread_id <> old.thread_id
     or new.created_at <> old.created_at then
    raise exception 'chat messages cannot be edited' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger chat_messages_immutable_trg before update on chat_messages
  for each row execute function chat_messages_immutable();

-- A message may only be written by someone on the thread.
create or replace function chat_sender_on_thread() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from chat_threads t where t.id = new.thread_id and new.sender_id = any(t.participant_ids)) then
    raise exception 'sender % is not on thread %', new.sender_id, new.thread_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger chat_sender_on_thread_trg before insert on chat_messages
  for each row execute function chat_sender_on_thread();

alter table start_otps enable row level security;
alter table price_revision_requests enable row level security;
alter table job_completions enable row level security;
alter table chat_threads enable row level security;
alter table chat_messages enable row level security;
