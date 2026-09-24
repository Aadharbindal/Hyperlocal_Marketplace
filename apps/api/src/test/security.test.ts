import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * The adversarial pass (SECURITY_CHECKLIST, last section). Each test is written from the
 * attacker's side: what they would try, and what should stop them.
 */

let app: TestApp;
let plumbingId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };

async function customerWithOpenJob(phone: string) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken);
  await app.inject({ method: 'POST', url: '/me/roles', headers: h, payload: { role: 'CUSTOMER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: h,
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003', landmark: 'Near the temple' },
  });
  const job = await app.inject({
    method: 'POST', url: '/jobs', headers: h,
    payload: { categoryId: plumbingId, addressId: addr.json().id, description: 'Kitchen tap leaking since morning' },
  });
  const submitted = await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/submit`, headers: h });
  return { headers: h, userId: res.user.id, jobId: submitted.json().job.id as string, token: res.accessToken };
}

async function makeProvider(phone: string) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
  await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: bearer(res.accessToken),
    payload: { label: 'Shop', line1: '4, Jor Bagh Market', city: 'Delhi', pincode: '110003' },
  });
  await app.inject({
    method: 'PUT', url: '/provider/profile', headers: h,
    payload: { businessName: `Services ${phone.slice(-4)}`, serviceRadiusKm: 8, baseAddressId: addr.json().id, skillIds: plumbingSkills },
  });
  const profile = await app.ctx.store.users.getProviderProfile(res.user.id);
  await app.ctx.store.users.upsertProviderProfile({ ...profile!, verification_status: 'VERIFIED' });
  await app.inject({ method: 'POST', url: '/provider/availability', headers: h, payload: { isAvailable: true } });
  return { headers: h, userId: res.user.id, token: res.accessToken };
}

async function confirmedJob(customerPhone: string, providerPhone: string) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  return { c, p, quote: accepted.json().quote, paymentId: accepted.json().payment.id as string, bidId: offer.json().id as string };
}

function sign(body: unknown): string {
  const secret = app.ctx.env.PAYMENT_WEBHOOK_SECRET ?? 'mock-webhook-secret';
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  const plumbing = (cats.json().items as Array<{ id: string; slug: string; skills: Array<{ id: string }> }>).find((c) => c.slug === 'plumbing')!;
  plumbingId = plumbing.id;
  plumbingSkills = plumbing.skills.map((s) => s.id);
});
afterAll(async () => {
  await app.close();
});

describe('accepted-quote tampering', () => {
  it('charges the locked quote however the client asks for the acceptance', async () => {
    const c = await customerWithOpenJob('+919222000001');
    const p = await makeProvider('+919222000002');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });

    // The attacker sends their own idea of the price along with the acceptance. The body is
    // strict, so it is refused outright rather than silently ignored - and refusing is the
    // better answer, because a client sending a price is either broken or hostile.
    const tampered = await app.inject({
      method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers,
      payload: { labourPaise: 1, totalPaise: 1, amountPaise: 1 },
    });
    expect(tampered.statusCode).toBe(400);

    // and the honest acceptance is charged at the locked quote, whatever was attempted before
    const accepted = await app.inject({
      method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers, payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().quote.labourPaise).toBe(BID.labourPaise);
    expect(accepted.json().payment.amountPaise).toBe(accepted.json().quote.totalPaise);
  });

  it('will not let a provider quietly raise the price after acceptance', async () => {
    const { p, bidId, quote } = await confirmedJob('+919222000003', '+919222000004');
    const revise = await app.inject({
      method: 'POST', url: `/bids/${bidId}/revise`, headers: p.headers,
      payload: { labourPaise: 500_000, etaMinutes: 60 },
    });
    expect(revise.statusCode).toBeGreaterThanOrEqual(400);
    expect(quote.labourPaise).toBe(BID.labourPaise);
  });
});

describe('cross-job and cross-account access', () => {
  it('keeps a provider out of a job they were not booked for', async () => {
    const { c } = await confirmedJob('+919222000005', '+919222000006');
    const stranger = await makeProvider('+919222000007');

    for (const url of [`/jobs/${c.jobId}/execution`, `/jobs/${c.jobId}/chat`, `/jobs/${c.jobId}/booking`, `/jobs/${c.jobId}/money`]) {
      const r = await app.inject({ method: 'GET', url, headers: stranger.headers });
      expect(r.statusCode).toBe(403);
    }
    const act = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/progress`, headers: stranger.headers, payload: { to: 'EN_ROUTE' } });
    expect(act.statusCode).toBe(403);
  });

  it('keeps a customer out of somebody else’s booking', async () => {
    const mine = await customerWithOpenJob('+919222000008');
    const theirs = await customerWithOpenJob('+919222000009');
    const r = await app.inject({ method: 'GET', url: `/jobs/${theirs.jobId}`, headers: mine.headers });
    expect(r.statusCode).toBe(403);
  });
});

describe('address and identity leakage', () => {
  it('never puts the address in a feed or an offer list', async () => {
    const c = await customerWithOpenJob('+919222000010');
    const p = await makeProvider('+919222000011');

    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    expect(JSON.stringify(feed.json())).not.toContain('Lodhi Colony');
    expect(JSON.stringify(feed.json())).not.toContain('Near the temple');
    expect(JSON.stringify(feed.json())).not.toContain('919222000010');

    await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    const offers = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}/offers`, headers: c.headers });
    expect(JSON.stringify(offers.json())).not.toContain('919222000011');
  });

  it('gives the public tracking link nothing worth stealing', async () => {
    const c = await customerWithOpenJob('+919222000012');
    const job = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}`, headers: c.headers });
    const token = job.json().trackingUrlToken as string;
    expect(token).toBeTruthy();

    const tracked = await app.inject({ method: 'GET', url: `/track/${token}` });
    expect(tracked.statusCode).toBe(200);
    const body = JSON.stringify(tracked.json());
    expect(body).not.toContain('Lodhi Colony');
    expect(body).not.toContain('919222000012');
    expect(body).not.toContain(c.userId);
  });
});

describe('webhook abuse', () => {
  it('refuses an unsigned or wrongly signed event before it parses the body', async () => {
    const { paymentId } = await confirmedJob('+919222000013', '+919222000014');
    const payment = await app.ctx.store.payments.get(paymentId);
    const body = {
      eventId: 'evt_forged_1',
      type: 'payment.authorized',
      orderId: payment!.provider_order_id,
      paymentId: 'pay_forged',
      amountPaise: Number(payment!.amount_paise),
    };
    const unsigned = await app.inject({ method: 'POST', url: '/payments/webhook', payload: body });
    expect(unsigned.statusCode).toBe(401);

    const wrongSig = await app.inject({
      method: 'POST', url: '/payments/webhook', headers: { 'x-payment-signature': 'deadbeef' }, payload: body,
    });
    expect(wrongSig.statusCode).toBe(401);
  });

  it('treats a replayed event as a no-op', async () => {
    const c = await customerWithOpenJob('+919222000015');
    const p = await makeProvider('+919222000016');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
    const payment = await app.ctx.store.payments.get(accepted.json().payment.id);

    const body = {
      eventId: 'evt_replay_1',
      type: 'payment.authorized' as const,
      orderId: payment!.provider_order_id,
      paymentId: 'pay_mock_replay',
      amountPaise: Number(payment!.amount_paise),
    };
    const headers = { 'x-payment-signature': sign(body) };
    const first = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: body });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: body });
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
  });

  it('refuses an event that claims a different amount', async () => {
    const c = await customerWithOpenJob('+919222000017');
    const p = await makeProvider('+919222000018');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
    const payment = await app.ctx.store.payments.get(accepted.json().payment.id);

    const body = {
      eventId: 'evt_amount_1',
      type: 'payment.authorized' as const,
      orderId: payment!.provider_order_id,
      paymentId: 'pay_mock_amount',
      amountPaise: 1,
    };
    const r = await app.inject({ method: 'POST', url: '/payments/webhook', headers: { 'x-payment-signature': sign(body) }, payload: body });
    expect(r.statusCode).toBe(409);
    expect((await app.ctx.store.payments.get(accepted.json().payment.id))!.status).not.toBe('AUTHORIZED');
  });
});

describe('OTP abuse', () => {
  it('refuses a login code twice', async () => {
    const phone = '+919222000019';
    const headers = { 'x-forwarded-for': '10.9.9.9' };
    const r1 = await app.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone }, headers });
    const { challengeId, demoCode } = r1.json();
    const ok = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: demoCode }, headers });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { challengeId, code: demoCode }, headers });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rate-limits code requests per phone, and a new IP does not get around it', async () => {
    const phone = '+919222000020';
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const r = await app.inject({
        method: 'POST', url: '/auth/request-otp', payload: { phone },
        // a different address every time: the per-phone limit is what has to hold
        headers: { 'x-forwarded-for': `10.8.8.${i + 1}` },
      });
      if (r.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });

  it('never reveals a start code to the provider, however they ask', async () => {
    const { c, p } = await confirmedJob('+919222000021', '+919222000022');
    await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });

    const panel = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}/execution`, headers: p.headers });
    expect(panel.json().startCode).toBeNull();
    const job = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}`, headers: p.headers });
    expect(JSON.stringify(job.json())).not.toMatch(/"startCode":"\d{4}"/);
  });
});

describe('privilege escalation', () => {
  it('will not let a customer grant themselves a staff role', async () => {
    const c = await customerWithOpenJob('+919222000023');
    for (const role of ['ADMIN', 'SUPPORT']) {
      const r = await app.inject({ method: 'POST', url: '/me/roles', headers: c.headers, payload: { role } });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    const roles = await app.ctx.store.users.listRoles(c.userId);
    expect(roles.some((x) => x.role === 'ADMIN' || x.role === 'SUPPORT')).toBe(false);
  });

  it('ignores a role header the caller does not actually hold', async () => {
    const c = await customerWithOpenJob('+919222000024');
    const asAdmin = bearer(c.token, { 'x-active-role': 'ADMIN' });
    const r = await app.inject({ method: 'GET', url: '/admin/users?q=ram', headers: asAdmin });
    expect(r.statusCode).toBe(403);
  });

  it('keeps the money endpoints shut to everyone but support', async () => {
    const { c, p } = await confirmedJob('+919222000025', '+919222000026');
    for (const headers of [c.headers, p.headers]) {
      const ledger = await app.inject({ method: 'GET', url: `/admin/jobs/${c.jobId}/ledger`, headers });
      expect(ledger.statusCode).toBe(403);
      const refund = await app.inject({
        method: 'POST', url: `/admin/jobs/${c.jobId}/refund`, headers,
        payload: { amountPaise: 1000, reason: 'Refunding myself for no reason at all' },
      });
      expect(refund.statusCode).toBe(403);
    }
  });

  it('will not publish a live event from a client', async () => {
    const c = await customerWithOpenJob('+919222000027');
    const r = await app.inject({ method: 'POST', url: '/events', headers: c.headers, payload: { kind: 'job.updated' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('suspended and unverified accounts', () => {
  it('lets a suspended provider read but not act', async () => {
    const p = await makeProvider('+919222000028');
    await app.ctx.store.users.update(p.userId, {
      status: 'SUSPENDED',
      suspended_reason: 'Under review for repeated no-shows',
      // both names, because the database insists on them and so does the policy
      suspended_by: (await login(app, '+919000000007')).user.id,
      suspension_approved_by: (await login(app, '+919000000008')).user.id,
    });

    const read = await app.inject({ method: 'GET', url: '/provider/profile', headers: p.headers });
    expect(read.statusCode).toBe(200);
    const act = await app.inject({ method: 'POST', url: '/provider/availability', headers: p.headers, payload: { isAvailable: true } });
    expect(act.statusCode).toBe(403);
  });

  it('will not let an unverified provider bid', async () => {
    const c = await customerWithOpenJob('+919222000029');
    const res = await login(app, '+919222000030');
    const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
    await app.inject({ method: 'PUT', url: '/provider/profile', headers: h, payload: { businessName: 'Unverified Services', skillIds: plumbingSkills } });

    const bid = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: h, payload: BID });
    expect(bid.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('idempotency', () => {
  it('replays the first answer instead of doing the work twice', async () => {
    const c = await customerWithOpenJob('+919222000031');
    const p = await makeProvider('+919222000032');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });

    const key = 'accept-once-please';
    const first = await app.inject({
      method: 'POST', url: `/bids/${offer.json().id}/accept`,
      headers: { ...c.headers, 'idempotency-key': key },
    });
    const second = await app.inject({
      method: 'POST', url: `/bids/${offer.json().id}/accept`,
      headers: { ...c.headers, 'idempotency-key': key },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().payment.id).toBe(first.json().payment.id);

    const payments = await app.ctx.store.payments.listForJob(c.jobId);
    expect(payments.filter((x) => x.purpose === 'BOOKING').length).toBe(1);
  });
});

describe('operational gates', () => {
  it('tells an app that is too old to update, and lets a current one through', async () => {
    const c = await customerWithOpenJob('+919222000033');
    const old = await app.inject({ method: 'GET', url: '/categories', headers: { ...c.headers, 'x-app-version': '0.0.1' } });
    // the default minimum is 0.0.0, so nothing is blocked until it is raised
    expect(old.statusCode).toBe(200);

    const strict = await makeApp({ MIN_APP_VERSION: '2.0.0' });
    try {
      const blocked = await strict.inject({ method: 'GET', url: '/categories', headers: { 'x-app-version': '1.9.9' } });
      expect(blocked.statusCode).toBe(426);
      expect(blocked.json().error.code).toBe('UPGRADE_REQUIRED');

      const fine = await strict.inject({ method: 'GET', url: '/categories', headers: { 'x-app-version': '2.0.1' } });
      expect(fine.statusCode).toBe(200);
      // a caller with no version - a browser, curl - is not blocked
      const noVersion = await strict.inject({ method: 'GET', url: '/categories' });
      expect(noVersion.statusCode).toBe(200);
    } finally {
      await strict.close();
    }
  });

  it('keeps reads working in maintenance mode and holds every write', async () => {
    const quiet = await makeApp({ MAINTENANCE_MODE: 'true' });
    try {
      const read = await quiet.inject({ method: 'GET', url: '/categories' });
      expect(read.statusCode).toBe(200);

      const write = await quiet.inject({ method: 'POST', url: '/auth/request-otp', payload: { phone: '+919222000034' } });
      expect(write.statusCode).toBe(503);
      expect(write.json().error.code).toBe('MAINTENANCE');

      const ready = await quiet.inject({ method: 'GET', url: '/ready' });
      expect(ready.json().maintenanceMode).toBe(true);
    } finally {
      await quiet.close();
    }
  });
});
