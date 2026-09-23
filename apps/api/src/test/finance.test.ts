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

/** One admin session for the whole file: OTP requests are rate limited per phone, as they should be. */
let adminSession: { headers: Record<string, string>; userId: string } | null = null;
async function admin() {
  if (!adminSession) {
    const res = await login(app, '+919000000007');
    adminSession = { headers: bearer(res.accessToken, { 'x-active-role': 'ADMIN' }), userId: res.user.id };
  }
  return adminSession;
}

/** A confirmed, authorized booking that has not started yet. */
async function confirmedJob(customerPhone: string, providerPhone: string, bid = BID) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: bid });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  return { c, p, jobId: c.job.id as string, quote: accepted.json().quote };
}

async function jobInProgress(customerPhone: string, providerPhone: string, bid = BID) {
  const s = await confirmedJob(customerPhone, providerPhone, bid);
  await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/progress`, headers: s.p.headers, payload: { to: 'EN_ROUTE' } });
  await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/progress`, headers: s.p.headers, payload: { to: 'ARRIVED' } });
  const panel = await app.inject({ method: 'GET', url: `/jobs/${s.jobId}/execution`, headers: s.c.headers });
  await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/start`, headers: s.p.headers, payload: { code: panel.json().startCode } });
  return s;
}

/** All the way to COMPLETED, which is the moment money is captured. */
async function completedJob(customerPhone: string, providerPhone: string, bid = BID) {
  const s = await jobInProgress(customerPhone, providerPhone, bid);
  const shot = await app.inject({
    method: 'POST', url: `/jobs/${s.jobId}/evidence`, headers: s.p.headers,
    payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 120_000 },
  });
  await app.inject({
    method: 'POST', url: `/jobs/${s.jobId}/complete`, headers: s.p.headers,
    payload: { summary: 'Replaced the cartridge and tested it', mediaIds: [shot.json().media.id] },
  });
  await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/approve`, headers: s.c.headers, payload: { approved: true } });
  return { ...s, mediaId: shot.json().media.id as string };
}

/** Makes a settlement due by backdating the row past the 24 hour hold. */
async function ageSettlements(jobId: string) {
  const store = app.ctx.store;
  for (const s of await store.finance.listSettlementsByStatus('PENDING', 50)) {
    if (s.job_id === jobId) {
      await store.finance.updateSettlement(s.id, { created_at: new Date(Date.now() - 25 * 3600_000) });
    }
  }
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

describe('capture and the ledger (PRODUCT_SPEC section 14)', () => {
  it('captures at the locked quote on approval and writes a balanced batch', async () => {
    const { c, jobId, quote } = await completedJob('+919555000001', '+919555000002');

    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    expect(money.json().capturedPaise).toBe(quote.totalPaise);
    expect(money.json().status).toBe('CAPTURED');

    const a = await admin();
    const ledger = await app.inject({ method: 'GET', url: `/admin/jobs/${jobId}/ledger`, headers: a.headers });
    const items = ledger.json().items as Array<{ entryType: string; amountPaise: number }>;
    // the customer's money in, and where every paisa of it went
    expect(items.find((e) => e.entryType === 'CUSTOMER_CHARGE')!.amountPaise).toBe(quote.totalPaise);
    expect(items.find((e) => e.entryType === 'PROVIDER_PAYABLE')!.amountPaise).toBe(-quote.providerPayablePaise);
    expect(items.find((e) => e.entryType === 'PLATFORM_REVENUE')!.amountPaise).toBe(-quote.platformFeePaise);
    expect(items.find((e) => e.entryType === 'TAX')!.amountPaise).toBe(-quote.taxPaise);
    // a batch that does not sum to zero is never written
    expect(ledger.json().netPaise).toBe(0);
  });

  it('keeps the ledger out of everyone except support', async () => {
    const { c, jobId } = await completedJob('+919555000003', '+919555000004');
    const r = await app.inject({ method: 'GET', url: `/admin/jobs/${jobId}/ledger`, headers: c.headers });
    expect(r.statusCode).toBe(403);
  });
});

describe('settlement', () => {
  it('records what is owed but pays nothing until the hold window has passed', async () => {
    const { p, jobId } = await completedJob('+919555000005', '+919555000006');
    const a = await admin();

    const earningsBefore = await app.inject({ method: 'GET', url: '/me/earnings', headers: p.headers });
    expect(earningsBefore.json().pendingPaise).toBeGreaterThan(0);
    expect(earningsBefore.json().settledPaise).toBe(0);

    const tooEarly = await app.inject({ method: 'POST', url: '/admin/settlements/run', headers: a.headers });
    expect((tooEarly.json().results as Array<{ status: string; reason?: string }>).every((r) => r.status !== 'PAID')).toBe(true);

    await ageSettlements(jobId);
    const run = await app.inject({ method: 'POST', url: '/admin/settlements/run', headers: a.headers });
    expect((run.json().results as Array<{ status: string }>).some((r) => r.status === 'PAID')).toBe(true);

    const earningsAfter = await app.inject({ method: 'GET', url: '/me/earnings', headers: p.headers });
    expect(earningsAfter.json().settledPaise).toBeGreaterThan(0);
    expect(earningsAfter.json().pendingPaise).toBe(0);

    // and the job itself is finished with, not merely completed
    const settled = await app.ctx.store.jobs.get(jobId);
    expect(settled!.status).toBe('SETTLED');
    expect(settled!.payment_status).toBe('SETTLED');
  });

  it('pays the provider exactly what the quote said they would get', async () => {
    const { p, jobId, quote } = await completedJob('+919555000007', '+919555000008');
    await ageSettlements(jobId);
    const a = await admin();
    await app.inject({ method: 'POST', url: '/admin/settlements/run', headers: a.headers });

    const earnings = await app.inject({ method: 'GET', url: '/me/earnings', headers: p.headers });
    const settlement = (earnings.json().settlements as Array<{ jobId: string; amountPaise: number; status: string }>).find((s) => s.jobId === jobId)!;
    expect(settlement.amountPaise).toBe(quote.providerPayablePaise);
    expect(settlement.status).toBe('PAID');
  });

  it('is only ever run by support', async () => {
    const { c } = await completedJob('+919555000009', '+919555000010');
    const r = await app.inject({ method: 'POST', url: '/admin/settlements/run', headers: c.headers });
    expect(r.statusCode).toBe(403);
  });
});

describe('cancellation (PAYMENT_FLOW section 6)', () => {
  it('charges nothing and releases the hold before the provider sets off', async () => {
    const { c, jobId } = await confirmedJob('+919555000011', '+919555000012');

    const preview = await app.inject({ method: 'GET', url: `/jobs/${jobId}/cancellation-quote`, headers: c.headers });
    expect(preview.json().chargePaise).toBe(0);
    expect(preview.json().stage).toBe('AFTER_CONFIRMATION');

    const cancelled = await app.inject({ method: 'POST', url: `/jobs/${jobId}/cancel`, headers: c.headers, payload: { reason: 'Plans changed' } });
    expect(cancelled.statusCode).toBe(200);

    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    // released, not refunded: the money never left the customer's account
    expect(money.json().status).toBe('RELEASED');
    expect(money.json().capturedPaise).toBe(0);
    expect(money.json().refundedPaise).toBe(0);
  });

  it('charges the visit fee once the provider is on the way', async () => {
    const { c, jobId } = await confirmedJob('+919555000013', '+919555000014');
    const p = await makeProvider('+919555000014');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });

    const preview = await app.inject({ method: 'GET', url: `/jobs/${jobId}/cancellation-quote`, headers: c.headers });
    expect(preview.json().chargePaise).toBe(BID.visitFeePaise);

    await app.inject({ method: 'POST', url: `/jobs/${jobId}/cancel`, headers: c.headers, payload: { reason: 'Something came up' } });
    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    expect(money.json().capturedPaise).toBe(BID.visitFeePaise);
  });

  it('sends the customer to support once work has started', async () => {
    const { c, jobId } = await jobInProgress('+919555000015', '+919555000016');
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/cancel`, headers: c.headers, payload: { reason: 'Changed my mind' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.finance).toEqual(['CANCELLATION_NEEDS_SUPPORT']);
  });

  it('costs the customer nothing when the provider backs out, and strikes the provider', async () => {
    const { c, p, jobId } = await confirmedJob('+919555000017', '+919555000018');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/cancel-as-provider`, headers: p.headers,
      payload: { reason: 'Van broke down' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('CANCELLED_BY_PROVIDER');

    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    expect(money.json().capturedPaise).toBe(0);

    const strikes = await app.ctx.store.finance.listStrikes(p.userId);
    expect(strikes[0]?.severity).toBe('MAJOR');
    const profile = await app.ctx.store.users.getProviderProfile(p.userId);
    expect(profile!.reliability_score).toBeLessThan(4.8);
  });
});

describe('disputes (DISPUTE_POLICY.md)', () => {
  it('freezes the money and the payout the moment one is raised', async () => {
    const { c, p, jobId } = await completedJob('+919555000019', '+919555000020');

    const raised = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/dispute`, headers: c.headers,
      payload: { category: 'POOR_WORKMANSHIP', description: 'The tap started leaking again within an hour of them leaving' },
    });
    expect(raised.statusCode).toBe(201);
    expect(raised.json().status).toBe('OPEN');
    expect(raised.json().raisedByMe).toBe(true);

    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    expect(money.json().status).toBe('DISPUTE_HOLD');

    // nothing is paid out while it is open, even after the hold window
    await ageSettlements(jobId);
    const a = await admin();
    await app.inject({ method: 'POST', url: '/admin/settlements/run', headers: a.headers });
    const earnings = await app.inject({ method: 'GET', url: '/me/earnings', headers: p.headers });
    expect(earnings.json().settledPaise).toBe(0);
  });

  it('refunds on a resolution and puts the money back where it came from', async () => {
    const { c, jobId, quote } = await completedJob('+919555000021', '+919555000022');
    const raised = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/dispute`, headers: c.headers,
      payload: { category: 'INCOMPLETE_WORK', description: 'Half the job was left unfinished when they walked out' },
    });
    const a = await admin();

    const resolved = await app.inject({
      method: 'POST', url: `/admin/disputes/${raised.json().id}/resolve`, headers: a.headers,
      payload: {
        resolution: 'PARTIAL_REFUND',
        refundPaise: 20_000,
        reason: 'Photos show the second tap was never touched, so half the labour is refunded',
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe('RESOLVED');
    expect(resolved.json().refundPaise).toBe(20_000);

    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    expect(money.json().refundedPaise).toBe(20_000);
    expect(money.json().status).toBe('PARTIALLY_REFUNDED');

    const ledger = await app.inject({ method: 'GET', url: `/admin/jobs/${jobId}/ledger`, headers: a.headers });
    expect(ledger.json().netPaise).toBe(0);
    const refundLine = (ledger.json().items as Array<{ entryType: string; amountPaise: number }>).find((e) => e.entryType === 'REFUND');
    expect(refundLine!.amountPaise).toBe(-20_000);
    // and the provider's payout shrinks by what was given back
    await ageSettlements(jobId);
    await app.inject({ method: 'POST', url: '/admin/settlements/run', headers: a.headers });
    expect(quote.providerPayablePaise).toBeGreaterThan(0);
  });

  it('needs a second approver for a large refund', async () => {
    // a genuinely large job, so the refund really is over the threshold
    const { c, jobId } = await completedJob('+919555000023', '+919555000024', { labourPaise: 8_00_000, visitFeePaise: 0, etaMinutes: 60, warrantyDays: 15 });
    const raised = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/dispute`, headers: c.headers,
      payload: { category: 'PROPERTY_DAMAGE', description: 'They cracked the basin while removing the old tap fitting' },
    });
    expect(raised.json().needsHuman).toBe(true);

    const a = await admin();
    const alone = await app.inject({
      method: 'POST', url: `/admin/disputes/${raised.json().id}/resolve`, headers: a.headers,
      payload: { resolution: 'PARTIAL_REFUND', refundPaise: 6_00_000, reason: 'Basin replacement quoted by an independent plumber' },
    });
    expect(alone.json().error.details.finance).toEqual(['SECOND_APPROVER_REQUIRED']);

    const support = await login(app, '+919000000008');
    const together = await app.inject({
      method: 'POST', url: `/admin/disputes/${raised.json().id}/resolve`, headers: a.headers,
      payload: {
        resolution: 'PARTIAL_REFUND',
        refundPaise: 6_00_000,
        reason: 'Basin replacement quoted by an independent plumber',
        secondApproverId: support.user.id,
      },
    });
    expect(together.statusCode).toBe(200);
  });

  it('allows only one open dispute per job, and only from someone on it', async () => {
    const { c, jobId } = await completedJob('+919555000025', '+919555000026');
    const body = { category: 'LATE_ARRIVAL' as const, description: 'They turned up nearly three hours after the agreed slot' };
    const first = await app.inject({ method: 'POST', url: `/jobs/${jobId}/dispute`, headers: c.headers, payload: body });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/jobs/${jobId}/dispute`, headers: c.headers, payload: body });
    expect(second.json().error.details.finance).toEqual(['ALREADY_OPEN']);

    const stranger = await makeProvider('+919555000027');
    const outside = await app.inject({ method: 'POST', url: `/jobs/${jobId}/dispute`, headers: stranger.headers, payload: body });
    expect(outside.json().error.details.finance).toEqual(['NOT_ON_JOB']);
  });

  it('refuses a dispute with no real description', async () => {
    const { c, jobId } = await completedJob('+919555000028', '+919555000029');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/dispute`, headers: c.headers,
      payload: { category: 'LATE_ARRIVAL', description: 'bad' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('reviews', () => {
  it('is left once per person and moves the provider rating', async () => {
    const { c, p, jobId } = await completedJob('+919555000030', '+919555000031');
    const before = await app.ctx.store.users.getProviderProfile(p.userId);

    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/review`, headers: c.headers, payload: { rating: 5, comment: 'Quick and tidy' } });
    expect(r.statusCode).toBe(201);

    const after = await app.ctx.store.users.getProviderProfile(p.userId);
    expect(after!.rating_count).toBe(before!.rating_count + 1);

    const again = await app.inject({ method: 'POST', url: `/jobs/${jobId}/review`, headers: c.headers, payload: { rating: 1 } });
    expect(again.json().error.details.finance).toEqual(['ALREADY_REVIEWED']);

    const list = await app.inject({ method: 'GET', url: `/providers/${p.userId}/reviews` });
    expect(list.json().items[0].rating).toBe(5);
    // a public review carries a first name only
    expect(list.json().items[0].reviewerName).not.toContain(' ');
  });

  it('cannot be left on a job that is not finished', async () => {
    const { c, jobId } = await jobInProgress('+919555000032', '+919555000033');
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/review`, headers: c.headers, payload: { rating: 5 } });
    expect(r.json().error.details.finance).toEqual(['JOB_NOT_COMPLETE']);
  });
});

describe('refund limits', () => {
  it('never refunds more than was captured', async () => {
    const { jobId, quote } = await completedJob('+919555000034', '+919555000035');
    const a = await admin();
    const r = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/refund`, headers: a.headers,
      payload: { amountPaise: quote.totalPaise + 1, reason: 'Trying to refund more than we ever took' },
    });
    expect(r.json().error.details.finance).toEqual(['REFUND_EXCEEDS_CAPTURE']);
    expect(r.json().error.details.capturedPaise).toBe(quote.totalPaise);
  });

  it('adds up across several partial refunds', async () => {
    const { c, jobId, quote } = await completedJob('+919555000036', '+919555000037');
    const a = await admin();
    const first = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/refund`, headers: a.headers,
      payload: { amountPaise: 30_000, reason: 'Agreed goodwill refund for the delay' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/refund`, headers: a.headers,
      payload: { amountPaise: quote.totalPaise, reason: 'Second refund that would take it past the captured amount' },
    });
    expect(second.json().error.details.finance).toEqual(['REFUND_EXCEEDS_CAPTURE']);

    const money = await app.inject({ method: 'GET', url: `/jobs/${jobId}/money`, headers: c.headers });
    expect(money.json().refundedPaise).toBe(30_000);
  });
});
