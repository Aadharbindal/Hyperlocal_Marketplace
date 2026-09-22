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
