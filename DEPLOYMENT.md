# Deployment

## Local (demo mode, no external services)

```bash
npm install
cp .env.example .env
npm run api:dev            # http://localhost:4000, DATA_MODE=memory, mock adapters
npm run mobile:start       # Expo dev server; press a/i/w or scan QR
```

Set `EXPO_PUBLIC_API_URL` to your machine's LAN IP (e.g. `http://192.168.1.10:4000`) when testing
on a physical device.

Demo login: any Indian mobile number, OTP `123456` (mock SMS). Seeded demo accounts are listed
in `apps/api/src/data/seed.ts` (customer, provider, contractor, technician, vendor, admin,
support).

## Local with Postgres (Supabase CLI)

```bash
npx supabase start                      # requires Docker
npx supabase db reset                   # applies supabase/migrations + seed
DATA_MODE=postgres DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run api:dev
```

## Staging

1. Create a Supabase project; run `npx supabase db push` with the project ref.
2. Deploy `apps/api` (Docker image from `apps/api/Dockerfile`) to Render/Fly/Railway/ECS with
   the staging `.env`. Use sandbox credentials for payment/SMS; adapters may stay `mock` only
   with `ALLOW_MOCK_IN_PRODUCTION=true` on staging, never on production.
3. Build the app with EAS: `eas build --profile preview` (profiles in `apps/mobile/eas.json`).
4. Run smoke tests: `npm run test:integration` against staging with `DATA_MODE=postgres`.

## Production

- Separate Supabase project and secrets. Rotate `API_JWT_SECRET` at least quarterly.
- API behind HTTPS (managed platform TLS). Health checks: `/health` (liveness), `/ready`
  (DB + adapters).
- Migrations: `npx supabase db push` during a maintenance window; `npm run migrate:check` in CI
  blocks renamed/edited applied migrations.
- Backups: Supabase PITR enabled; monthly restore drill recorded in `PROGRESS_LOG.md`.
- Monitoring: `ERROR_MONITORING_PROVIDER=sentry`, alerts on 5xx rate, webhook failures,
  settlement failures.
- Mobile: `eas build --profile production`, `eas submit`. Enforce min app version via
  `X-App-Version` header (426 response).

## CI (GitHub Actions, `.github/workflows/ci.yml`)

typecheck → lint → unit → integration → build → migrate:check → `npm audit --audit-level=high`.

## Background worker

The API runs its own scheduler in-process (`SCHEDULER_ENABLED`, `SCHEDULER_TICK_SECONDS`), and
it is now safe to leave on everywhere. Every node ticks; a Postgres advisory lock admits one, and
the rest return immediately. Losing that race is the normal case, not an error.

The lock alone was not enough. Each node used to keep "when did this last run" in memory, so a
second node believed nothing had ever run and would fire every task on its first tick, and again
on the next. That state lives in `scheduler_runs` now, read and written inside the lock, so the
schedule belongs to the cluster rather than to whichever process is asking. `GET /admin/scheduler`
reports the cluster's view for the same reason.

| Task | Every | What it does |
| --- | --- | --- |
| `expire-bid-windows` | 60 s | Auto-cancels a job nobody answered; leaves one with offers alone |
| `expire-offers` | 60 s | Expires counter-offers and hands the job back to its offers |
| `expire-material` | 2 min | Expires stale material quotes and unanswered requests |
| `abandon-drafts` | 1 h | Marks drafts older than 72 h abandoned |
| `run-settlements` | 15 min | Sends payouts that are due and clear of disputes |
| `reconcile-payments` | 2 min | Asks the gateway about payments with no webhook; hands 30-minute-old ones to support |
| `chase-approvals` | 1 h | Reminds a customer sitting on a finished job, then opens a ticket |
| `retention-sweep` | 1 h | Executes retention events whose time has come |

`GET /admin/scheduler` shows every task with its last run, duration and error.
`POST /admin/scheduler/run` forces a sweep (staff + MFA), which is what to use during an incident
rather than restarting the process.

**On more than one node**, leave `SCHEDULER_ENABLED=true` everywhere. The previous advice here
was to turn it off on all but one node, which worked but meant the background worker had a single
point of failure that nothing would tell you about: the one node with it enabled dies, payouts
quietly stop, and every other node looks healthy.

## Live updates

`GET /events` is a Server-Sent Events stream, one per signed-in user. It carries no data, only
"this changed", so the client re-reads the endpoint it already trusts.

**Across nodes** the stream is fanned out with Postgres LISTEN/NOTIFY. A stream is held open by
one node and the write that causes an event is handled by whichever node took the request, so on
two nodes those are usually different and without this a customer watching their job would simply
see nothing. Events therefore always go over the bus, including to the publishing node's own
subscribers - NOTIFY delivers back to the sender, so publishing locally *as well* would send
everything twice.

Each node holds one connection open for LISTEN. Count it when sizing the pool (below). If the bus
cannot be reached at boot the node fails to start rather than serving with silent streams, and a
publish failure afterwards is logged and reported to monitoring, because a bus that has stopped
working is invisible from outside: every request still succeeds and every screen just stops.

Behind a proxy:

- disable response buffering for `/events` (`proxy_buffering off` in nginx; the API already sends
  `X-Accel-Buffering: no`)
- allow an idle timeout of at least 60 s; the server sends a keep-alive comment every 25 s
- the apps fall back to polling every 60 s if the stream cannot connect, so a proxy that breaks
  it degrades the experience rather than the correctness

## The container image

`Dockerfile` at the repo root builds the API. Two stages: one with the whole monorepo and a
toolchain, one that ships the bundled `dist/server.js`, its third-party dependencies, the
migrations and nothing else.

```bash
docker build -t hyperlocal-api .
docker run --rm -p 4000:4000 \
  -e APP_ENV=staging -e DATA_MODE=postgres \
  -e DATABASE_URL=postgres://... -e API_JWT_SECRET=... \
  hyperlocal-api
```

Three choices in it are worth knowing about, because each one is a failure that has already been
seen rather than a preference:

- **The runtime dependencies are resolved on their own**, not with `npm ci --omit=dev` at the
  root. This is an npm workspaces repo and `apps/mobile` has Expo and React Native as
  *production* dependencies, so a root prod install drags a mobile app into an image that serves
  HTTP. The trade is that the runtime tree resolves from `apps/api/package.json` rather than the
  root lockfile, so versions are the caret ranges rather than the exact pins CI tested. If exact
  pinning matters more later, the answer is a lockfile per deployable package, not a bigger image.
- **`tini` as PID 1.** Node as PID 1 does not forward signals the way an init does, so SIGTERM on
  deploy becomes SIGKILL after the grace period - requests cut off mid-flight instead of drained.
- **The healthcheck hits `/health`, never `/ready`.** See below.

> **Not yet built.** The Dockerfile has not been built into an image, because Docker Desktop
> could not be started in the environment it was written in. What *has* been verified is the
> part most likely to be wrong: the runtime dependency install was run exactly as the image
> does it, the bundled server was started against only those dependencies, and `/health`,
> `/ready` and the healthcheck command were all exercised against it. That found two real bugs
> (below). Treat the image build itself as unproven until someone runs it.

## Health probes

Three different questions, and giving them all the same answer is how a small outage becomes a
total one.

| Endpoint | Question | Use it for |
| --- | --- | --- |
| `GET /health` | Is this process able to answer at all? | Container healthcheck, k8s **liveness** |
| `GET /ready` | Can this node serve requests? | Load balancer, k8s **readiness**, deploy gates |
| `GET /ready?deep=1` | What is the state of everything it depends on? | A human looking into something |

`/health` deliberately touches no dependency. A liveness probe that checks the database turns a
database blip into a restart loop across every node at once, which is strictly worse than the
blip.

`/ready` checks the process and its database, and **only those decide the status code**. It used
to ping every adapter on every call - eight outbound API calls per probe per node with live
credentials - and return 503 if any of them failed. That meant a payment provider having a bad
ten minutes would make every node report itself unready at the same moment, taking the whole
service down including the great majority of requests that never touch payments. A third party's
outage became ours, automatically. Adapter health is still reported in the body, and
`degradedAdapters` names anything unhealthy, but it is swept on a 30-second cache and decides
nothing. `?deep=1` forces a fresh sweep.

## Connection pool sizing

Per node: `DATABASE_POOL_MAX` (default 10), `DATABASE_POOL_IDLE_TIMEOUT_MS`,
`DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`.

The number that matters is not any of those, it is:

```
(DATABASE_POOL_MAX + 1) x number of nodes   <   the server's max_connections
```

The `+ 1` is the connection each node holds open permanently for LISTEN. On a managed Postgres
`max_connections` is usually far lower than people expect - a small instance often allows around
100, shared with backups, migrations and whatever is connected from somebody's laptop.

Ten per node is chosen to be obviously safe at four nodes rather than to be optimal. Raise it
only alongside a measurement showing requests waiting on the pool: a pool larger than the
database can serve moves the queue rather than shortening it.

`DATABASE_STATEMENT_TIMEOUT_MS` is a ceiling on any single statement. Without it one pathological
query holds a connection until somebody notices, and with a small pool that is an outage rather
than a slow page.

## Two bugs the production-shaped run found

Both are recorded here because neither is visible from a dev machine, and both would have been
found by a user instead.

**The container would not have started at all.** `pino-pretty` is a devDependency, but the logger
asks pino to resolve it by name whenever `APP_ENV` is `local` - and `APP_ENV` *defaults* to
`local`. With dev dependencies omitted that is not a plainer log format, it is a process that
exits at boot with a stack trace about a log formatter, on the first run anybody would attempt.
The logger now checks whether it is installed before asking for it.

**`/ready` could have taken the service down**, as described above. Worth stating plainly because
the code looked careful - it checked everything - and checking everything was the bug.

## Maintenance mode

`MAINTENANCE_MODE=true` makes every state-changing request answer 503 with `MAINTENANCE_MESSAGE`
while reads keep working. Use it for a migration that cannot run online. `/ready` reports it, so
a load balancer or an on-call engineer can see the mode without reading the config.

## Version gate

`MIN_APP_VERSION` is the oldest app build the API will talk to. An older build gets 426 with the
minimum in the body; a caller with no `x-app-version` header (a browser, curl, a health check) is
never blocked. Raise it only after the new build is actually in the stores.

## Backups and the restore drill

Supabase takes daily automatic backups with point-in-time recovery on paid plans. That is the
supplier's claim; what matters is whether **we** can restore, so this is the drill to run before
launch and quarterly after it.

1. **Take a manual snapshot.** `supabase db dump -f backup-$(date +%F).sql --db-url "$DATABASE_URL"`
   Keep it outside the provider (an object store in another account), encrypted at rest.
2. **Restore into a scratch project**, never over the live one:
   `psql "$SCRATCH_DATABASE_URL" -f backup-YYYY-MM-DD.sql`
3. **Verify the restore, not the file.** Point a staging API at the scratch database and check:
   - `npm run migrate:check` reports the same migration count
   - a known completed job still has its full `job_status_events` trail
   - `select sum(amount_paise) from ledger_entries` is zero for every settled job
   - a KYC record still has only `doc_number_last4`, never a full number
4. **Time it.** Write down how long steps 1-3 took; that number is the real recovery time
   objective, and it belongs in `INCIDENT_RESPONSE.md` rather than in an assumption.
5. **Record the result** - date, who ran it, duration, anything that did not match - in the
   deployment log.

> Status: this drill is **documented but not yet executed**. There is no provisioned database
> yet, so no restore has been performed. `SECURITY_CHECKLIST.md` keeps it marked partial until a
> dated result exists.
