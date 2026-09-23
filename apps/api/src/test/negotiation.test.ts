import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

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
  return { token: res.accessToken, headers: h, userId: res.user.id, job: submitted.json().job };
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
  return { token: res.accessToken, headers: h, userId: res.user.id };
}

/** A customer, a provider and one live offer on the customer's job. */
async function jobWithOffer(customerPhone: string, providerPhone: string, bid = BID) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: bid });
  return { c, p, bidId: offer.json().id as string };
}

function sign(body: unknown): string {
  const secret = app.ctx.env.PAYMENT_WEBHOOK_SECRET ?? 'mock-webhook-secret';
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
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

describe('counter-offers (PRODUCT_SPEC section 10)', () => {
  it('moves the job to NEGOTIATING and lands in the provider inbox', async () => {
    const { c, p, bidId } = await jobWithOffer('+919666000001', '+919666000002');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${c.job.id}/counter-offer`, headers: c.headers,
      payload: { bidId, labourPaise: 45_000, scopeNotes: 'Can you do it for this?' },
    });
    expect(r.statusCode).toBe(201);
    const offer = r.json();
    expect(offer.senderParty).toBe('CUSTOMER');
    expect(offer.labourPaise).toBe(45_000);
    // the counter keeps the terms it did not mention
    expect(offer.visitFeePaise).toBe(10_000);
    expect(offer.status).toBe('PENDING');
    expect(offer.awaitingYou).toBe(false);

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    expect(job.json().status).toBe('NEGOTIATING');

    const inbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    expect(inbox.json().items[0].type).toBe('offer.countered');

    const chain = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offer-chain`, headers: p.headers });
    expect(chain.json().items).toHaveLength(1);
    expect(chain.json().items[0].awaitingYou).toBe(true);
  });

  it('refuses a second counter while one is pending', async () => {
    const { c, bidId } = await jobWithOffer('+919666000003', '+919666000004');
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/counter-offer`, headers: c.headers, payload: { bidId, labourPaise: 45_000 } });
    const again = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/counter-offer`, headers: c.headers, payload: { bidId, labourPaise: 40_000 } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.details.reason).toBe('offer_already_pending');
  });

  it('lets the provider counter back, then the customer accept the agreed terms', async () => {
    const { c, p, bidId } = await jobWithOffer('+919666000005', '+919666000006');
    const first = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/counter-offer`, headers: c.headers, payload: { bidId, labourPaise: 40_000 } });

    const back = await app.inject({
      method: 'POST', url: `/offers/${first.json().id}/respond`, headers: p.headers,
      payload: { action: 'COUNTER', labourPaise: 52_000, scopeNotes: 'Best I can do' },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().senderParty).toBe('PROVIDER');
    expect(back.json().labourPaise).toBe(52_000);
    expect(back.json().parentOfferId).toBe(first.json().id);

    const accepted = await app.inject({ method: 'POST', url: `/offers/${back.json().id}/respond`, headers: c.headers, payload: { action: 'ACCEPT' } });
    expect(accepted.json().status).toBe('ACCEPTED');

    // the agreed price is now the live offer
    const offers = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offers`, headers: c.headers });
    expect(offers.json().items[0].labourPaise).toBe(52_000);

    const chain = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offer-chain`, headers: c.headers });
    expect(chain.json().items.map((o: { status: string }) => o.status)).toEqual(['SUPERSEDED', 'ACCEPTED']);
  });

  it('refuses a response from the wrong side or on a settled offer', async () => {
    const { c, p, bidId } = await jobWithOffer('+919666000007', '+919666000008');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/counter-offer`, headers: c.headers, payload: { bidId, labourPaise: 45_000 } });
    const offerId = offer.json().id;

    // the sender cannot answer their own counter
    const self = await app.inject({ method: 'POST', url: `/offers/${offerId}/respond`, headers: c.headers, payload: { action: 'ACCEPT' } });
    expect(self.statusCode).toBe(409);
    expect(self.json().error.details.negotiation).toContain('NOT_YOUR_TURN');

    // a stranger cannot see it at all
    const stranger = await customerWithOpenJob('+919666000009');
    const other = await app.inject({ method: 'POST', url: `/offers/${offerId}/respond`, headers: stranger.headers, payload: { action: 'ACCEPT' } });
    expect(other.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: `/offers/${offerId}/respond`, headers: p.headers, payload: { action: 'REJECT' } });
    const twice = await app.inject({ method: 'POST', url: `/offers/${offerId}/respond`, headers: p.headers, payload: { action: 'ACCEPT' } });
    expect(twice.json().error.details.negotiation).toContain('OFFER_NOT_PENDING');
  });

  it('a provider only sees their own thread', async () => {
    const c = await customerWithOpenJob('+919666000010');
    const p1 = await makeProvider('+919666000011');
    const p2 = await makeProvider('+919666000012');
    const b1 = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p1.headers, payload: BID });
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p2.headers, payload: BID });
    await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/counter-offer`, headers: c.headers, payload: { bidId: b1.json().id, labourPaise: 45_000 } });

    const mine = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offer-chain`, headers: p1.headers });
    expect(mine.json().items).toHaveLength(1);
    const theirs = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offer-chain`, headers: p2.headers });
    expect(theirs.statusCode).toBe(403);

    const customerView = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offer-chain`, headers: c.headers });
    expect(customerView.json().items).toHaveLength(1);
  });
});

describe('accepting an offer (BID-11, BID-12)', () => {
  it('locks the quote, closes the other offers, assigns the provider and asks for payment', async () => {
    const c = await customerWithOpenJob('+919666000020');
    const winner = await makeProvider('+919666000021');
    const loser = await makeProvider('+919666000022');
    const wBid = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: winner.headers, payload: BID });
    const lBid = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: loser.headers, payload: { ...BID, labourPaise: 40_000 } });

    const r = await app.inject({ method: 'POST', url: `/bids/${wBid.json().id}/accept`, headers: c.headers });
    expect(r.statusCode).toBe(200);
    const { quote, payment, jobStatus } = r.json();
    expect(jobStatus).toBe('PAYMENT_PENDING');
    expect(quote.status).toBe('ACTIVE');
    expect(quote.providerId).toBe(winner.userId);
    // the frozen quote is the full, itemised price
    expect(quote.totalPaise).toBe(quote.labourPaise + quote.visitFeePaise + quote.platformFeePaise + quote.taxPaise);
    expect(quote.providerPayablePaise).toBe(70_000);
    expect(payment.status).toBe('PENDING');
    expect(payment.amountPaise).toBe(quote.totalPaise);
    expect(payment.providerOrderId).toBeTruthy();

    // the job now shows the booking
    const booking = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/booking`, headers: c.headers });
    expect(booking.json().assignment.providerId).toBe(winner.userId);
    expect(booking.json().assignment.providerVerified).toBe(true);

    // the loser's offer is closed and no longer visible as an option
    const offers = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/offers`, headers: c.headers });
    expect(offers.json().items).toHaveLength(0);
    const loserBids = await app.inject({ method: 'GET', url: '/provider/bids', headers: loser.headers });
    expect(loserBids.json().items.find((b: { id: string }) => b.id === lBid.json().id).status).toBe('INACTIVE');

    const winnerInbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: winner.headers });
    expect(winnerInbox.json().items[0].type).toBe('bid.accepted');
  });

  it('refuses a second acceptance on the same job', async () => {
    const c = await customerWithOpenJob('+919666000023');
    const p1 = await makeProvider('+919666000024');
    const p2 = await makeProvider('+919666000025');
    const b1 = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p1.headers, payload: BID });
    const b2 = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p2.headers, payload: BID });

    const first = await app.inject({ method: 'POST', url: `/bids/${b1.json().id}/accept`, headers: c.headers });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/bids/${b2.json().id}/accept`, headers: c.headers });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.details.acceptance).toEqual(expect.arrayContaining(['JOB_NOT_ACCEPTABLE']));
  });

  it('only one of two simultaneous acceptances wins', async () => {
    const c = await customerWithOpenJob('+919666000026');
    const p1 = await makeProvider('+919666000027');
    const p2 = await makeProvider('+919666000028');
    const b1 = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p1.headers, payload: BID });
    const b2 = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p2.headers, payload: BID });

    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/bids/${b1.json().id}/accept`, headers: c.headers }),
      app.inject({ method: 'POST', url: `/bids/${b2.json().id}/accept`, headers: c.headers }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    const booking = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/booking`, headers: c.headers });
    expect(booking.json().quote).toBeTruthy();
    expect(booking.json().assignment.status).toBe('ACTIVE');
  });

  it('refuses a withdrawn offer', async () => {
    const { c, p, bidId } = await jobWithOffer('+919666000029', '+919666000030');
    await app.inject({ method: 'POST', url: `/bids/${bidId}/withdraw`, headers: p.headers, payload: { reason: 'Double booked' } });
    const r = await app.inject({ method: 'POST', url: `/bids/${bidId}/accept`, headers: c.headers });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.details.acceptance).toContain('BID_NOT_ACTIVE');
  });

  it('another customer cannot accept an offer on your job', async () => {
    const { c, bidId } = await jobWithOffer('+919666000031', '+919666000032');
    const attacker = await customerWithOpenJob('+919666000033');
    const r = await app.inject({ method: 'POST', url: `/bids/${bidId}/accept`, headers: attacker.headers });
    expect(r.statusCode).toBe(403);
    void c;
  });
});

describe('payment authorization (PAYMENT_FLOW)', () => {
  async function acceptedBooking(customerPhone: string, providerPhone: string) {
    const { c, p, bidId } = await jobWithOffer(customerPhone, providerPhone);
    const accepted = await app.inject({ method: 'POST', url: `/bids/${bidId}/accept`, headers: c.headers });
    return { c, p, payment: accepted.json().payment, quote: accepted.json().quote };
  }

  it('confirms the booking when the gateway authorizes the payment', async () => {
    const { c, p, payment } = await acceptedBooking('+919666000040', '+919666000041');
    const body = {
      eventId: 'evt_auth_1',
      type: 'payment.authorized' as const,
      orderId: payment.providerOrderId,
      paymentId: 'pay_mock_1',
      amountPaise: payment.amountPaise,
    };
    const r = await app.inject({ method: 'POST', url: '/payments/webhook', headers: { 'x-payment-signature': sign(body) }, payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.json().replayed).toBe(false);

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    // the provider was already assigned, so the job goes straight past CONFIRMED
    expect(job.json().status).toBe('PROVIDER_ASSIGNED');
    expect(job.json().paymentStatus).toBe('AUTHORIZED');
    expect(job.json().statusLabelKey).toBe('status.provider_confirmed');
    expect(job.json().events.map((e: { toStatus: string }) => e.toStatus)).toEqual(
      expect.arrayContaining(['PAYMENT_PENDING', 'CONFIRMED', 'PROVIDER_ASSIGNED']),
    );

    const booking = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/booking`, headers: c.headers });
    expect(booking.json().payments[0].status).toBe('AUTHORIZED');

    const providerInbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    expect(providerInbox.json().items[0].type).toBe('job.confirmed');
  });

  it('ignores a replayed webhook (PAY-04)', async () => {
    const { c, payment } = await acceptedBooking('+919666000042', '+919666000043');
    const body = {
      eventId: 'evt_replay_1',
      type: 'payment.authorized' as const,
      orderId: payment.providerOrderId,
      paymentId: 'pay_mock_2',
      amountPaise: payment.amountPaise,
    };
    const headers = { 'x-payment-signature': sign(body) };
    const first = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: body });
    const second = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: body });
    expect(first.json().replayed).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    // the status trail is not written twice
    const confirms = job.json().events.filter((e: { toStatus: string }) => e.toStatus === 'CONFIRMED');
    expect(confirms).toHaveLength(1);
  });

  it('rejects an unsigned or tampered webhook', async () => {
    const { payment } = await acceptedBooking('+919666000044', '+919666000045');
    const body = {
      eventId: 'evt_bad_1',
      type: 'payment.authorized' as const,
      orderId: payment.providerOrderId,
      paymentId: 'pay_mock_3',
      amountPaise: payment.amountPaise,
    };
    const unsigned = await app.inject({ method: 'POST', url: '/payments/webhook', payload: body });
    expect(unsigned.statusCode).toBe(401);
    const tampered = await app.inject({
      method: 'POST', url: '/payments/webhook',
      headers: { 'x-payment-signature': sign(body) },
      payload: { ...body, amountPaise: 1 },
    });
    expect(tampered.statusCode).toBe(401);
  });

  it('refuses to confirm on an amount mismatch (PAY-06)', async () => {
    const { c, payment } = await acceptedBooking('+919666000046', '+919666000047');
    const body = {
      eventId: 'evt_mismatch_1',
      type: 'payment.authorized' as const,
      orderId: payment.providerOrderId,
      paymentId: 'pay_mock_4',
      amountPaise: payment.amountPaise - 100,
    };
    const r = await app.inject({ method: 'POST', url: '/payments/webhook', headers: { 'x-payment-signature': sign(body) }, payload: body });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.details.reason).toBe('amount_mismatch');

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    expect(job.json().status).toBe('PAYMENT_PENDING');
  });

  it('releases the booking when payment fails so the customer can choose again', async () => {
    const { c, payment } = await acceptedBooking('+919666000048', '+919666000049');
    const body = {
      eventId: 'evt_fail_1',
      type: 'payment.failed' as const,
      orderId: payment.providerOrderId,
      paymentId: 'pay_mock_5',
      amountPaise: payment.amountPaise,
      failureReason: 'card_declined',
    };
    const r = await app.inject({ method: 'POST', url: '/payments/webhook', headers: { 'x-payment-signature': sign(body) }, payload: body });
    expect(r.statusCode).toBe(200);

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    expect(job.json().status).toBe('BID_RECEIVED');
    expect(job.json().paymentStatus).toBe('FAILED');

    const booking = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/booking`, headers: c.headers });
    expect(booking.json().quote).toBeNull();
    expect(booking.json().assignment).toBeNull();
  });

  it('the demo helper drives the mock gateway and is owner-only', async () => {
    const { c, payment } = await acceptedBooking('+919666000050', '+919666000051');
    const attacker = await customerWithOpenJob('+919666000052');
    const denied = await app.inject({ method: 'POST', url: `/payments/${payment.id}/mock-complete`, headers: attacker.headers, payload: {} });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: 'POST', url: `/payments/${payment.id}/mock-complete`, headers: c.headers, payload: { outcome: 'authorized' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().payment.status).toBe('AUTHORIZED');

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}`, headers: c.headers });
    expect(job.json().status).toBe('PROVIDER_ASSIGNED');
  });

  it('the provider sees the booking but not the payment records', async () => {
    const { c, p, payment } = await acceptedBooking('+919666000053', '+919666000054');
    await app.inject({ method: 'POST', url: `/payments/${payment.id}/mock-complete`, headers: c.headers, payload: {} });

    const providerView = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/booking`, headers: p.headers });
    expect(providerView.statusCode).toBe(200);
    expect(providerView.json().quote.totalPaise).toBeGreaterThan(0);
    expect(providerView.json().payments).toEqual([]);

    const stranger = await customerWithOpenJob('+919666000055');
    const denied = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/booking`, headers: stranger.headers });
    expect(denied.statusCode).toBe(403);
  });
});
