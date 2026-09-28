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

console.log('\n--- health ---');
const ready = await call('GET', '/ready');
ok('server ready', ready.json?.ok === true);
ok('runs on postgres', ready.json?.dataMode === 'postgres', ready.json?.dataMode);
ok('mocked adapters declared honestly', Array.isArray(ready.json?.mockedAdapters) && ready.json.mockedAdapters.length > 0);

console.log(`\n${failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`}`);
await db.end();
process.exit(failures === 0 ? 0 : 1);
