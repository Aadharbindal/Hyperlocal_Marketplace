import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * Two promises the platform was making and not keeping: a professional who cannot make it had
 * only "cancel", and a referral reward reached QUALIFIED and waited for somebody in support to
 * remember it.
 */

let app: TestApp;
let plumbingId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };
const REASON = 'My van has broken down and the part arrives tomorrow morning.';

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
  return { headers: h, userId: res.user.id, job: submitted.json().job };
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
  await app.inject({
    method: 'POST', url: '/me/payout-account', headers: h,
    payload: { method: 'UPI', accountHolderName: `Services ${phone.slice(-4)}`, vpa: `pay${phone.slice(-6)}@okhdfc` },
  });
  return { headers: h, userId: res.user.id };
}

/** A booking with a provider on it and money authorized - which is when a time can be moved. */
async function confirmedJob(customerPhone: string, providerPhone: string, promoCode?: string) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
  const accepted = await app.inject({
    method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers,
    payload: promoCode ? { promoCode } : {},
  });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  return { c, p, jobId: c.job.id as string, accepted: accepted.json() };
}

/** All the way through, which is when a referral qualifies. */
async function completedJob(customerPhone: string, providerPhone: string) {
  const s = await confirmedJob(customerPhone, providerPhone);
  const { c, p, jobId } = s;
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
  const panel = await app.inject({ method: 'GET', url: `/jobs/${jobId}/execution`, headers: c.headers });
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code: panel.json().startCode } });
  const shot = await app.inject({
    method: 'POST', url: `/jobs/${jobId}/evidence`, headers: p.headers,
    payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 120_000 },
  });
  await app.inject({
    method: 'POST', url: `/jobs/${jobId}/complete`, headers: p.headers,
    payload: { summary: 'Replaced the cartridge and tested it', mediaIds: [shot.json().media.id] },
  });
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/approve`, headers: c.headers, payload: { approved: true } });
  return s;
}

const inTwoDays = () => new Date(Date.now() + 2 * 24 * 3600_000).toISOString();

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

describe('a professional suggesting a new time', () => {
  it('asks rather than tells: nothing moves until the customer answers', async () => {
    const { c, p, jobId } = await confirmedJob('+919666200001', '+919666200002');
    const before = (await app.ctx.store.jobs.get(jobId))!.preferred_start;

    const proposed = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json().proposal.status).toBe('PENDING');

    // The booking has not moved.
    expect((await app.ctx.store.jobs.get(jobId))!.preferred_start).toEqual(before);

    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: c.headers });
    expect((theirs.json().items as Array<{ type: string }>).map((n) => n.type)).toContain('job.time_proposed');
  });

  it('moves the booking only when the customer accepts, and records it as a reschedule', async () => {
    const { c, p, jobId } = await confirmedJob('+919666200003', '+919666200004');
    const when = inTwoDays();
    const proposed = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: when, reason: REASON },
    });

    const answered = await app.inject({
      method: 'POST', url: `/time-proposals/${proposed.json().proposal.id}/respond`, headers: c.headers,
      payload: { accept: true },
    });
    expect(answered.json().proposal.status).toBe('ACCEPTED');
    expect((await app.ctx.store.jobs.get(jobId))!.preferred_start?.toISOString()).toBe(when);

    // The history of when a job was meant to happen reads the same whoever asked for the change.
    const history = await app.ctx.store.reach.listReschedules(jobId);
    expect(history).toHaveLength(1);
    expect(history[0]!.requested_by).toBe(p.userId);
    void c;
  });

  it('leaves the original time alone when the customer says no', async () => {
    const { c, p, jobId } = await confirmedJob('+919666200005', '+919666200006');
    const before = (await app.ctx.store.jobs.get(jobId))!.preferred_start;
    const proposed = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });

    const answered = await app.inject({
      method: 'POST', url: `/time-proposals/${proposed.json().proposal.id}/respond`, headers: c.headers,
      payload: { accept: false, reason: 'I have taken the day off for this.' },
    });
    expect(answered.json().proposal.status).toBe('DECLINED');
    expect((await app.ctx.store.jobs.get(jobId))!.preferred_start).toEqual(before);

    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    expect((theirs.json().items as Array<{ type: string }>).map((n) => n.type)).toContain('job.time_declined');
  });

  it('insists on a reason, because the customer is rearranging their day', async () => {
    const { p, jobId } = await confirmedJob('+919666200007', '+919666200008');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: 'busy' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('keeps one suggestion open at a time', async () => {
    const { p, jobId } = await confirmedJob('+919666200009', '+919666200010');
    await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    const second = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    expect(second.json().error.details.proposal).toEqual(['ALREADY_PROPOSED']);
  });

  it('is not a stranger suggestion to make, nor a stranger answer', async () => {
    const { p, jobId } = await confirmedJob('+919666200011', '+919666200012');
    const outsider = await makeProvider('+919666200013');
    const nosy = await customerWithOpenJob('+919666200014');

    const suggested = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: outsider.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    expect(suggested.statusCode).toBe(403);

    const mine = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    const answered = await app.inject({
      method: 'POST', url: `/time-proposals/${mine.json().proposal.id}/respond`, headers: nosy.headers,
      payload: { accept: true },
    });
    expect(answered.statusCode).toBe(403);
  });

  it('can be withdrawn before it is answered', async () => {
    const { p, jobId } = await confirmedJob('+919666200015', '+919666200016');
    const proposed = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    const withdrawn = await app.inject({
      method: 'POST', url: `/time-proposals/${proposed.json().proposal.id}/withdraw`, headers: p.headers,
    });
    expect(withdrawn.json().proposal.status).toBe('WITHDRAWN');

    // And a withdrawn one leaves room for another.
    const again = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    expect(again.statusCode).toBe(201);
  });

  it('lapses rather than hanging over a booking forever', async () => {
    const { p, jobId } = await confirmedJob('+919666200017', '+919666200018');
    const proposed = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/propose-time`, headers: p.headers,
      payload: { newStart: inTwoDays(), reason: REASON },
    });
    const id = proposed.json().proposal.id as string;
    await app.ctx.store.reach.updateProposal(id, { expires_at: new Date(Date.now() - 1000) });

    const result = await app.ctx.services.scheduler.runTask('expire-proposals');
    expect(result.handled).toBeGreaterThan(0);
    expect((await app.ctx.store.reach.getProposal(id))!.status).toBe('EXPIRED');

    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    expect((theirs.json().items as Array<{ type: string }>).map((n) => n.type)).toContain('job.time_expired');
  });
});

describe('a referral reward that pays itself', () => {
  it('issues a code to each side once the friend finishes a booking', async () => {
    const referrer = await customerWithOpenJob('+919666200030');
    const code = (await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers })).json().code as string;

    const friend = await customerWithOpenJob('+919666200031');
    await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: friend.headers, payload: { code } });

    await completedJob('+919666200031', '+919666200032');

    // It used to stop at QUALIFIED and wait for somebody in support to remember it.
    const summary = await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers });
    expect(summary.json().people[0].status).toBe('REWARDED');
    expect(summary.json().earnedPaise).toBe(10_000);

    const inbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: referrer.headers });
    const reward = (inbox.json().items as Array<{ type: string; title: string }>).find((n) => n.type === 'promo.referral_reward');
    expect(reward).toBeTruthy();
    expect(reward!.title).toContain('THANKS');
  });

  it('gives a code the owner can actually spend', async () => {
    const referrer = await customerWithOpenJob('+919666200033');
    const referralCode = (await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers })).json().code as string;
    const friend = await customerWithOpenJob('+919666200034');
    await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: friend.headers, payload: { code: referralCode } });
    await completedJob('+919666200034', '+919666200035');

    const reward = `THANKS${referralCode}`;
    const preview = await app.inject({ method: 'GET', url: `/promo/preview?code=${reward}&orderPaise=80000`, headers: referrer.headers });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().promo.discountPaise).toBe(10_000);
  });

  it('is nobody else code to spend', async () => {
    const referrer = await customerWithOpenJob('+919666200036');
    const referralCode = (await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers })).json().code as string;
    const friend = await customerWithOpenJob('+919666200037');
    await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: friend.headers, payload: { code: referralCode } });
    await completedJob('+919666200037', '+919666200038');

    const stranger = await customerWithOpenJob('+919666200039');
    const r = await app.inject({
      method: 'GET', url: `/promo/preview?code=THANKS${referralCode}&orderPaise=80000`, headers: stranger.headers,
    });
    expect(r.json().error.details.promo).toEqual(['NOT_YOURS']);
    // Reported as NOT_YOURS rather than NOT_FOUND, so the owner is never told their code is fake.
    expect(r.json().error.details.message).toContain('somebody else');
  });

  it('keeps a personal reward out of the campaign list', async () => {
    const a = await login(app, '+919000000007');
    const admin = bearer(a.accessToken, { 'x-active-role': 'ADMIN' });
    const list = await app.inject({ method: 'GET', url: '/admin/promos', headers: admin });
    const codes = (list.json().items as Array<{ code: string }>).map((p) => p.code);
    expect(codes.some((c) => c.startsWith('THANKS') || c.startsWith('WELCOME'))).toBe(false);
  });
});
