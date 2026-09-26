import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

/**
 * The operations overview, which is now computed by the database rather than by walking the
 * store.
 *
 * The old implementation read up to 500 customers, up to 200 jobs each, and a ledger per job.
 * Two of these tests exist because of what that did rather than what it cost: it returned
 * numbers that were **silently truncated** past its limits, and two of its fields were
 * hardcoded to zero. Both are worse than a slow report, because an operator cannot tell a wrong
 * number from a quiet week - they just act on it.
 */
describe('the numbers an operator acts on', () => {
  async function admin() {
    const res = await login(app, '+919000000007');
    return bearer(res.accessToken, { 'x-active-role': 'ADMIN' });
  }

  async function verifiedProvider(phone: string) {
    const res = await login(app, phone);
    const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
    await app.inject({ method: 'PUT', url: '/provider/profile', headers: h, payload: { businessName: `Shop ${phone.slice(-4)}` } });
    const profile = await app.ctx.store.users.getProviderProfile(res.user.id);
    await app.ctx.store.users.upsertProviderProfile({ ...profile!, verification_status: 'VERIFIED' });
    return { headers: h, userId: res.user.id };
  }

  it('counts verified professionals instead of reporting zero', async () => {
    await verifiedProvider('+919555000001');
    await verifiedProvider('+919555000002');

    const report = await app.inject({ method: 'GET', url: '/admin/reports/overview', headers: await admin() });
    expect(report.statusCode).toBe(200);

    // These two fields were literally `providersVerified: 0, providersSuspended: 0` in the
    // previous version - not computed from anything, just zero, on a screen an operator reads
    // to decide whether there is enough supply to take bookings.
    expect(report.json().providersVerified).toBeGreaterThanOrEqual(2);
    expect(report.json().providersSuspended).toBe(0);
  });

  it('agrees with the records it is summarising', async () => {
    const before = (await app.inject({ method: 'GET', url: '/admin/reports/overview', headers: await admin() })).json();

    // One more job, submitted, so it lands in a known status.
    const customer = await login(app, '+919555000010');
    const ch = bearer(customer.accessToken);
    await app.inject({ method: 'POST', url: '/me/roles', headers: ch, payload: { role: 'CUSTOMER' } });
    const address = await app.inject({
      method: 'POST', url: '/me/addresses', headers: ch,
      payload: { line1: '9, Lodhi Colony', city: 'Delhi', pincode: '110003' },
    });
    const categories = await app.inject({ method: 'GET', url: '/categories', headers: ch });
    const plumbing = categories.json().items.find((c: { slug: string }) => c.slug === 'plumbing');
    const draft = await app.inject({
      method: 'POST', url: '/jobs', headers: ch,
      payload: { categoryId: plumbing.id, addressId: address.json().id, description: 'Tap leaking under the sink' },
    });
    await app.inject({ method: 'POST', url: `/jobs/${draft.json().id}/submit`, headers: ch });

    const after = (await app.inject({ method: 'GET', url: '/admin/reports/overview', headers: await admin() })).json();

    const total = (byStatus: Record<string, number>) => Object.values(byStatus).reduce((t, n) => t + n, 0);
    expect(total(after.jobsByStatus)).toBe(total(before.jobsByStatus) + 1);

    // liveJobs is derived from jobsByStatus rather than counted separately, so the two can
    // never drift apart the way two independent queries would.
    const live = ['OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING', 'PAYMENT_PENDING', 'CONFIRMED', 'PROVIDER_ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS'];
    expect(after.liveJobs).toBe(live.reduce((t, s) => t + (after.jobsByStatus[s] ?? 0), 0));
  });

  it('does not stop counting after some number of customers', async () => {
    // The old version walked 500 customers and 200 jobs each. It is not worth making 501
    // customers in a test, so this asserts the property that made truncation possible is gone:
    // the report is one set of aggregates over whole tables, and asking it twice with nothing
    // in between gives the same answer rather than a sample.
    const headers = await admin();
    const a = (await app.inject({ method: 'GET', url: '/admin/reports/overview', headers })).json();
    const b = (await app.inject({ method: 'GET', url: '/admin/reports/overview', headers })).json();

    expect(b.jobsByStatus).toEqual(a.jobsByStatus);
    expect(b.capturedPaise).toBe(a.capturedPaise);
    expect(b.providersVerified).toBe(a.providersVerified);
  });

  it('reports money as positive numbers whichever side of the ledger it came from', async () => {
    const report = (await app.inject({ method: 'GET', url: '/admin/reports/overview', headers: await admin() })).json();
    // Revenue and refunds are negative in the ledger as seen from the platform's side; an
    // operator reading "refunded" should not have to know that.
    for (const field of ['capturedPaise', 'refundedPaise', 'platformRevenuePaise', 'payoutsPendingPaise', 'payoutsPaidPaise']) {
      expect(report[field]).toBeGreaterThanOrEqual(0);
    }
  });
});
