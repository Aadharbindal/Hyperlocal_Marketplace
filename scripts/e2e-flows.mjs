/**
 * The five journeys `e2e-journey.mjs` does not walk.
 *
 * The main journey follows one customer and one professional from booking to settlement, which is
 * the spine. These five hang off it and had never been driven end to end over HTTP at all - they
 * were built from the contracts, covered by unit and route tests, and never *walked*:
 *
 *   1. a contractor hiring a technician and sending them to a job
 *   2. a warranty claim, answered and then booked as a return visit
 *   3. a standing arrangement that comes due and opens its own booking
 *   4. a professional who stops answering, and the booking being offered to somebody else
 *   5. materials: the provider asks, vendors quote, one is chosen, it is delivered and invoiced
 *
 * Route tests prove each endpoint in isolation with a hand-made record in front of it. That is not
 * the same as proving the endpoints reach each other - the whole reason the main journey exists.
 * The materials one matters most: it ends at the only path by which a vendor is ever paid.
 *
 *   node scripts/e2e-flows.mjs           # against a running API on 4000
 *   npm run test:flows                   # starts postgres and an API for you
 *
 * Exits non-zero on the first broken link, so CI can hold the line.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4000';

let failures = 0;
let checks = 0;
const ok = (label, cond, extra = '') => {
  checks += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};
const section = (s) => console.log(`\n--- ${s} ---`);

async function call(method, path, { token, body, role } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (role) headers['x-active-role'] = role;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text };
}

/**
 * A phone nobody has used before, this run or any other.
 *
 * The stamp is what makes a second run possible: fixed numbers meant the OTP rate limiter -
 * five requests an hour, per number, which is correct - refused the whole script the moment it
 * was run twice. A test you can only run once an hour is a test nobody runs.
 */
const stamp = Date.now().toString().slice(-6);
let nextPhone = 0;
const phone = () => `+919${stamp}${String(nextPhone++).padStart(3, '0')}`;

/** Sign in and take the role the app's own role screen would have granted. */
async function signUpAs(p, role) {
  const actor = await signIn(p);
  await grant(actor, role);
  return actor;
}

async function signIn(p) {
  const otp = await call('POST', '/auth/request-otp', { body: { phone: p } });
  if (!otp.json?.challengeId) throw new Error(`otp ${p}: ${otp.status} ${otp.text.slice(0, 200)}`);
  const v = await call('POST', '/auth/verify-otp', { body: { challengeId: otp.json.challengeId, code: otp.json.demoCode } });
  if (!v.json?.user) throw new Error(`verify ${p}: ${v.status} ${v.text.slice(0, 200)}`);
  return { token: v.json.accessToken, userId: v.json.user.id, phone: p };
}

async function grant(actor, role) {
  const r = await call('POST', '/me/roles', { token: actor.token, body: { role } });
  if (r.status >= 300) throw new Error(`grant ${role}: ${r.status} ${r.text.slice(0, 200)}`);
  return r;
}

async function addressFor(actor, role = 'CUSTOMER') {
  const made = await call('POST', '/me/addresses', {
    token: actor.token,
    role,
    body: {
      label: 'HOME',
      line1: 'B-42, Green Park Society',
      city: 'Delhi',
      pincode: '110016',
      // Inside the pilot zone: PILOT_CENTER is 28.6139, 77.2090 with a 3 km radius, and a
      // submit outside it is refused with ADDRESS_OUT_OF_ZONE - correctly.
      lat: 28.6139,
      lng: 77.209,
      isDefault: true,
    },
  });
  if (!made.json?.id) throw new Error(`address: ${made.status} ${made.text.slice(0, 300)}`);
  return made.json.id;
}

async function readyProvider(p) {
  const prov = await signIn(p);
  await grant(prov, 'PROVIDER');
  // `address.manage` is open to PROVIDER too, so the base location does not need a second role.
  const cats = await call('GET', '/categories', { token: prov.token });
  const cat = (cats.json.items ?? cats.json)[0];
  const addressId = await addressFor(prov, 'PROVIDER');
  await call('PUT', '/provider/profile', {
    token: prov.token,
    role: 'PROVIDER',
    body: { businessName: 'Verified Works', skillIds: cat.skills.map((s) => s.id), baseAddressId: addressId, serviceRadiusKm: 15 },
  });
  await verifyAndGoOnline(prov, 'PROVIDER');
  return { ...prov, cat };
}

/**
 * The seeded platform admin, who approves identity documents.
 *
 * Verification goes through the real review endpoints rather than a write to the database,
 * because "an unverified professional cannot bid" is one of the guards most worth proving fires
 * - and because approving is what the admin console does, so it should be exercised here too.
 */
const ADMIN_PHONE = process.env.E2E_ADMIN_PHONE ?? '+919000000007';
let adminToken = null;
async function asAdmin() {
  if (adminToken) return adminToken;
  const a = await signIn(ADMIN_PHONE);
  const probe = await call('GET', '/admin/kyc', { token: a.token, role: 'ADMIN' });
  if (probe.status !== 200) {
    throw new Error(
      `${ADMIN_PHONE} is not an admin on this server (GET /admin/kyc -> ${probe.status}). ` +
        'Run `npm run seed:demo` against the same database first.',
    );
  }
  adminToken = a.token;
  return adminToken;
}

/** Submit a document, have it approved, and go on duty - the real route to being able to bid. */
async function verifyAndGoOnline(actor, role) {
  const kyc = await call('POST', '/provider/kyc', {
    token: actor.token,
    role,
    body: { documentType: 'AADHAAR', documentNumber: '123456789012', mime: 'image/png', sizeBytes: 70 },
  });
  if (kyc.status !== 201) throw new Error(`kyc ${role}: ${kyc.status} ${kyc.text.slice(0, 250)}`);

  const token = await asAdmin();
  const queue = await call('GET', '/admin/kyc', { token, role: 'ADMIN' });
  const mine = (queue.json?.items ?? []).find((k) => k.userId === actor.userId);
  if (!mine) throw new Error(`kyc for ${actor.phone} never reached the review queue`);
  const reviewed = await call('POST', `/admin/kyc/${mine.id}/review`, {
    token,
    role: 'ADMIN',
    body: { decision: 'APPROVE', reason: 'Document matches the name on the account' },
  });
  if (reviewed.status !== 200) throw new Error(`review: ${reviewed.status} ${reviewed.text.slice(0, 250)}`);

  // Going on duty is a separate act from being verified, and it comes after. A vendor opens
  // their shop through their own endpoint, so that one is done by the caller.
  if (role === 'VENDOR') return;
  const avail = await call('POST', '/provider/availability', { token: actor.token, role, body: { isAvailable: true } });
  if (avail.status !== 200) throw new Error(`availability ${role}: ${avail.status} ${avail.text.slice(0, 250)}`);
}

/**
 * On the way, arrived, started with the customer's code, finished, approved.
 *
 * The start code is a real safeguard - a professional cannot mark themselves as having started
 * until the person at the door reads them four digits - so it is walked rather than bypassed.
 */
async function runJobToApproval(cust, prov, jobId, role = 'PROVIDER') {
  await call('POST', `/jobs/${jobId}/progress`, { token: prov.token, role, body: { to: 'EN_ROUTE', etaMinutes: 20 } });
  await call('POST', `/jobs/${jobId}/progress`, { token: prov.token, role, body: { to: 'ARRIVED' } });

  const exec = await call('GET', `/jobs/${jobId}/execution`, { token: cust.token, role: 'CUSTOMER' });
  const code = exec.json?.startCode;
  if (!code) throw new Error(`no start code: ${exec.status} ${exec.text.slice(0, 250)}`);
  const started = await call('POST', `/jobs/${jobId}/start`, { token: prov.token, role, body: { code } });
  if (started.status !== 200) throw new Error(`start: ${started.status} ${started.text.slice(0, 250)}`);

  // `/jobs/:id/media` is the customer's "photos with the request" path (`job.create`); a
  // professional's completion evidence goes to `/jobs/:id/evidence`.
  const up = await call('POST', `/jobs/${jobId}/evidence`, {
    token: prov.token,
    role,
    body: { kind: 'PHOTO', mime: 'image/png', sizeBytes: 70 },
  });
  const mediaId = up.json?.media?.id;
  if (!mediaId) throw new Error(`media: ${up.status} ${up.text.slice(0, 250)}`);
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  if (up.json?.upload?.url) await fetch(up.json.upload.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });

  const done = await call('POST', `/jobs/${jobId}/complete`, {
    token: prov.token,
    role,
    body: { summary: 'Replaced the washer and tested for ten minutes.', mediaIds: [mediaId] },
  });
  if (done.status !== 200 && done.status !== 201) throw new Error(`complete: ${done.status} ${done.text.slice(0, 250)}`);

  const approved = await call('POST', `/jobs/${jobId}/approve`, { token: cust.token, role: 'CUSTOMER', body: { approved: true } });
  if (approved.status !== 200) throw new Error(`approve: ${approved.status} ${approved.text.slice(0, 250)}`);
  return approved;
}

/** Everything a job needs before anybody can bid on it. */
async function openJob(cust, cat, overrides = {}) {
  const addressId = await addressFor(cust);
  const job = await call('POST', '/jobs', {
    token: cust.token,
    role: 'CUSTOMER',
    body: {
      categoryId: cat.id,
      skillIds: cat.skills?.[0] ? [cat.skills[0].id] : [],
      addressId,
      description: 'The kitchen tap drips all night and the washer looks worn through.',
      priority: 'NORMAL',
      requestType: 'LABOUR_ONLY',
      ...overrides,
    },
  });
  if (!job.json?.id) throw new Error(`job: ${job.status} ${job.text.slice(0, 400)}`);
  const sent = await call('POST', `/jobs/${job.json.id}/submit`, { token: cust.token, role: 'CUSTOMER' });
  // Checked rather than assumed: an unchecked submit leaves the job in DRAFT and every later step
  // fails somewhere else, blaming the wrong thing.
  if (sent.status !== 200) throw new Error(`submit: ${sent.status} ${sent.text.slice(0, 400)}`);
  return job.json.id;
}

/** Bid, accept, pay - the shortest route to a confirmed booking somebody can work on. */
async function confirmedJob(cust, prov, jobId) {
  const bid = await call('POST', `/jobs/${jobId}/bids`, {
    token: prov.token,
    role: 'PROVIDER',
    body: { labourPaise: 60000, etaMinutes: 45, warrantyDays: 30, notes: 'I will bring a spare washer.' },
  });
  if (bid.status !== 201) throw new Error(`bid: ${bid.status} ${bid.text.slice(0, 300)}`);
  const accepted = await call('POST', `/bids/${bid.json.id}/accept`, { token: cust.token, role: 'CUSTOMER' });
  const paymentId = accepted.json?.payment?.id;
  if (!paymentId) throw new Error(`accept: ${accepted.status} ${accepted.text.slice(0, 300)}`);
  await call('POST', `/payments/${paymentId}/mock-complete`, { token: cust.token, body: { outcome: 'authorized' } });
  return bid.json.id;
}

// ===========================================================================
// 1. A contractor hires a technician and sends them to a job
// ===========================================================================
section('a contractor, a technician, and a job between them');

const tech = await signIn(phone());
const contractor = await signIn(phone());
await grant(contractor, 'CONTRACTOR');

const profile = await call('GET', '/contractor/profile', { token: contractor.token, role: 'CONTRACTOR' });
ok('granting CONTRACTOR creates the profile', profile.status === 200, `status ${profile.status} ${profile.text.slice(0, 160)}`);

const named = await call('PUT', '/contractor/profile', {
  token: contractor.token,
  role: 'CONTRACTOR',
  body: { businessName: 'BuildRight Services', serviceRadiusKm: 20 },
});
ok('the firm can be named', named.status === 200, `status ${named.status} ${named.text.slice(0, 200)}`);

const hired = await call('POST', '/contractor/technicians', {
  token: contractor.token,
  role: 'CONTRACTOR',
  body: { phone: tech.phone, fullName: 'Ravi Kumar' },
});
ok('a technician who has signed in can be added', hired.status === 201 || hired.status === 200, `status ${hired.status} ${hired.text.slice(0, 250)}`);
const technicianId = hired.json?.technician?.userId ?? tech.userId;
ok('and the response names them', !!hired.json?.technician?.userId, JSON.stringify(hired.json ?? {}).slice(0, 200));

const team = await call('GET', '/contractor/technicians', { token: contractor.token, role: 'CONTRACTOR' });
ok('and appears on the team', (team.json?.items ?? []).length === 1, `status ${team.status} ${team.text.slice(0, 200)}`);

const techSees = await call('GET', '/technician/profile', { token: tech.token, role: 'TECHNICIAN' });
ok('the technician now has a profile of their own', techSees.status === 200, `status ${techSees.status} ${techSees.text.slice(0, 200)}`);
ok('which names the firm they work for', !!techSees.json?.teamName, JSON.stringify(techSees.json ?? {}).slice(0, 200));

// The contractor bids like any professional, then puts one of their people on it.
const custA = await signUpAs(phone(), 'CUSTOMER');
const cats = await call('GET', '/categories', { token: custA.token });
const cat = (cats.json.items ?? cats.json)[0];
const addrC = await addressFor(contractor, 'CONTRACTOR');
const firmReady = await call('PUT', '/contractor/profile', {
  token: contractor.token,
  role: 'CONTRACTOR',
  body: { businessName: 'BuildRight Services', skills: cat.skills.map((s) => s.id), baseAddressId: addrC, serviceRadiusKm: 20 },
});
ok('the firm can say what it does and where from', firmReady.status === 200, `status ${firmReady.status} ${firmReady.text.slice(0, 200)}`);

// The check that matters: a contractor is a professional who delegates, so the marketplace has
// to be able to see them at all.
const contractorFeed = await call('GET', '/provider/jobs/nearby?limit=20', { token: contractor.token, role: 'CONTRACTOR' });
ok('and the firm can see the job feed, like any professional', contractorFeed.status === 200,
  `status ${contractorFeed.status} ${contractorFeed.text.slice(0, 220)}`);

await verifyAndGoOnline(contractor, 'CONTRACTOR');
const firmAfter = await call('GET', '/contractor/profile', { token: contractor.token, role: 'CONTRACTOR' });
ok("and their own profile screen agrees they are verified", firmAfter.json?.verificationStatus === 'VERIFIED',
  JSON.stringify(firmAfter.json ?? {}).slice(0, 200));
const verifiedFeed = await call('GET', '/provider/jobs/nearby?limit=20', { token: contractor.token, role: 'CONTRACTOR' });
ok('and once verified and on duty, nothing is blocking them', (verifiedFeed.json?.blockers ?? []).length === 0,
  JSON.stringify(verifiedFeed.json?.blockers ?? verifiedFeed.text.slice(0, 160)));

const jobA = await openJob(custA, cat);
await confirmedJob(custA, { ...contractor }, jobA);

const contractorJobs = await call('GET', '/contractor/jobs', { token: contractor.token, role: 'CONTRACTOR' });
ok('the won job reaches the contractor queue', (contractorJobs.json?.items ?? []).some((j) => j.jobId === jobA || j.id === jobA),
  `status ${contractorJobs.status} ${contractorJobs.text.slice(0, 250)}`);
const needs = (contractorJobs.json?.items ?? []).find((j) => (j.jobId ?? j.id) === jobA);
ok('and says nobody is on it yet', needs?.needsTechnician === true, JSON.stringify(needs ?? {}).slice(0, 200));

// A technician cannot be sent to somebody's home unverified, and the refusal is worth proving.
const unverified = await call('POST', `/jobs/${jobA}/technician`, {
  token: contractor.token,
  role: 'CONTRACTOR',
  body: { technicianId },
});
ok('an unverified technician cannot be sent to a customer',
  unverified.status === 400 && JSON.stringify(unverified.json).includes('TECHNICIAN_NOT_VERIFIED'),
  `status ${unverified.status} ${unverified.text.slice(0, 200)}`);

// The contractor submits their technician's documents; staff decide. That is the whole point of
// the route existing.
const techKyc = await call('POST', `/contractor/technicians/${technicianId}/kyc`, {
  token: contractor.token,
  role: 'CONTRACTOR',
  body: { documentType: 'AADHAAR', documentNumber: '123456789012', mime: 'image/png', sizeBytes: 70 },
});
ok('the contractor can submit their documents', techKyc.status === 201 || techKyc.status === 200,
  `status ${techKyc.status} ${techKyc.text.slice(0, 250)}`);

const adminToken2 = await asAdmin();
const tq = await call('GET', '/admin/kyc', { token: adminToken2, role: 'ADMIN' });
const techSubmission = (tq.json?.items ?? []).find((k) => k.userId === technicianId);
ok('and it reaches the same review queue everybody else is in', !!techSubmission,
  `status ${tq.status} ${(tq.json?.items ?? []).length} waiting`);
if (techSubmission) {
  const okd = await call('POST', `/admin/kyc/${techSubmission.id}/review`, {
    token: adminToken2,
    role: 'ADMIN',
    body: { decision: 'APPROVE', reason: 'Document matches the name the contractor gave' },
  });
  ok('staff can approve it', okd.status === 200, `status ${okd.status} ${okd.text.slice(0, 200)}`);
}

const assigned = await call('POST', `/jobs/${jobA}/technician`, {
  token: contractor.token,
  role: 'CONTRACTOR',
  body: { technicianId },
});
ok('a technician can be sent to it', assigned.status === 200 || assigned.status === 201, `status ${assigned.status} ${assigned.text.slice(0, 250)}`);

const techJobs = await call('GET', '/technician/jobs', { token: tech.token, role: 'TECHNICIAN' });
ok('and the job appears on their own screen', (techJobs.json?.items ?? techJobs.json ?? []).some?.((j) => j.jobId === jobA),
  `status ${techJobs.status} ${techJobs.text.slice(0, 250)}`);
const techJob = (techJobs.json?.items ?? techJobs.json ?? []).find?.((j) => j.jobId === jobA);
ok('with the full address, because they have to be able to arrive', !!techJob?.address, JSON.stringify(techJob ?? {}).slice(0, 220));
ok('and no price, because it is not theirs to see',
  techJob != null && !('totalPaise' in techJob) && !('providerPayablePaise' in techJob),
  Object.keys(techJob ?? {}).join(','));

// ===========================================================================
// 2. A warranty claim, answered, and booked as a return visit
// ===========================================================================
section('work that came back');

const custB = await signUpAs(phone(), 'CUSTOMER');
const provB = await readyProvider(phone());
const jobB = await openJob(custB, provB.cat);
await confirmedJob(custB, provB, jobB);

// Run it to completion so there is a warranty to claim against.
const ran = await runJobToApproval(custB, provB, jobB);
ok('the job can be run from on-the-way to approved', ran.status === 200, `status ${ran.status}`);

const warranty = await call('GET', `/jobs/${jobB}/warranty`, { token: custB.token, role: 'CUSTOMER' });
ok('the customer can see what the warranty covers', warranty.status === 200, `status ${warranty.status} ${warranty.text.slice(0, 250)}`);

const claim = await call('POST', `/jobs/${jobB}/warranty-claim`, {
  token: custB.token,
  role: 'CUSTOMER',
  body: { description: 'The same tap has started dripping again after four days.' },
});
ok('and raise a claim against it', claim.status === 201 || claim.status === 200, `status ${claim.status} ${claim.text.slice(0, 300)}`);
const claimId = claim.json?.id ?? claim.json?.claim?.id;

const provClaims = await call('GET', '/me/warranty-claims', { token: provB.token, role: 'PROVIDER' });
ok('which reaches the professional who did the work', (provClaims.json?.items ?? []).some((c) => c.id === claimId),
  `status ${provClaims.status} ${provClaims.text.slice(0, 250)}`);

const answered = await call('POST', `/warranty-claims/${claimId}/respond`, {
  token: provB.token,
  role: 'PROVIDER',
  body: { response: 'ACCEPT', proposedStart: new Date(Date.now() + 2 * 86_400_000).toISOString() },
});
ok('the professional can accept it', answered.status === 200, `status ${answered.status} ${answered.text.slice(0, 250)}`);

const revisit = await call('POST', `/warranty-claims/${claimId}/revisit`, {
  token: provB.token,
  role: 'PROVIDER',
  body: { preferredStart: new Date(Date.now() + 2 * 86_400_000).toISOString() },
});
ok('and book the return visit, which is the point of the whole feature',
  revisit.status === 200 || revisit.status === 201, `status ${revisit.status} ${revisit.text.slice(0, 300)}`);

// ===========================================================================
// 3. A standing arrangement that comes due
// ===========================================================================
section('the work that comes back every few months');

const custC = await signUpAs(phone(), 'CUSTOMER');
const addrCust = await addressFor(custC);
const plan = await call('POST', '/me/service-plans', {
  token: custC.token,
  role: 'CUSTOMER',
  body: {
    categoryId: cat.id,
    skillIds: cat.skills?.[0] ? [cat.skills[0].id] : [],
    addressId: addrCust,
    description: 'Service the water filter and replace the cartridge if it needs it.',
    intervalDays: 90,
    leadDays: 2,
    firstDueOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  },
});
ok('a repeat booking can be set up', plan.status === 201 || plan.status === 200, `status ${plan.status} ${plan.text.slice(0, 300)}`);
const planId = plan.json?.id ?? plan.json?.plan?.id;

const plans = await call('GET', '/me/service-plans', { token: custC.token, role: 'CUSTOMER' });
ok('and is listed back', (plans.json?.items ?? []).some((p) => p.id === planId), `status ${plans.status} ${plans.text.slice(0, 250)}`);

const skipped = await call('POST', `/me/service-plans/${planId}/skip-next`, { token: custC.token, role: 'CUSTOMER' });
ok('one occurrence can be skipped without cancelling the arrangement', skipped.status === 200,
  `status ${skipped.status} ${skipped.text.slice(0, 250)}`);

const paused = await call('PATCH', `/me/service-plans/${planId}`, {
  token: custC.token,
  role: 'CUSTOMER',
  body: { status: 'PAUSED' },
});
ok('and the whole thing can be paused', paused.status === 200, `status ${paused.status} ${paused.text.slice(0, 250)}`);

// ===========================================================================
// 4. Nobody turns up, and the booking is offered to somebody else
// ===========================================================================
section('when the professional stops answering');

const custD = await signUpAs(phone(), 'CUSTOMER');
const provD = await readyProvider(phone());
const rescuer = await readyProvider(phone());
const jobD = await openJob(custD, provD.cat);

/*
 * Somebody else has to have *lost* this job for there to be anybody to rescue it with.
 * Redispatch only asks providers who already bid: they have seen the job, priced it, and are
 * far better for a customer who has taken time off work than an empty screen. With a single
 * bidder - the one who just dropped out - `open` correctly returns null and the booking is
 * simply cancelled, which is what the first version of this test was accidentally proving.
 */
const alsoBid = await call('POST', `/jobs/${jobD}/bids`, {
  token: rescuer.token,
  role: 'PROVIDER',
  // Under the first offer deliberately. A rescuer who costs more than the customer authorised is
  // skipped as COSTS_MORE_THAN_AUTHORISED - correctly, because the alternative is charging
  // somebody more for a problem they did not cause.
  body: { labourPaise: 55000, etaMinutes: 60, warrantyDays: 30, notes: 'Available this afternoon.' },
});
ok('a second professional offers on the job', alsoBid.status === 201, `status ${alsoBid.status} ${alsoBid.text.slice(0, 200)}`);

await confirmedJob(custD, provD, jobD);

const gaveUp = await call('POST', `/jobs/${jobD}/cancel-as-provider`, {
  token: provD.token,
  role: 'PROVIDER',
  body: { reason: 'My van has broken down and I cannot reach you today at all.' },
});
ok('a professional can give up a confirmed booking', gaveUp.status === 200, `status ${gaveUp.status} ${gaveUp.text.slice(0, 300)}`);

const afterCancel = await call('GET', `/jobs/${jobD}`, { token: custD.token, role: 'CUSTOMER' });
ok('which puts the booking into redispatch rather than simply killing it',
  afterCancel.json?.status === 'REDISPATCHING', `status ${afterCancel.json?.status}`);

const invites = await call('GET', '/me/redispatch-invitations', { token: rescuer.token, role: 'PROVIDER' });
ok('and somebody else is invited to cover it', (invites.json?.items ?? []).length >= 1,
  `status ${invites.status} ${invites.text.slice(0, 250)}`);
const inviteId = (invites.json?.items ?? [])[0]?.id;

if (inviteId) {
  const took = await call('POST', `/redispatch-invitations/${inviteId}/respond`, {
    token: rescuer.token,
    role: 'PROVIDER',
    body: { accept: true },
  });
  ok('who can take it', took.status === 200, `status ${took.status} ${took.text.slice(0, 300)}`);
  const rescued = await call('GET', `/jobs/${jobD}`, { token: custD.token, role: 'CUSTOMER' });
  ok('and the booking is live again without the customer paying twice',
    ['CONFIRMED', 'PROVIDER_ASSIGNED'].includes(rescued.json?.status), `status ${rescued.json?.status}`);
}

// ===========================================================================
// 5. Materials: asked for, quoted, chosen, delivered, invoiced, payable
// ===========================================================================
section('materials, all the way to the one path a vendor is paid by');

const custE = await signUpAs(phone(), 'CUSTOMER');
const provE = await readyProvider(phone());
const vendor = await signIn(phone());
await grant(vendor, 'VENDOR');

const jobE = await openJob(custE, provE.cat, { requestType: 'LABOUR_AND_MATERIAL' });
await confirmedJob(custE, provE, jobE);

/*
 * Materials are asked for from the doorstep, not from the sofa. `JOB_NOT_ON_SITE` refuses a
 * request before the professional has arrived, which is right - a parts list written before
 * seeing the job is a guess the customer pays for.
 */
await call('POST', `/jobs/${jobE}/progress`, { token: provE.token, role: 'PROVIDER', body: { to: 'EN_ROUTE', etaMinutes: 15 } });
await call('POST', `/jobs/${jobE}/progress`, { token: provE.token, role: 'PROVIDER', body: { to: 'ARRIVED' } });
const execE = await call('GET', `/jobs/${jobE}/execution`, { token: custE.token, role: 'CUSTOMER' });
const startedE = await call('POST', `/jobs/${jobE}/start`, { token: provE.token, role: 'PROVIDER', body: { code: execE.json?.startCode } });
ok('the professional is on site before asking for anything', startedE.status === 200,
  `status ${startedE.status} ${startedE.text.slice(0, 200)}`);

const asked = await call('POST', `/jobs/${jobE}/material-request`, {
  token: provE.token,
  role: 'PROVIDER',
  body: { items: [{ name: 'Brass tap cartridge', quantity: 2, unit: 'PIECE' }], note: 'Half inch, standard thread.' },
});
ok('the professional can ask for materials', asked.status === 201 || asked.status === 200, `status ${asked.status} ${asked.text.slice(0, 300)}`);
const requestId = asked.json?.id ?? asked.json?.request?.id;

const blocked = await call('GET', '/vendor/material-requests', { token: vendor.token, role: 'VENDOR' });
ok('an unverified vendor is told why their feed is empty, rather than just shown an empty list',
  (blocked.json?.blockers ?? []).length >= 1, JSON.stringify(blocked.json ?? {}).slice(0, 200));

await verifyAndGoOnline(vendor, 'VENDOR');
const shopOn = await call('POST', '/vendor/availability', { token: vendor.token, role: 'VENDOR', body: { deliveryAvailable: true } });
ok('a verified vendor can open their shop for requests', shopOn.status === 200, `status ${shopOn.status} ${shopOn.text.slice(0, 200)}`);

const vendorFeed = await call('GET', '/vendor/material-requests', { token: vendor.token, role: 'VENDOR' });
ok('a vendor sees the request', vendorFeed.status === 200, `status ${vendorFeed.status} ${vendorFeed.text.slice(0, 250)}`);
ok('or is told exactly why not, rather than an empty list',
  (vendorFeed.json?.items ?? []).length >= 1 || (vendorFeed.json?.blockers ?? []).length >= 1,
  JSON.stringify(vendorFeed.json ?? {}).slice(0, 250));

const quoted = await call('POST', `/material-requests/${requestId}/quote`, {
  token: vendor.token,
  role: 'VENDOR',
  body: {
    items: [{ name: 'Brass tap cartridge', quantity: 2, unit: 'PIECE', unitPricePaise: 18000, inStock: true }],
    deliveryPaise: 5000,
    etaMinutes: 90,
  },
});
ok('and can quote on it', quoted.status === 201 || quoted.status === 200, `status ${quoted.status} ${quoted.text.slice(0, 300)}`);
const quoteId = quoted.json?.id ?? quoted.json?.quote?.id;

const seen = await call('GET', `/jobs/${jobE}/materials`, { token: custE.token, role: 'CUSTOMER' });
ok('the customer can see what it would cost', seen.status === 200, `status ${seen.status} ${seen.text.slice(0, 250)}`);

const chosen = await call('POST', `/material-quotes/${quoteId}/select`, { token: custE.token, role: 'CUSTOMER' });
ok('and choose a quote', chosen.status === 200 || chosen.status === 201, `status ${chosen.status} ${chosen.text.slice(0, 300)}`);
const orderId = chosen.json?.orderId ?? chosen.json?.order?.id ?? chosen.json?.id;

/*
 * Materials are paid for separately from the labour, and the vendor is deliberately not asked to
 * prepare anything until that lands: nobody buys stock on an unpaid promise. Until it does the
 * order sits at PENDING_PAYMENT and every move is correctly refused.
 */
const matPaymentId = chosen.json?.payment?.id;
ok('choosing a quote raises its own payment', !!matPaymentId, JSON.stringify(chosen.json ?? {}).slice(0, 200));
const matPaid = await call('POST', `/payments/${matPaymentId}/mock-complete`, {
  token: custE.token,
  body: { outcome: 'authorized' },
});
ok('which the customer authorises', matPaid.status === 200, `status ${matPaid.status} ${matPaid.text.slice(0, 200)}`);

const orders = await call('GET', '/vendor/material-orders', { token: vendor.token, role: 'VENDOR' });
ok('and only then is the vendor asked to prepare it',
  (orders.json?.items ?? []).find((o) => o.id === orderId)?.status === 'PREPARING',
  JSON.stringify((orders.json?.items ?? [])[0] ?? {}).slice(0, 200));
ok('which reaches the vendor as an order', (orders.json?.items ?? []).some((o) => o.id === orderId),
  `status ${orders.status} ${orders.text.slice(0, 250)}`);

const dispatched = await call('POST', `/material-orders/${orderId}/status`, {
  token: vendor.token,
  role: 'VENDOR',
  body: { to: 'OUT_FOR_DELIVERY' },
});
ok('the vendor can mark it on its way', dispatched.status === 200, `status ${dispatched.status} ${dispatched.text.slice(0, 250)}`);

const delivered = await call('POST', `/material-orders/${orderId}/status`, {
  token: vendor.token,
  role: 'VENDOR',
  body: { to: 'DELIVERED' },
});
ok('and delivered', delivered.status === 200, `status ${delivered.status} ${delivered.text.slice(0, 250)}`);

const confirmed = await call('POST', `/material-orders/${orderId}/confirm`, {
  token: provE.token,
  role: 'PROVIDER',
  body: { ok: true },
});
ok('the professional confirms it arrived', confirmed.status === 200, `status ${confirmed.status} ${confirmed.text.slice(0, 250)}`);

/*
 * The invoice is a *file*, so the vendor has to be able to attach one to somebody else's job -
 * the one path by which a vendor is ever paid, and the one that used to refuse them twice over.
 */
const invoiceMedia = await call('POST', `/jobs/${jobE}/evidence`, {
  token: vendor.token,
  role: 'VENDOR',
  body: { kind: 'DOCUMENT', mime: 'application/pdf', sizeBytes: 120_000 },
});
ok('a vendor can attach a file to the job they supplied', invoiceMedia.status === 201 || invoiceMedia.status === 200,
  `status ${invoiceMedia.status} ${invoiceMedia.text.slice(0, 250)}`);

const invoiced = await call('POST', `/material-orders/${orderId}/invoice`, {
  token: vendor.token,
  role: 'VENDOR',
  body: { mediaId: invoiceMedia.json?.media?.id, amountPaise: 41000, invoiceNumber: 'INV-2026-0042' },
});
ok('and the vendor can attach the invoice - the only way they are ever paid',
  invoiced.status === 200 || invoiced.status === 201, `status ${invoiced.status} ${invoiced.text.slice(0, 300)}`);

console.log(`\n${failures ? `${failures} of ${checks} FAILED` : `ALL GREEN (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
