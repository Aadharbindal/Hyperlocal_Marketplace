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

The API runs its own scheduler in-process (`SCHEDULER_ENABLED`, `SCHEDULER_TICK_SECONDS`). One
pilot node needs no queue: every task is idempotent and batched, so a missed tick catches up on
the next one and a restart loses nothing.

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

**If you run more than one node**, turn the scheduler off everywhere except one
(`SCHEDULER_ENABLED=false`) until the work moves to a real queue. Nothing corrupts if two nodes
overlap - the guards and idempotency keys hold - but the payout run will do duplicate work.

## Live updates

`GET /events` is a Server-Sent Events stream, one per signed-in user. It carries no data, only
"this changed", so the client re-reads the endpoint it already trusts. Behind a proxy:

- disable response buffering for `/events` (`proxy_buffering off` in nginx; the API already sends
  `X-Accel-Buffering: no`)
- allow an idle timeout of at least 60 s; the server sends a keep-alive comment every 25 s
- the apps fall back to polling every 60 s if the stream cannot connect, so a proxy that breaks
  it degrades the experience rather than the correctness

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
