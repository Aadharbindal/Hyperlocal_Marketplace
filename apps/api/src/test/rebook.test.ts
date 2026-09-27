import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let customer: { headers: Record<string, string>; userId: string };

beforeAll(async () => {
  app = await makeApp();
  const res = await login(app, '+919788000001');
  customer = { headers: bearer(res.accessToken), userId: res.user.id };
  await app.inject({ method: 'POST', url: '/me/roles', headers: customer.headers, payload: { role: 'CUSTOMER' } });
});
afterAll(async () => {
  await app.close();
});

/**
 * Offering somebody the work they have already had done.
 *
 * The app remembered nothing: a customer who had let a stranger into their home, paid and been
 * happy came back to the same blank grid as a first-time visitor. These tests are less about
 * the shortcut working than about what it must refuse to carry over - a repeat is a new job,
 * and anything pre-filled that is not still true is the app telling somebody something false.
 */
describe('booking the same thing again', () => {
  async function address() {
    const r = await app.inject({
      method: 'POST', url: '/me/addresses', headers: customer.headers,
      payload: { line1: '21, Lodhi Colony', city: 'Delhi', pincode: '110003' },
    });
    return r.json().id as string;
  }

  async function finishedJob(description: string) {
    const addressId = await address();
    const categories = await app.inject({ method: 'GET', url: '/categories', headers: customer.headers });
    const plumbing = categories.json().items.find((c: { slug: string }) => c.slug === 'plumbing');
    const draft = await app.inject({
      method: 'POST', url: '/jobs', headers: customer.headers,
      payload: { categoryId: plumbing.id, addressId, description },
    });
    const id = draft.json().id as string;
    // Driven straight to COMPLETED through the store: the point here is the repeat, and the
    // whole booking journey is already covered by its own suite.
    const job = await app.ctx.store.jobs.get(id);
    await app.ctx.store.jobs.update(id, { status: 'COMPLETED', completed_at: new Date(), submitted_at: new Date() });
    return { jobId: id, categoryId: plumbing.id as string, addressId, previous: job };
  }

  it('offers back the work that is finished, with who did it', async () => {
    const { categoryId } = await finishedJob('Tap dripping into the kitchen cupboard');

    const res = await app.inject({ method: 'GET', url: '/me/rebook', headers: customer.headers });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ categoryId: string; description: string }>;
    expect(items.some((i) => i.categoryId === categoryId)).toBe(true);
  });

  it('does not offer to repeat something still in progress', async () => {
    const addressId = await address();
    const categories = await app.inject({ method: 'GET', url: '/categories', headers: customer.headers });
    const electrical = categories.json().items.find((c: { slug: string }) => c.slug === 'electrical');
    const draft = await app.inject({
      method: 'POST', url: '/jobs', headers: customer.headers,
      payload: { categoryId: electrical.id, addressId, description: 'Fan making a grinding noise upstairs' },
    });
    await app.inject({ method: 'POST', url: `/jobs/${draft.json().id}/submit`, headers: customer.headers });

    const res = await app.inject({ method: 'GET', url: '/me/rebook', headers: customer.headers });
    const items = res.json().items as Array<{ categoryId: string }>;
    // "Book it again" over a job somebody is still waiting on is the app failing to read the room.
    expect(items.some((i) => i.categoryId === electrical.id)).toBe(false);
  });

  it('shows one card per kind of work, not a history', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/rebook', headers: customer.headers });
    const items = res.json().items as Array<{ categoryId: string }>;
    const ids = items.map((i) => i.categoryId);
    // Five "Plumbing" cards would be a list of everything that ever happened; this is a shortcut.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts a real draft with what is still true', async () => {
    const { jobId, categoryId, addressId } = await finishedJob('Bathroom tap leaking at the base');

    const res = await app.inject({ method: 'POST', url: `/jobs/from/${jobId}`, headers: customer.headers });
    expect(res.statusCode).toBe(201);
    const draft = res.json();

    expect(draft.status).toBe('DRAFT');
    expect(draft.category.id).toBe(categoryId);
    expect(draft.address?.id ?? draft.addressId).toBe(addressId);
    expect(draft.description).toBe('Bathroom tap leaking at the base');
  });

  it('carries over no price and no professional', async () => {
    const { jobId } = await finishedJob('Kitchen drain slow again');

    const draft = (await app.inject({ method: 'POST', url: `/jobs/from/${jobId}`, headers: customer.headers })).json();

    // A repeat has to be quoted on its own. Pre-filling last time's number would be quoting
    // somebody a price nobody has agreed to, and pre-filling the professional would be booking
    // on their behalf without asking whether they are free.
    expect(draft.quote ?? null).toBeNull();
    expect(draft.provider ?? null).toBeNull();
  });

  it('will not repeat a job that is not finished', async () => {
    const addressId = await address();
    const categories = await app.inject({ method: 'GET', url: '/categories', headers: customer.headers });
    const carpentry = categories.json().items.find((c: { slug: string }) => c.slug === 'carpentry');
    const draft = await app.inject({
      method: 'POST', url: '/jobs', headers: customer.headers,
      payload: { categoryId: carpentry.id, addressId, description: 'Cupboard door hinge has come away' },
    });

    const res = await app.inject({ method: 'POST', url: `/jobs/from/${draft.json().id}`, headers: customer.headers });
    expect(res.statusCode).toBe(409);
  });

  it('will not repeat somebody else job', async () => {
    const { jobId } = await finishedJob('Geyser not heating in the morning');
    const other = await login(app, '+919788000002');
    const theirs = bearer(other.accessToken);
    await app.inject({ method: 'POST', url: '/me/roles', headers: theirs, payload: { role: 'CUSTOMER' } });

    const res = await app.inject({ method: 'POST', url: `/jobs/from/${jobId}`, headers: theirs });
    // 404 rather than 403: somebody else's booking history is not theirs to learn the shape of.
    expect(res.statusCode).toBe(404);
  });
});
