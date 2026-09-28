-- 0019_arrival_tracking.sql
-- "How far away are they?" - answered, and answered as narrowly as possible.
--
-- Forward-only. Nothing in 0001-0018 is rewritten.

-- ---------------------------------------------------------------------------
-- The last known position of somebody on their way to a booking
-- ---------------------------------------------------------------------------

-- EN_ROUTE has existed since 0002 with nothing behind it. The app could say "on the way" and had
-- no way to say whether that meant five minutes or fifty, to a customer who has taken the
-- afternoon off to wait at home. That is the single most-asked question in this product and the
-- one it could not answer.
--
-- The shape of this table is the argument. It is the **worker's** location - a person being
-- tracked by the platform they earn from - so:
--
--   * one row per job, not per ping. There is no trail. `set_updated_at` overwrites the previous
--     position, so at any moment the database knows where somebody is and has no idea where they
--     have been. A history would be a surveillance record that nobody asked for and that a
--     subpoena or a breach could reach.
--   * coordinates arrive already rounded to ~110 m (LOCATION_PRECISION_DECIMALS in core). Enough
--     to say "2.4 km away", not enough to say which building.
--   * the row is deleted the moment the job stops being EN_ROUTE, by the trigger below. Not
--     retained, not archived, not anonymised later - gone.
--
-- Deliberately **not** on `jobs`: a column there would survive the booking, be swept into every
-- job query, and turn up in exports and support screens that have no business holding it.
create table job_arrival_pings (
  job_id uuid primary key references jobs(id) on delete cascade,
  provider_id uuid not null references users(id),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  -- What the phone itself said about how sure it was. A wild value means a cell-tower guess, and
  -- the reader throws it away rather than building a confident number on nothing.
  accuracy_m integer not null check (accuracy_m >= 0),
  reported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger job_arrival_pings_updated before update on job_arrival_pings for each row execute function set_updated_at();

-- No index beyond the primary key on purpose. Every read is "where is the person on this one
-- booking", by job_id. An index that made it easy to ask "who was near this place" would be
-- building the query this table exists to make impossible.

-- ---------------------------------------------------------------------------
-- Deletion is enforced by the database, not remembered by the application
-- ---------------------------------------------------------------------------

-- The rule is "position exists only while somebody is on their way". Leaving that to application
-- code means it holds until the first path that forgets - a support override, a re-dispatch, an
-- admin cancellation - and the failure is silent, because a stale row looks exactly like a
-- current one. So the status change itself removes it.
create or replace function job_arrival_pings_clear() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status <> 'EN_ROUTE' then
    delete from job_arrival_pings where job_id = new.id;
  end if;
  return new;
end $$;

create trigger jobs_clear_arrival_ping after update of status on jobs
  for each row execute function job_arrival_pings_clear();

-- And the same rule on the way in: a row may only exist for a job that is actually EN_ROUTE.
-- Without this, a provider's phone could keep posting after they arrived and the trigger above
-- would never fire again to clean it up.
create or replace function job_arrival_pings_guard() returns trigger language plpgsql as $$
begin
  if (select status from jobs where id = new.job_id) <> 'EN_ROUTE' then
    raise exception 'position may only be reported while a job is EN_ROUTE' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger job_arrival_pings_only_en_route before insert or update on job_arrival_pings
  for each row execute function job_arrival_pings_guard();
