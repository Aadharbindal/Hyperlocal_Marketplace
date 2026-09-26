-- 0014_multi_node.sql
-- What has to exist in the database once the API is more than one process.
--
-- Forward-only. Nothing in 0001-0013 is rewritten.

-- ---------------------------------------------------------------------------
-- A rate limit that means what it says
-- ---------------------------------------------------------------------------

-- The in-process limiter counts hits in a Map, which is correct for one node and quietly wrong
-- for two: an attacker gets the limit multiplied by however many nodes are running, and the
-- number on the screen is not the number being enforced. That is tolerable for the global
-- fairness limit - it exists to stop one client being rude, and being twice as generous is a
-- performance question. It is not tolerable for the OTP limits, which exist to stop somebody
-- brute-forcing their way into an account.
--
-- So the shared counter is used where the limit is a security control, and the cheap in-process
-- one stays where it is a fairness control. Postgres rather than Redis because the pilot has a
-- database and does not have a Redis, and one more piece of infrastructure to run, monitor and
-- fail over is a real cost against a table with two columns.
create table if not exists rate_limit_hits (
  -- What is being limited: already namespaced by the caller, e.g. 'otp:+919812345678'.
  key text not null,
  -- The start of the fixed window this row counts. Fixed windows rather than a sliding log:
  -- a sliding window needs a row per request and a periodic sweep, and buys precision that a
  -- brute-force limit does not need.
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- The sweep. Rows are only interesting inside their own window, so anything older is litter.
create index if not exists rate_limit_hits_window_idx on rate_limit_hits (window_start);

-- ---------------------------------------------------------------------------
-- Notes on the two primitives that need no tables
-- ---------------------------------------------------------------------------

-- *Scheduler exclusion* uses `pg_try_advisory_lock`, which lives in the session rather than in a
-- table. That is the right shape here: a lock held by a node that dies is released by Postgres
-- when the connection drops, with no lease to expire and no stuck row for somebody to clear by
-- hand at two in the morning.

-- *Stream fan-out* uses LISTEN/NOTIFY. An SSE subscriber is attached to one node, and an event
-- is published on whichever node handled the write, so without this a customer watching their
-- job sees nothing whenever the two differ. NOTIFY delivers to every listening node including
-- the sender, which is why the publishing node does not also deliver locally - it would send
-- the same event twice.

-- ---------------------------------------------------------------------------
-- A schedule that is the cluster's, not each node's
-- ---------------------------------------------------------------------------

-- The advisory lock stops two nodes running the same task at the same moment, and on its own
-- that is not enough. Each node kept "when did this last run" in a Map, so a second node
-- believed nothing had ever run and would fire every task on its first tick - and then again on
-- the next one, and the next. The work is idempotent so nothing breaks, but `everySeconds`
-- stops describing reality, which is its whole job.
--
-- Moving the state here makes the schedule a property of the system rather than of whichever
-- process happens to be asking. It is read and written inside the lock, so there is no race to
-- worry about and no need for optimistic concurrency on it.
create table if not exists scheduler_runs (
  task text primary key,
  last_run_at timestamptz not null,
  last_duration_ms integer not null default 0,
  last_error text,
  runs bigint not null default 0
);
