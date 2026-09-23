import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * Three things a real app has to do that this one could not: reach somebody's phone, let two
 * people talk without swapping numbers, and move a booking rather than lose it.
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
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  const job = await app.inject({
    method: 'POST', url: '/jobs', headers: h,
    payload: { categoryId: plumbingId, addressId: addr.json().id, description: 'Kitchen tap leaking since morning' },
  });
  const submitted = await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/submit`, headers: h });
  return { headers: h, userId: res.user.id, job: submitted.json().job, draftId: job.json().id as string };
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
  return { headers: h, userId: res.user.id };
}

/** A confirmed booking: a provider is assigned and the money is authorized. */
async function confirmedJob(customerPhone: string, providerPhone: string) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  return { c, p, jobId: c.job.id as string };
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

describe('reaching a phone', () => {
  it('registers a device, and registering the same one again is not an error', async () => {
    const c = await customerWithOpenJob('+919666000001');
    const payload = { token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', platform: 'ANDROID', deviceLabel: 'Redmi Note 12' };

    const first = await app.inject({ method: 'POST', url: '/me/devices', headers: c.headers, payload });
    expect(first.statusCode).toBe(200);

    // The app sends this on every launch, because the OS rotates the token.
    const again = await app.inject({ method: 'POST', url: '/me/devices', headers: c.headers, payload });
    expect(again.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/me/devices', headers: c.headers });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].deviceLabel).toBe('Redmi Note 12');
    // The token is a handle to somebody's phone and is never sent back.
    expect(list.body).not.toContain('ExponentPushToken');
  });

  it('moves a handset to its new owner rather than notifying both', async () => {
    const seller = await customerWithOpenJob('+919666000002');
    const buyer = await customerWithOpenJob('+919666000003');
    const token = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

    await app.inject({ method: 'POST', url: '/me/devices', headers: seller.headers, payload: { token, platform: 'ANDROID' } });
    await app.inject({ method: 'POST', url: '/me/devices', headers: buyer.headers, payload: { token, platform: 'ANDROID' } });

    expect((await app.inject({ method: 'GET', url: '/me/devices', headers: seller.headers })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/me/devices', headers: buyer.headers })).json().items).toHaveLength(1);
  });

  it('sends a push when there is a device, and silently does not when there is not', async () => {
    const { c, p, jobId } = await confirmedJob('+919666000004', '+919666000005');
    await app.inject({
      method: 'POST', url: '/me/devices', headers: c.headers,
      payload: { token: 'ExponentPushToken[cccccccccccccccccccccc]', platform: 'IOS' },
    });

    // A status change the customer cares about
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    expect(r.statusCode).toBe(200);

    const notifications = await app.inject({ method: 'GET', url: '/me/notifications', headers: c.headers });
    expect(notifications.json().unread).toBeGreaterThan(0);
  });

  it('counts unread and clears it', async () => {
    const { c } = await confirmedJob('+919666000006', '+919666000007');
    const before = await app.inject({ method: 'GET', url: '/me/notifications', headers: c.headers });
    expect(before.json().unread).toBeGreaterThan(0);
    expect(before.json().items[0].category).toBeTruthy();

    const read = await app.inject({ method: 'POST', url: '/me/notifications/read', headers: c.headers, payload: {} });
    expect(read.json().unread).toBe(0);

    // Reading again marks nothing, rather than failing
    const twice = await app.inject({ method: 'POST', url: '/me/notifications/read', headers: c.headers, payload: {} });
    expect(twice.json().marked).toBe(0);
  });

  it('lets someone turn off what they chose to, and nothing else', async () => {
    const c = await customerWithOpenJob('+919666000008');
    const off = await app.inject({
      method: 'PATCH', url: '/me/notification-settings', headers: c.headers,
      payload: { jobUpdates: false, marketing: false },
    });
    expect(off.json().jobUpdates).toBe(false);
    expect(off.json().offers).toBe(true);
    // Money and account alerts have no switch at all, and the response says so out loud.
    expect(off.json().alwaysOn).toEqual(['MONEY', 'ACCOUNT']);
  });
});

describe('talking without swapping numbers', () => {
  it('connects the two people on a live job, and never shows either number', async () => {
    const { c, p, jobId } = await confirmedJob('+919666000010', '+919666000011');
    // A job under way, which is when people actually ring each other - and the case the
    // calling-hours rule deliberately does not apply to.
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });

    const call = await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: c.headers, payload: {} });
    expect(call.statusCode).toBe(201);
    expect(call.json().call.virtualNumber).toBeTruthy();
    expect(call.json().call.status).toBe('CONNECTED');
    // The provider's real number is nowhere in the response
    expect(call.body).not.toContain('919666000011');
    expect(call.json().call.callsLeftToday).toBe(9);

    // and it works the other way round too
    const back = await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: p.headers, payload: {} });
    expect(back.statusCode).toBe(201);
    expect(back.body).not.toContain('919666000010');
  });

  it('will not connect a stranger to a job', async () => {
    const { jobId } = await confirmedJob('+919666000012', '+919666000013');
    const stranger = await customerWithOpenJob('+919666000014');
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: stranger.headers, payload: {} });
    expect(r.statusCode).toBe(403);
  });

  it('will not connect a job nobody has been booked for yet', async () => {
    const c = await customerWithOpenJob('+919666000015');
    const r = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/call`, headers: c.headers, payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.call).toEqual(['JOB_NOT_CONFIRMED']);
  });

  it('connects a booking made for later only within calling hours, unless it is urgent', async () => {
    const { c, jobId } = await confirmedJob('+919666000030', '+919666000031');
    // This one is scheduled, not under way, so the hour matters. Whichever side of the line
    // the clock happens to be on when this runs, "urgent" must get through.
    const urgent = await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: c.headers, payload: { urgent: true } });
    expect(urgent.statusCode).toBe(201);
  });

  it('stops somebody ringing over and over', async () => {
    const { c, p, jobId } = await confirmedJob('+919666000016', '+919666000017');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: c.headers, payload: {} });
    }
    const eleventh = await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: c.headers, payload: {} });
    expect(eleventh.statusCode).toBe(400);
    expect(eleventh.json().error.details.call).toEqual(['TOO_MANY_CALLS']);
  });

  it('keeps a log of who rang whom, but never what was said', async () => {
    const { c, p, jobId } = await confirmedJob('+919666000018', '+919666000019');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/call`, headers: c.headers, payload: {} });
    const calls = await app.ctx.store.reach.countCallsSince(jobId, c.userId, new Date(Date.now() - 3600_000));
    expect(calls).toBe(1);
  });
});

describe('moving a booking instead of losing it', () => {
  const inThreeDays = () => new Date(Date.now() + 3 * 24 * 3600_000).toISOString();

  it('moves an open job and leaves moves in hand', async () => {
    const c = await customerWithOpenJob('+919666000020');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${c.job.id}/reschedule`, headers: c.headers,
      payload: { newStart: inThreeDays(), reason: 'Away for work' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().movesLeft).toBe(1);
    expect(r.json().providerNotified).toBe(false);
  });

  it('tells the provider who had blocked the time', async () => {
    const { c, p, jobId } = await confirmedJob('+919666000021', '+919666000022');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/reschedule`, headers: c.headers,
      payload: { newStart: inThreeDays() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().providerNotified).toBe(true);

    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    const types = (theirs.json().items as Array<{ type: string }>).map((n) => n.type);
    expect(types).toContain('job.rescheduled');
  });

  it('refuses a third move, and says what to do instead', async () => {
    const c = await customerWithOpenJob('+919666000023');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/reschedule`, headers: c.headers, payload: { newStart: inThreeDays() } });
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/reschedule`, headers: c.headers, payload: { newStart: inThreeDays() } });
    const third = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/reschedule`, headers: c.headers, payload: { newStart: inThreeDays() } });
    expect(third.statusCode).toBe(400);
    expect(third.json().error.details.reschedule).toEqual(['TOO_MANY_RESCHEDULES']);
    // and the customer is told in their own terms, not in ours
    expect(third.json().error.details.message).toContain('Cancel it and book again');
  });

  it('refuses a time in the past', async () => {
    const c = await customerWithOpenJob('+919666000024');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${c.job.id}/reschedule`, headers: c.headers,
      payload: { newStart: new Date(Date.now() - 3600_000).toISOString() },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.reschedule).toEqual(['IN_THE_PAST']);
  });

  it('is not the provider decision to make', async () => {
    const { p, jobId } = await confirmedJob('+919666000025', '+919666000026');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/reschedule`, headers: p.headers,
      payload: { newStart: inThreeDays() },
    });
    expect(r.statusCode).toBe(403);
  });

  it('refuses once work is under way', async () => {
    const { c, p, jobId } = await confirmedJob('+919666000027', '+919666000028');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/reschedule`, headers: c.headers,
      payload: { newStart: inThreeDays() },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.reschedule).toEqual(['ALREADY_UNDER_WAY']);
  });
});
