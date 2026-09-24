import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * The warranty every quote has promised since M4, and the four other holes closed with it:
 * looking at a professional before booking them, a search box that searches, a moderation queue
 * somebody reads, and a data export.
 */

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
    payload: { businessName: `Services ${phone.slice(-4)}`, serviceRadiusKm: 8, baseAddressId: addr.json().id, skillIds: plumbingSkills, bio: 'Twelve years on the tools.', experienceYears: 12 },
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

/**
 * A finished, approved job - which is when a warranty starts running.
 *
 * `duringJob` runs while the work is still live, which is the only time chat is open: once a job
 * finishes the thread closes, so anything that needs a message has to say it here.
 */
async function completedJob(
  customerPhone: string,
  providerPhone: string,
  bid = BID,
  duringJob?: (ctx: { c: { headers: Record<string, string> }; p: { headers: Record<string, string> }; jobId: string }) => Promise<void>,
) {
  const c = await customerWithOpenJob(customerPhone);
  const p = await makeProvider(providerPhone);
  const offer = await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/bids`, headers: p.headers, payload: bid });
  const accepted = await app.inject({ method: 'POST', url: `/bids/${offer.json().id}/accept`, headers: c.headers, payload: {} });
  await app.inject({
    method: 'POST', url: `/payments/${accepted.json().payment.id}/mock-complete`, headers: c.headers,
    payload: { outcome: 'authorized' },
  });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/progress`, headers: p.headers, payload: { to: 'EN_ROUTE' } });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/progress`, headers: p.headers, payload: { to: 'ARRIVED' } });
  const panel = await app.inject({ method: 'GET', url: `/jobs/${c.job.id}/execution`, headers: c.headers });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/start`, headers: p.headers, payload: { code: panel.json().startCode } });
  if (duringJob) await duringJob({ c, p, jobId: c.job.id as string });
  const shot = await app.inject({
    method: 'POST', url: `/jobs/${c.job.id}/evidence`, headers: p.headers,
    payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 120_000 },
  });
  await app.inject({
    method: 'POST', url: `/jobs/${c.job.id}/complete`, headers: p.headers,
    payload: { summary: 'Replaced the cartridge and tested it', mediaIds: [shot.json().media.id] },
  });
  await app.inject({ method: 'POST', url: `/jobs/${c.job.id}/approve`, headers: c.headers, payload: { approved: true } });
  return { c, p, jobId: c.job.id as string };
}

const CLAIM = { description: 'The same tap has started dripping again, three days after the repair.' };

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

describe('a warranty somebody can actually claim on', () => {
  it('tells the customer what cover they have, without them working it out', async () => {
    const { c, jobId } = await completedJob('+919555100001', '+919555100002');
    const status = await app.inject({ method: 'GET', url: `/jobs/${jobId}/warranty`, headers: c.headers });
    expect(status.statusCode).toBe(200);
    expect(status.json().warrantyDays).toBe(15);
    expect(status.json().active).toBe(true);
    expect(status.json().daysLeft).toBe(15);
    expect(status.json().canClaim).toBe(true);
  });

  it('raises a claim and tells the professional, with a clock on it', async () => {
    const { c, p, jobId } = await completedJob('+919555100003', '+919555100004');

    const raised = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    expect(raised.statusCode).toBe(201);
    expect(raised.json().claim.status).toBe('OPEN');
    expect(raised.json().claim.warrantyDays).toBe(15);

    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: p.headers });
    expect((theirs.json().items as Array<{ type: string }>).map((n) => n.type)).toContain('warranty.claimed');
  });

  it('is not filed as a dispute, because it is not an argument', async () => {
    const { c, jobId } = await completedJob('+919555100005', '+919555100006');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });

    // A strike-shaped cloud over somebody who has done nothing wrong is how professionals stop
    // offering warranties.
    const disputes = await app.inject({ method: 'GET', url: `/jobs/${jobId}/disputes`, headers: c.headers });
    expect(disputes.json().items).toHaveLength(0);
  });

  it('refuses a claim after the window, in the customer own words', async () => {
    const { c, jobId } = await completedJob('+919555100007', '+919555100008');
    // Backdate the completion past the 15-day cover.
    const completion = await app.ctx.store.execution.latestCompletion(jobId);
    await app.ctx.store.execution.updateCompletion(completion!.id, { approved_at: new Date(Date.now() - 20 * 24 * 3600_000) });

    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.warranty).toEqual(['WARRANTY_EXPIRED']);
    expect(r.json().error.details.message).toContain('15-day warranty');
  });

  it('keeps one claim per booking', async () => {
    const { c, jobId } = await completedJob('+919555100009', '+919555100010');
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    const second = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    expect(second.json().error.details.warranty).toEqual(['ALREADY_OPEN']);
  });

  it('is not somebody else claim to make', async () => {
    const { jobId } = await completedJob('+919555100011', '+919555100012');
    const stranger = await customerWithOpenJob('+919555100013');
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: stranger.headers, payload: CLAIM });
    expect(r.statusCode).toBe(403);
  });
});

describe('answering a claim', () => {
  it('accepts, and books a return visit that carries no money', async () => {
    const { c, p, jobId } = await completedJob('+919555100020', '+919555100021');
    const raised = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    const claimId = raised.json().claim.id;

    const accepted = await app.inject({
      method: 'POST', url: `/warranty-claims/${claimId}/respond`, headers: p.headers,
      payload: { response: 'ACCEPT' },
    });
    expect(accepted.json().claim.status).toBe('ACCEPTED');

    const revisit = await app.inject({ method: 'POST', url: `/warranty-claims/${claimId}/revisit`, headers: c.headers, payload: {} });
    expect(revisit.statusCode).toBe(201);
    const revisitJobId = revisit.json().claim.revisitJobId as string;
    expect(revisitJobId).toBeTruthy();

    // The return visit is work the professional already agreed to when they offered a warranty.
    // Nothing may charge for it, and nothing may pay them again for it.
    const revisitJob = await app.ctx.store.jobs.get(revisitJobId);
    expect(revisitJob!.warranty_claim_id).toBe(claimId);
    expect(revisitJob!.confirmed_provider_id).toBe(p.userId);
    expect(await app.ctx.store.payments.listForJob(revisitJobId)).toHaveLength(0);
    expect(await app.ctx.store.negotiation.getActiveQuote(revisitJobId)).toBeNull();
  });

  it('lets a professional decline, but never without explaining', async () => {
    const { c, p, jobId } = await completedJob('+919555100022', '+919555100023');
    const raised = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    const claimId = raised.json().claim.id;

    const bare = await app.inject({
      method: 'POST', url: `/warranty-claims/${claimId}/respond`, headers: p.headers,
      payload: { response: 'DECLINE' },
    });
    expect(bare.json().error.details.warranty).toEqual(['REASON_REQUIRED']);

    const explained = await app.inject({
      method: 'POST', url: `/warranty-claims/${claimId}/respond`, headers: p.headers,
      payload: { response: 'DECLINE', reason: 'The new leak is on a different pipe, upstream of the joint I replaced.' },
    });
    expect(explained.json().claim.status).toBe('DECLINED');
    expect(explained.json().claim.declineReason).toContain('different pipe');
  });

  it('is not a claim a stranger can answer', async () => {
    const { c, jobId } = await completedJob('+919555100024', '+919555100025');
    const raised = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    const other = await makeProvider('+919555100026');
    const r = await app.inject({
      method: 'POST', url: `/warranty-claims/${raised.json().claim.id}/respond`, headers: other.headers,
      payload: { response: 'ACCEPT' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('hands support a claim the professional ignored', async () => {
    const { c, jobId } = await completedJob('+919555100027', '+919555100028');
    const raised = await app.inject({ method: 'POST', url: `/jobs/${jobId}/warranty-claim`, headers: c.headers, payload: CLAIM });
    const claimId = raised.json().claim.id as string;

    // Age it past the 48-hour response window.
    await app.ctx.store.trust.updateClaim(claimId, { created_at: new Date(Date.now() - 50 * 3600_000) });
    const result = await app.ctx.services.scheduler.runTask('escalate-warranty');
    expect(result.handled).toBeGreaterThan(0);

    // Silence must not be a way to run down somebody's warranty clock.
    expect((await app.ctx.store.trust.getClaim(claimId))!.status).toBe('ESCALATED');
    const tickets = await app.inject({ method: 'GET', url: '/support/tickets', headers: c.headers });
    expect((tickets.json().items as Array<{ subject: string }>).some((t) => t.subject.includes('Warranty'))).toBe(true);
  });
});

describe('looking at a professional before booking them', () => {
  it('shows enough to choose on something other than price', async () => {
    const { c, p } = await completedJob('+919555100030', '+919555100031');
    const r = await app.inject({ method: 'GET', url: `/providers/${p.userId}`, headers: c.headers });
    expect(r.statusCode).toBe(200);

    const view = r.json().provider;
    expect(view.businessName).toContain('Services');
    expect(view.verificationStatus).toBe('VERIFIED');
    expect(view.bio).toContain('Twelve years');
    expect(view.categories.length).toBeGreaterThan(0);
    expect(view.ratingBreakdown).toHaveLength(5);
    expect(typeof view.memberSince).toBe('string');
  });

  it('never hands out a phone number, an address or a document', async () => {
    const { c, p } = await completedJob('+919555100032', '+919555100033');
    const r = await app.inject({ method: 'GET', url: `/providers/${p.userId}`, headers: c.headers });
    expect(r.body).not.toContain('919555100033');
    expect(r.body).not.toContain('Jor Bagh');
    expect(r.body).not.toContain('AADHAAR');
    // Distance, not a location: "about 3 km away" is what a customer needs.
    const distance = r.json().provider.approxDistanceKm;
    expect(distance === null || typeof distance === 'number').toBe(true);
  });
});

describe('a search box that searches', () => {
  it('finds a trade by the word somebody actually types', async () => {
    const c = await customerWithOpenJob('+919555100040');
    const r = await app.inject({ method: 'GET', url: '/search?q=geyser', headers: c.headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().hits.length).toBeGreaterThan(0);
    expect(r.json().hits[0].matchedOn).toBe('geyser');
  });

  it('works in Hindi', async () => {
    const c = await customerWithOpenJob('+919555100041');
    const r = await app.inject({ method: 'GET', url: `/search?q=${encodeURIComponent('नल')}`, headers: c.headers });
    expect(r.json().hits.length).toBeGreaterThan(0);
  });

  it('never shows a blank panel before anybody types', async () => {
    const c = await customerWithOpenJob('+919555100042');
    const r = await app.inject({ method: 'GET', url: '/search', headers: c.headers });
    expect(r.json().hits).toEqual([]);
    // A search that shows nothing before you type reads as broken.
    expect(r.json().suggestions.length).toBeGreaterThan(0);
    // What they booked before comes first.
    expect(r.json().suggestions[0].reason).toBe('RECENT');
  });
});

describe('reading the messages we flag', () => {
  it('queues a flagged message and lets support clear it', async () => {
    const { p } = await completedJob('+919555100050', '+919555100051', BID, async ({ c, jobId }) => {
      await app.inject({
        method: 'POST', url: `/jobs/${jobId}/chat`, headers: c.headers,
        payload: { body: 'Call me on 9876543210 instead' },
      });
    });

    const a = await admin();
    const queue = await app.inject({ method: 'GET', url: '/admin/flagged-messages', headers: a.headers });
    expect(queue.json().items.length).toBeGreaterThan(0);
    const flagged = queue.json().items[0];
    expect(flagged.flagReason).toBeTruthy();

    // Most flags are innocent - somebody sharing a number so a delivery is let through the gate.
    const cleared = await app.inject({
      method: 'POST', url: `/admin/flagged-messages/${flagged.id}/review`, headers: a.headers,
      payload: { outcome: 'ALLOWED' },
    });
    expect(cleared.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/admin/flagged-messages', headers: a.headers });
    expect((after.json().items as Array<{ id: string }>).map((i) => i.id)).not.toContain(flagged.id);
    void p;
  });

  it('needs a reason for anything with a consequence, and issues the strike', async () => {
    await completedJob('+919555100052', '+919555100053', BID, async ({ c, jobId }) => {
      await app.inject({
        method: 'POST', url: `/jobs/${jobId}/chat`, headers: c.headers,
        payload: { body: 'Pay me on UPI ramesh@okaxis, cheaper without the app' },
      });
    });
    const a = await admin();
    const queue = await app.inject({ method: 'GET', url: '/admin/flagged-messages', headers: a.headers });
    const flagged = queue.json().items[0];

    const bare = await app.inject({
      method: 'POST', url: `/admin/flagged-messages/${flagged.id}/review`, headers: a.headers,
      payload: { outcome: 'STRIKE' },
    });
    expect(bare.json().error.details.moderation).toEqual(['REASON_REQUIRED']);

    const done = await app.inject({
      method: 'POST', url: `/admin/flagged-messages/${flagged.id}/review`, headers: a.headers,
      payload: { outcome: 'STRIKE', reason: 'Soliciting payment outside the platform' },
    });
    expect(done.statusCode).toBe(200);
    expect((await app.ctx.store.finance.listStrikes(flagged.senderId)).length).toBeGreaterThan(0);
  });

  it('is not a queue a customer can read', async () => {
    const c = await customerWithOpenJob('+919555100054');
    const r = await app.inject({ method: 'GET', url: '/admin/flagged-messages', headers: c.headers });
    expect(r.statusCode).toBe(403);
  });
});

describe('answering "what do you hold about me"', () => {
  it('gives a person their own data, and says what it left out', async () => {
    const { c } = await completedJob('+919555100060', '+919555100061');
    const r = await app.inject({ method: 'GET', url: '/me/export', headers: c.headers });
    expect(r.statusCode).toBe(200);

    expect(r.json().sections).toContain('invoices');
    expect(r.json().data.profile.phone).toBe('+919555100060');
    expect(r.json().counts.jobs).toBeGreaterThan(0);
    // Nobody should have to guess whether something is missing by accident or by design.
    expect(r.json().exclusions.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.json().exclusions)).toContain('Identity documents');
  });

  it('never includes the other side of a conversation', async () => {
    const { c } = await completedJob('+919555100062', '+919555100063', BID, async (live) => {
      await app.inject({ method: 'POST', url: `/jobs/${live.jobId}/chat`, headers: live.c.headers, payload: { body: 'Mine: please come after six' } });
      await app.inject({ method: 'POST', url: `/jobs/${live.jobId}/chat`, headers: live.p.headers, payload: { body: 'Theirs: on my way now' } });
    });

    const r = await app.inject({ method: 'GET', url: '/me/export', headers: c.headers });
    const bodies = (r.json().data.messages as Array<{ body: string }>).map((m) => m.body);
    expect(bodies).toContain('Mine: please come after six');
    // A conversation belongs to both sides, and the other person did not ask for this.
    expect(bodies).not.toContain('Theirs: on my way now');
  });
});

describe('getting back in after a lost phone', () => {
  it('issues codes once, and never shows them again', async () => {
    const a = await admin();
    const issued = await app.inject({ method: 'POST', url: '/admin/mfa/recovery-codes', headers: a.headers });
    expect(issued.statusCode).toBe(201);
    const codes = issued.json().codes as string[];
    expect(codes).toHaveLength(10);
    // Readable aloud by somebody already having a bad day: no 0/O, no 1/I.
    expect(codes.every((c) => !/[01OI]/.test(c))).toBe(true);
    expect(issued.json().warning).toContain('cannot show them again');

    const listed = await app.inject({ method: 'GET', url: '/admin/mfa/recovery-codes', headers: a.headers });
    expect(listed.json().remaining).toBe(10);
    // The count, never the codes.
    expect(listed.body).not.toContain(codes[0]!.replace(/-/g, '').slice(0, 4));
  });

  it('spends a code once and only once', async () => {
    const a = await admin();
    const issued = await app.inject({ method: 'POST', url: '/admin/mfa/recovery-codes', headers: a.headers });
    const code = (issued.json().codes as string[])[0]!;

    const first = await app.inject({ method: 'POST', url: '/admin/mfa/recover', headers: a.headers, payload: { code } });
    expect(first.statusCode).toBe(200);
    expect(first.json().remaining).toBe(9);

    const again = await app.inject({ method: 'POST', url: '/admin/mfa/recover', headers: a.headers, payload: { code } });
    expect(again.json().error.details.recovery).toEqual(['BAD_CODE']);
  });

  it('refuses a code that was never issued', async () => {
    const a = await admin();
    await app.inject({ method: 'POST', url: '/admin/mfa/recovery-codes', headers: a.headers });
    const r = await app.inject({ method: 'POST', url: '/admin/mfa/recover', headers: a.headers, payload: { code: 'ZZZZ-ZZZZ' } });
    expect(r.json().error.details.recovery).toEqual(['BAD_CODE']);
  });
});
