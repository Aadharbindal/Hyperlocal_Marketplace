import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHONES, bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('roles (AUTH-02)', () => {
  it('self-service roles can be added, privileged roles cannot', async () => {
    const res = await login(app, '+919222222221');
    const ok = await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'CUSTOMER' } });
    expect(ok.statusCode).toBe(201);
    const again = await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'CUSTOMER' } });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyGranted).toBe(true);
    for (const role of ['ADMIN', 'SUPPORT', 'TECHNICIAN']) {
      const r = await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role } });
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('ROLE_NOT_SELF_SERVICE');
    }
  });

  it('adding PROVIDER creates an UNVERIFIED provider profile', async () => {
    const res = await login(app, '+919222222222');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(res.accessToken) });
    expect(me.json().profiles.provider.verificationStatus).toBe('UNVERIFIED');
    expect(me.json().profiles.provider.isAvailable).toBe(false);
  });
});

describe('addresses (JOB-05 geocode, pilot zone)', () => {
  it('creates, geocodes, marks pilot zone, and enforces ownership', async () => {
    const a = await login(app, '+919222222223');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(a.accessToken), payload: { role: 'CUSTOMER' } });
    const created = await app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: bearer(a.accessToken),
      payload: { line1: '12, Lodhi Colony', city: 'Delhi', pincode: '110003' },
    });
    expect(created.statusCode).toBe(201);
    const addr = created.json();
    expect(addr.isDefault).toBe(true);
    expect(addr.inPilotZone).toBe(true);
    expect(typeof addr.lat).toBe('number');

    const outside = await app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: bearer(a.accessToken),
      payload: { label: 'Office', line1: 'Far away', city: 'Delhi', pincode: '110099' },
    });
    expect(outside.json().inPilotZone).toBe(false);
    expect(outside.json().isDefault).toBe(false);

    // Another user cannot read/modify it (cross-user access security test).
    const b = await login(app, '+919222222224');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(b.accessToken), payload: { role: 'CUSTOMER' } });
    const forbidden = await app.inject({ method: 'PATCH', url: `/me/addresses/${addr.id}`, headers: bearer(b.accessToken), payload: { label: 'Hacked' } });
    expect(forbidden.statusCode).toBe(403);
    const del = await app.inject({ method: 'DELETE', url: `/me/addresses/${addr.id}`, headers: bearer(b.accessToken) });
    expect(del.statusCode).toBe(403);

    const bad = await app.inject({ method: 'POST', url: '/me/addresses', headers: bearer(a.accessToken), payload: { line1: 'x', city: 'Delhi', pincode: '12' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['line1', 'pincode']));
  });

  it('requires a role that manages addresses', async () => {
    const noRole = await login(app, '+919222222225');
    const r = await app.inject({ method: 'GET', url: '/me/addresses', headers: bearer(noRole.accessToken) });
    expect(r.statusCode).toBe(403);
  });
});

describe('idempotency (NET-06)', () => {
  it('replays the first response for the same key', async () => {
    const a = await login(app, '+919222222226');
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(a.accessToken), payload: { role: 'CUSTOMER' } });
    const headers = bearer(a.accessToken, { 'idempotency-key': 'k-1' });
    const payload = { line1: '5, Jor Bagh', city: 'Delhi', pincode: '110003' };
    const r1 = await app.inject({ method: 'POST', url: '/me/addresses', headers, payload });
    const r2 = await app.inject({ method: 'POST', url: '/me/addresses', headers, payload });
    expect(r2.statusCode).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json().id).toBe(r1.json().id);
    const list = await app.inject({ method: 'GET', url: '/me/addresses', headers: bearer(a.accessToken) });
    expect(list.json().items).toHaveLength(1);
    const wrongRoute = await app.inject({ method: 'PATCH', url: '/me', headers, payload: { displayName: 'X Y' } });
    expect(wrongRoute.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('admin (AUTH-09, audit)', () => {
  it('support can search (masked), only admin can suspend, reason is mandatory, everything audited', async () => {
    const victim = await login(app, '+919222222227');
    const support = await login(app, PHONES.support);
    const admin = await login(app, PHONES.admin);
    const customer = await login(app, PHONES.customer);

    const denied = await app.inject({ method: 'GET', url: '/admin/users?q=9222222227', headers: bearer(customer.accessToken) });
    expect(denied.statusCode).toBe(403);

    const search = await app.inject({ method: 'GET', url: '/admin/users?q=9222222227', headers: bearer(support.accessToken) });
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0].phone).toBe('+91********27');

    const supportSuspend = await app.inject({ method: 'POST', url: `/admin/users/${victim.user.id}/suspend`, headers: bearer(support.accessToken), payload: { reason: 'abuse report' } });
    expect(supportSuspend.statusCode).toBe(403);

    const noReason = await app.inject({ method: 'POST', url: `/admin/users/${victim.user.id}/suspend`, headers: bearer(admin.accessToken), payload: {} });
    expect(noReason.statusCode).toBe(400);

    const suspended = await app.inject({ method: 'POST', url: `/admin/users/${victim.user.id}/suspend`, headers: bearer(admin.accessToken), payload: { reason: 'Repeated no-shows confirmed by support' } });
    expect(suspended.statusCode).toBe(200);

    // Victim's sessions are revoked; a fresh login still works but actions are blocked (balances stay readable).
    const stale = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: victim.refreshToken } });
    expect(stale.statusCode).toBe(401);
    const relogin = await login(app, '+919222222227');
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(relogin.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.status).toBe('SUSPENDED');
    const blocked = await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(relogin.accessToken), payload: { role: 'CUSTOMER' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('AUTH_SUSPENDED');

    const logs = await app.inject({ method: 'GET', url: `/admin/audit-logs?entityType=user&entityId=${victim.user.id}`, headers: bearer(admin.accessToken) });
    expect(logs.statusCode).toBe(200);
    const actions = logs.json().items.map((l: { action: string }) => l.action);
    expect(actions).toContain('admin.user.suspended');
    const entry = logs.json().items.find((l: { action: string }) => l.action === 'admin.user.suspended');
    expect(entry.reason).toBe('Repeated no-shows confirmed by support');
    expect(entry.actorUserId).toBe(admin.user.id);

    const supportLogs = await app.inject({ method: 'GET', url: '/admin/audit-logs', headers: bearer(support.accessToken) });
    expect(supportLogs.statusCode).toBe(403);

    const reactivated = await app.inject({ method: 'POST', url: `/admin/users/${victim.user.id}/reactivate`, headers: bearer(admin.accessToken), payload: { reason: 'Appeal accepted' } });
    expect(reactivated.statusCode).toBe(200);
  });

  it('an admin cannot suspend themselves', async () => {
    const admin = await login(app, PHONES.admin);
    const r = await app.inject({ method: 'POST', url: `/admin/users/${admin.user.id}/suspend`, headers: bearer(admin.accessToken), payload: { reason: 'oops mistake' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('consents and deletion (PRI-01/02)', () => {
  it('records consent changes and schedules anonymisation on delete', async () => {
    const u = await login(app, '+919222222228');
    const c = await app.inject({ method: 'POST', url: '/me/consents', headers: bearer(u.accessToken), payload: { type: 'MARKETING', version: '2026-09', granted: false } });
    expect(c.statusCode).toBe(201);
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(u.accessToken) });
    expect(me.json().consents[0]).toMatchObject({ type: 'MARKETING', granted: false });
    const del = await app.inject({ method: 'DELETE', url: '/me', headers: bearer(u.accessToken) });
    expect(del.statusCode).toBe(200);
    expect(del.json().retained).toMatch(/Financial/);
    const after = await app.inject({ method: 'GET', url: '/me', headers: bearer(u.accessToken) });
    // Access token is still cryptographically valid until expiry but the account shows scheduled deletion.
    expect(after.json().user.status).toBe('DELETION_SCHEDULED');
  });
});

describe('categories', () => {
  it('lists only enabled categories with localised names', async () => {
    const en = await app.inject({ method: 'GET', url: '/categories' });
    expect(en.json().items.map((c: { slug: string }) => c.slug)).toEqual(['plumbing', 'electrical', 'carpentry']);
    const hi = await app.inject({ method: 'GET', url: '/categories', headers: { 'accept-language': 'hi' } });
    expect(hi.json().items[0].name).toBe('प्लंबिंग');
  });
});
