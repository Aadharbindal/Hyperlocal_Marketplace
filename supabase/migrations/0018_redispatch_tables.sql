-- 0018_redispatch_tables.sql
-- Everything that refers to the REDISPATCHING status added in 0017, plus what a dropped booking
-- costs the professional who dropped it.
--
-- Forward-only. Nothing in 0001-0017 is rewritten. Separate from 0017 only because Postgres
-- refuses to let a new enum value be used in the transaction that created it.

-- ---------------------------------------------------------------------------
-- The state of a re-dispatch in flight
-- ---------------------------------------------------------------------------

alter table jobs add column if not exists redispatch_deadline timestamptz;
-- How many times this booking has been dropped. Not decoration: a job on its third provider is
-- a job something is wrong with, and support should see it before the customer gives up.
alter table jobs add column if not exists redispatch_count integer not null default 0;

-- A booking cannot sit in REDISPATCHING with no clock on it, because the failure mode is a
-- customer watching a spinner all afternoon while their authorised payment stays held.
alter table jobs
  add constraint jobs_redispatch_needs_deadline
  check (status <> 'REDISPATCHING' or redispatch_deadline is not null);

create index jobs_redispatching_idx on jobs (redispatch_deadline) where status = 'REDISPATCHING';

-- ---------------------------------------------------------------------------
-- Who was asked, and what they said
-- ---------------------------------------------------------------------------

-- Kept rather than inferred from bid statuses, for three reasons. A provider who declines must
-- not be asked again on the same job. A provider who ignored it is a different fact from one who
-- said no, and reliability scoring should be able to tell them apart. And when a customer asks
-- support "why did this take two hours", the answer has to be a list of times and names rather
-- than a guess.
create table redispatch_invitations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  provider_id uuid not null references users(id),
  bid_id uuid not null references bids(id),
  -- What this provider would be paid if they take it. Frozen at invitation time, and it is their
  -- own original terms rather than the price the person who dropped out had agreed: nobody is
  -- press-ganged into somebody else's number, and the customer is never asked for more than they
  -- already authorised because a dearer bid is simply not invited.
  total_paise integer not null check (total_paise > 0),
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  outcome text check (outcome is null or outcome in ('ACCEPTED','DECLINED','EXPIRED','SUPERSEDED')),
  created_at timestamptz not null default now()
);

-- Asked once per job. A second invitation to the same person is a bug, not a retry.
create unique index redispatch_invitations_unique on redispatch_invitations (job_id, provider_id);
create index redispatch_invitations_open on redispatch_invitations (provider_id, expires_at) where responded_at is null;
create index redispatch_invitations_job on redispatch_invitations (job_id, invited_at);

-- Exactly one invitation per job may be accepted. Two professionals turning up to the same
-- address is worse than none, and it is not a race the application layer should be trusted to
-- win on its own.
create unique index redispatch_invitations_one_winner
  on redispatch_invitations (job_id)
  where outcome = 'ACCEPTED';

-- ---------------------------------------------------------------------------
-- What dropping a confirmed booking costs the professional: nothing new
-- ---------------------------------------------------------------------------

-- Deliberately no table here.
--
-- The first draft of this migration added a `provider_strikes` table, on the belief that nothing
-- happened to a provider who walked away from a confirmed booking. That was wrong: `strikes`
-- has existed since 0007, `cancelWithMoney` has always issued a MAJOR strike for exactly this,
-- and `STRIKE_RELIABILITY_COST` / `shouldSuspend` already take the reliability score down and
-- suspend on the third strike in ninety days.
--
-- A second strike table beside the first is how a system ends up with two answers to "is this
-- person reliable", and the ranking reads only one of them. Re-dispatch therefore reuses
-- `finance.addStrike` and adds no penalty machinery of its own.
