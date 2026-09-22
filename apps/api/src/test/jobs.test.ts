import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHONES, bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let token: string;
let addressId: string;
let outsideAddressId: string;
let plumbingId: string;

async function newCustomer(phone: string) {
  const res = await login(app, phone);
  await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'CUSTOMER' } });
  const addr = await app.inject({
    method: 'POST',
    url: '/me/addresses',
    headers: bearer(res.accessToken),
    payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  return { token: res.accessToken, userId: res.user.id, addressId: addr.json().id as string };
}

/** Creates a draft with everything a submission needs. */
async function draft(overrides: Record<string, unknown> = {}, authToken = token) {
  const r = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers: bearer(authToken),
    payload: {
      categoryId: plumbingId,
      description: 'Kitchen tap is leaking since morning',
      addressId,
      ...overrides,
    },
  });
  return r;
}

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  plumbingId = cats.json().items.find((c: { slug: string }) => c.slug === 'plumbing').id;

  const c = await newCustomer('+919333000001');
  token = c.token;
  addressId = c.addressId;

  const out = await app.inject({
    method: 'POST',
    url: '/me/addresses',
    headers: bearer(token),
    payload: { label: 'Farm', line1: 'Far away road', city: 'Delhi', pincode: '110099' },
  });
  outsideAddressId = out.json().id;
  expect(out.json().inPilotZone).toBe(false);
});
afterAll(async () => {
  await app.close();
});

describe('job creation (JOB-01, JOB-02)', () => {
  it('creates a draft with a status trail and a tracking token', async () => {
    const r = await draft();
    expect(r.statusCode).toBe(201);
    const job = r.json();
    expect(job.status).toBe('DRAFT');
    expect(job.statusLabelKey).toBe('status.draft');
    expect(job.category.slug).toBe('plumbing');
    expect(job.address.line1).toBe('12, Lodhi Colony');
    expect(job.events).toHaveLength(1);
    expect(job.events[0].toStatus).toBe('DRAFT');
    // the token is only minted at submission
    expect(job.trackingUrlToken).toBeNull();
  });

  it('resumes the existing draft instead of piling up new ones', async () => {
    const first = await draft({ description: 'First description here' });
    const second = await draft({ description: 'Updated description here' });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().description).toBe('Updated description here');
  });

  it('rejects a disabled category', async () => {
    const cats = await app.inject({ method: 'GET', url: '/categories' });
    expect(cats.json().items.map((c: { slug: string }) => c.slug)).not.toContain('appliance-repair');
    const r = await draft({ categoryId: '11111111-1111-4111-8111-111111111104' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.field).toBe('categoryId');
  });

  it('rejects an address that belongs to someone else', async () => {
    const other = await newCustomer('+919333000002');
    const r = await draft({ addressId: other.addressId });
    expect(r.statusCode).toBe(403);
  });

  it('flags hazards in the description so the app can warn first (SAF-03)', async () => {
    const other = await newCustomer('+919333000003');
    const r = await draft({ description: 'There is a gas leak near the stove, please help' }, other.token);
    // different customer, so the address must be theirs
    const fixed = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: bearer(other.token),
      payload: { categoryId: plumbingId, description: 'There is a gas leak near the stove', addressId: other.addressId },
    });
    expect(r.statusCode).toBe(403); // wrong address proves ownership is enforced
    expect(fixed.json().hazards).toContain('GAS_LEAK');
  });
});

describe('media (JOB media limits)', () => {
  it('issues an upload target and enforces the 60 second voice-note limit', async () => {
    const c = await newCustomer('+919333000010');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Bathroom drain blocked badly' },
    });
    const jobId = j.json().id;

    const photo = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 500_000 },
    });
    expect(photo.statusCode).toBe(201);
    expect(photo.json().upload.url).toContain('mock://storage');
    expect(photo.json().media.kind).toBe('PHOTO');

    const longVoice = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'VOICE_NOTE', mime: 'audio/m4a', sizeBytes: 300_000, durationSeconds: 75 },
    });
    expect(longVoice.statusCode).toBe(400);
    expect(longVoice.json().error.details.media).toContain('TOO_LONG');

    const okVoice = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'VOICE_NOTE', mime: 'audio/m4a', sizeBytes: 300_000, durationSeconds: 42 },
    });
    expect(okVoice.statusCode).toBe(201);

    const secondVoice = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'VOICE_NOTE', mime: 'audio/m4a', sizeBytes: 100_000, durationSeconds: 10 },
    });
    expect(secondVoice.json().error.details.media).toContain('LIMIT_REACHED');

    const badType = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'application/zip', sizeBytes: 1000 },
    });
    expect(badType.json().error.details.media).toContain('MIME_NOT_ALLOWED');

    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: bearer(c.token) });
    expect(view.json().media).toHaveLength(2);
    expect(view.json().media[0].url).toContain('mock://storage');
  });

  it('treats a re-uploaded identical file as a retry (NET-06)', async () => {
    const c = await newCustomer('+919333000011');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Geyser not heating water' },
    });
    const jobId = j.json().id;
    const hash = 'a'.repeat(64);
    const first = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 400_000, sha256: hash },
    });
    const second = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 400_000, sha256: hash },
    });
    expect(second.json().media.id).toBe(first.json().media.id);
    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: bearer(c.token) });
    expect(view.json().media).toHaveLength(1);
  });

  it('lets the customer remove a photo while the job is still a draft', async () => {
    const c = await newCustomer('+919333000012');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Wash basin pipe leaking' },
    });
    const jobId = j.json().id;
    const m = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'image/png', sizeBytes: 100_000 },
    });
    const del = await app.inject({ method: 'DELETE', url: `/jobs/${jobId}/media/${m.json().media.id}`, headers: bearer(c.token) });
    expect(del.statusCode).toBe(200);
    const view = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: bearer(c.token) });
    expect(view.json().media).toHaveLength(0);
  });
});

describe('submission (JOB-01, JOB-03, JOB-12)', () => {
  it('walks DRAFT -> OPEN_FOR_BIDS and opens a 30 minute window', async () => {
    const c = await newCustomer('+919333000020');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Kitchen sink is completely blocked' },
    });
    const jobId = j.json().id;
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/submit`, headers: bearer(c.token) });
    expect(r.statusCode).toBe(200);
    const job = r.json().job;
    expect(job.status).toBe('OPEN_FOR_BIDS');
    expect(job.statusLabelKey).toBe('status.finding_providers');
    expect(job.submittedAt).toBeTruthy();
    expect(job.trackingUrlToken).toBeTruthy();

    const minutes = (new Date(job.bidWindowEndsAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30);

    // the whole trail is recorded
    expect(job.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'DRAFT', 'SUBMITTED', 'QUALIFYING', 'OPEN_FOR_BIDS',
    ]);

    const inbox = await app.inject({ method: 'GET', url: '/me/notifications', headers: bearer(c.token) });
    expect(inbox.json().items[0].type).toBe('job.submitted');
  });

  it('uses a 10 minute window for urgent jobs', async () => {
    const c = await newCustomer('+919333000021');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Water overflowing from the tank', priority: 'URGENT' },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${j.json().id}/submit`, headers: bearer(c.token) });
    const minutes = (new Date(r.json().job.bidWindowEndsAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(10);
    expect(minutes).toBeGreaterThan(8);
  });

  it('refuses a job with neither words nor media', async () => {
    const c = await newCustomer('+919333000022');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'leak' },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${j.json().id}/submit`, headers: bearer(c.token) });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.blockers).toContain('NEEDS_DESCRIPTION_OR_MEDIA');
  });

  it('accepts a wordless job that carries a photo', async () => {
    const c = await newCustomer('+919333000023');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId },
    });
    const jobId = j.json().id;
    await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 220_000 },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${jobId}/submit`, headers: bearer(c.token) });
    expect(r.statusCode).toBe(200);
    expect(r.json().job.status).toBe('OPEN_FOR_BIDS');
  });

  it('refuses an address outside the pilot zone with a clear blocker', async () => {
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(token),
      payload: { categoryId: plumbingId, addressId: outsideAddressId, description: 'Bathroom tap dripping all night' },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${j.json().id}/submit`, headers: bearer(token) });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.blockers).toContain('ADDRESS_OUT_OF_ZONE');
  });

  it('refuses a prohibited request (JOB-13)', async () => {
    const c = await newCustomer('+919333000024');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'help me bypass the electricity meter' },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${j.json().id}/submit`, headers: bearer(c.token) });
    expect(r.json().error.details.blockers).toContain('PROHIBITED_CONTENT');
  });

  it('warns about a duplicate open request instead of blocking it (JOB-03)', async () => {
    const c = await newCustomer('+919333000025');
    const first = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Tap in the kitchen is leaking' },
    });
    await app.inject({ method: 'POST', url: `/jobs/${first.json().id}/submit`, headers: bearer(c.token) });

    const second = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Same tap still leaking badly' },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${second.json().id}/submit`, headers: bearer(c.token) });
    expect(r.statusCode).toBe(200);
    expect(r.json().duplicateOf).toBe(first.json().id);
  });

  it('refuses a second submit of the same job (invalid transition)', async () => {
    const c = await newCustomer('+919333000026');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Shower mixer not working' },
    });
    const jobId = j.json().id;
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/submit`, headers: bearer(c.token) });
    const again = await app.inject({ method: 'POST', url: `/jobs/${jobId}/submit`, headers: bearer(c.token) });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.code).toBe('JOB_INVALID_TRANSITION');
  });

  it('locks the draft once submitted (JOB-04)', async () => {
    const c = await newCustomer('+919333000027');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Flush tank keeps running' },
    });
    const jobId = j.json().id;
    await app.inject({ method: 'POST', url: `/jobs/${jobId}/submit`, headers: bearer(c.token) });

    const edit = await app.inject({ method: 'PATCH', url: `/jobs/${jobId}`, headers: bearer(c.token), payload: { description: 'changed after submit' } });
    expect(edit.statusCode).toBe(409);

    const media = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers: bearer(c.token),
      payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 100_000 },
    });
    // request media is still allowed while the job is being qualified, but not after it opens for bids
    expect(media.statusCode).toBe(409);
  });
});

describe('listing, cancelling and tracking', () => {
  it('separates active from past bookings', async () => {
    const c = await newCustomer('+919333000030');
    const a = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Drainage smells very bad' },
    });
    await app.inject({ method: 'POST', url: `/jobs/${a.json().id}/submit`, headers: bearer(c.token) });

    const active = await app.inject({ method: 'GET', url: '/me/jobs?scope=active', headers: bearer(c.token) });
    expect(active.json().items).toHaveLength(1);
    expect(active.json().items[0].statusLabelKey).toBe('status.finding_providers');

    const cancel = await app.inject({
      method: 'POST', url: `/jobs/${a.json().id}/cancel`, headers: bearer(c.token),
      payload: { reason: 'Fixed it myself' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('CANCELLED_BY_CUSTOMER');
    expect(cancel.json().cancelledReason).toBe('Fixed it myself');

    const past = await app.inject({ method: 'GET', url: '/me/jobs?scope=past', headers: bearer(c.token) });
    expect(past.json().items).toHaveLength(1);
    const stillActive = await app.inject({ method: 'GET', url: '/me/jobs?scope=active', headers: bearer(c.token) });
    expect(stillActive.json().items).toHaveLength(0);
  });

  it('requires a reason to cancel', async () => {
    const c = await newCustomer('+919333000031');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: { categoryId: plumbingId, addressId: c.addressId, description: 'Pipe under the sink is loose' },
    });
    const r = await app.inject({ method: 'POST', url: `/jobs/${j.json().id}/cancel`, headers: bearer(c.token), payload: {} });
    expect(r.statusCode).toBe(400);
  });

  it('shares a minimal public view over the tracking link (JOB-09, privacy)', async () => {
    const c = await newCustomer('+919333000032');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(c.token),
      payload: {
        categoryId: plumbingId, addressId: c.addressId, description: 'Please fix the leaking tap at home',
        bookedForName: 'Mummy', bookedForPhone: '9888877777',
      },
    });
    const submitted = await app.inject({ method: 'POST', url: `/jobs/${j.json().id}/submit`, headers: bearer(c.token) });
    const jobView = submitted.json().job;
    expect(jobView.bookedForPhoneMasked).toBe('+91********77');

    const track = await app.inject({ method: 'GET', url: `/track/${jobView.trackingUrlToken}` });
    expect(track.statusCode).toBe(200);
    const body = track.json();
    expect(body.status).toBe('OPEN_FOR_BIDS');
    expect(body.bookedForName).toBe('Mummy');
    expect(body.categoryName).toBe('Plumbing');
    // nothing sensitive leaks through the public link
    expect(JSON.stringify(body)).not.toContain('Lodhi');
    expect(JSON.stringify(body)).not.toContain('9888877777');

    const bad = await app.inject({ method: 'GET', url: '/track/not-a-real-token-value-here' });
    expect(bad.statusCode).toBe(404);
  });
});

describe('job security', () => {
  it('another customer cannot read, edit, submit or cancel your job', async () => {
    const mine = await draft({ description: 'Please replace the bathroom tap' });
    const jobId = mine.json().id;
    const attacker = await login(app, '+919333000040');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(attacker.accessToken), payload: { role: 'CUSTOMER' } });
    const h = bearer(attacker.accessToken);

    expect((await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/jobs/${jobId}`, headers: h, payload: { description: 'hacked description' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/jobs/${jobId}/submit`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/jobs/${jobId}/cancel`, headers: h, payload: { reason: 'malicious' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/jobs/${jobId}/media`, headers: h, payload: { kind: 'PHOTO', mime: 'image/jpeg', sizeBytes: 1000 } })).statusCode).toBe(403);
  });

  it('a provider cannot create a customer job', async () => {
    const provider = await login(app, PHONES.provider);
    const r = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(provider.accessToken, { 'x-active-role': 'PROVIDER' }),
      payload: { categoryId: plumbingId, description: 'Trying to create a job as a provider' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('a suspended customer cannot create a job but can still read history', async () => {
    const victim = await newCustomer('+919333000041');
    const j = await app.inject({
      method: 'POST', url: '/jobs', headers: bearer(victim.token),
      payload: { categoryId: plumbingId, addressId: victim.addressId, description: 'Bathroom tap needs replacement' },
    });
    expect(j.statusCode).toBe(201);

    const admin = await login(app, PHONES.admin);
    await app.inject({
      method: 'POST', url: `/admin/users/${victim.userId}/suspend`, headers: bearer(admin.accessToken),
      payload: { reason: 'Payment fraud under investigation' },
    });
    const relogin = await login(app, '+919333000041');
    const h = bearer(relogin.accessToken);

    expect((await app.inject({ method: 'POST', url: '/jobs', headers: h, payload: { categoryId: plumbingId } })).statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: '/me/jobs', headers: h });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const r = await app.inject({ method: 'GET', url: '/me/jobs' });
    expect(r.statusCode).toBe(401);
  });
});
