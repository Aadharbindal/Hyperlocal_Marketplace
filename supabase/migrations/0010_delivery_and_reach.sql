-- 0010_delivery_and_reach.sql
-- Making a notification actually reach somebody, and letting two people on a job talk
-- without either of them learning the other's phone number.
--
-- Until now the push adapter had nowhere to send to: a device token was never stored, so every
-- "notification" lived only inside the app's own list. And the telephony adapter existed with no
-- way to reach it, so the anti-leakage promise in PRODUCT_SPEC section 17 was a promise the
-- product could not keep.
--
-- Forward-only. Nothing in 0001-0009 is rewritten.

-- ---------------------------------------------------------------------------
-- Where a person's phone actually is
-- ---------------------------------------------------------------------------

create type device_platform as enum ('IOS', 'ANDROID', 'WEB');

create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The push service's own handle for this installation.
  token text not null,
  platform device_platform not null,
  -- So a person can see and revoke their own devices without guessing which is which.
  device_label text,
  app_version text,
  -- A token that stopped working. Kept rather than deleted, so a device that comes back is
  -- recognised instead of duplicated.
  disabled_at timestamptz,
  disabled_reason text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- One row per token, whoever it belongs to. A handset that changes hands moves to the new
-- account rather than notifying both.
create unique index device_tokens_token_idx on device_tokens(token);
create index device_tokens_user_idx on device_tokens(user_id) where disabled_at is null;
create trigger device_tokens_updated before update on device_tokens for each row execute function set_updated_at();

alter table device_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- What a person agreed to be sent
-- ---------------------------------------------------------------------------

-- Defaults are deliberate: everything about a job someone is on is on, because missing "your
-- technician is outside" is a real cost to them. Marketing is off until they say otherwise.
alter table users add column if not exists push_job_updates boolean not null default true;
alter table users add column if not exists push_offers boolean not null default true;
alter table users add column if not exists push_marketing boolean not null default false;

-- ---------------------------------------------------------------------------
-- Talking without exchanging numbers
-- ---------------------------------------------------------------------------

create type call_status as enum ('REQUESTED', 'CONNECTED', 'FAILED', 'ENDED');

create table masked_calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  caller_id uuid not null references users(id),
  callee_id uuid not null references users(id),
  -- The number the provider's telephony service put in the middle. Never either real number:
  -- those are looked up at the moment of the call and not written down here.
  virtual_number text,
  provider_session_id text,
  status call_status not null default 'REQUESTED',
  failure_reason text,
  -- Duration only. No recording: a recorded call is a privacy liability we have no consent for
  -- and no process to handle (PRIVACY_DATA_MAP).
  duration_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index masked_calls_job_idx on masked_calls(job_id, created_at desc);
create index masked_calls_caller_idx on masked_calls(caller_id, created_at desc);
create trigger masked_calls_updated before update on masked_calls for each row execute function set_updated_at();

-- A call log is evidence in a dispute about what was said and when, so it is not editable
-- after the fact beyond the status the service writes.
revoke delete on masked_calls from public;
alter table masked_calls enable row level security;

-- ---------------------------------------------------------------------------
-- Moving a booking instead of losing it
-- ---------------------------------------------------------------------------

-- A customer who cannot be home on Tuesday should not have to cancel and start again, and the
-- provider who already blocked the slot deserves to be told rather than to find out.
create table job_reschedules (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  requested_by uuid not null references users(id),
  previous_start timestamptz,
  previous_end timestamptz,
  new_start timestamptz not null,
  new_end timestamptz,
  reason text,
  created_at timestamptz not null default now()
);

create index job_reschedules_job_idx on job_reschedules(job_id, created_at desc);

-- The history of when a job was meant to happen is part of the job's story, so it is kept.
revoke update, delete on job_reschedules from public;
alter table job_reschedules enable row level security;

-- How many times a booking has been moved, so the limit can be enforced without counting rows
-- on every request.
alter table jobs add column if not exists reschedule_count int not null default 0;
