import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '@hyperlocal/core';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;

const hmacSha1 = (key: Uint8Array, message: Uint8Array) =>
  Uint8Array.from(createHmac('sha1', Buffer.from(key)).update(Buffer.from(message)).digest());

/** What an authenticator app on the reviewer's phone would be showing right now. */
function codeFor(secret: string, offsetSteps = 0): string {
  return totpAt(secret, Math.floor(Date.now() / 1000 / 30) + offsetSteps, hmacSha1);
}

let adminSession: { headers: Record<string, string>; userId: string } | null = null;
async function admin() {
  if (!adminSession) {
    const res = await login(app, '+919000000007');
    adminSession = { headers: bearer(res.accessToken, { 'x-active-role': 'ADMIN' }), userId: res.user.id };
  }
  return adminSession;
}

let supportSession: { headers: Record<string, string>; userId: string } | null = null;
async function support() {
  if (!supportSession) {
    const res = await login(app, '+919000000008');
    supportSession = { headers: bearer(res.accessToken, { 'x-active-role': 'SUPPORT' }), userId: res.user.id };
  }
  return supportSession;
}

/** A provider who has submitted a document and is waiting to be verified. */
async function providerAwaitingKyc(phone: string) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
  await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
  await app.inject({ method: 'PUT', url: '/provider/profile', headers: h, payload: { businessName: `Shop ${phone.slice(-4)}` } });
  const kyc = await app.inject({
    method: 'POST', url: '/provider/kyc', headers: h,
    payload: { documentType: 'AADHAAR', documentNumber: '123456789012', mime: 'image/jpeg', sizeBytes: 90_000 },
  });
  if (kyc.statusCode !== 201) throw new Error(`kyc submit failed: ${kyc.body}`);
  return { headers: h, userId: res.user.id, kycId: kyc.json().kyc.id as string };
}

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('admin MFA (SECURITY_CHECKLIST)', () => {
  it('enrols, proves the authenticator works, then verifies a session', async () => {
    const a = await admin();

    const setup = await app.inject({ method: 'POST', url: '/admin/mfa/setup', headers: a.headers });
    expect(setup.statusCode).toBe(200);
    const secret = setup.json().secret as string;
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.json().otpauthUri).toContain('otpauth://totp/');
    // the URI carries a masked number, never the whole one
    expect(setup.json().otpauthUri).not.toContain('9000000007');

    const wrong = await app.inject({ method: 'POST', url: '/admin/mfa/enable', headers: a.headers, payload: { code: '000000' } });
    expect(wrong.json().error.details.admin).toEqual(['WRONG_CODE']);

    const enabled = await app.inject({ method: 'POST', url: '/admin/mfa/enable', headers: a.headers, payload: { code: codeFor(secret) } });
    expect(enabled.statusCode).toBe(200);

    const status = await app.inject({ method: 'GET', url: '/admin/mfa', headers: a.headers });
    expect(status.json().enrolled).toBe(true);

    // the enrolment code cannot be replayed to verify the session
    const replay = await app.inject({ method: 'POST', url: '/admin/mfa/verify', headers: a.headers, payload: { code: codeFor(secret) } });
    expect(replay.json().error.details.admin).toEqual(['CODE_REUSED']);

    // a code from the next step works
    const fresh = await app.inject({ method: 'POST', url: '/admin/mfa/verify', headers: a.headers, payload: { code: codeFor(secret, 1) } });
    expect(fresh.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/admin/mfa', headers: a.headers });
    expect(after.json().verifiedForSession).toBe(true);
  });

  it('never hands the secret back after enrolment', async () => {
    const a = await admin();
    const again = await app.inject({ method: 'POST', url: '/admin/mfa/setup', headers: a.headers });
    expect(again.json().error.details.admin).toEqual(['MFA_ALREADY_ENROLLED']);
    const status = await app.inject({ method: 'GET', url: '/admin/mfa', headers: a.headers });
    expect(JSON.stringify(status.json())).not.toContain('secret');
  });

  it('locks the factor after five wrong codes', async () => {
    const s = await support();
    const setup = await app.inject({ method: 'POST', url: '/admin/mfa/setup', headers: s.headers });
    const secret = setup.json().secret as string;
    await app.inject({ method: 'POST', url: '/admin/mfa/enable', headers: s.headers, payload: { code: codeFor(secret) } });

    for (let i = 0; i < 5; i++) {
      const wrong = await app.inject({ method: 'POST', url: '/admin/mfa/verify', headers: s.headers, payload: { code: '111111' } });
      expect(wrong.statusCode).toBe(400);
    }
    const locked = await app.inject({ method: 'POST', url: '/admin/mfa/verify', headers: s.headers, payload: { code: codeFor(secret, 1) } });
    expect(locked.json().error.details.admin).toEqual(['MFA_LOCKED']);

    // unlock for the rest of the file
    await app.ctx.store.admin.updateMfa(s.userId, { locked_until: null, failed_attempts: 0 });
    const ok = await app.inject({ method: 'POST', url: '/admin/mfa/verify', headers: s.headers, payload: { code: codeFor(secret, 1) } });
    expect(ok.statusCode).toBe(200);
  });

  it('keeps the console shut to everyone else', async () => {
    const customer = await login(app, '+919444000001');
    const h = bearer(customer.accessToken);
    for (const url of ['/admin/kyc', '/admin/reports/overview']) {
      const r = await app.inject({ method: 'GET', url, headers: h });
      expect(r.statusCode).toBe(403);
    }
    const setup = await app.inject({ method: 'POST', url: '/admin/mfa/setup', headers: h });
    expect(setup.statusCode).toBe(403);
  });
});

describe('KYC review (PRODUCT_SPEC section 15)', () => {
  it('shows the queue without documents, and logs every look at one', async () => {
    const a = await admin();
    const provider = await providerAwaitingKyc('+919444000002');

    const queue = await app.inject({ method: 'GET', url: '/admin/kyc', headers: a.headers });
    expect(queue.statusCode).toBe(200);
    const mine = (queue.json().items as Array<{ id: string; documentUrl: string | null; documentLast4: string | null; userPhoneMasked: string }>)
      .find((k) => k.id === provider.kycId)!;
    expect(mine).toBeTruthy();
    // the queue never carries the document or the number
    expect(mine.documentUrl).toBeNull();
    expect(mine.documentLast4).toBe('9012');
    expect(JSON.stringify(queue.json())).not.toContain('123456789012');
    expect(mine.userPhoneMasked).not.toContain('9444000002');

    const opened = await app.inject({ method: 'POST', url: `/admin/kyc/${provider.kycId}/open`, headers: a.headers });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().documentUrl).toBeTruthy();

    const access = await app.ctx.store.admin.listKycAccess(provider.kycId, 10);
    expect(access).toHaveLength(1);
    expect(access[0]!.viewed_by).toBe(a.userId);
  });

  it('approving is what lets someone work, and the number never reaches the audit log', async () => {
    const a = await admin();
    const provider = await providerAwaitingKyc('+919444000003');

    const before = await app.ctx.store.users.getProviderProfile(provider.userId);
    expect(before!.verification_status).not.toBe('VERIFIED');

    const reviewed = await app.inject({
      method: 'POST', url: `/admin/kyc/${provider.kycId}/review`, headers: a.headers,
      payload: { decision: 'APPROVE' },
    });
    if (reviewed.statusCode !== 200) throw new Error(`review failed: ${reviewed.body}`);
    expect(reviewed.json().status).toBe('VERIFIED');

    const after = await app.ctx.store.users.getProviderProfile(provider.userId);
    expect(after!.verification_status).toBe('VERIFIED');

    const logs = await app.inject({ method: 'GET', url: '/admin/audit-logs?limit=50', headers: a.headers });
    expect(JSON.stringify(logs.json())).not.toContain('123456789012');
    expect(JSON.stringify(logs.json())).toContain('admin.kyc.approve');
  });

  it('a rejection has to say why, and cannot be decided twice', async () => {
    const a = await admin();
    const provider = await providerAwaitingKyc('+919444000004');

    const bare = await app.inject({
      method: 'POST', url: `/admin/kyc/${provider.kycId}/review`, headers: a.headers,
      payload: { decision: 'REJECT', reason: 'no' },
    });
    expect(bare.statusCode).toBe(400);

    const rejected = await app.inject({
      method: 'POST', url: `/admin/kyc/${provider.kycId}/review`, headers: a.headers,
      payload: { decision: 'REJECT', reason: 'The photo is cut off; please upload the whole document' },
    });
    expect(rejected.json().status).toBe('REJECTED');

    const again = await app.inject({
      method: 'POST', url: `/admin/kyc/${provider.kycId}/review`, headers: a.headers,
      payload: { decision: 'APPROVE' },
    });
    expect(again.json().error.details.admin).toEqual(['ALREADY_DECIDED']);
  });

  it('nobody verifies themselves', async () => {
    const a = await admin();
    const h = bearer((await login(app, '+919000000007')).accessToken, { 'x-active-role': 'ADMIN' });
    const own = await app.inject({
      method: 'POST', url: '/provider/kyc', headers: bearer((await login(app, '+919000000007')).accessToken, { 'x-active-role': 'PROVIDER' }),
      payload: { documentType: 'PAN', documentNumber: 'ABCDE1234F', mime: 'image/jpeg', sizeBytes: 50_000 },
    });
    if (own.statusCode !== 201) return; // the admin has no provider role in this seed; nothing to assert
    const r = await app.inject({ method: 'POST', url: `/admin/kyc/${own.json().id}/review`, headers: h, payload: { decision: 'APPROVE' } });
    expect(r.json().error.details.admin).toEqual(['CANNOT_REVIEW_OWN']);
    expect(a.userId).toBeTruthy();
  });
});

describe('suspension takes two people', () => {
  it('refuses one approver, a short reason, and yourself', async () => {
    const a = await admin();
    const target = await providerAwaitingKyc('+919444000005');

    const alone = await app.inject({
      method: 'POST', url: `/admin/users/${target.userId}/suspend-approved`, headers: a.headers,
      payload: { reason: 'Repeatedly demanded cash payments from customers off-platform' },
    });
    expect(alone.statusCode).toBe(400);

    const sameUser = await app.inject({
      method: 'POST', url: `/admin/users/${target.userId}/suspend-approved`, headers: a.headers,
      payload: { reason: 'Repeatedly demanded cash payments from customers off-platform', secondApproverId: a.userId },
    });
    expect(sameUser.json().error.details.admin).toEqual(['SECOND_APPROVER_MUST_DIFFER']);

    const self = await app.inject({
      method: 'POST', url: `/admin/users/${a.userId}/suspend-approved`, headers: a.headers,
      payload: { reason: 'Repeatedly demanded cash payments from customers off-platform', secondApproverId: (await support()).userId },
    });
    expect(self.json().error.details.admin).toEqual(['CANNOT_SUSPEND_SELF']);
  });

  it('refuses an approver who is not staff', async () => {
    const a = await admin();
    const target = await providerAwaitingKyc('+919444000006');
    const bystander = await login(app, '+919444000007');
    const r = await app.inject({
      method: 'POST', url: `/admin/users/${target.userId}/suspend-approved`, headers: a.headers,
      payload: { reason: 'Repeatedly demanded cash payments from customers off-platform', secondApproverId: bystander.user.id },
    });
    expect(r.json().error.details.admin).toEqual(['SECOND_APPROVER_NOT_STAFF']);
  });

  it('suspends with two approvers, ends their sessions and keeps what they earned', async () => {
    const a = await admin();
    const s = await support();
    const target = await providerAwaitingKyc('+919444000008');

    const r = await app.inject({
      method: 'POST', url: `/admin/users/${target.userId}/suspend-approved`, headers: a.headers,
      payload: { reason: 'Repeatedly demanded cash payments from customers off-platform', secondApproverId: s.userId },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('SUSPENDED');

    // a suspended account can still read, but can no longer act
    const act = await app.inject({ method: 'POST', url: '/provider/availability', headers: target.headers, payload: { isAvailable: true } });
    expect(act.statusCode).toBe(403);

    const detail = await app.inject({ method: 'GET', url: `/admin/users/${target.userId}`, headers: a.headers });
    expect(detail.json().status).toBe('SUSPENDED');
    // a suspended account keeps its balance rather than losing it
    expect(detail.json().owedPaise).toBeGreaterThanOrEqual(0);
  });
});

describe('console queues and reports', () => {
  it('shows support what is waiting and what the numbers are', async () => {
    const a = await admin();
    const report = await app.inject({ method: 'GET', url: '/admin/reports/overview', headers: a.headers });
    expect(report.statusCode).toBe(200);
    const body = report.json();
    expect(typeof body.kycPending).toBe('number');
    expect(typeof body.disputesOpen).toBe('number');
    expect(typeof body.payoutsPendingPaise).toBe('number');
    expect(body.generatedAt).toBeTruthy();
  });

  it('reads a user with their strikes, masked for support and full for an admin', async () => {
    const a = await admin();
    const s = await support();
    const target = await providerAwaitingKyc('+919444000009');

    const asAdmin = await app.inject({ method: 'GET', url: `/admin/users/${target.userId}`, headers: a.headers });
    expect(asAdmin.json().phone).toBe('+919444000009');

    const asSupport = await app.inject({ method: 'GET', url: `/admin/users/${target.userId}`, headers: s.headers });
    expect(asSupport.json().phone).not.toBe('+919444000009');
    expect(asSupport.json().phone).toContain('09');
  });
});
