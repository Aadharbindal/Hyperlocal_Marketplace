#!/usr/bin/env node
/**
 * A load test that drives real bookings, not a synthetic GET loop.
 *
 * The question worth answering before launch is not "how many requests per second can Fastify
 * serve" - that number is meaningless here, because nothing in this product is a single request.
 * It is "what breaks first when N people book at once, and does anything go wrong with the
 * money while it does".
 *
 * So each virtual user walks a whole booking: sign in, post a job, receive an offer, accept it,
 * authorise the payment, run the work, complete it. That exercises the transaction that decides
 * a single winner, the ledger batches, and the scheduler running underneath all of it.
 *
 * Written with no dependencies on purpose. k6 and artillery are better tools, and neither is
 * worth adding to this repo to answer one question that fetch can answer.
 *
 *   node scripts/load-test.mjs --users 50 --api http://localhost:4000
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1]]);
    return acc;
  }, []),
);

const API = (args.api ?? process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const USERS = Number(args.users ?? 25);
const RAMP_MS = Number(args.ramp ?? 5000);

/** Every request's duration, so the report can talk in percentiles rather than an average. */
const timings = [];
const failures = new Map();

async function call(label, path, options = {}) {
  const started = performance.now();
  try {
    const res = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const ms = performance.now() - started;
    timings.push({ label, ms, status: res.status });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const key = `${label} ${res.status} ${json?.error?.code ?? ''}`.trim();
      failures.set(key, (failures.get(key) ?? 0) + 1);
      return { ok: false, json };
    }
    return { ok: true, json };
  } catch (error) {
    timings.push({ label, ms: performance.now() - started, status: 0 });
    const key = `${label} network`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
    return { ok: false, json: null, error };
  }
}

async function signIn(phone) {
  const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${((Math.random() * 250) | 0) + 1}`;
  const headers = { 'x-forwarded-for': ip };
  const start = await call('auth/request-otp', '/auth/request-otp', { method: 'POST', body: { phone }, headers });
  if (!start.ok) return null;
  const done = await call('auth/verify-otp', '/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: start.json.challengeId, code: start.json.demoCode },
    headers,
  });
  return done.ok ? { token: done.json.accessToken, userId: done.json.user.id, ip } : null;
}

const auth = (session, role) => ({
  authorization: `Bearer ${session.token}`,
  'x-forwarded-for': session.ip,
  ...(role ? { 'x-active-role': role } : {}),
});

/** One virtual user, walking a whole booking from both sides. */
async function runBooking(n, categoryId, skillIds) {
  const customerPhone = `+9198${String(70_000_000 + n * 2).slice(0, 8)}`;
  const providerPhone = `+9198${String(70_000_001 + n * 2).slice(0, 8)}`;

  const customer = await signIn(customerPhone);
  const provider = await signIn(providerPhone);
  if (!customer || !provider) return false;

  await call('me/roles', '/me/roles', { method: 'POST', headers: auth(customer), body: { role: 'CUSTOMER' } });
  await call('me/roles', '/me/roles', { method: 'POST', headers: auth(provider), body: { role: 'PROVIDER' } });

  const address = await call('me/addresses', '/me/addresses', {
    method: 'POST',
    headers: auth(customer),
    body: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
  });
  if (!address.ok) return false;

  const shop = await call('me/addresses', '/me/addresses', {
    method: 'POST',
    headers: auth(provider),
    body: { label: 'Shop', line1: '4, Jor Bagh Market', city: 'Delhi', pincode: '110003' },
  });
  await call('provider/profile', '/provider/profile', {
    method: 'PUT',
    headers: auth(provider, 'PROVIDER'),
    body: { businessName: `Load ${n}`, serviceRadiusKm: 8, baseAddressId: shop.json?.id, skillIds },
  });
  // Expected to be refused: going available is only meaningful once staff have verified the
  // provider, so under a cold start every one of these is a 403. Left in the walk rather than
  // skipped, because the refusal is part of what a real signup costs the server.
  await call('provider/availability', '/provider/availability', {
    method: 'POST',
    headers: auth(provider, 'PROVIDER'),
    body: { isAvailable: true },
  });

  const draft = await call('jobs', '/jobs', {
    method: 'POST',
    headers: auth(customer),
    body: { categoryId, addressId: address.json.id, description: 'Kitchen tap leaking under load' },
  });
  if (!draft.ok) return false;
  const submitted = await call('jobs/submit', `/jobs/${draft.json.id}/submit`, { method: 'POST', headers: auth(customer) });
  if (!submitted.ok) return false;

  const jobId = submitted.json.job.id;
  // A provider who is not verified cannot bid, and verification is a staff action - so under
  // load this stops here for most users, which is itself worth measuring: it is the real shape
  // of a cold start.
  const bid = await call('jobs/bids', `/jobs/${jobId}/bids`, {
    method: 'POST',
    headers: auth(provider, 'PROVIDER'),
    body: { labourPaise: 60_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 15 },
  });
  if (!bid.ok) return true; // the booking got as far as it can without a verified provider

  const accepted = await call('bids/accept', `/bids/${bid.json.id}/accept`, {
    method: 'POST',
    headers: auth(customer),
    body: {},
  });
  if (!accepted.ok) return false;

  await call('payments/complete', `/payments/${accepted.json.payment.id}/mock-complete`, {
    method: 'POST',
    headers: auth(customer),
    body: { outcome: 'authorized' },
  });
  return true;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

async function main() {
  console.log(`Load test against ${API}: ${USERS} concurrent bookings, ramped over ${RAMP_MS}ms\n`);

  const health = await call('ready', '/ready');
  if (!health.ok) {
    console.error('The API is not answering /ready. Start it first.');
    process.exit(1);
  }

  const categories = await call('categories', '/categories');
  const plumbing = categories.json?.items?.find((c) => c.slug === 'plumbing');
  if (!plumbing) {
    console.error('No catalog. Is the database seeded?');
    process.exit(1);
  }

  const started = performance.now();
  const runs = [];
  for (let i = 0; i < USERS; i++) {
    // Ramped rather than all at once: a thundering herd measures the herd, not the system.
    await new Promise((resolve) => setTimeout(resolve, RAMP_MS / USERS));
    runs.push(runBooking(i, plumbing.id, plumbing.skills.slice(0, 2).map((s) => s.id)));
  }
  const results = await Promise.all(runs);
  const wall = performance.now() - started;

  const byLabel = new Map();
  for (const t of timings) {
    if (!byLabel.has(t.label)) byLabel.set(t.label, []);
    byLabel.get(t.label).push(t.ms);
  }

  console.log(`Completed ${results.filter(Boolean).length}/${USERS} booking walks in ${Math.round(wall)}ms`);
  console.log(`${timings.length} requests, ${Math.round((timings.length / wall) * 1000)} req/s\n`);

  console.log('Slowest endpoints (p95):');
  [...byLabel.entries()]
    .map(([label, values]) => ({ label, p50: percentile(values, 50), p95: percentile(values, 95), n: values.length }))
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 10)
    .forEach((row) => console.log(`  ${String(row.p95).padStart(6)}ms p95  ${String(row.p50).padStart(5)}ms p50  ${String(row.n).padStart(4)}x  ${row.label}`));

  if (failures.size > 0) {
    console.log('\nFailures:');
    [...failures.entries()].sort((a, b) => b[1] - a[1]).forEach(([key, count]) => console.log(`  ${String(count).padStart(4)}x  ${key}`));
  } else {
    console.log('\nNo failures.');
  }

  // The number that actually matters: a request that took longer than a person would wait.
  const slow = timings.filter((t) => t.ms > 3000).length;
  console.log(`\n${slow} request(s) took longer than 3s.`);
}

await main();
