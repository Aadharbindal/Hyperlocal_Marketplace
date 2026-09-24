import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * A contractor runs a team. The API could record the *result* of that - an assignment naming a
 * technician - but there was no way to build a team in the first place.
 */

let app: TestApp;
let plumbingSkills: string[];

async function makeContractor(phone: string) {
  const res = await login(app, phone);
  const h = bearer(res.accessToken, { 'x-active-role': 'CONTRACTOR' });
  await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'CONTRACTOR' } });
  await app.inject({ method: 'PUT', url: '/contractor/profile', headers: h, payload: { businessName: `Crew ${phone.slice(-4)}` } });
  return { headers: h, userId: res.user.id, phone };
}

/**
 * Somebody who has signed in on their own phone. That is all that is required - and all that
 * *can* be required, since TECHNICIAN is deliberately not a role anyone gives themselves.
 */
async function makeTechnicianAccount(phone: string) {
  const res = await login(app, phone);
  return { userId: res.user.id, phone, headers: bearer(res.accessToken) };
}

beforeAll(async () => {
  app = await makeApp();
  const cats = await app.inject({ method: 'GET', url: '/categories' });
  const plumbing = (cats.json().items as Array<{ slug: string; skills: Array<{ id: string }> }>).find((c) => c.slug === 'plumbing')!;
  plumbingSkills = plumbing.skills.map((s) => s.id);
});
afterAll(async () => {
  await app.close();
});

describe('building a crew', () => {
  it('adds somebody who has already signed in, and grants them the role', async () => {
    const c = await makeContractor('+919888000001');
    const tech = await makeTechnicianAccount('+919888000002');

    const added = await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: c.headers,
      payload: { phone: tech.phone, fullName: 'Ravi Kumar', skills: plumbingSkills.slice(0, 2) },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().technician.fullName).toBe('Ravi Kumar');
    // Added is not verified. Staff decide that, on documents, later.
    expect(added.json().technician.verificationStatus).toBe('UNVERIFIED');

    const list = await app.inject({ method: 'GET', url: '/contractor/technicians', headers: c.headers });
    expect(list.json().items).toHaveLength(1);

    // Being added is what grants the role - nobody becomes a technician by declaring it.
    const roles = await app.ctx.store.users.listRoles(tech.userId);
    expect(roles.map((r) => r.role)).toContain('TECHNICIAN');
    // and the grant records who did it
    expect(roles.find((r) => r.role === 'TECHNICIAN')?.granted_by).toBe(c.userId);

    // The person is told, rather than discovering it when a job appears at their door.
    const theirs = await app.inject({ method: 'GET', url: '/me/notifications', headers: tech.headers });
    expect((theirs.json().items as Array<{ type: string }>).map((n) => n.type)).toContain('account.team_joined');
  });

  it('will not conjure an account for somebody who has never signed in', async () => {
    const c = await makeContractor('+919888000003');
    const r = await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: c.headers,
      payload: { phone: '+919888099999', fullName: 'Nobody At All' },
    });
    // A contractor who could create accounts for people could create accounts *as* people, and
    // send an unverified stranger to a home under a name the customer trusted.
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.contractor).toEqual(['TECHNICIAN_NOT_REGISTERED']);
    expect(r.json().error.details.message).toContain('sign in with this number first');
  });

  it('will not let somebody make themselves a technician', async () => {
    const someone = await login(app, '+919888000005');
    const r = await app.inject({
      method: 'POST', url: '/me/roles', headers: bearer(someone.accessToken), payload: { role: 'TECHNICIAN' },
    });
    // Nobody becomes a technician by declaring it; a contractor vouches for them, by adding them.
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('ROLE_NOT_SELF_SERVICE');
  });

  it('keeps somebody off two crews at once', async () => {
    const first = await makeContractor('+919888000006');
    const second = await makeContractor('+919888000007');
    const tech = await makeTechnicianAccount('+919888000008');

    await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: first.headers,
      payload: { phone: tech.phone, fullName: 'Shared Person' },
    });
    const poached = await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: second.headers,
      payload: { phone: tech.phone, fullName: 'Shared Person' },
    });
    // A customer has to be able to tell who is answerable for the person at their door.
    expect(poached.statusCode).toBe(409);
    expect(poached.json().error.details.contractor).toEqual(['ALREADY_ON_ANOTHER_TEAM']);
  });

  it('refuses a contractor adding themselves', async () => {
    const c = await makeContractor('+919888000009');
    const r = await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: c.headers,
      payload: { phone: c.phone, fullName: 'Me Myself' },
    });
    expect(r.json().error.details.contractor).toEqual(['CANNOT_ADD_YOURSELF']);
  });

  it('removes somebody without erasing them', async () => {
    const c = await makeContractor('+919888000010');
    const tech = await makeTechnicianAccount('+919888000011');
    await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: c.headers,
      payload: { phone: tech.phone, fullName: 'Leaving Soon' },
    });

    const removed = await app.inject({ method: 'DELETE', url: `/contractor/technicians/${tech.userId}`, headers: c.headers });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/contractor/technicians', headers: c.headers })).json().items).toHaveLength(0);

    // The profile is kept, so their own history stays theirs.
    expect(await app.ctx.store.users.getTechnicianProfile(tech.userId)).not.toBeNull();
  });

  it('is nobody else business', async () => {
    const c = await makeContractor('+919888000012');
    const outsider = await login(app, '+919888000013');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(outsider.accessToken), payload: { role: 'CUSTOMER' } });

    const r = await app.inject({ method: 'GET', url: '/contractor/technicians', headers: bearer(outsider.accessToken) });
    expect(r.statusCode).toBe(403);
    void c;
  });
});

describe('verifying a crew member', () => {
  it('puts them in the same queue as everybody else, and never lets the contractor decide', async () => {
    const c = await makeContractor('+919888000020');
    const tech = await makeTechnicianAccount('+919888000021');
    await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: c.headers,
      payload: { phone: tech.phone, fullName: 'Awaiting Review' },
    });

    const submitted = await app.inject({
      method: 'POST', url: `/contractor/technicians/${tech.userId}/kyc`, headers: c.headers,
      payload: { documentType: 'AADHAAR', documentNumber: '1234 5678 9012', mime: 'image/jpeg', sizeBytes: 400_000 },
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().kyc.status).toBe('SUBMITTED');

    // SUBMITTED, not VERIFIED: "verified" cannot mean "their employer says so".
    const list = await app.inject({ method: 'GET', url: '/contractor/technicians', headers: c.headers });
    expect(list.json().items[0].verificationStatus).toBe('SUBMITTED');

    // And the document number itself never reaches the audit log.
    const stored = await app.ctx.store.kyc.findOpen(tech.userId, 'AADHAAR');
    expect(stored?.doc_number_last4).toBe('9012');
    expect(JSON.stringify(stored)).not.toContain('123456789012');
  });

  it('cannot submit for somebody on another crew', async () => {
    const mine = await makeContractor('+919888000022');
    const theirs = await makeContractor('+919888000023');
    const tech = await makeTechnicianAccount('+919888000024');
    await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: theirs.headers,
      payload: { phone: tech.phone, fullName: 'Someone Else Crew' },
    });

    const r = await app.inject({
      method: 'POST', url: `/contractor/technicians/${tech.userId}/kyc`, headers: mine.headers,
      payload: { documentType: 'PAN', documentNumber: 'ABCDE1234F', mime: 'image/jpeg', sizeBytes: 400_000 },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('the day a contractor runs', () => {
  it('shows live jobs and says which still have nobody on them', async () => {
    const c = await makeContractor('+919888000030');
    const jobs = await app.inject({ method: 'GET', url: '/contractor/jobs', headers: c.headers });
    expect(jobs.statusCode).toBe(200);
    // Nothing won yet, so nothing to show - and no error about it.
    expect(jobs.json().items).toEqual([]);
  });

  it('counts the crew on the profile, verified separately from added', async () => {
    const c = await makeContractor('+919888000031');
    const tech = await makeTechnicianAccount('+919888000032');
    await app.inject({
      method: 'POST', url: '/contractor/technicians', headers: c.headers,
      payload: { phone: tech.phone, fullName: 'One Of Two' },
    });

    const profile = await app.inject({ method: 'GET', url: '/contractor/profile', headers: c.headers });
    expect(profile.json().teamSize).toBe(1);
    expect(profile.json().verifiedTeamSize).toBe(0);
  });
});
