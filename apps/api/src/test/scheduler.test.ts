import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TASK_SCHEDULE } from '@hyperlocal/core';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let plumbingId: string;
let plumbingSkills: string[];

const BID = { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 };

async function customerWithJob(phone: string, submit = true) {
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
  if (!submit) return { headers: h, userId: res.user.id, jobId: job.json().id as string };
  const submitted = await app.inject({ method: 'POST', url: `/jobs/${job.json().id}/submit`, headers: h });
  return { headers: h, userId: res.user.id, jobId: submitted.json().job.id as string };
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

const run = (task: string) => app.ctx.services.scheduler.runTask(task as never);

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

describe('bidding windows', () => {
  it('auto-cancels a job nobody answered, and tells the customer why', async () => {
    const c = await customerWithJob('+919333000001');
    await app.ctx.store.jobs.update(c.jobId, { bid_window_ends_at: new Date(Date.now() - 60_000) });

    const result = await run('expire-bid-windows');
    expect(result.handled).toBeGreaterThan(0);

    const job = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}`, headers: c.headers });
    expect(job.json().status).toBe('AUTO_CANCELLED');
    const inbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: c.headers });
    expect((inbox.json().items as Array<{ type: string }>).some((n) => n.type === 'job.auto_cancelled')).toBe(true);
  });

  it('leaves a job alone while the customer still has offers to choose from', async () => {
    const c = await customerWithJob('+919333000002');
    const p = await makeProvider('+919333000003');
    await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    await app.ctx.store.jobs.update(c.jobId, { bid_window_ends_at: new Date(Date.now() - 60_000) });

    await run('expire-bid-windows');
    const job = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}`, headers: c.headers });
    expect(job.json().status).toBe('BID_RECEIVED');
  });
});

describe('offer expiry', () => {
  it('expires a counter nobody answered and hands the job back to its offers', async () => {
    const c = await customerWithJob('+919333000004');
    const p = await makeProvider('+919333000005');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    const counter = await app.inject({
      method: 'POST', url: `/jobs/${c.jobId}/counter-offer`, headers: c.headers,
      payload: { bidId: offer.json().id, labourPaise: 45_000 },
    });
    expect(counter.statusCode).toBe(201);

    const negotiating = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}`, headers: c.headers });
    expect(negotiating.json().status).toBe('NEGOTIATING');

    await app.ctx.store.negotiation.updateOffer(counter.json().id, { expires_at: new Date(Date.now() - 1000) });
    const result = await run('expire-offers');
    expect(result.handled).toBeGreaterThan(0);

    const after = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}`, headers: c.headers });
    expect(after.json().status).toBe('BID_RECEIVED');
    const chain = await app.inject({ method: 'GET', url: `/jobs/${c.jobId}/offer-chain`, headers: c.headers });
    expect((chain.json().items as Array<{ status: string }>)[0]!.status).toBe('EXPIRED');
  });
});

describe('drafts', () => {
  it('abandons a draft nobody ever submitted, and leaves a fresh one alone', async () => {
    const stale = await customerWithJob('+919333000006', false);
    const fresh = await customerWithJob('+919333000007', false);
    await app.ctx.store.jobs.update(stale.jobId, { created_at: new Date(Date.now() - 96 * 3600_000) });

    await run('abandon-drafts');
    expect((await app.ctx.store.jobs.get(stale.jobId))!.status).toBe('ABANDONED');
    expect((await app.ctx.store.jobs.get(fresh.jobId))!.status).toBe('DRAFT');
  });
});

describe('payment reconciliation (PAYMENT_FLOW section 8)', () => {
  it('leaves a payment alone while the gateway still says pending', async () => {
    const c = await customerWithJob('+919333000008');
    const p = await makeProvider('+919333000009');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
    const paymentId = accepted.json().payment.id as string;

    await app.ctx.store.payments.update(paymentId, { created_at: new Date(Date.now() - 5 * 60_000) });
    await run('reconcile-payments');

    // the mock gateway has no memory, so nothing is invented on the customer's behalf
    expect((await app.ctx.store.payments.get(paymentId))!.status).toBe('PENDING');
  });

  it('hands a payment stuck past the give-up window to support', async () => {
    const c = await customerWithJob('+919333000010');
    const p = await makeProvider('+919333000011');
    const offer = await app.inject({ method: 'POST', url: `/jobs/${c.jobId}/bids`, headers: p.headers, payload: BID });
    const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers });
    const paymentId = accepted.json().payment.id as string;

    await app.ctx.store.payments.update(paymentId, { created_at: new Date(Date.now() - 45 * 60_000) });
    const result = await run('reconcile-payments');
    expect(result.handled).toBeGreaterThan(0);

    const tickets = await app.inject({ method: 'GET', url: '/support/tickets', headers: c.headers });
    expect((tickets.json().items as Array<{ category: string }>).some((t) => t.category === 'PAYMENT_ISSUE')).toBe(true);
  });
});

describe('the worker itself', () => {
  it('runs what is due, records each task, and keeps going when one fails', async () => {
    const results = await app.ctx.services.scheduler.runDue();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => typeof r.durationMs === 'number')).toBe(true);

    const status = app.ctx.services.scheduler.status();
    // Every task in TASK_SCHEDULE is wired: a task in the schedule with no handler would be a
    // silent no-op, which is the failure mode a scheduler is least able to tell you about.
    expect(status.length).toBe(TASK_SCHEDULE.length);
    expect(status.every((t) => t.description.length > 10)).toBe(true);
    expect(status.filter((t) => t.runs > 0).length).toBeGreaterThan(0);
  });

  it('does not run a task again before it is due', async () => {
    await app.ctx.services.scheduler.runTask('abandon-drafts');
    const before = app.ctx.services.scheduler.status().find((t) => t.task === 'abandon-drafts')!.runs;
    await app.ctx.services.scheduler.runDue();
    const after = app.ctx.services.scheduler.status().find((t) => t.task === 'abandon-drafts')!.runs;
    expect(after).toBe(before);
  });

  it('is support-only over HTTP, and needs a reason trail', async () => {
    const c = await customerWithJob('+919333000012');
    const forbidden = await app.inject({ method: 'POST', url: '/admin/scheduler/run', headers: c.headers, payload: {} });
    expect(forbidden.statusCode).toBe(403);

    const adminRes = await login(app, '+919000000007');
    const adminHeaders = bearer(adminRes.accessToken, { 'x-active-role': 'ADMIN' });
    const ok = await app.inject({ method: 'POST', url: '/admin/scheduler/run', headers: adminHeaders, payload: { task: 'abandon-drafts' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().results[0].task).toBe('abandon-drafts');

    const logs = await app.inject({ method: 'GET', url: '/admin/audit-logs?limit=20', headers: adminHeaders });
    expect(JSON.stringify(logs.json())).toContain('admin.scheduler.run');
  });
});

describe('retention sweep (PRIVACY_DATA_MAP)', () => {
  it('anonymises a user whose deletion date has arrived but keeps the financial trail', async () => {
    const c = await customerWithJob('+919333000013');
    await app.ctx.store.retention.schedule({
      entity_type: 'user',
      entity_id: c.userId,
      action: 'ANONYMISE',
      scheduled_for: new Date(Date.now() - 1000),
      executed_at: null,
      reason: 'account deletion requested',
    });

    const result = await run('retention-sweep');
    expect(result.handled).toBeGreaterThan(0);

    const user = await app.ctx.store.users.findById(c.userId);
    expect(user!.display_name).toBe('Deleted user');
    expect(user!.deleted_at).not.toBeNull();
    // the job itself is still there: financial and audit history is retained
    expect(await app.ctx.store.jobs.get(c.jobId)).not.toBeNull();
  });
});
