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

/** A job all the way to PROVIDER_ASSIGNED: offer placed, accepted, payment authorized. */
async function confirmedJob(customerPhone: string, providerPhone: string) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: BID });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
  const paymentId = accepted.json().payment.id as string;
  await app.inject({
    method: 'POST', url: `/payments/${paymentId}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  return { c, p, jobId: c.job.id as string };
}

/** The customer's own view is the only place the start code is ever shown. */
async function startCode(jobId: string, headers: Record<string, string>) {
  const r = await app.inject({ method: 'GET', url: `/jobs/${jobId}/execution`, headers });
  return r.json().startCode as string;
}

async function attachEvidence(jobId: string, headers: Record<string, string>) {
  const r = await app.inject({
    method: 'POST', url: `/jobs/${jobId}/evidence`, headers,
    payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 120_000 },
  });
  if (r.statusCode !== 201) throw new Error(`evidence upload failed: ${r.body}`);
  return r.json().media.id as string;
}

/** Straight to IN_PROGRESS: on the way, arrived, started with the code. */
async function jobInProgress(customerPhone: string, providerPhone: string) {
  const s = await confirmedJob(customerPhone, providerPhone);
  await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/progress`, headers: s.p.headers, payload: { to: 'EN_ROUTE' } });
  await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/progress`, headers: s.p.headers, payload: { to: 'ARRIVED' } });
  const code = await startCode(s.jobId, s.c.headers);
  const started = await app.inject({ method: 'POST', url: `/jobs/${s.jobId}/start`, headers: s.p.headers, payload: { code } });
  if (started.statusCode !== 200) throw new Error(`start failed: ${started.body}`);
  return s;
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

describe('arrival and the start code (PRODUCT_SPEC section 12)', () => {
  it('walks PROVIDER_ASSIGNED -> EN_ROUTE -> ARRIVED -> IN_PROGRESS with the code', async () => {
    const { c, p, jobId } = await confirmedJob('+919777000001', '+919777000002');

    const enRoute = await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE', etaMinutes: 20 } });
    expect(enRoute.statusCode).toBe(200);
    expect(enRoute.json().status).toBe('EN_ROUTE');

    const arrived = await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
    expect(arrived.json().status).toBe('ARRIVED');

    const code = await startCode(jobId, c.headers);
    expect(code).toMatch(/^\d{4}$/);

    const started = await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code } });
    expect(started.statusCode).toBe(200);
    // STARTED is a moment, not a state to sit in
    expect(started.json().status).toBe('IN_PROGRESS');

    const trail = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    const statuses = (trail.json().events as Array<{ toStatus: string }>).map((e) => e.toStatus);
    expect(statuses).toContain('ARRIVED');
    expect(statuses).toContain('STARTED');
  });

  it('never shows the code to the provider', async () => {
    const { p, jobId } = await confirmedJob('+919777000003', '+919777000004');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}/execution`, headers: p.headers });
    expect(view.statusCode).toBe(200);
    expect(view.json().startCode).toBeNull();
  });

  it('refuses a wrong code, counts the attempt and locks after five', async () => {
    const { c, p, jobId } = await confirmedJob('+919777000005', '+919777000006');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
    const real = await startCode(jobId, c.headers);
    const wrong = real === '0000' ? '1111' : '0000';

    const first = await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code: wrong } });
    expect(first.statusCode).toBe(400);
    expect(first.json().error.details.execution).toEqual(['WRONG_CODE']);
    expect(first.json().error.details.attemptsLeft).toBe(4);

    for (let i = 0; i < 4; i++) {
      await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code: wrong } });
    }
    const locked = await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code: real } });
    expect(locked.json().error.details.execution).toEqual(['TOO_MANY_ATTEMPTS']);

    const job = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(job.json().status).toBe('ARRIVED');
  });

  it('cannot start before arriving', async () => {
    const { c, p, jobId } = await confirmedJob('+919777000007', '+919777000008');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    const code = await startCode(jobId, c.headers);
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers, payload: { code } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.execution).toEqual(['JOB_NOT_ARRIVED']);
  });

  it('refuses a stranger who somehow has the code', async () => {
    const { c, p, jobId } = await confirmedJob('+919777000009', '+919777000010');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
    const code = await startCode(jobId, c.headers);

    const other = await makeProvider('+919777000011');
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: other.headers, payload: { code } });
    expect(r.statusCode).toBe(403);
  });

  it('lets an admin override with a reason, and records that it was overridden', async () => {
    const { c, p, jobId } = await confirmedJob('+919777000012', '+919777000013');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });

    const admin = await login(app, '+919000000007');
    const ah = bearer(admin.accessToken, { 'x-active-role': 'ADMIN' });
    const short = await app.inject({ method: 'POST', url: `/jobs/${jobId}/start`, headers: ah, payload: { override: true, reason: 'lost' } });
    expect(short.json().error.details.execution).toEqual(['OVERRIDE_NEEDS_REASON']);

    const ok = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/start`, headers: ah,
      payload: { override: true, reason: 'Customer is unreachable, confirmed by phone with the neighbour' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('IN_PROGRESS');

    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}/execution`, headers: c.headers });
    expect(view.json().startWasOverridden).toBe(true);
    // the code is spent, so it is no longer shown
    expect(view.json().startCode).toBeNull();
  });

  it('refuses an override from the provider', async () => {
    const { p, jobId } = await confirmedJob('+919777000014', '+919777000015');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/start`, headers: p.headers,
      payload: { override: true, reason: 'The customer told me to just start the work' },
    });
    expect(r.json().error.details.execution).toEqual(['OVERRIDE_NOT_ALLOWED']);
  });
});

describe('technician handoff', () => {
  it('assigns a verified technician of the same provider', async () => {
    const { c, p, jobId } = await confirmedJob('+919777000016', '+919777000017');
    const tech = await login(app, '+919000000005');
    await app.ctx.store.users.upsertTechnicianProfile({
      user_id: tech.user.id,
      contractor_id: p.userId,
      full_name: 'Ravi (Technician)',
      verification_status: 'VERIFIED',
      skills: [],
      active: true,
    });

    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/technician`, headers: p.headers, payload: { technicianId: tech.user.id } });
    expect(r.statusCode).toBe(200);

    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}/execution`, headers: c.headers });
    expect(view.json().technician.name).toBe('Ravi (Technician)');
    expect(view.json().technician.verified).toBe(true);
    // the customer gets a masked number, never the real one
    expect(view.json().technician.maskedPhone).not.toContain('0000005');
  });

  it('refuses an unverified technician', async () => {
    const { p, jobId } = await confirmedJob('+919777000018', '+919777000019');
    const tech = await login(app, '+919777000020');
    await app.ctx.store.users.grantRole({ user_id: tech.user.id, role: 'TECHNICIAN', granted_by: null });
    await app.ctx.store.users.upsertTechnicianProfile({
      user_id: tech.user.id,
      contractor_id: p.userId,
      full_name: 'Unverified helper',
      verification_status: 'SUBMITTED',
      skills: [],
      active: true,
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/technician`, headers: p.headers, payload: { technicianId: tech.user.id } });
    expect(r.json().error.details.execution).toEqual(['TECHNICIAN_NOT_VERIFIED']);
  });
});

describe('price revision (PRODUCT_SPEC section 11)', () => {
  it('needs evidence and an explanation before a customer is asked for more money', async () => {
    const { p, jobId } = await jobInProgress('+919777000021', '+919777000022');
    const mediaId = await attachEvidence(jobId, p.headers);

    const thin = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers,
      payload: { reason: 'EXTRA_WORK', extraLabourPaise: 20_000, explanation: 'need more', mediaIds: [mediaId] },
    });
    expect(thin.statusCode).toBe(400);

    const nothing = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers,
      payload: { reason: 'EXTRA_WORK', extraLabourPaise: 0, explanation: 'The pipe behind the wall is also rusted through', mediaIds: [mediaId] },
    });
    expect(nothing.json().error.details.execution).toEqual(['NOTHING_EXTRA']);
  });

  it('approval supersedes the quote and opens a separate authorization for the difference', async () => {
    const { c, p, jobId } = await jobInProgress('+919777000023', '+919777000024');
    const mediaId = await attachEvidence(jobId, p.headers);

    const asked = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers,
      payload: {
        reason: 'HIDDEN_DAMAGE',
        extraLabourPaise: 20_000,
        extraTimeMinutes: 30,
        explanation: 'The pipe behind the wall is also rusted through and has to be replaced',
        mediaIds: [mediaId],
      },
    });
    expect(asked.statusCode).toBe(201);
    const revision = asked.json();
    expect(revision.differencePaise).toBeGreaterThan(20_000); // the fee and tax move with the labour

    const pending = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(pending.json().status).toBe('PRICE_REVISION_PENDING');

    const booking = await app.inject({ method: 'GET', url: `/jobs/${jobId}/booking`, headers: c.headers });
    const before = booking.json().quote.totalPaise;

    const approved = await app.inject({
      method: 'POST', url: `/price-revisions/${revision.id}/respond`, headers: c.headers,
      payload: { action: 'APPROVE' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().revision.status).toBe('APPROVED');
    // the original hold is untouched; only the difference is asked for
    expect(approved.json().payment.amountPaise).toBe(revision.differencePaise);
    expect(approved.json().payment.purpose).toBe('PRICE_REVISION');
    expect(approved.json().payment.status).toBe('PENDING');

    const after = await app.inject({ method: 'GET', url: `/jobs/${jobId}/booking`, headers: c.headers });
    expect(after.json().quote.totalPaise).toBe(revision.revisedTotalPaise);
    expect(after.json().quote.totalPaise).toBeGreaterThan(before);

    const back = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(back.json().status).toBe('IN_PROGRESS');
  });

  it('rejection keeps the original quote exactly as it was', async () => {
    const { c, p, jobId } = await jobInProgress('+919777000025', '+919777000026');
    const mediaId = await attachEvidence(jobId, p.headers);
    const before = (await app.inject({ method: 'GET', url: `/jobs/${jobId}/booking`, headers: c.headers })).json().quote.totalPaise;

    const asked = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers,
      payload: { reason: 'EXTRA_WORK', extraLabourPaise: 30_000, explanation: 'Two more taps need replacing while I am here', mediaIds: [mediaId] },
    });
    const r = await app.inject({
      method: 'POST', url: `/price-revisions/${asked.json().id}/respond`, headers: c.headers,
      payload: { action: 'REJECT', message: 'Just do what we agreed' },
    });
    expect(r.json().revision.status).toBe('REJECTED');
    expect(r.json().payment).toBeNull();

    const after = await app.inject({ method: 'GET', url: `/jobs/${jobId}/booking`, headers: c.headers });
    expect(after.json().quote.totalPaise).toBe(before);
    const job = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: c.headers });
    expect(job.json().status).toBe('IN_PROGRESS');
  });

  it('only the customer may answer', async () => {
    const { p, jobId } = await jobInProgress('+919777000027', '+919777000028');
    const mediaId = await attachEvidence(jobId, p.headers);
    const asked = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers,
      payload: { reason: 'EXTRA_WORK', extraLabourPaise: 15_000, explanation: 'The valve under the sink is also leaking badly', mediaIds: [mediaId] },
    });
    const r = await app.inject({
      method: 'POST', url: `/price-revisions/${asked.json().id}/respond`, headers: p.headers,
      payload: { action: 'APPROVE' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('allows only one open request at a time', async () => {
    const { p, jobId } = await jobInProgress('+919777000029', '+919777000030');
    const mediaId = await attachEvidence(jobId, p.headers);
    const body = { reason: 'EXTRA_WORK', extraLabourPaise: 10_000, explanation: 'The shut-off valve is seized and must be cut out', mediaIds: [mediaId] };
    const first = await app.inject({ method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers, payload: body });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/jobs/${jobId}/price-revision`, headers: p.headers, payload: body });
    // the job has already left IN_PROGRESS, which is itself the guard
    expect(second.statusCode).toBe(400);
  });
});

describe('completion and approval', () => {
  it('requires a photo and a summary, then waits for the customer', async () => {
    const { c, p, jobId } = await jobInProgress('+919777000031', '+919777000032');

    const noPhoto = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/complete`, headers: p.headers,
      payload: { summary: 'Replaced the cartridge and tested it', mediaIds: [] },
    });
    expect(noPhoto.statusCode).toBe(400);

    const mediaId = await attachEvidence(jobId, p.headers);
    const done = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/complete`, headers: p.headers,
      payload: { summary: 'Replaced the cartridge and tested it for leaks', mediaIds: [mediaId], warrantyNote: '15 days on the part' },
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().status).toBe('CUSTOMER_APPROVAL_PENDING');

    const approved = await app.inject({ method: 'POST', url: `/jobs/${jobId}/approve`, headers: c.headers, payload: { approved: true, rating: 5 } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('COMPLETED');
    expect(approved.json().completion.approvedAt).not.toBeNull();

    // capture and payout are M7: the money is still only authorized
    const booking = await app.inject({ method: 'GET', url: `/jobs/${jobId}/booking`, headers: c.headers });
    expect(booking.json().payments.every((p2: { status: string }) => p2.status !== 'CAPTURED')).toBe(true);
  });

  it('sends the provider back when the customer reports unfinished work', async () => {
    const { c, p, jobId } = await jobInProgress('+919777000033', '+919777000034');
    const mediaId = await attachEvidence(jobId, p.headers);
    await app.inject({
      method: 'POST', url: `/jobs/${jobId}/complete`, headers: p.headers,
      payload: { summary: 'Tap fixed and area cleaned up', mediaIds: [mediaId] },
    });
    const rejected = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/approve`, headers: c.headers,
      payload: { approved: false, reason: 'It is still dripping when the tap is half open' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('IN_PROGRESS');
    expect(rejected.json().completion.rejectionReason).toContain('dripping');
  });

  it('refuses a completion from someone who is not on the job', async () => {
    const { jobId } = await jobInProgress('+919777000035', '+919777000036');
    const other = await makeProvider('+919777000037');
    const r = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/complete`, headers: other.headers,
      payload: { summary: 'I did this work honestly', mediaIds: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('in-job chat', () => {
  it('carries messages both ways and flags contact details', async () => {
    const { c, p, jobId } = await jobInProgress('+919777000038', '+919777000039');

    const fromCustomer = await app.inject({ method: 'POST', url: `/jobs/${jobId}/chat`, headers: c.headers, payload: { body: 'The gate code is on the intercom' } });
    expect(fromCustomer.statusCode).toBe(201);
    expect(fromCustomer.json().flagged).toBe(false);

    const offPlatform = await app.inject({ method: 'POST', url: `/jobs/${jobId}/chat`, headers: p.headers, payload: { body: 'Pay me directly on 9876543210' } });
    expect(offPlatform.json().flagged).toBe(true);

    const thread = await app.inject({ method: 'GET', url: `/jobs/${jobId}/chat`, headers: c.headers });
    expect(thread.json().items).toHaveLength(2);
    expect(thread.json().items[0].mine).toBe(true);
    expect(thread.json().items[1].senderParty).toBe('PROVIDER');
  });

  it('keeps strangers out of the thread', async () => {
    const { jobId } = await jobInProgress('+919777000040', '+919777000041');
    const other = await makeProvider('+919777000042');
    const r = await app.inject({ method: 'GET', url: `/jobs/${jobId}/chat`, headers: other.headers });
    expect(r.statusCode).toBe(403);
  });

  it('closes the thread once the work is approved', async () => {
    const { c, p, jobId } = await jobInProgress('+919777000043', '+919777000044');
    const mediaId = await attachEvidence(jobId, p.headers);
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/complete`, headers: p.headers, payload: { summary: 'All done and tested', mediaIds: [mediaId] } });
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/approve`, headers: c.headers, payload: { approved: true } });

    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/chat`, headers: c.headers, payload: { body: 'One more thing' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.execution).toEqual(['CHAT_CLOSED']);
  });
});
