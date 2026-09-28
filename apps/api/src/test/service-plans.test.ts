import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * Work that comes back.
 *
 * The thing these tests defend most is the sweep's idempotency. It runs hourly and will
 * sometimes fail halfway - a deploy, a database blip, a category disabled between two
 * statements - and the failure that must never happen is a customer waking up to fourteen
 * identical bookings because each tick tried again. Every due date is claimed exactly once,
 * before the booking is attempted, and several tests below exist purely to prove that.
 */

let app: TestApp;
let plumbingId: string;

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  plumbingId = cats.json().items.find((c: { slug: string }) => c.slug === 'plumbing').id;
});
afterAll(async () => {
  await app.close();
});

const isoDay = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function customer(phone: string) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken);
  await app.inject({ method: 'POST', url: '/me/roles', headers: h, payload: { role: 'CUSTOMER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: h,
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  return { headers: h, userId: res.user.id, addressId: addr.json().id as string };
}

const createPlan = (h: Record<string, string>, addressId: string, over: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST', url: '/me/service-plans', headers: h,
    payload: { categoryId: plumbingId, addressId, intervalDays: 90, firstDueOn: isoDay(30), description: 'Quarterly geyser service', ...over },
  });

const sweep = () => app.ctx.services.scheduler.runTask('book-service-plans');

describe('setting up a repeat', () => {
  it('creates a plan and says the interval in words', async () => {
    const c = await customer('+919555000001');
    const r = await createPlan(c.headers, c.addressId);
    expect(r.statusCode).toBe(201);
    expect(r.json().intervalLabel).toBe('every 3 months');
    expect(r.json().status).toBe('ACTIVE');
    // No price anywhere on a plan. It opens a booking; the booking is quoted and paid for.
    expect(JSON.stringify(r.json())).not.toMatch(/paise|amount|price/i);
  });

  it('refuses a first visit in the past', async () => {
    // Otherwise the very next sweep opens it, which is never what somebody means.
    const c = await customer('+919555000002');
    const r = await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(-1) });
    expect(r.statusCode).toBe(400);
  });

  it('refuses a second plan for the same work at the same address', async () => {
    // A duplicate would silently double every future booking.
    const c = await customer('+919555000003');
    expect((await createPlan(c.headers, c.addressId)).statusCode).toBe(201);
    expect((await createPlan(c.headers, c.addressId)).statusCode).toBe(409);
  });

  it('refuses an address that is not theirs', async () => {
    const a = await customer('+919555000004');
    const b = await customer('+919555000005');
    const r = await createPlan(a.headers, b.addressId);
    expect(r.statusCode).toBe(404);
  });
});

describe('when a plan falls due', () => {
  it('opens an ordinary booking and moves the schedule on', async () => {
    const c = await customer('+919555000006');
    const plan = await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(1), leadDays: 3 });

    expect((await sweep()).handled).toBeGreaterThanOrEqual(1);

    const jobs = await app.inject({ method: 'GET', url: '/me/jobs', headers: c.headers });
    const booked = jobs.json().items.find((j: { status: string }) => j.status === 'OPEN_FOR_BIDS');
    expect(booked).toBeTruthy();

    const after = await app.inject({ method: 'GET', url: '/me/service-plans', headers: c.headers });
    const mine = after.json().items.find((p: { id: string }) => p.id === plan.json().id);
    // Counted from the date that was due, so a quarterly service keeps its rhythm.
    expect(mine.nextDueOn).not.toBe(plan.json().nextDueOn);
    expect(mine.recent[0]).toMatchObject({ outcome: 'BOOKED' });
  });

  it('does not open the same visit twice, however often the sweep runs', async () => {
    // The whole reason the due date is claimed before the booking is attempted.
    const c = await customer('+919555000007');
    await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(1) });

    await sweep();
    await sweep();
    await sweep();

    const jobs = await app.inject({ method: 'GET', url: '/me/jobs', headers: c.headers });
    const fromPlan = jobs.json().items.filter((j: { status: string }) => j.status === 'OPEN_FOR_BIDS');
    expect(fromPlan).toHaveLength(1);
  });

  it('waits rather than stacking a second booking on an unfinished one', async () => {
    const c = await customer('+919555000008');
    const plan = await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(1), intervalDays: 14 });
    await sweep();

    // Wind the plan forward so it is due again while the first booking is still open.
    await app.ctx.store.servicePlans.update(plan.json().id, { next_due_on: new Date() });
    await sweep();

    const jobs = await app.inject({ method: 'GET', url: '/me/jobs', headers: c.headers });
    expect(jobs.json().items.filter((j: { status: string }) => j.status === 'OPEN_FOR_BIDS')).toHaveLength(1);

    const after = await app.inject({ method: 'GET', url: '/me/service-plans', headers: c.headers });
    const mine = after.json().items.find((p: { id: string }) => p.id === plan.json().id);
    expect(mine.recent.some((o: { detail: string | null }) => o.detail === 'ALREADY_OPEN')).toBe(true);
  });

  it('leaves a paused plan alone', async () => {
    const c = await customer('+919555000009');
    const plan = await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(1) });
    await app.inject({ method: 'PATCH', url: `/me/service-plans/${plan.json().id}`, headers: c.headers, payload: { status: 'PAUSED' } });

    await sweep();
    const jobs = await app.inject({ method: 'GET', url: '/me/jobs', headers: c.headers });
    expect(jobs.json().items.filter((j: { status: string }) => j.status === 'OPEN_FOR_BIDS')).toHaveLength(0);
  });

  it('records why it could not book, rather than passing in silence', async () => {
    // A plan that has quietly produced nothing for six months is the failure this must not have.
    const c = await customer('+919555000010');
    const plan = await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(1) });
    await app.inject({ method: 'DELETE', url: `/me/addresses/${c.addressId}`, headers: c.headers });

    await sweep();
    const after = await app.inject({ method: 'GET', url: '/me/service-plans', headers: c.headers });
    const mine = after.json().items.find((p: { id: string }) => p.id === plan.json().id);
    expect(mine.recent[0]).toMatchObject({ outcome: 'SKIPPED', detail: 'ADDRESS_GONE' });
  });
});

describe('the customer staying in control', () => {
  it('skips one visit without ending the arrangement', async () => {
    // The alternative people reach for is cancelling, and most never set it up again.
    const c = await customer('+919555000011');
    const plan = await createPlan(c.headers, c.addressId, { firstDueOn: isoDay(1) });
    const before = plan.json().nextDueOn;

    const skipped = await app.inject({
      method: 'POST', url: `/me/service-plans/${plan.json().id}/skip-next`,
      headers: c.headers, payload: { reason: 'Away that week' },
    });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().status).toBe('ACTIVE');
    expect(skipped.json().nextDueOn).not.toBe(before);

    // And the skipped date does not come back on the next sweep.
    await sweep();
    const jobs = await app.inject({ method: 'GET', url: '/me/jobs', headers: c.headers });
    expect(jobs.json().items.filter((j: { status: string }) => j.status === 'OPEN_FOR_BIDS')).toHaveLength(0);
  });

  it('pauses and resumes', async () => {
    const c = await customer('+919555000012');
    const plan = await createPlan(c.headers, c.addressId);
    const id = plan.json().id;

    expect((await app.inject({ method: 'PATCH', url: `/me/service-plans/${id}`, headers: c.headers, payload: { status: 'PAUSED' } })).json().status).toBe('PAUSED');
    expect((await app.inject({ method: 'PATCH', url: `/me/service-plans/${id}`, headers: c.headers, payload: { status: 'ACTIVE' } })).json().status).toBe('ACTIVE');
  });

  it('lets a cancelled plan be replaced by a new one for the same work', async () => {
    // The unique index is partial on status precisely so this works.
    const c = await customer('+919555000013');
    const plan = await createPlan(c.headers, c.addressId);
    await app.inject({ method: 'PATCH', url: `/me/service-plans/${plan.json().id}`, headers: c.headers, payload: { status: 'CANCELLED' } });
    expect((await createPlan(c.headers, c.addressId)).statusCode).toBe(201);
  });

  it('will not let somebody touch another account plan', async () => {
    const a = await customer('+919555000014');
    const b = await customer('+919555000015');
    const plan = await createPlan(a.headers, a.addressId);
    const r = await app.inject({ method: 'PATCH', url: `/me/service-plans/${plan.json().id}`, headers: b.headers, payload: { status: 'CANCELLED' } });
    expect(r.statusCode).toBe(404);
  });
});
