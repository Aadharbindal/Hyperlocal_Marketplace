-- 0008_admin.sql - Milestone 8
-- The support console's own safeguards: admin MFA, a record of who looked at an identity
-- document, and the queue state the console works through.
-- Forward-only. Nothing in 0001-0007 is rewritten.

-- ---------------------------------------------------------------------------
-- admin_mfa: a second factor for the accounts that can see documents and move money
-- ---------------------------------------------------------------------------
create table admin_mfa (
  user_id uuid primary key references users(id) on delete cascade,
  -- the TOTP secret, encrypted at rest with the server key; the plaintext is shown once at
  -- enrolment and never returned again
  secret_encrypted text not null,
  enabled_at timestamptz,
  -- the last time step a code was accepted for, so the same code cannot be used twice
  last_used_step bigint,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create trigger admin_mfa_updated before update on admin_mfa for each row execute function set_updated_at();

-- A session records when its second factor was satisfied; admin routes check the age of it.
alter table sessions add column if not exists mfa_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- kyc_access_log: every look at an identity document, by whom and why
-- ---------------------------------------------------------------------------
create table kyc_access_log (
  id uuid primary key default gen_random_uuid(),
  kyc_record_id uuid not null references kyc_records(id) on delete cascade,
  viewed_by uuid not null references users(id),
  purpose text not null,
  ip text,
  created_at timestamptz not null default now()
);
create index kyc_access_log_record_idx on kyc_access_log(kyc_record_id, created_at desc);
create index kyc_access_log_viewer_idx on kyc_access_log(viewed_by, created_at desc);
-- This log is the evidence that access was legitimate, so it is never edited or deleted.
revoke update, delete on kyc_access_log from public;

-- ---------------------------------------------------------------------------
-- Queue state for the console
-- ---------------------------------------------------------------------------
alter table disputes add column if not exists assigned_to uuid references users(id);
alter table disputes add column if not exists queue_note text;
create index if not exists disputes_assigned_idx on disputes(assigned_to, status);

-- A suspension is a two-person action, so the record has to name both.
alter table users add column if not exists suspended_by uuid references users(id);
alter table users add column if not exists suspension_approved_by uuid references users(id);
alter table users add column if not exists suspended_until timestamptz;

-- Nobody suspends themselves, and nobody suspends alone.
create or replace function users_suspension_needs_two() returns trigger language plpgsql as $$
begin
  if new.status = 'SUSPENDED' and (old.status is distinct from 'SUSPENDED') then
    if new.suspended_by is null or new.suspension_approved_by is null then
      raise exception 'a suspension must record who asked for it and who approved it'
        using errcode = 'check_violation';
    end if;
    if new.suspended_by = new.suspension_approved_by then
      raise exception 'a suspension needs two different people' using errcode = 'check_violation';
    end if;
    if new.suspended_by = new.id or new.suspension_approved_by = new.id then
      raise exception 'nobody may suspend themselves' using errcode = 'check_violation';
    end if;
    if length(coalesce(new.suspended_reason, '')) < 20 then
      raise exception 'a suspension must carry a reason' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger users_suspension_needs_two_trg before update on users
  for each row execute function users_suspension_needs_two();

alter table admin_mfa enable row level security;
alter table kyc_access_log enable row level security;
