import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * What happens to a booking when the professional pulls out.
 *
 * Before this existed, the answer was: it ends. The customer had taken time off work, arranged
 * their day around a window somebody else then walked away from, and was returned to an empty
 * screen and asked to start again - for the one failure that is entirely not their fault.
 *
 * Every test here is a promise to that customer: the booking survives if anybody can take it,
 * they are never asked for more money, and when nobody can take it they are told quickly rather
 * than left watching a spinner with their payment still held.
 */

let app: TestApp;
let plumbingId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  const plumbing = cats.json().items.find((c: { slug: string }) => c.slug === 'plumbing');
  plumbingId = plumbing.id;
  plumbingSkills = plumbing.skills.slice(0, 1).map((s: { id: string }) => s.id);
});
afterAll(async () => {
  await app.close();
});

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
  return { headers: h, userId: res.user.id };
}

/**
 * A confirmed booking with a loser standing by.
 *
 * `rivalBid` is deliberately not identical: the whole question this feature answers is what the
 * customer pays when somebody else steps in, so the second offer being cheaper is the case that
 * proves nobody is over-charged.
 */
async function bookingWithRunnerUp(customerPhone: string, winnerPhone: string, rivalPhone: string, rivalBid = BID) {
  const c = await customerWithOpenJob(customerPhone);
  const winner = await makeProvider(winnerPhone);
  const rival = await makeProvider(rivalPhone);

  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: rival.headers, payload: rivalBid });
  const winning = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: winner.headers, payload: BID });

  const accepted = await app.inject({ method: 'POST', url: `/bids/${winning.json().id}/accept`, headers: c.headers });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  return { c, winner, rival, jobId: c.job.id as string };
}

const drop = (jobId: string, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: `/jobs/${jobId}/cancel-as-provider`, headers, payload: { reason: 'Van broke down' } });

describe('a provider drops a confirmed booking', () => {
  it('re-opens it to the people whose offers lost, instead of ending it', async () => {
    const { c, rival, jobId } = await bookingWithRunnerUp('+919333000001', '+919333000002', '+919333000003');

    const res = await drop(jobId, (await bookingProviderHeaders('+919333000002')) ?? {});
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REDISPATCHING');
    expect(res.json().redispatch.invited).toBe(1);

    // The customer's booking is alive, and says so rather than saying "cancelled".
    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(view.json().status).toBe('REDISPATCHING');

    // And the runner-up has been asked.
    const feed = await app.inject({ method: 'GET', url: '/me/redispatch-invitations', headers: rival.headers });
    expect(feed.json().items).toHaveLength(1);
    expect(feed.json().items[0].jobId).toBe(jobId);
    expect(feed.json().items[0].reason).toBe('PROVIDER_DROPPED');
  });

  it('hands the booking over at the same price when somebody takes it', async () => {
    // The rival originally asked for less. They are re-invited at their own number, so the
    // customer's bill goes down rather than up - and never up, which is the promise.
    const cheaper = { ...BID, labourPaise: 50_000 };
    const { c, rival, jobId } = await bookingWithRunnerUp('+919333000004', '+919333000005', '+919333000006', cheaper);
    await drop(jobId, (await bookingProviderHeaders('+919333000005')) ?? {});

    const feed = await app.inject({ method: 'GET', url: '/me/redispatch-invitations', headers: rival.headers });
    const invitation = feed.json().items[0];
    expect(invitation.totalPaise).toBe(60_000);

    const taken = await app.inject({
      method: 'POST', url: `/redispatch-invitations/${invitation.id}/respond`,
      headers: rival.headers, payload: { accept: true },
    });
    expect(taken.statusCode).toBe(200);
    expect(taken.json().status).toBe('CONFIRMED');

    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(view.json().status).toBe('CONFIRMED');

    const quote = await app.ctx.store.negotiation.getActiveQuote(jobId);
    expect(quote!.provider_id).toBe(rival.userId);
    expect(Number(quote!.total_paise)).toBeLessThanOrEqual(70_000);
  });

  it('cancels as before when there is nobody else to ask', async () => {
    // A booking with a single bidder has no runner-up, and the customer is told straight away
    // rather than left in a re-dispatch that was never going to find anybody.
    const c = await customerWithOpenJob('+919333000007');
    const p = await makeProvider('+919333000008');
    const bid = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    const accepted = await app.inject({ method: 'POST', url: `/bids/${bid.json().id}/accept`, headers: c.headers });
    await app.inject({
      method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
      payload: { outcome: 'authorized' },
    });

    const res = await drop(c.job.id, p.headers);
    expect(res.json().status).toBe('CANCELLED_BY_PROVIDER');
    expect(res.json().redispatch).toBeNull();
  });

  it('still costs the provider a strike, whether or not the booking was saved', async () => {
    // Otherwise the penalty for letting somebody down depends on that customer's luck.
    const { jobId } = await bookingWithRunnerUp('+919333000009', '+919333000010', '+919333000011');
    const dropper = await bookingProviderId('+919333000010');
    await drop(jobId, (await bookingProviderHeaders('+919333000010')) ?? {});

    const strikes = await app.ctx.store.finance.listStrikes(dropper);
    expect(strikes.some((s) => s.job_id === jobId && s.severity === 'MAJOR')).toBe(true);
  });

  it('never offers the booking back to the person who just dropped it', async () => {
    const { jobId } = await bookingWithRunnerUp('+919333000012', '+919333000013', '+919333000014');
    const dropperHeaders = (await bookingProviderHeaders('+919333000013')) ?? {};
    await drop(jobId, dropperHeaders);

    const theirFeed = await app.inject({ method: 'GET', url: '/me/redispatch-invitations', headers: dropperHeaders });
    expect(theirFeed.json().items).toHaveLength(0);
  });
});

describe('two people answering at once', () => {
  it('gives the booking to one of them and tells the other plainly', async () => {
    // Two professionals arriving at the same address is worse than none. The second answer is a
    // conflict with a reason, not a 500 and not a silent second assignment.
    const c = await customerWithOpenJob('+919333000015');
    const winner = await makeProvider('+919333000016');
    const a = await makeProvider('+919333000017');
    const b = await makeProvider('+919333000018');

    for (const p of [a, b]) {
      await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    }
    const winning = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: winner.headers, payload: BID });
    const accepted = await app.inject({ method: 'POST', url: `/bids/${winning.json().id}/accept`, headers: c.headers });
    await app.inject({
      method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
      payload: { outcome: 'authorized' },
    });
    await drop(c.job.id, winner.headers);

    const [feedA, feedB] = await Promise.all([
      app.inject({ method: 'GET', url: '/me/redispatch-invitations', headers: a.headers }),
      app.inject({ method: 'GET', url: '/me/redispatch-invitations', headers: b.headers }),
    ]);
    const idA = feedA.json().items[0].id;
    const idB = feedB.json().items[0].id;

    const first = await app.inject({ method: 'POST', url: `/redispatch-invitations/${idA}/respond`, headers: a.headers, payload: { accept: true } });
    const second = await app.inject({ method: 'POST', url: `/redispatch-invitations/${idB}/respond`, headers: b.headers, payload: { accept: true } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);

    const assignment = await app.ctx.store.negotiation.getActiveAssignment(c.job.id);
    expect(assignment!.provider_id).toBe(a.userId);
  });
});

describe('when the clock runs out', () => {
  it('gives up, tells the customer and releases the money', async () => {
    const { c, jobId } = await bookingWithRunnerUp('+919333000019', '+919333000020', '+919333000021');
    await drop(jobId, (await bookingProviderHeaders('+919333000020')) ?? {});

    // Wind the deadline back rather than waiting twenty minutes.
    await app.ctx.store.jobs.update(jobId, { redispatch_deadline: new Date(Date.now() - 1000) });
    const handled = await app.ctx.services.scheduler.runTask('expire-redispatch');
    expect(handled.handled).toBeGreaterThanOrEqual(1);

    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(view.json().status).toBe('CANCELLED_BY_PROVIDER');

    // The hold is released. A booking that never happened must not leave money sitting on
    // somebody's card.
    const payments = await app.ctx.store.payments.listForJob(jobId);
    expect(payments.every((p) => p.status !== 'AUTHORIZED')).toBe(true);
  });

  it('stops showing an invitation for a booking that is no longer open', async () => {
    const { rival, jobId } = await bookingWithRunnerUp('+919333000022', '+919333000023', '+919333000024');
    await drop(jobId, (await bookingProviderHeaders('+919333000023')) ?? {});
    await app.ctx.store.jobs.update(jobId, { redispatch_deadline: new Date(Date.now() - 1000) });
    await app.ctx.services.scheduler.runTask('expire-redispatch');

    // Listed and then refused when tapped is a worse experience than not listed.
    const feed = await app.inject({ method: 'GET', url: '/me/redispatch-invitations', headers: rival.headers });
    expect(feed.json().items).toHaveLength(0);
  });
});

// --- small helpers that re-derive a provider's headers/id from their phone -------------------
const providerCache = new Map<string, { headers: Record<string, string>; userId: string }>();

async function bookingProviderHeaders(phone: string) {
  return (await rememberProvider(phone)).headers;
}
async function bookingProviderId(phone: string) {
  return (await rememberProvider(phone)).userId;
}
async function rememberProvider(phone: string) {
  const hit = providerCache.get(phone);
  if (hit) return hit;
  // Logging in again is the cheapest way to get a token for somebody the helper above created.
  const res = await login(app, phone);
  const entry = { headers: bearer(res.accessToken, { 'x-active-role': 'PROVIDER' }), userId: res.user.id };
  providerCache.set(phone, entry);
  return entry;
}
