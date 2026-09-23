import { buildApp, type App } from '../app';
import { seedDemo } from '../data/seed';

export type TestApp = App;

export async function makeApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const app = await buildApp({
    envOverrides: { APP_ENV: 'test', DATA_MODE: 'memory', OTP_DEMO_CODE: '123456', OTP_REQUESTS_PER_HOUR: '5', ...envOverrides },
    seed: false,
  });
  await seedDemo(app.ctx.store, app.ctx.env);
  await app.ready();
  return app;
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
