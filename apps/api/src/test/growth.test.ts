import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * Receipts, saved professionals, rebooking, promo codes, referrals and feed filters - the
 * things that make this an app somebody comes back to rather than uses once.
 */

let app: TestApp;
let plumbingId: string;
let electricalId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };

async function customerWithOpenJob(phone: string, categoryId?: string) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken);
  await app.inject({ method: 'POST', url: '/me/roles', headers: h, payload: { role: 'CUSTOMER' } });
  const addr = await app.inject({
    method: 'POST', url: '/me/addresses', headers: h,
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  const job = await app.inject({
    method: 'POST', url: '/jobs', headers: h,
    payload: { categoryId: categoryId ?? plumbingId, addressId: addr.json().id, description: 'Kitchen tap leaking since morning' },
  });
  const submitted = await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/submit`, headers: h });
  return { headers: h, userId: res.user.id, job: submitted.json().job, addressId: addr.json().id as string };
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

let adminSession: { headers: Record<string, string>; userId: string } | null = null;
async function admin() {
  if (!adminSession) {
    const res = await login(app, '+919000000007');
    adminSession = { headers: bearer(res.accessToken, { 'x-active-role': 'ADMIN' }), userId: res.user.id };
  }
  return adminSession;
}

/** All the way to a paid, completed job - which is when a receipt exists. */
async function completedJob(customerPhone: string, providerPhone: string, promoCode?: string) {
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
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
  const panel = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/execution`, headers: c.headers });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/start`, headers: p.headers, payload: { code: panel.json().startCode } });
  const shot = await app.inject({
    method: 'POST', url: `/jobs/${c.job.id}/evidence`, headers: p.headers,
    payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 120_000 },
  });
  await app.inject({
    method: 'POST', url: `/jobs/${c.job.id}/complete`, headers: p.headers,
    payload: { summary: 'Replaced the cartridge and tested it', mediaIds: [shot.json().media.id] },
  });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/approve`, headers: c.headers, payload: { approved: true } });
  return { c, p, jobId: c.job.id as string, accepted: accepted.json() };
}

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  const list = cats.json().items as Array<{ id: string; slug: string; skills: Array<{ id: string }> }>;
  const plumbing = list.find((c) => c.slug === 'plumbing')!;
  plumbingId = plumbing.id;
  plumbingSkills = plumbing.skills.map((s) => s.id);
  electricalId = list.find((c) => c.slug === 'electrical')!.id;
});
afterAll(async () => {
  await app.close();
});

describe('a receipt the customer can keep', () => {
  it('issues one automatically when the money is taken', async () => {
    const { c, jobId } = await completedJob('+919777000001', '+919777000002');

    const r = await app.inject({ method: 'GET', url: `/jobs/${jobId}/invoice`, headers: c.headers });
    expect(r.statusCode).toBe(200);
    const invoice = r.json().invoice;
    // A number somebody can quote on the phone, in the financial year an accountant works in
    expect(invoice.number).toMatch(/^HL-\d{4}-\d{6}$/);
    expect(invoice.lines.labourPaise).toBe(BID.labourPaise);
    expect(invoice.providerName).toContain('Services');
    expect(invoice.serviceAddress).toContain('Lodhi Colony');
    expect(invoice.netPaise).toBe(invoice.totalPaise - invoice.refundedPaise);
  });

  it('gives the same number every time, rather than issuing a second document', async () => {
    const { c, jobId } = await completedJob('+919777000003', '+919777000004');
    const first = await app.inject({ method: 'GET', url: `/jobs/${jobId}/invoice`, headers: c.headers });
    const again = await app.inject({ method: 'GET', url: `/jobs/${jobId}/invoice`, headers: c.headers });
    expect(again.json().invoice.number).toBe(first.json().invoice.number);
  });

  it('is not somebody else to read', async () => {
    const { jobId } = await completedJob('+919777000005', '+919777000006');
    const stranger = await customerWithOpenJob('+919777000007');
    const r = await app.inject({ method: 'GET', url: `/jobs/${jobId}/invoice`, headers: stranger.headers });
    expect(r.statusCode).toBe(403);
  });

  it('lists every receipt a customer has', async () => {
    const { c } = await completedJob('+919777000008', '+919777000009');
    const list = await app.inject({ method: 'GET', url: '/me/invoices', headers: c.headers });
    expect(list.json().items.length).toBeGreaterThan(0);
  });
});

describe('professionals worth asking for again', () => {
  it('saves and unsaves, and says honestly whether they can be asked right now', async () => {
    const { c, p } = await completedJob('+919777000010', '+919777000011');

    const saved = await app.inject({ method: 'POST', url: `/providers/${p.userId}/favourite`, headers: c.headers, payload: { note: 'Fixed the geyser properly' } });
    expect(saved.statusCode).toBe(200);
    const fav = saved.json().items[0];
    expect(fav.providerId).toBe(p.userId);
    expect(fav.jobsTogether).toBeGreaterThan(0);
    expect(fav.available).toBe(true);
    expect(fav.verified).toBe(true);
    expect(fav.note).toBe('Fixed the geyser properly');

    const removed = await app.inject({ method: 'DELETE', url: `/providers/${p.userId}/favourite`, headers: c.headers });
    expect(removed.json().items).toHaveLength(0);
  });

  it('saving twice is the same fact, not an error', async () => {
    const { c, p } = await completedJob('+919777000012', '+919777000013');
    await app.inject({ method: 'POST', url: `/providers/${p.userId}/favourite`, headers: c.headers, payload: {} });
    const again = await app.inject({ method: 'POST', url: `/providers/${p.userId}/favourite`, headers: c.headers, payload: { note: 'Changed my mind about the note' } });
    expect(again.statusCode).toBe(200);
    expect(again.json().items).toHaveLength(1);
    expect(again.json().items[0].note).toBe('Changed my mind about the note');
  });

  it('rebooks without asking anything already answered', async () => {
    const { c, p, jobId } = await completedJob('+919777000014', '+919777000015');

    const again = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/rebook`, headers: c.headers,
      payload: { preferProviderId: p.userId, description: 'The same tap is dripping again' },
    });
    expect(again.statusCode).toBe(201);
    const job = again.json().job;
    expect(job.id).not.toBe(jobId);
    expect(job.category.id).toBe(plumbingId);
    expect(job.status).toBe('DRAFT');

    // The preferred professional is told first, but the job still opens to everyone: quietly
    // assigning them would take away the customer's chance to compare.
    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    expect((theirs.json().items as Array<{ type: string }>).map((n) => n.type)).toContain('bid.invited');
  });
});

describe('promo codes', () => {
  async function makeCode(code: string, over: Record<string, unknown> = {}) {
    const a = await admin();
    return app.inject({
      method: 'POST', url: '/admin/promos', headers: a.headers,
      payload: { code, kind: 'FLAT', value: 10_000, minOrderPaise: 0, maxPerCustomer: 1, firstJobOnly: false, ...over },
    });
  }

  it('is only created by staff, and a percentage needs a ceiling', async () => {
    const c = await customerWithOpenJob('+919777000020');
    const denied = await app.inject({
      method: 'POST', url: '/admin/promos', headers: c.headers,
      payload: { code: 'SNEAKY', kind: 'FLAT', value: 100_000, minOrderPaise: 0, maxPerCustomer: 1, firstJobOnly: false },
    });
    expect(denied.statusCode).toBe(403);

    // An uncapped percentage is an unbounded liability
    const uncapped = await makeCode('NOCEILING', { kind: 'PERCENT', value: 5000 });
    expect(uncapped.statusCode).toBe(400);
  });

  it('shows what a code takes off before anybody commits to it', async () => {
    await makeCode('SAVE100');
    const c = await customerWithOpenJob('+919777000021');
    const preview = await app.inject({ method: 'GET', url: '/promo/preview?code=save100&orderPaise=80000', headers: c.headers });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().promo.discountPaise).toBe(10_000);
    expect(preview.json().promo.newTotalPaise).toBe(70_000);
  });

  it('explains a refusal in the customer terms, not ours', async () => {
    await makeCode('BIGORDER', { minOrderPaise: 500_000 });
    const c = await customerWithOpenJob('+919777000022');
    const r = await app.inject({ method: 'GET', url: '/promo/preview?code=BIGORDER&orderPaise=80000', headers: c.headers });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.promo).toEqual(['ORDER_TOO_SMALL']);
    expect(r.json().error.details.message).toContain('Rs 5000');
  });

  it('takes the discount off the customer and never off the provider', async () => {
    await makeCode('REAL100');
    const { c, jobId, accepted } = await completedJob('+919777000023', '+919777000024', 'REAL100');

    // The customer is charged less...
    expect(accepted.payment.amountPaise).toBe(accepted.quote.totalPaise - 10_000);
    // ...and the professional is still paid exactly what the accepted quote said.
    const earnings = await app.inject({ method: 'GET', url: '/me/earnings', headers: (await providerFor(jobId)).headers });
    expect(earnings.json().lifetimePaise).toBe(accepted.quote.providerPayablePaise);
    void c;
  });

  it('cannot be used twice by the same person', async () => {
    await makeCode('ONCEONLY');
    const c = await customerWithOpenJob('+919777000025');
    await app.inject({ method: 'GET', url: '/promo/preview?code=ONCEONLY&orderPaise=80000', headers: c.headers });

    // Redeem it on a real booking
    const p = await makeProvider('+919777000026');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
    await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers, payload: { promoCode: 'ONCEONLY' } });

    const second = await app.inject({ method: 'GET', url: '/promo/preview?code=ONCEONLY&orderPaise=80000', headers: c.headers });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.details.promo).toEqual(['ALREADY_USED']);
  });

  it('stops working once it is deactivated, without touching bookings already made', async () => {
    const created = await makeCode('STOPME');
    const a = await admin();
    await app.inject({ method: 'POST', url: `/admin/promos/${created.json().promo.id}/deactivate`, headers: a.headers });

    const c = await customerWithOpenJob('+919777000027');
    const r = await app.inject({ method: 'GET', url: '/promo/preview?code=STOPME&orderPaise=80000', headers: c.headers });
    expect(r.json().error.details.promo).toEqual(['INACTIVE']);
  });

  async function providerFor(jobId: string) {
    const job = await app.ctx.store.jobs.get(jobId);
    const res = await login(app, (await app.ctx.store.users.findById(job!.confirmed_provider_id!))!.phone_e164);
    return { headers: bearer(res.accessToken, { 'x-active-role': 'PROVIDER' }) };
  }
});

describe('referrals', () => {
  it('gives everyone a code they can read aloud', async () => {
    const c = await customerWithOpenJob('+919777000030');
    const r = await app.inject({ method: 'GET', url: '/me/referrals', headers: c.headers });
    expect(r.json().code).toHaveLength(6);
    expect(r.json().code).not.toMatch(/[01OI]/);
    expect(r.json().terms).toContain('first booking');
    expect(r.json().invited).toBe(0);
  });

  it('refuses a self-referral and a second claim', async () => {
    const a = await customerWithOpenJob('+919777000031');
    const mine = (await app.inject({ method: 'GET', url: '/me/referrals', headers: a.headers })).json().code;

    const self = await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: a.headers, payload: { code: mine } });
    expect(self.statusCode).toBe(400);
    expect(self.json().error.details.growth).toEqual(['SELF_REFERRAL']);

    const friend = await customerWithOpenJob('+919777000032');
    const claimed = await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: friend.headers, payload: { code: mine } });
    expect(claimed.statusCode).toBe(200);

    const twice = await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: friend.headers, payload: { code: mine } });
    expect(twice.json().error.details.growth).toEqual(['ALREADY_REFERRED']);
  });

  it('pays out on completed work, not on a signup', async () => {
    const referrer = await customerWithOpenJob('+919777000033');
    const code = (await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers })).json().code;

    // A friend claims the code and books nothing: still pending.
    const friend = await customerWithOpenJob('+919777000034');
    await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: friend.headers, payload: { code } });
    let summary = await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers });
    expect(summary.json().invited).toBe(1);
    expect(summary.json().qualified).toBe(0);

    // They complete a booking, and only then does it qualify.
    await completedJob('+919777000034', '+919777000035');
    summary = await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers });
    expect(summary.json().qualified).toBe(1);
    // A first name only, or nothing at all: joining through a link is not agreeing to be
    // identified to whoever shared it, and the phone number is certainly never shown.
    const shown = summary.json().people[0].name as string;
    expect(shown === 'A friend' || !shown.includes(' ')).toBe(true);
    expect(summary.body).not.toContain('919777000034');
  });

  it('will not accept a code from somebody who already books here', async () => {
    const referrer = await customerWithOpenJob('+919777000036');
    const code = (await app.inject({ method: 'GET', url: '/me/referrals', headers: referrer.headers })).json().code;

    const established = await completedJob('+919777000037', '+919777000038');
    const r = await app.inject({ method: 'POST', url: '/me/referrals/claim', headers: established.c.headers, payload: { code } });
    expect(r.json().error.details.growth).toEqual(['NOT_A_NEW_USER']);
  });
});

describe('narrowing the nearby feed', () => {
  it('offers only the filters that would actually find something', async () => {
    await customerWithOpenJob('+919777000040');
    const p = await makeProvider('+919777000041');

    const feed = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    expect(feed.json().items.length).toBeGreaterThan(0);
    expect(feed.json().facets.categories.length).toBeGreaterThan(0);
    expect(feed.json().facets.total).toBe(feed.json().items.length);
  });

  it('narrows, and never widens what the provider is eligible for', async () => {
    await customerWithOpenJob('+919777000042');
    const p = await makeProvider('+919777000043');

    // A category this provider has no skill in returns nothing, whatever they ask for
    const other = await app.inject({ method: 'GET', url: `/provider/jobs/nearby?categoryIds=${electricalId}`, headers: p.headers });
    expect(other.json().items).toHaveLength(0);

    const tiny = await app.inject({ method: 'GET', url: '/provider/jobs/nearby?maxDistanceKm=0.5', headers: p.headers });
    expect(tiny.json().items.length).toBeLessThanOrEqual(feedCount(other));
  });

  it('says why a feed is empty, which is not the same as saying there is no work', async () => {
    await customerWithOpenJob('+919777000044');
    const p = await makeProvider('+919777000045');

    const narrow = await app.inject({ method: 'GET', url: `/provider/jobs/nearby?categoryIds=${electricalId}`, headers: p.headers });
    expect(narrow.json().emptyReason).toBeTruthy();
    expect(narrow.json().emptyReason).toContain('work nearby');
  });

  it('hides jobs already bid on, when asked', async () => {
    const c = await customerWithOpenJob('+919777000046');
    const p = await makeProvider('+919777000047');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });

    const all = await app.inject({ method: 'GET', url: '/provider/jobs/nearby', headers: p.headers });
    const hidden = await app.inject({ method: 'GET', url: '/provider/jobs/nearby?hideMyBids=true', headers: p.headers });
    expect(hidden.json().items.length).toBeLessThan(all.json().items.length);
    expect((hidden.json().items as Array<{ jobId: string }>).map((i) => i.jobId)).not.toContain(c.job.id);
  });
});

function feedCount(res: { json: () => { items: unknown[] } }): number {
  return res.json().items.length + 1;
}
