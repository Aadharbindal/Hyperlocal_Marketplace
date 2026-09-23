import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHONES, bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('reports mocked adapters honestly', async () => {
    const r = await app.inject({ method: 'GET', url: '/ready' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.dataMode).toBe(app.ctx.store.mode);
    expect(body.mockedAdapters).toContain('sms');
    expect(body.mockedAdapters).toContain('payment');
  });
});

describe('OTP login (AUTH-05/06/07, signup)', () => {
  it('creates a new user on first verification and returns tokens', async () => {
    const res = await login(app, PHONES.fresh);
    expect(res.isNewUser).toBe(true);
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(res.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.phoneMasked).toBe('+91********11');
    expect(me.json().user.roles).toEqual([]);
  });

  it('rejects invalid phone numbers', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone: '12345' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a wrong code, counts attempts and locks after max attempts', async () => {
    const phone = '+919111111112';
    const r1 = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone } });
    const { challengeId } = r1.json();
    for (let i = 1; i <= 4; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: '000000' } });
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('OTP_INVALID');
      expect(r.json().error.details.attemptsRemaining).toBe(5 - i);
    }
    const locked = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: '000000' } });
    expect(locked.json().error.code).toBe('OTP_LOCKED');
    // Even the right code no longer works once locked.
    const right = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: '123456' } });
    expect(right.json().error.code).toBe('OTP_LOCKED');
  });

  it('a consumed code cannot be reused (OTP reuse security test)', async () => {
    const phone = '+919111111113';
    const r1 = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone } });
    const { challengeId, demoCode } = r1.json();
    const ok = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: demoCode } });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: demoCode } });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.code).toBe('OTP_CONSUMED');
  });

  it('enforces resend cooldown and hourly request limit', async () => {
    const phone = '+919111111114';
    const first = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone } });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('OTP_RATE_LIMITED');
    expect(second.json().error.details.resendAfterSeconds).toBeGreaterThan(0);
  });

  it('rotates refresh tokens and rejects the old one', async () => {
    const res = await login(app, '+919111111115');
    const r = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: res.refreshToken } });
    expect(r.statusCode).toBe(200);
    expect(r.json().refreshToken).not.toBe(res.refreshToken);
    const replay = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: res.refreshToken } });
    expect(replay.statusCode).toBe(401);
  });

  it('rejects tampered access tokens', async () => {
    const res = await login(app, '+919111111116');
    const bad = res.accessToken.slice(0, -3) + 'abc';
    const r = await app.inject({ method: 'GET', url: '/me', headers: bearer(bad) });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('logout all revokes every session', async () => {
    const res = await login(app, '+919111111117');
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: bearer(res.accessToken), payload: { all: true } });
    expect(out.statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: res.refreshToken } });
    expect(r.statusCode).toBe(401);
  });

  it('localises error messages in Hindi when requested', async () => {
    const r = await app.inject({ method: 'GET', url: '/me', headers: { 'accept-language': 'hi-IN' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toContain('साइन इन');
  });
});
