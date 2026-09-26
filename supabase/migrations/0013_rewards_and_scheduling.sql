-- 0013_rewards_and_scheduling.sql
-- Paying a referral without inventing money, and letting a professional propose a new time
-- instead of cancelling.
--
-- Forward-only. Nothing in 0001-0012 is rewritten.

-- ---------------------------------------------------------------------------
-- Referral rewards that pay themselves
-- ---------------------------------------------------------------------------

-- A referral has been reaching QUALIFIED and stopping there, with support expected to credit it
-- by hand. That is a promise the platform makes on a screen and keeps in a spreadsheet, which is
-- exactly the kind of thing that stops happening in a busy week.
--
-- The reward is issued as a **promo code reserved for one person** rather than as a new kind of
-- money. That is deliberate: the promo path is already built and tested end to end - validation,
-- one redemption per booking, and the rule that a discount is the platform's cost and never the
-- provider's. A wallet balance would be a second money primitive with its own ledger path, its
-- own rounding and its own bugs, to express something the existing one already expresses.
alter table promo_codes add column if not exists reserved_for_user_id uuid references users(id) on delete cascade;

-- A reserved code belongs to one person and is not worth showing in the public list.
create index if not exists promo_codes_reserved_idx on promo_codes(reserved_for_user_id)
  where reserved_for_user_id is not null;

-- Which referral a code came from, so "where did this code come from" has an answer.
alter table promo_codes add column if not exists referral_id uuid references referrals(id);

-- ---------------------------------------------------------------------------
-- A professional proposing a new time
-- ---------------------------------------------------------------------------

-- Rescheduling has been the customer's alone since it was built. A professional whose van broke
-- down had exactly one option: cancel - which costs them the job, costs the customer their
-- booking, and puts a cancellation on a record that should have shown a rearranged visit.
--
-- A proposal is not a reschedule. The customer's time is theirs to arrange, so this asks rather
-- than tells, and nothing moves until they answer.

create type schedule_proposal_status as enum ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

create table schedule_proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  proposed_by uuid not null references users(id),

  previous_start timestamptz,
  new_start timestamptz not null,
  new_end timestamptz,
  -- Why. A customer deciding whether to accept a new time deserves to know why it moved.
  reason text not null,

  status schedule_proposal_status not null default 'PENDING',
  responded_at timestamptz,
  decline_reason text,

  -- A proposal nobody answers cannot hang over a booking forever.
  expires_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz,

  constraint schedule_proposal_moves_forward check (new_end is null or new_end > new_start)
);

-- One open proposal per job: a second would leave the customer choosing between two times the
-- professional may no longer both have free.
create unique index schedule_proposals_one_open_idx on schedule_proposals(job_id)
  where status = 'PENDING';
create index schedule_proposals_job_idx on schedule_proposals(job_id, created_at desc);
create trigger schedule_proposals_updated before update on schedule_proposals for each row execute function set_updated_at();

-- What was proposed and who answered is part of the job's story.
revoke delete on schedule_proposals from public;
alter table schedule_proposals enable row level security;
