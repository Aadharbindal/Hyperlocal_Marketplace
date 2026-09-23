import { buildApp, type App } from '../app';
import { seedDemo } from '../data/seed';

export type TestApp = App;

/**
 * The suite runs in memory by default and against real Postgres when the environment says so:
 *
 *   DATA_MODE=postgres DATABASE_URL=... npm run test:integration
 *
 * Nothing in the tests themselves changes. That is the point - the same expectations have to
 * hold whichever store is underneath, because the memory repositories exist to mirror the SQL,
 * not to be an easier version of it.
 */
const DATA_MODE = process.env.DATA_MODE === 'postgres' ? 'postgres' : 'memory';

export async function makeApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const app = await buildApp({
    envOverrides: {
      APP_ENV: 'test',
      DATA_MODE,
      ...(DATA_MODE === 'postgres' && process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      OTP_DEMO_CODE: '123456',
      OTP_REQUESTS_PER_HOUR: '5',
      ...envOverrides,
    },
    seed: false,
  });
  // Each test file gets the database to itself. Truncating is faster than re-running the
  // migrations and proves the foreign keys are wired, since CASCADE has to reach everything.
  // The service catalog is reference data seeded by 0001 and belongs to the schema, not to a
  // test, so it is left alone.
  if (DATA_MODE === 'postgres') await truncateAll(app);
  await seedDemo(app.ctx.store, app.ctx.env);
  await app.ready();
  return app;
}

async function truncateAll(app: TestApp) {
  const store = app.ctx.store as unknown as { query?: (sql: string) => Promise<unknown> };
  if (!store.query) throw new Error('postgres store does not expose a query hook for tests');
  await store.query(`
    do $$
    declare t text;
    begin
      for t in
        select tablename from pg_tables
        where schemaname = 'public' and tablename not in ('service_categories', 'service_skills')
      loop
        execute format('truncate table %I cascade', t);
      end loop;
    end $$;
  `);
}

/**
 * A stable pseudo-IP per phone number. Every test user is a different device, so one test file
 * cannot trip the per-IP OTP limit that protects real users.
 */
function ipFor(phone: string): string {
  const n = Number(phone.slice(-6)) || 1;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n % 254) + 1}`;
}

/** Full OTP login; returns tokens for the given phone. */
export async function login(app: TestApp, phone: string) {
  const headers = { 'x-forwarded-for': ipFor(phone) };
  const r1 = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone }, headers });
  if (r1.statusCode !== 200) throw new Error(`request-otp failed: ${r1.body}`);
  const { challengeId, demoCode } = r1.json();
  const r2 = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: demoCode }, headers });
  if (r2.statusCode !== 200) throw new Error(`verify-otp failed: ${r2.body}`);
  return r2.json() as { accessToken: string; refreshToken: string; user: { id: string }; isNewUser: boolean };
}

export const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

export const PHONES = {
  customer: '+919000000001',
  provider: '+919000000002',
  contractor: '+919000000004',
  technician: '+919000000005',
  vendor: '+919000000006',
  admin: '+919000000007',
  support: '+919000000008',
  fresh: '+919111111111',
};
