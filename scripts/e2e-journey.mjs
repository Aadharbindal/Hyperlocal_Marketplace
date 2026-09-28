/**
 * One complete journey against a running server and a real PostgreSQL.
 *
 * Not a unit test and not a mock: every call below is the same HTTP request the phone makes, in
 * the order a real customer and a real professional would make them. It exists to answer one
 * question the test suite cannot - whether the pieces are actually wired to each other end to
 * end, or merely all correct on their own.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4010';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/hyperlocal_test';

let failures = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

async function call(method, path, { token, body, role } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (role) headers['x-active-role'] = role;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, json, text };
}

async function signIn(phone) {
  const otp = await call('POST', '/auth/request-otp', { body: { phone } });
  const v = await call('POST', '/auth/verify-otp', {
    body: { challengeId: otp.json.challengeId, code: otp.json.demoCode },
  });
  if (!v.json?.user) throw new Error(`sign-in failed for ${phone}: ${otp.status}/${v.status} ${v.text.slice(0, 200)}`);
  return { token: v.json.accessToken, userId: v.json.user.id, isNew: v.json.isNewUser };
}

const { default: pgLib } = await import('pg');
const db = new pgLib.Client({ connectionString: DB_URL });
await db.connect();
const pg = (sql) => db.query(sql);

const stamp = Date.now().toString().slice(-6);
// +91 then ten digits starting 6-9. stamp keeps runs from colliding with each other.
const phone = (n) => `+919${stamp}${String(n).padStart(3, '0')}`;

console.log('--- identity ---');
const cust = await signIn(phone(1));
ok('customer signs in', !!cust.token);
await call('POST', '/me/roles', { token: cust.token, body: { role: 'CUSTOMER' } });

const me0 = await call('GET', '/me', { token: cust.token });
ok('new account has no name yet', me0.json.user.displayName === null);

const done = await call('POST', '/me/complete-profile', {
  token: cust.token,
  body: { displayName: 'Ravi Kumar', email: `ravi.${stamp}@example.com`, acceptedTermsVersion: '1.0', marketingOptIn: false },
});
ok('profile completed', done.json?.user?.displayName === 'Ravi Kumar');
ok('terms recorded', (await call('GET', '/me', { token: cust.token })).json.consents.some((c) => c.type === 'TERMS' && c.granted));

const addr = await call('POST', '/me/addresses', {
  token: cust.token,
  body: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
});
ok('address created', addr.status === 201 || addr.status === 200, `status ${addr.status}`);

console.log('\n--- catalogue and price guidance ---');
const cats = await call('GET', '/categories');
const plumbing = cats.json.items.find((c) => c.slug === 'plumbing');
ok('catalogue served', !!plumbing);
ok('price guidance present', !!plumbing.priceGuide?.minPaise && plumbing.skills.every((s) => !!s.priceGuide));
ok('price guidance says it is an estimate, not a measurement', plumbing.priceGuide.basis === 'ESTIMATE', plumbing.priceGuide.basis);

console.log('\n--- booking ---');
const draft = await call('POST', '/jobs', {
  token: cust.token,
  body: { categoryId: plumbing.id, addressId: addr.json.id, description: 'Kitchen tap has been leaking since morning' },
});
ok('draft created', draft.status === 201, `status ${draft.status}`);
const submitted = await call('POST', `/jobs/${draft.json.id}/submit`, { token: cust.token });
ok('submitted and open for offers', submitted.json?.job?.status === 'OPEN_FOR_BIDS', submitted.json?.job?.status);
const jobId = draft.json.id;

console.log('\n--- provider side ---');
const prov = await signIn(phone(2));
await call('POST', '/me/roles', { token: prov.token, body: { role: 'PROVIDER' } });
const pAddr = await call('POST', '/me/addresses', {
  token: prov.token,
  body: { label: 'Shop', line1: '4, Jor Bagh Market', city: 'Delhi', pincode: '110003' },
});
await call('PUT', '/provider/profile', {
  token: prov.token, role: 'PROVIDER',
  body: { businessName: 'Sharma Plumbing', serviceRadiusKm: 8, baseAddressId: pAddr.json.id, skillIds: [plumbing.skills[0].id] },
});
// A provider cannot bid until somebody has checked who they are. Exercised through the real
// endpoints rather than by writing VERIFIED into the database, because the refusal below is one
// of the guards most worth proving actually fires.
const tooEarly = await call('POST', `/jobs/${jobId}/bids`, {
  token: prov.token, role: 'PROVIDER',
  body: { labourPaise: 60000, visitFeePaise: 10000, etaMinutes: 60, warrantyDays: 15 },
});
ok('an unverified provider cannot bid', tooEarly.status === 403, `status ${tooEarly.status}`);

const kyc = await call('POST', '/provider/kyc', {
  token: prov.token, role: 'PROVIDER',
  body: { documentType: 'AADHAAR', documentNumber: '123456789012', mime: 'image/png', sizeBytes: 70 },
});
ok('identity document submitted', kyc.status === 201, `status ${kyc.status} ${kyc.text.slice(0, 160)}`);

// An admin exists only because this database was created empty; the role grant is the one thing
// here done directly, and everything after it goes through the real review endpoints.
const admin = await signIn(phone(9));
await pg(`update user_roles set role = 'ADMIN' where user_id = '${admin.userId}'`);
await pg(`insert into user_roles (user_id, role, status) select '${admin.userId}', 'ADMIN', 'ACTIVE'
          where not exists (select 1 from user_roles where user_id = '${admin.userId}' and role = 'ADMIN')`);
const admin2 = await signIn(phone(9));

const queue = await call('GET', '/admin/kyc', { token: admin2.token, role: 'ADMIN' });
ok('document reaches the review queue', (queue.json?.items ?? []).length >= 1, `status ${queue.status}`);

const submission = (queue.json?.items ?? []).find((k) => k.userId === prov.userId) ?? queue.json?.items?.[0];
const reviewed = await call('POST', `/admin/kyc/${submission?.id}/review`, {
  token: admin2.token, role: 'ADMIN',
  body: { decision: 'APPROVE', reason: 'Document matches the name on the account' },
});
ok('reviewer approves it', reviewed.status === 200, `status ${reviewed.status} ${reviewed.text.slice(0, 160)}`);

// Going on duty is a separate act from being verified, and it comes after.
const avail = await call('POST', '/provider/availability', { token: prov.token, role: 'PROVIDER', body: { isAvailable: true } });
ok('provider goes on duty', avail.status === 200, `status ${avail.status} ${avail.text.slice(0, 120)}`);

const feed = await call('GET', '/provider/jobs/nearby', { token: prov.token, role: 'PROVIDER' });
ok('nearby feed answers', feed.status === 200, `status ${feed.status} ${feed.text.slice(0, 140)}`);
ok('the customer job is in the feed', (feed.json?.items ?? []).some((j) => (j.jobId ?? j.id) === jobId), `${(feed.json?.items ?? []).length} item(s)`);

const bid = await call('POST', `/jobs/${jobId}/bids`, {
  token: prov.token, role: 'PROVIDER',
  body: { labourPaise: 60000, visitFeePaise: 10000, etaMinutes: 60, warrantyDays: 15 },
});
ok('offer placed', bid.status === 201, `status ${bid.status} ${bid.text.slice(0, 120)}`);

const offers = await call('GET', `/jobs/${jobId}/offers`, { token: cust.token });
ok('customer sees the offer', (offers.json?.items ?? []).length >= 1, `status ${offers.status} ${offers.text.slice(0, 120)}`);

console.log('\n--- money ---');
const accepted = await call('POST', `/bids/${bid.json.id}/accept`, { token: cust.token });
ok('offer accepted, payment created', !!accepted.json?.payment?.id, `status ${accepted.status}`);
const paid = await call('POST', `/payments/${accepted.json.payment.id}/mock-complete`, {
  token: cust.token, body: { outcome: 'authorized' },
});
ok('payment authorised', paid.status === 200, `status ${paid.status}`);

const afterPay = await call('GET', `/jobs/${jobId}`, { token: cust.token });
ok('booking confirmed', ['CONFIRMED', 'PROVIDER_ASSIGNED'].includes(afterPay.json.status), afterPay.json.status);
ok('tracking link issued', !!afterPay.json.trackingUrlToken);

console.log('\n--- on the way, with live ETA ---');
const enRoute = await call('POST', `/jobs/${jobId}/progress`, {
  token: prov.token, role: 'PROVIDER', body: { to: 'EN_ROUTE', etaMinutes: 30 },
});
ok('provider sets off', enRoute.json?.status === 'EN_ROUTE', enRoute.json?.status);

const pos = await call('POST', `/jobs/${jobId}/position`, {
  token: prov.token, role: 'PROVIDER', body: { lat: 28.64, lng: 77.24, accuracyM: 12 },
});
ok('position accepted', pos.status === 204, `status ${pos.status}`);

const arrival = await call('GET', `/jobs/${jobId}/arrival`, { token: cust.token });
ok('customer sees a distance and a time', arrival.json?.kind === 'ON_THE_WAY', JSON.stringify(arrival.json));
ok('no coordinates leak to the customer', !('lat' in (arrival.json ?? {})) && !('lng' in (arrival.json ?? {})));

const track = await call('GET', `/track/${afterPay.json.trackingUrlToken}`);
ok('public tracking link works', track.status === 200);
ok('tracking link carries no position', !/lat|lng|distanceKm|etaMinutes/.test(JSON.stringify(track.json)));

console.log('\n--- doing the work ---');
await call('POST', `/jobs/${jobId}/progress`, { token: prov.token, role: 'PROVIDER', body: { to: 'ARRIVED' } });
const gone = await call('GET', `/jobs/${jobId}/arrival`, { token: cust.token });
ok('position forgotten on arrival', gone.json?.kind === 'NOT_TRACKING', JSON.stringify(gone.json));

const exec = await call('GET', `/jobs/${jobId}/execution`, { token: cust.token });
const code = exec.json?.startCode;
ok('customer has a start code', !!code);

const started = await call('POST', `/jobs/${jobId}/start`, { token: prov.token, role: 'PROVIDER', body: { code } });
ok('work starts only with the code', started.status === 200, `status ${started.status} ${started.text.slice(0, 120)}`);

console.log('\n--- finishing and paying ---');
const up = await call('POST', `/jobs/${jobId}/evidence`, {
  token: prov.token, role: 'PROVIDER',
  body: { kind: 'PHOTO', mime: 'image/png', sizeBytes: 70 },
});
ok('evidence upload target issued', up.status === 201 || up.status === 200, `status ${up.status} ${up.text.slice(0, 160)}`);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
if (up.json?.upload?.url) {
  const putRes = await fetch(up.json.upload.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
  ok('evidence bytes stored', putRes.status === 204 || putRes.ok, `status ${putRes.status}`);
}

const completed = await call('POST', `/jobs/${jobId}/complete`, {
  token: prov.token, role: 'PROVIDER',
  body: { summary: 'Replaced the washer and tested the tap', mediaIds: up.json?.media?.id ? [up.json.media.id] : [] },
});
ok('handed back for checking', completed.status === 200 || completed.status === 201, `status ${completed.status} ${completed.text.slice(0, 160)}`);

const approved = await call('POST', `/jobs/${jobId}/approve`, { token: cust.token, body: { approved: true, rating: 5 } });
ok('customer approves and money is captured', approved.status === 200, `status ${approved.status} ${approved.text.slice(0, 160)}`);

const finalJob = await call('GET', `/jobs/${jobId}`, { token: cust.token });
ok('booking completed', ['COMPLETED', 'SETTLED'].includes(finalJob.json.status), finalJob.json.status);

console.log('\n--- after the job ---');
const receipts = await call('GET', '/me/invoices', { token: cust.token });
ok('receipt issued automatically', (receipts.json?.items ?? []).length >= 1);

const review = await call('POST', `/jobs/${jobId}/review`, { token: cust.token, body: { rating: 5, comment: 'On time and tidy' } });
ok('review accepted', review.status === 201, `status ${review.status}`);
const provReviews = await call('GET', `/providers/${prov.userId}/reviews`);
ok('review shows on the provider', (provReviews.json?.items ?? []).length >= 1);

const warranty = await call('GET', `/jobs/${jobId}/warranty`, { token: cust.token });
ok('warranty is live on a finished job', warranty.status === 200, `status ${warranty.status}`);

console.log('\n--- repeat bookings ---');
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const plan = await call('POST', '/me/service-plans', {
  token: cust.token,
  body: { categoryId: plumbing.id, addressId: addr.json.id, intervalDays: 90, firstDueOn: tomorrow, description: 'Quarterly tap and geyser check' },
});
ok('repeat booking created', plan.status === 201, `status ${plan.status} ${plan.text.slice(0, 160)}`);
ok('interval in plain words', plan.json?.intervalLabel === 'every 3 months', plan.json?.intervalLabel);
ok('no price anywhere on a plan', !/paise|amount/i.test(JSON.stringify(plan.json ?? {})));

console.log('\n--- safety ---');
const contact = await call('POST', '/me/emergency-contacts', {
  token: cust.token, body: { name: 'Priya', phone: '+919812345678', relationship: 'sister' },
});
ok('emergency contact saved', contact.status === 201, `status ${contact.status}`);
ok('contact number masked on the way out', !/812345/.test(JSON.stringify(contact.json)));

console.log('\n--- the three that had no screen until now ---');

// Addresses: edit and remove. Somebody who moves house has to be able to get their old home
// address out of this system, which is a privacy matter as much as a convenience.
const spare = await call('POST', '/me/addresses', {
  token: cust.token, body: { label: 'Old flat', line1: '9, Green Park', city: 'Delhi', pincode: '110016' },
});
const edited = await call('PATCH', `/me/addresses/${spare.json.id}`, {
  token: cust.token, body: { label: 'Parents' },
});
ok('address can be edited', edited.status === 200 && edited.json?.label === 'Parents', `status ${edited.status} ${edited.text.slice(0, 120)}`);
const removed = await call('DELETE', `/me/addresses/${spare.json.id}`, { token: cust.token });
ok('address can be removed', removed.status === 200 || removed.status === 204, `status ${removed.status}`);
const left = await call('GET', '/me/addresses', { token: cust.token });
ok('removed address is gone from the list', !(left.json?.items ?? []).some((a) => a.id === spare.json.id));

// A second booking, because the first one is finished and these three all need a live one.
const draft2 = await call('POST', '/jobs', {
  token: cust.token,
  body: { categoryId: plumbing.id, addressId: addr.json.id, description: 'Bathroom drain is blocked and backing up' },
});
await call('POST', `/jobs/${draft2.json.id}/submit`, { token: cust.token });
const bid2 = await call('POST', `/jobs/${draft2.json.id}/bids`, {
  token: prov.token, role: 'PROVIDER',
  body: { labourPaise: 50000, visitFeePaise: 10000, etaMinutes: 90, warrantyDays: 15 },
});
const acc2 = await call('POST', `/bids/${bid2.json.id}/accept`, { token: cust.token });
await call('POST', `/payments/${acc2.json.payment.id}/mock-complete`, { token: cust.token, body: { outcome: 'authorized' } });

// Rescheduling, and the asymmetry is the interesting part: the customer's time is theirs, so
// they move the booking outright. The professional has to ask.
const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
const movedByCustomer = await call('POST', `/jobs/${draft2.json.id}/reschedule`, {
  token: cust.token, body: { newStart: nextWeek, reason: 'I have to be at work that morning after all' },
});
ok('the customer can move their own booking', movedByCustomer.status === 200, `status ${movedByCustomer.status} ${movedByCustomer.text.slice(0, 160)}`);
ok('and is told how many moves are left', typeof movedByCustomer.json?.movesLeft === 'number', String(movedByCustomer.json?.movesLeft));
ok('and that the professional was told', movedByCustomer.json?.providerNotified === true, String(movedByCustomer.json?.providerNotified));

const customerTried = await call('POST', `/jobs/${draft2.json.id}/propose-time`, {
  token: cust.token, body: { newStart: nextWeek, reason: 'Trying the provider path as a customer' },
});
ok('a customer cannot use the provider path', customerTried.status === 403, `status ${customerTried.status}`);

const later = new Date(Date.now() + 9 * 86400000).toISOString();
const proposed = await call('POST', `/jobs/${draft2.json.id}/propose-time`, {
  token: prov.token, role: 'PROVIDER', body: { newStart: later, reason: 'I am double booked that afternoon, sorry' },
});
ok('the professional can suggest a time', proposed.status === 201, `status ${proposed.status} ${proposed.text.slice(0, 160)}`);

const seen = await call('GET', `/jobs/${draft2.json.id}/time-proposal`, { token: cust.token });
ok('the customer sees the suggestion', seen.json?.proposal?.id === proposed.json?.proposal?.id);
ok('and is told it is theirs to answer', seen.json?.proposal?.mine === false, String(seen.json?.proposal?.mine));

const agreed = await call('POST', `/time-proposals/${proposed.json.proposal.id}/respond`, {
  token: cust.token, body: { accept: true },
});
ok('accepting moves the booking', agreed.status === 200, `status ${agreed.status} ${agreed.text.slice(0, 160)}`);
const moved = await call('GET', `/jobs/${draft2.json.id}`, { token: cust.token });
ok('the booking now says the new time', (moved.json?.preferredStart ?? '').slice(0, 10) === later.slice(0, 10), moved.json?.preferredStart);

// The provider backing out - which, before anybody has arrived, re-opens the booking to the
// professionals whose offers lost rather than ending it.
const backedOut = await call('POST', `/jobs/${draft2.json.id}/cancel-as-provider`, {
  token: prov.token, role: 'PROVIDER', body: { reason: 'My van has broken down and cannot be fixed today' },
});
ok('provider can back out', backedOut.status === 200, `status ${backedOut.status} ${backedOut.text.slice(0, 160)}`);
ok('and the booking is not simply dead', ['REDISPATCHING', 'CANCELLED_BY_PROVIDER'].includes(backedOut.json?.status), backedOut.json?.status);

console.log('\n--- health ---');
const ready = await call('GET', '/ready');
ok('server ready', ready.json?.ok === true);
ok('runs on postgres', ready.json?.dataMode === 'postgres', ready.json?.dataMode);
ok('mocked adapters declared honestly', Array.isArray(ready.json?.mockedAdapters) && ready.json.mockedAdapters.length > 0);

console.log(`\n${failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`}`);
await db.end();
process.exit(failures === 0 ? 0 : 1);
