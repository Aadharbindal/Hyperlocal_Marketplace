import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let plumbingId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };
const ITEMS = [
  { name: 'Brass tap cartridge', quantity: 2, unit: 'PIECE' as const },
  { name: 'PTFE tape', quantity: 1, unit: 'PIECE' as const },
];
const QUOTED = [
  { name: 'Brass tap cartridge', quantity: 2, unit: 'PIECE' as const, brand: 'Jaquar', unitPricePaise: 18_000, inStock: true },
  { name: 'PTFE tape', quantity: 1, unit: 'PIECE' as const, unitPricePaise: 3_000, inStock: true },
];

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

async function makeVendor(phone: string, opts: { verified?: boolean; available?: boolean } = {}) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken, { 'x-active-role': 'VENDOR' });
  await app.ctx.store.users.grantRole({ user_id: res.user.id, role: 'VENDOR', granted_by: null });
  await app.ctx.store.users.upsertVendorProfile({
    user_id: res.user.id,
    shop_name: `Hardware ${phone.slice(-4)}`,
    shop_address_id: null,
    delivery_radius_km: 5,
    material_categories: ['plumbing'],
    delivery_available: opts.available ?? true,
    verification_status: opts.verified === false ? 'SUBMITTED' : 'VERIFIED',
  });
  return { headers: h, userId: res.user.id };
}

/** A job with work under way: the only point at which materials can be asked for. */
async function jobInProgress(customerPhone: string, providerPhone: string) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  const jobId = c.job.id as string;
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
  const panel = await app.inject({ method: 'GET', url: `/jobs/${jobId}/execution`, headers: c.headers });
  await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code: panel.json().startCode } });
  return { c, p, jobId };
}

/** Request raised, one vendor quote given. */
async function jobWithQuote(customerPhone: string, providerPhone: string, vendorPhone: string) {
  const s = await jobInProgress(customerPhone, providerPhone);
  const v = await makeVendor(vendorPhone);
  const req = await app.inject({
    method: 'POST', url: `/jobs/${s.jobId}/material-request`, headers: s.p.headers,
    payload: { items: ITEMS, neededByMinutes: 120, note: 'Need these to finish today' },
  });
  if (req.statusCode !== 201) throw new Error(`request failed: ${req.body}`);
  const quote = await app.inject({
    method: 'POST', url: `/material-requests/${req.json().id}/quote`, headers: v.headers,
    payload: { items: QUOTED, deliveryPaise: 4_000, etaMinutes: 40 },
  });
  if (quote.statusCode !== 201) throw new Error(`quote failed: ${quote.body}`);
  return { ...s, v, requestId: req.json().id as string, quoteId: quote.json().id as string, quote: quote.json() };
}

/** All the way to a paid, delivered order waiting to be confirmed. */
async function deliveredOrder(customerPhone: string, providerPhone: string, vendorPhone: string) {
  const s = await jobWithQuote(customerPhone, providerPhone, vendorPhone);
  const selected = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
  if (selected.statusCode !== 201) throw new Error(`select failed: ${selected.body}`);
  const orderId = selected.json().order.id as string;
  await app.inject({
    method: 'POST', url: `/payments/${selected.json().payment.id}/mock-complete`, headers: s.c.headers,
    payload: { outcome: 'authorized' },
  });
  await app.inject({ method: 'POST', url: `/material-orders/${orderId}/status`, headers: s.v.headers, payload: { to: 'OUT_FOR_DELIVERY' } });
  await app.inject({ method: 'POST', url: `/material-orders/${orderId}/status`, headers: s.v.headers, payload: { to: 'DELIVERED' } });
  return { ...s, orderId, total: selected.json().order.totalPaise as number };
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

describe('material requests (PRODUCT_SPEC section 13)', () => {
  it('is raised by the provider on site and reaches the vendor feed with the area only', async () => {
    const { c, p, jobId } = await jobInProgress('+919888000001', '+919888000002');
    const v = await makeVendor('+919888000003');

    const req = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/material-request`, headers: p.headers,
      payload: { items: ITEMS, note: 'Need these to finish today' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json().status).toBe('OPEN');
    expect(req.json().items).toHaveLength(2);

    const feed = await app.inject({ method: 'GET', url: '/vendor/material-requests', headers: v.headers });
    expect(feed.statusCode).toBe(200);
    const mine = (feed.json().items as Array<{ id: string; areaLabel: string }>).find((r) => r.id === req.json().id);
    expect(mine).toBeTruthy();
    // the vendor sees what to bring and roughly where, never the customer's address
    expect(JSON.stringify(mine)).not.toContain('Lodhi Colony');
    expect(mine!.areaLabel).toBeTruthy();

    // and the customer is told that nothing is bought without them
    const inbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: c.headers });
    expect((inbox.json().items as Array<{ type: string }>).some((n) => n.type === 'material.requested')).toBe(true);
  });

  it('cannot be raised by the customer, or before anyone is on site', async () => {
    const { c, p, jobId } = await jobInProgress('+919888000004', '+919888000005');
    const byCustomer = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/material-request`, headers: c.headers, payload: { items: ITEMS },
    });
    expect(byCustomer.statusCode).toBe(403);

    // a second job that has not started yet
    const fresh = await customerWithOpenJob('+919888000006');
    const early = await app.inject({
      method: 'POST', url: `/jobs/${fresh.job.id}/material-request`, headers: p.headers, payload: { items: ITEMS },
    });
    expect(early.statusCode).toBe(403);
  });

  it('allows only one open request per job', async () => {
    const { p, jobId } = await jobInProgress('+919888000007', '+919888000008');
    const first = await app.inject({ method: 'POST', url: `/jobs/${jobId}/material-request`, headers: p.headers, payload: { items: ITEMS } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/jobs/${jobId}/material-request`, headers: p.headers, payload: { items: ITEMS } });
    expect(second.json().error.details.materials).toEqual(['REQUEST_ALREADY_OPEN']);
  });
});

describe('vendor quotes', () => {
  it('prices the whole list and only charges for what is in stock', async () => {
    const { quote } = await jobWithQuote('+919888000009', '+919888000010', '+919888000011');
    // 2 x 180 + 1 x 30 = 390, plus 40 delivery
    expect(quote.subtotalPaise).toBe(39_000);
    expect(quote.totalPaise).toBe(43_000);
    expect(quote.inStockCount).toBe(2);
    expect(quote.vendor.verified).toBe(true);
  });

  it('refuses a partial list, a second quote and an unverified vendor', async () => {
    const s = await jobInProgress('+919888000012', '+919888000013');
    const v = await makeVendor('+919888000014');
    const req = await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/material-request`, headers: s.p.headers, payload: { items: ITEMS } });
    const url = `/material-requests/${req.json().id}/quote`;

    const partial = await app.inject({ method: 'POST', url, headers: v.headers, payload: { items: [QUOTED[0]], etaMinutes: 30 } });
    expect(partial.json().error.details.materials).toEqual(['ITEM_COUNT_MISMATCH']);

    const ok = await app.inject({ method: 'POST', url, headers: v.headers, payload: { items: QUOTED, etaMinutes: 30 } });
    expect(ok.statusCode).toBe(201);
    const twice = await app.inject({ method: 'POST', url, headers: v.headers, payload: { items: QUOTED, etaMinutes: 30 } });
    expect(twice.json().error.details.materials).toEqual(['ALREADY_QUOTED']);

    const unverified = await makeVendor('+919888000015', { verified: false });
    const refused = await app.inject({ method: 'POST', url, headers: unverified.headers, payload: { items: QUOTED, etaMinutes: 30 } });
    expect(refused.json().error.details.materials).toEqual(['VENDOR_NOT_VERIFIED']);
    // and that vendor sees why their feed is empty
    const feed = await app.inject({ method: 'GET', url: '/vendor/material-requests', headers: unverified.headers });
    expect(feed.json().blockers).toContain('verification_pending');
  });

  it('refuses a quote where nothing is in stock', async () => {
    const s = await jobInProgress('+919888000016', '+919888000017');
    const v = await makeVendor('+919888000018');
    const req = await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/material-request`, headers: s.p.headers, payload: { items: ITEMS } });
    const r = await app.inject({
      method: 'POST', url: `/material-requests/${req.json().id}/quote`, headers: v.headers,
      payload: { items: QUOTED.map((i) => ({ ...i, inStock: false })), etaMinutes: 30 },
    });
    expect(r.json().error.details.materials).toEqual(['NOTHING_IN_STOCK']);
  });
});

describe('selection and the separate material authorization', () => {
  it('locks the quote, closes the others and opens its own payment', async () => {
    const s = await jobWithQuote('+919888000019', '+919888000020', '+919888000021');
    const other = await makeVendor('+919888000022');
    await app.inject({
      method: 'POST', url: `/material-requests/${s.requestId}/quote`, headers: other.headers,
      payload: { items: QUOTED.map((i) => ({ ...i, unitPricePaise: i.unitPricePaise + 1_000 })), etaMinutes: 90 },
    });

    const bookingBefore = await app.inject({ method: 'GET', url: `/jobs/${s.jobId}/booking`, headers: s.c.headers });
    const labourTotal = bookingBefore.json().quote.totalPaise;

    const selected = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
    expect(selected.statusCode).toBe(201);
    expect(selected.json().order.status).toBe('PENDING_PAYMENT');
    // materials are a separate leg of money, never folded into the labour hold
    expect(selected.json().payment.purpose).toBe('MATERIAL');
    expect(selected.json().payment.amountPaise).toBe(43_000);

    const bookingAfter = await app.inject({ method: 'GET', url: `/jobs/${s.jobId}/booking`, headers: s.c.headers });
    expect(bookingAfter.json().quote.totalPaise).toBe(labourTotal);

    const panel = await app.inject({ method: 'GET', url: `/jobs/${s.jobId}/materials`, headers: s.c.headers });
    const statuses = (panel.json().quotes as Array<{ status: string }>).map((q) => q.status).sort();
    expect(statuses).toEqual(['REJECTED', 'SELECTED']);
    expect(panel.json().request.status).toBe('ORDERED');
  });

  it('asks the vendor to prepare only once the money is authorized', async () => {
    const s = await jobWithQuote('+919888000023', '+919888000024', '+919888000025');
    const selected = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
    const orderId = selected.json().order.id;

    const beforePay = await app.inject({ method: 'GET', url: '/vendor/material-orders', headers: s.v.headers });
    expect((beforePay.json().items as Array<{ id: string; status: string }>).find((o) => o.id === orderId)!.status).toBe('PENDING_PAYMENT');

    const paid = await app.inject({
      method: 'POST', url: `/payments/${selected.json().payment.id}/mock-complete`, headers: s.c.headers,
      payload: { outcome: 'authorized' },
    });
    expect(paid.statusCode).toBe(200);

    const afterPay = await app.inject({ method: 'GET', url: '/vendor/material-orders', headers: s.v.headers });
    const order = (afterPay.json().items as Array<{ id: string; status: string; payment: { status: string } }>).find((o) => o.id === orderId)!;
    expect(order.status).toBe('PREPARING');
    expect(order.payment.status).toBe('AUTHORIZED');

    // the job itself is untouched by a material payment
    const job = await app.inject({ method: 'GET', url: `/jobs/${s.jobId}`, headers: s.c.headers });
    expect(job.json().status).toBe('IN_PROGRESS');
  });

  it('refuses a second order for the same list', async () => {
    const s = await jobWithQuote('+919888000026', '+919888000027', '+919888000028');
    const first = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.details.materials).toEqual(['ALREADY_ORDERED']);
  });

  it('refuses an expired quote', async () => {
    const s = await jobWithQuote('+919888000029', '+919888000030', '+919888000031');
    await app.ctx.store.materials.updateQuote(s.quoteId, { expires_at: new Date(Date.now() - 1000) });
    const r = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
    expect(r.json().error.details.materials).toEqual(['QUOTE_EXPIRED']);
  });

  it('only the customer may select', async () => {
    const s = await jobWithQuote('+919888000032', '+919888000033', '+919888000034');
    const r = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.p.headers });
    expect(r.statusCode).toBe(403);
  });
});

describe('delivery, confirmation and the invoice', () => {
  it('runs delivery to confirmation', async () => {
    const s = await deliveredOrder('+919888000035', '+919888000036', '+919888000037');
    const confirmed = await app.inject({ method: 'POST', url: `/material-orders/${s.orderId}/confirm`, headers: s.c.headers, payload: { ok: true } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('CONFIRMED');
    expect(confirmed.json().confirmedAt).not.toBeNull();
  });

  it('parks the order when the delivery is wrong instead of accepting it', async () => {
    const s = await deliveredOrder('+919888000038', '+919888000039', '+919888000040');
    const held = await app.inject({
      method: 'POST', url: `/material-orders/${s.orderId}/confirm`, headers: s.c.headers,
      payload: { ok: false, issue: 'WRONG_ITEM', note: 'Wrong brand of cartridge, we asked for Jaquar' },
    });
    expect(held.statusCode).toBe(200);
    expect(held.json().status).toBe('ON_HOLD');
    expect(held.json().issue).toBe('WRONG_ITEM');

    // a held order cannot be invoiced for payout
    const invoice = await app.inject({
      method: 'POST', url: `/material-orders/${s.orderId}/invoice`, headers: s.v.headers,
      payload: { mediaId: '00000000-0000-4000-8000-000000000000', amountPaise: s.total },
    });
    expect(invoice.json().error.details.materials).toEqual(['ORDER_NOT_CONFIRMED']);
  });

  it('refuses an invoice whose amount does not match the order', async () => {
    const s = await deliveredOrder('+919888000041', '+919888000042', '+919888000043');
    await app.inject({ method: 'POST', url: `/material-orders/${s.orderId}/confirm`, headers: s.c.headers, payload: { ok: true } });

    const upload = await app.inject({
      method: 'POST', url: `/jobs/${s.jobId}/evidence`, headers: s.p.headers,
      payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 90_000 },
    });
    const mediaId = upload.json().media.id;

    const wrong = await app.inject({
      method: 'POST', url: `/material-orders/${s.orderId}/invoice`, headers: s.v.headers,
      payload: { mediaId, amountPaise: s.total + 100 },
    });
    expect(wrong.json().error.details.materials).toEqual(['AMOUNT_MISMATCH']);
    expect(wrong.json().error.details.orderTotalPaise).toBe(s.total);

    const right = await app.inject({
      method: 'POST', url: `/material-orders/${s.orderId}/invoice`, headers: s.v.headers,
      payload: { mediaId, amountPaise: s.total, invoiceNumber: 'INV-2026-114' },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().invoiceNumber).toBe('INV-2026-114');
  });

  it('keeps a stranger away from someone else’s order', async () => {
    const s = await deliveredOrder('+919888000044', '+919888000045', '+919888000046');
    const other = await makeVendor('+919888000047');
    const r = await app.inject({ method: 'POST', url: `/material-orders/${s.orderId}/status`, headers: other.headers, payload: { to: 'DELIVERED' } });
    expect(r.statusCode).toBe(403);

    const stranger = await makeProvider('+919888000048');
    const confirm = await app.inject({ method: 'POST', url: `/material-orders/${s.orderId}/confirm`, headers: stranger.headers, payload: { ok: true } });
    expect(confirm.statusCode).toBe(403);
  });

  it('refuses an out-of-order fulfilment step', async () => {
    const s = await jobWithQuote('+919888000049', '+919888000050', '+919888000051');
    const selected = await app.inject({ method: 'POST', url: `/material-quotes/${s.quoteId}/select`, headers: s.c.headers });
    const orderId = selected.json().order.id;
    // still PENDING_PAYMENT: nobody delivers stock that has not been paid for
    const early = await app.inject({ method: 'POST', url: `/material-orders/${orderId}/status`, headers: s.v.headers, payload: { to: 'DELIVERED' } });
    expect(early.json().error.details.materials).toEqual(['INVALID_ORDER_TRANSITION']);
  });
});
