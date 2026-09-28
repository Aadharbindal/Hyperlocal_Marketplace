-- 0020_service_plans.sql
-- Work that comes back: the AC every three months, the deep clean every month.
--
-- Forward-only. Nothing in 0001-0019 is rewritten.

-- ---------------------------------------------------------------------------
-- A standing arrangement, not a subscription
-- ---------------------------------------------------------------------------

-- Almost everything a home needs is repeat work. Servicing, filter changes, seasonal cleaning -
-- the customer knows it is due and forgets until something breaks, and the professional who did
-- it last time has no idea it is coming. `POST /jobs/from/:id` already exists for booking the
-- same thing again, but somebody has to remember to press it.
--
-- The shape here is deliberately the boring one. A plan is a **reminder that books itself**: when
-- an occurrence falls due the system creates an ordinary job, and that job is quoted, negotiated
-- and paid for exactly like any other. Nothing about the existing flow is bypassed.
--
-- In particular there is **no stored payment mandate and no automatic charge**. Recurring debits
-- against a saved card in India sit under the RBI e-mandate rules - registration, a pre-debit
-- notification, per-transaction limits, and a separate approval journey - and none of that is
-- built or reviewed here. Pretending otherwise by quietly charging a card would be the single
-- most damaging thing this product could do. The customer pays per visit, as they do today.
create table service_plans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id),
  category_id uuid not null references service_categories(id),
  skill_ids uuid[] not null default '{}',
  address_id uuid not null references addresses(id),
  description text check (description is null or length(btrim(description)) <= 500),

  -- How often, in days. An interval rather than a cron expression or an enum: "every 90 days"
  -- covers quarterly servicing, "every 30" covers a monthly clean, and a customer who wants the
  -- 3rd of the month is better served by moving the due date than by the schema learning about
  -- calendars. Bounded because a plan that fires weekly is a staffing arrangement and one that
  -- fires every three years is a note to self.
  interval_days integer not null check (interval_days between 14 and 365),

  -- Who did it last time, and who is told first when the next one opens. A preference, never a
  -- reservation: they may be unavailable, may have left, and the booking still has to happen.
  preferred_provider_id uuid references users(id),

  -- The next date work should actually happen. Stored as a date, not a timestamp: nobody plans
  -- a geyser service to the minute, and a timestamp would drift across a timezone change.
  next_due_on date not null,

  -- How many days before that date the booking is opened, so there is time to find somebody.
  lead_days integer not null default 3 check (lead_days between 0 and 14),

  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED','CANCELLED')),
  paused_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger service_plans_updated before update on service_plans for each row execute function set_updated_at();

-- One live plan per kind of work per address. A customer with two "AC service" plans on the same
-- flat has made a mistake, and the second one would quietly double every future booking.
create unique index service_plans_one_per_target
  on service_plans (customer_id, category_id, address_id)
  where status <> 'CANCELLED';

create index service_plans_customer on service_plans (customer_id, status);
-- The sweep's query: active plans whose lead time has arrived. Partial, because a paused or
-- cancelled plan is never due.
create index service_plans_due on service_plans (next_due_on) where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- What the plan actually produced
-- ---------------------------------------------------------------------------

-- Kept rather than derived from the jobs table, because the interesting rows are the ones with
-- no job attached: the month the customer skipped, and the month the system tried and failed. A
-- plan that has silently produced nothing for half a year looks identical to a healthy one
-- unless the failures are written down.
create table service_plan_occurrences (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references service_plans(id) on delete cascade,
  due_on date not null,
  job_id uuid references jobs(id),
  outcome text not null check (outcome in ('BOOKED','SKIPPED','FAILED')),
  -- Why it failed, in the words support would need. Null for the ordinary cases.
  detail text,
  created_at timestamptz not null default now()
);

-- Exactly once per due date. This is the guard that matters: the sweep runs every hour, and
-- without it a plan whose job creation failed halfway would book the same visit again on the
-- next tick, and again, until somebody noticed a customer with fourteen identical bookings.
create unique index service_plan_occurrences_once on service_plan_occurrences (plan_id, due_on);
create index service_plan_occurrences_plan on service_plan_occurrences (plan_id, due_on desc);

-- ---------------------------------------------------------------------------
-- Where a booking came from
-- ---------------------------------------------------------------------------

-- So a job created by a plan can say so on the customer's screen - "this is your regular AC
-- service" reads very differently from a booking they do not remember making - and so support
-- can tell an automatic booking from one somebody tapped.
alter table jobs add column if not exists service_plan_id uuid references service_plans(id);
create index jobs_service_plan on jobs (service_plan_id) where service_plan_id is not null;
