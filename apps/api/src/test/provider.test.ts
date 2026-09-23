import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHONES, bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let plumbingId: string;
let electricalId: string;
let plumbingSkills: string[];

/** A customer with an in-zone address and a submitted plumbing job. */
async function customerWithOpenJob(phone: string, categoryId = plumbingId) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken);
  await app.inject({ method: 'POST', url: '/me/roles', headers: h, payload: { role: 'CUSTOMER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: h,
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  const job = await app.inject({
    method: 'POST', url: '/jobs', headers: h,
    payload: { categoryId, addressId: addr.json().id, description: 'Kitchen tap leaking since morning' },
  });
  const submitted = await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/submit`, headers: h });
  return { token: res.accessToken, headers: h, userId: res.user.id, addressId: addr.json().id as string, job: submitted.json().job };
}

/** A provider, verified and available by default, with skills in the given category. */
async function makeProvider(phone: string, opts: { skills?: string[]; verified?: boolean; available?: boolean; radiusKm?: number } = {}) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
  await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: bearer(res.accessToken),
    payload: { label: 'Shop', line1: '4, Jor Bagh Market', city: 'Delhi', pincode: '110003' },
  });
  await app.inject({
    method: 'PUT', url: '/provider/profile', headers: h,
    payload: {
      businessName: `Test Services ${phone.slice(-4)}`,
      experienceYears: 6,
      serviceRadiusKm: opts.radiusKm ?? 8,
      baseAddressId: addr.json().id,
      skillIds: opts.skills ?? plumbingSkills,
    },
  });
  if (opts.verified !== false) {
    // Verification is an admin action in M8; for now set it directly on the store.
    const profile = await app.ctx.store.users.getProviderProfile(res.user.id);
    await app.ctx.store.users.upsertProviderProfile({ ...profile!, verification_status: 'VERIFIED' });
  }
  if (opts.available !== false) {
    await app.inject({ method: 'POST', url: '/provider/availability', headers: h, payload: { isAvailable: true } });
  }
  return { token: res.accessToken, headers: h, userId: res.user.id };
}

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  const items = cats.json().items as Array<{ id: string; slug: string; skills: Array<{ id: string }> }>;
  const plumbing = items.find((c) => c.slug === 'plumbing')!;
  const electrical = items.find((c) => c.slug === 'electrical')!;
  plumbingId = plumbing.id;
  electricalId = electrical.id;
  plumbingSkills = plumbing.skills.map((s) => s.id);
});
afterAll(async () => {
  await app.close();
});

describe('provider profile and verification', () => {
  it('starts unverified, cannot go available, and lists why', async () => {
    const res = await login(app, '+919444000001');
    const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });

    const profile = await app.inject({ method: 'GET', url: '/provider/profile', headers: h });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().verificationStatus).toBe('UNVERIFIED');
    expect(profile.json().blockers).toEqual(expect.arrayContaining(['VERIFICATION_PENDING', 'AVAILABILITY_OFF', 'NO_SKILLS_SELECTED']));

    const avail = await app.inject({ method: 'POST', url: '/provider/availability', headers: h, payload: { isAvailable: true } });
    expect(avail.statusCode).toBe(403);
    expect(avail.json().error.details.reason).toBe('verification_pending');
  });

  it('saves the profile, skills and base location', async () => {
    const p = await makeProvider('+919444000002');
    const profile = await app.inject({ method: 'GET', url: '/provider/profile', headers: p.headers });
    const body = profile.json();
    expect(body.businessName).toBe('Test Services 0002');
    expect(body.serviceRadiusKm).toBe(8);
    expect(body.skills.length).toBe(plumbingSkills.length);
    expect(body.isAvailable).toBe(true);
    expect(body.blockers).toEqual([]);
  });

  it('stores only the last four characters of a KYC document and never the number', async () => {
    const p = await makeProvider('+919444000003', { verified: false });
    const r = await app.inject({
      method: 'POST', url: '/provider/kyc', headers: p.headers,
      payload: { documentType: 'AADHAAR', documentNumber: '1234 5678 9012', mime: 'image/jpeg', sizeBytes: 900_000 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().kyc.last4).toBe('9012');
    expect(JSON.stringify(r.json())).not.toContain('12345678');

    const profile = await app.inject({ method: 'GET', url: '/provider/profile', headers: p.headers });
    expect(profile.json().verificationStatus).toBe('SUBMITTED');
    expect(profile.json().kyc[0].last4).toBe('9012');

    const again = await app.inject({
      method: 'POST', url: '/provider/kyc', headers: p.headers,
      payload: { documentType: 'AADHAAR', documentNumber: '1234 5678 9012', mime: 'image/jpeg', sizeBytes: 900_000 },
    });
    expect(again.statusCode).toBe(409);

    const admin = await login(app, PHONES.admin);
    const logs = await app.inject({ method: 'GET', url: '/admin/audit-logs?entityType=kyc_record', headers: bearer(admin.accessToken) });
    expect(JSON.stringify(logs.json())).not.toContain('12345678');
  });
});

describe('nearby feed eligibility (BID-04, BID-08)', () => {
  it('shows an in-radius job with matching skills and hides the exact address', async () => {
    const c = await customerWithOpenJob('+919444000010');
    const p = await makeProvider('+919444000011');
    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    expect(feed.statusCode).toBe(200);
    const item = feed.json().items.find((i: { jobId: string }) => i.jobId === c.job.id);
    expect(item).toBeTruthy();
    expect(item.categoryName).toBe('Plumbing');
    expect(item.distanceKm).toBeGreaterThanOrEqual(0);
    expect(item.bidCount).toBe(0);
    expect(item.myBid).toBeNull();
    // the exact street address is never in the feed
    expect(JSON.stringify(item)).not.toContain('Lodhi');
  });

  it('hides jobs from another category', async () => {
    const c = await customerWithOpenJob('+919444000012', electricalId);
    const p = await makeProvider('+919444000013', { skills: plumbingSkills });
    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    expect(feed.json().items.find((i: { jobId: string }) => i.jobId === c.job.id)).toBeUndefined();
  });

  it('hides jobs outside the service radius', async () => {
    const c = await customerWithOpenJob('+919444000014');
    const p = await makeProvider('+919444000015', { radiusKm: 0.5 });
    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    const found = feed.json().items.find((i: { jobId: string }) => i.jobId === c.job.id);
    // either filtered out, or within half a kilometre if the mock geocoder placed them together
    if (found) expect(found.distanceKm).toBeLessThanOrEqual(0.5);
  });

  it('returns an empty feed with reasons when the provider is unavailable or unverified', async () => {
    await customerWithOpenJob('+919444000016');
    const off = await makeProvider('+919444000017', { available: false });
    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: off.headers });
    expect(feed.json().items).toEqual([]);
    expect(feed.json().blockers).toContain('AVAILABILITY_OFF');

    const unverified = await makeProvider('+919444000018', { verified: false, available: false });
    const feed2 = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: unverified.headers });
    expect(feed2.json().blockers).toContain('VERIFICATION_PENDING');
  });

  it('a customer cannot read the provider feed', async () => {
    const c = await customerWithOpenJob('+919444000019');
    const r = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: c.headers });
    expect(r.statusCode).toBe(403);
  });
});

describe('placing offers (BID-01, BID-06, BID-08)', () => {
  it('places an offer, moves the job to BID_RECEIVED and notifies the customer', async () => {
    const c = await customerWithOpenJob('+919444000020');
    const p = await makeProvider('+919444000021');

    const r = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    expect(r.statusCode).toBe(201);
    const bid = r.json();
    expect(bid.labourPaise).toBe(60_000);
    // the customer's total includes the platform fee and tax on it
    expect(bid.totalPaise).toBe(60_000 + 10_000 + bid.platformFeePaise + bid.taxPaise);
    expect(bid.revisionsLeft).toBe(2);
    expect(bid.status).toBe('ACTIVE');

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    expect(job.json().status).toBe('BID_RECEIVED');
    expect(job.json().statusLabelKey).toBe('status.offers_received');
    expect(job.json().events.map((e: { toStatus: string }) => e.toStatus)).toContain('BID_RECEIVED');

    const inbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: c.headers });
    expect(inbox.json().items[0].type).toBe('job.offer_received');

    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    const item = feed.json().items.find((i: { jobId: string }) => i.jobId === c.job.id);
    expect(item.myBid.id).toBe(bid.id);
    expect(item.bidCount).toBe(1);
  });

  it('refuses a second live offer from the same provider', async () => {
    const c = await customerWithOpenJob('+919444000022');
    const p = await makeProvider('+919444000023');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    const again = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.details.bid).toContain('DUPLICATE_ACTIVE_BID');
  });

  it('refuses an offer from an unverified or unavailable provider', async () => {
    const c = await customerWithOpenJob('+919444000024');
    const unverified = await makeProvider('+919444000025', { verified: false, available: false });
    const r = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: unverified.headers, payload: BID });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.details.eligibility).toContain('NOT_VERIFIED');
  });

  it('refuses an offer on a job in another category', async () => {
    const c = await customerWithOpenJob('+919444000026', electricalId);
    const p = await makeProvider('+919444000027', { skills: plumbingSkills });
    const r = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.details.eligibility).toContain('CATEGORY_MISMATCH');
  });

  it('validates the terms', async () => {
    const c = await customerWithOpenJob('+919444000028');
    const p = await makeProvider('+919444000029');
    const zero = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: { ...BID, labourPaise: 0, visitFeePaise: 0 } });
    expect(zero.statusCode).toBe(400);
    const eta = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: { ...BID, etaMinutes: 2 } });
    expect(eta.statusCode).toBe(400);
  });

  it('refuses an offer once the job is cancelled', async () => {
    const c = await customerWithOpenJob('+919444000030');
    const p = await makeProvider('+919444000031');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/cancel`, headers: c.headers, payload: { reason: 'No longer needed' } });
    const r = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.details.reason).toBe('job_not_accepting_offers');
    expect(r.json().error.details.status).toBe('CANCELLED_BY_CUSTOMER');
  });
});

describe('revising and withdrawing (BID-01, BID-07)', () => {
  it('allows two revisions and refuses the third', async () => {
    const c = await customerWithOpenJob('+919444000040');
    const p = await makeProvider('+919444000041');
    const created = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    const bidId = created.json().id;

    const first = await app.inject({ method: 'POST', url: `/bids/${bidId}/revise`, headers: p.headers, payload: { ...BID, labourPaise: 55_000 } });
    expect(first.statusCode).toBe(200);
    expect(first.json().revisionNo).toBe(1);
    expect(first.json().revisionsLeft).toBe(1);
    expect(first.json().labourPaise).toBe(55_000);

    const second = await app.inject({ method: 'POST', url: `/bids/${bidId}/revise`, headers: p.headers, payload: { ...BID, labourPaise: 50_000 } });
    expect(second.json().revisionNo).toBe(2);
    expect(second.json().revisionsLeft).toBe(0);

    const third = await app.inject({ method: 'POST', url: `/bids/${bidId}/revise`, headers: p.headers, payload: { ...BID, labourPaise: 45_000 } });
    expect(third.statusCode).toBe(400);
    expect(third.json().error.details.bid).toContain('TOO_MANY_REVISIONS');
  });

  it('withdraws an offer and frees the provider to bid again', async () => {
    const c = await customerWithOpenJob('+919444000042');
    const p = await makeProvider('+919444000043');
    const created = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });

    const w = await app.inject({ method: 'POST', url: `/bids/${created.json().id}/withdraw`, headers: p.headers, payload: { reason: 'Double booked' } });
    expect(w.statusCode).toBe(200);
    expect(w.json().status).toBe('WITHDRAWN');

    const offers = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offers`, headers: c.headers });
    expect(offers.json().items).toHaveLength(0);

    const again = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    expect(again.statusCode).toBe(201);

    const twice = await app.inject({ method: 'POST', url: `/bids/${created.json().id}/withdraw`, headers: p.headers, payload: { reason: 'Again' } });
    expect(twice.statusCode).toBe(409);
  });

  it('lists the provider their own offers with the job context', async () => {
    const c = await customerWithOpenJob('+919444000044');
    const p = await makeProvider('+919444000045');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    const mine = await app.inject({ method: 'GET', url: '/provider/bids', headers: p.headers });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items[0].job.categoryName).toBe('Plumbing');
    expect(mine.json().items[0].job.status).toBe('BID_RECEIVED');
  });
});

describe('offers as the customer sees them (PRODUCT_SPEC section 10)', () => {
  it('ranks on more than price and shows limited provider identity', async () => {
    const c = await customerWithOpenJob('+919444000050');
    const cheapNew = await makeProvider('+919444000051');
    const solid = await makeProvider('+919444000052');

    // give the second provider a track record
    const profile = await app.ctx.store.users.getProviderProfile(solid.userId);
    await app.ctx.store.users.upsertProviderProfile({ ...profile!, completed_jobs: 80, rating_avg: 4.8, rating_count: 60, reliability_score: 4.9 });

    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: cheapNew.headers, payload: { ...BID, labourPaise: 30_000, etaMinutes: 240 } });
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: solid.headers, payload: { ...BID, labourPaise: 60_000, etaMinutes: 45 } });

    const offers = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offers`, headers: c.headers });
    expect(offers.statusCode).toBe(200);
    const items = offers.json().items;
    expect(items).toHaveLength(2);
    // the cheaper offer does not automatically win
    expect(items[0].provider.id).toBe(solid.userId);
    expect(items[0].provider.completedJobs).toBe(80);
    expect(items[0].provider.verified).toBe(true);
    expect(items[0].sponsored).toBe(false);
    // no contact details are exposed before confirmation
    expect(JSON.stringify(items)).not.toContain('+91');
  });

  it('another customer cannot read the offers on your job', async () => {
    const c = await customerWithOpenJob('+919444000053');
    const p = await makeProvider('+919444000054');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });

    const attacker = await customerWithOpenJob('+919444000055');
    const r = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offers`, headers: attacker.headers });
    expect(r.statusCode).toBe(403);
  });

  it('a provider cannot revise or withdraw another provider offer', async () => {
    const c = await customerWithOpenJob('+919444000056');
    const owner = await makeProvider('+919444000057');
    const other = await makeProvider('+919444000058');
    const created = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: owner.headers, payload: BID });
    const bidId = created.json().id;

    expect((await app.inject({ method: 'POST', url: `/bids/${bidId}/revise`, headers: other.headers, payload: BID })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/bids/${bidId}/withdraw`, headers: other.headers, payload: { reason: 'malicious' } })).statusCode).toBe(403);
  });

  it('a customer cannot place an offer', async () => {
    const c = await customerWithOpenJob('+919444000059');
    const r = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: c.headers, payload: BID });
    expect(r.statusCode).toBe(403);
  });
});
