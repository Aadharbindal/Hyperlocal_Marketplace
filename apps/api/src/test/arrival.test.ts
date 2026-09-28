import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * Knowing how far away the professional is - and the rather larger number of cases where the
 * honest answer is that we will not say.
 *
 * This is a worker's live position, held by the platform they earn from. The tests that matter
 * most here are the refusals: that nothing is stored before they set off or after they arrive,
 * that the row disappears on its own rather than because some code path remembered to delete it,
 * and that the shareable tracking link never carries any of it.
 */

let app: TestApp;
let plumbingId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };
/** A point a few kilometres from the seeded Delhi address used below. */
const AWAY = { lat: 28.64, lng: 77.24, accuracyM: 15 };

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

async function enRouteJob(customerPhone: string, providerPhone: string) {
  const cust = await login(app, customerPhone);
  const ch = bearer(cust.accessToken);
  await app.inject({ method: 'POST', url: '/me/roles', headers: ch, payload: { role: 'CUSTOMER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: ch,
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  const job = await app.inject({
    method: 'POST', url: '/jobs', headers: ch,
    payload: { categoryId: plumbingId, addressId: addr.json().id, description: 'Kitchen tap leaking since morning' },
  });
  await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/submit`, headers: ch });

  const prov = await login(app, providerPhone);
  const ph = bearer(prov.accessToken, { 'x-active-role': 'PROVIDER' });
  await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(prov.accessToken), payload: { role: 'PROVIDER' } });
  const paddr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: bearer(prov.accessToken),
    payload: { label: 'Shop', line1: '4, Jor Bagh Market', city: 'Delhi', pincode: '110003' },
  });
  await app.inject({
    method: 'PUT', url: '/provider/profile', headers: ph,
    payload: { businessName: `Services ${providerPhone.slice(-4)}`, serviceRadiusKm: 8, baseAddressId: paddr.json().id, skillIds: plumbingSkills },
  });
  const profile = await app.ctx.store.users.getProviderProfile(prov.user.id);
  await app.ctx.store.users.upsertProviderProfile({ ...profile!, verification_status: 'VERIFIED' });
  await app.inject({ method: 'POST', url: '/provider/availability', headers: ph, payload: { isAvailable: true } });

  const bid = await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/bids`, headers: ph, payload: BID });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${bid.json().id}/accept`, headers: ch });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: ch,
    payload: { outcome: 'authorized' },
  });

  const jobId = job.json().id as string;
  return { ch, ph, jobId, customerId: cust.user.id, providerId: prov.user.id };
}

const setOff = (jobId: string, ph: Record<string, string>) =>
  app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: ph, payload: { to: 'EN_ROUTE', etaMinutes: 30 } });

const report = (jobId: string, ph: Record<string, string>, body = AWAY) =>
  app.inject({ method: 'POST', url: `/jobs/${jobId}/position`, headers: ph, payload: body });

const arrival = (jobId: string, h: Record<string, string>) =>
  app.inject({ method: 'GET', url: `/jobs/${jobId}/arrival`, headers: h });

describe('while the professional is on their way', () => {
  it('turns a position into a distance and a time for the customer', async () => {
    const { ch, ph, jobId } = await enRouteJob('+919444000001', '+919444000002');
    await setOff(jobId, ph);

    expect((await report(jobId, ph)).statusCode).toBe(204);

    const view = await arrival(jobId, ch);
    expect(view.json().kind).toBe('ON_THE_WAY');
    expect(view.json().distanceKm).toBeGreaterThan(0);
    expect(view.json().etaMinutes).toBeGreaterThanOrEqual(1);
    // Never coordinates. A distance answers the question; a point on a map is something you can
    // follow, and a screenshot of this screen should disclose nothing about where somebody is.
    expect(view.json().lat).toBeUndefined();
    expect(view.json().lng).toBeUndefined();
  });

  it('stores nothing more precise than a street', async () => {
    const { ph, jobId } = await enRouteJob('+919444000003', '+919444000004');
    await setOff(jobId, ph);
    await report(jobId, ph, { lat: 28.6412345678, lng: 77.2456789012, accuracyM: 5 });

    const stored = await app.ctx.store.arrival.latest(jobId);
    // Blunted to three decimals (~110 m) on the way in, not on the way out.
    expect(Number(stored!.lat)).toBe(28.641);
    expect(Number(stored!.lng)).toBe(77.246);
  });

  it('keeps only the latest position, never a trail', async () => {
    const { ph, jobId } = await enRouteJob('+919444000005', '+919444000006');
    await setOff(jobId, ph);
    await report(jobId, ph, { lat: 28.64, lng: 77.24, accuracyM: 10 });
    await report(jobId, ph, { lat: 28.62, lng: 77.23, accuracyM: 10 });

    const stored = await app.ctx.store.arrival.latest(jobId);
    expect(Number(stored!.lat)).toBe(28.62);
    // There is no history to ask for, which is the point: the database knows where somebody is
    // and has no idea where they have been.
    expect(Object.keys(app.ctx.store.arrival)).not.toContain('list');
  });
});

describe('what is refused', () => {
  it('will not accept a position before they have set off', async () => {
    const { ph, jobId } = await enRouteJob('+919444000007', '+919444000008');
    const r = await report(jobId, ph);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.details.reason).toBe('not_en_route');
  });

  it('forgets where they were the moment they arrive', async () => {
    const { ch, ph, jobId } = await enRouteJob('+919444000009', '+919444000010');
    await setOff(jobId, ph);
    await report(jobId, ph);
    expect(await app.ctx.store.arrival.latest(jobId)).not.toBeNull();

    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: ph, payload: { to: 'ARRIVED' } });

    // Deleted, not merely hidden. In Postgres this is a trigger on the status change, so no
    // application path can forget to do it.
    expect(await app.ctx.store.arrival.latest(jobId)).toBeNull();
    expect((await arrival(jobId, ch)).json().kind).toBe('NOT_TRACKING');
  });

  it('will not let somebody who is not on the job report a position', async () => {
    const { ph, jobId } = await enRouteJob('+919444000011', '+919444000012');
    await setOff(jobId, ph);

    const stranger = await login(app, '+919444000013');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(stranger.accessToken), payload: { role: 'PROVIDER' } });
    const r = await report(jobId, bearer(stranger.accessToken, { 'x-active-role': 'PROVIDER' }));
    expect([403, 404]).toContain(r.statusCode);
  });

  it('tells the provider nothing about where the customer thinks they are', async () => {
    // The provider does not need this screen, and giving them one would mean the platform
    // showing a worker a live readout of itself watching them.
    const { ph, jobId } = await enRouteJob('+919444000014', '+919444000015');
    await setOff(jobId, ph);
    await report(jobId, ph);
    expect((await arrival(jobId, ph)).json().kind).toBe('NOT_TRACKING');
  });

  it('keeps live position off the shareable tracking link', async () => {
    const { ch, ph, jobId } = await enRouteJob('+919444000016', '+919444000017');
    await setOff(jobId, ph);
    await report(jobId, ph);

    const job = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: ch });
    const token = job.json().trackingUrlToken as string;
    const tracked = await app.inject({ method: 'GET', url: `/track/${token}` });

    expect(tracked.statusCode).toBe(200);
    // That URL exists to be forwarded to a neighbour or a building guard. Anything in this body
    // is effectively public.
    const body = JSON.stringify(tracked.json());
    expect(body).not.toMatch(/lat|lng|distanceKm|etaMinutes/);
  });

  it('says nothing when the phone was only guessing', async () => {
    const { ch, ph, jobId } = await enRouteJob('+919444000018', '+919444000019');
    await setOff(jobId, ph);
    await report(jobId, ph, { lat: 28.64, lng: 77.24, accuracyM: 4000 });

    // A confident "3 km away" built on a cell-tower fix is a number with nothing behind it.
    expect((await arrival(jobId, ch)).json().kind).toBe('NOT_TRACKING');
  });

  it('admits it has lost them rather than showing a stale position as live', async () => {
    const { ch, ph, jobId } = await enRouteJob('+919444000020', '+919444000021');
    await setOff(jobId, ph);
    await report(jobId, ph);

    await app.ctx.store.arrival.report({
      job_id: jobId,
      provider_id: (await app.ctx.store.negotiation.getActiveAssignment(jobId))!.provider_id,
      lat: AWAY.lat, lng: AWAY.lng, accuracy_m: 15,
      reported_at: new Date(Date.now() - 10 * 60_000),
    });

    const view = await arrival(jobId, ch);
    expect(view.json().kind).toBe('STALE');
    expect(view.json().lastSeenSecondsAgo).toBeGreaterThan(180);
  });
});
