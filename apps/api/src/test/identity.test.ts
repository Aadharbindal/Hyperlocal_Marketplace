import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * The account a person actually has, rather than the row we created for their phone number.
 *
 * For most of this project's life `display_name`, `avatar_url` and an email column existed in the
 * schema and nothing ever wrote to any of them, so every profile in the app rendered a masked
 * phone number and every greeting said "Good evening," to nobody. These tests exist to keep that
 * from being true again: they assert the fields are reachable, that changing an email un-verifies
 * it, and that the avatar key cannot be pointed at somebody else's files.
 */

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

/** A signed-in account with the CUSTOMER role, on a number no other test is using. */
async function freshCustomer(phone: string) {
  const s = await login(app, phone);
  await app.inject({ method: 'POST', url: '/me/roles', payload: { role: 'CUSTOMER' }, headers: bearer(s.accessToken) });
  return s;
}

describe('completing a profile after signup', () => {
  it('records the name, the email and the terms version in one request', async () => {
    const s = await freshCustomer('+919222000001');

    const r = await app.inject({
      method: 'POST',
      url: '/me/complete-profile',
      payload: { displayName: 'Aadhar Bindal', email: 'Aadhar.Test@Example.com', acceptedTermsVersion: '1.0', marketingOptIn: false },
      headers: bearer(s.accessToken),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.displayName).toBe('Aadhar Bindal');
    // Lower-cased on the way in, so it matches the way the unique index compares addresses.
    expect(r.json().user.email).toBe('aadhar.test@example.com');
    // Typed, not confirmed.
    expect(r.json().user.emailVerified).toBe(false);

    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(s.accessToken) });
    expect(me.json().user.displayName).toBe('Aadhar Bindal');
    const terms = me.json().consents.find((c: { type: string }) => c.type === 'TERMS');
    expect(terms).toMatchObject({ version: '1.0', granted: true });
    // Declining marketing is recorded, not merely absent: "never opted in" and "never asked" are
    // different facts and only one of them is a defence.
    expect(me.json().consents.find((c: { type: string }) => c.type === 'MARKETING')).toMatchObject({ granted: false });
  });

  it('refuses a name that is not one', async () => {
    const s = await freshCustomer('+919222000002');
    const r = await app.inject({
      method: 'POST',
      url: '/me/complete-profile',
      payload: { displayName: 'A', acceptedTermsVersion: '1.0' },
      headers: bearer(s.accessToken),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps the name the provider is shown in step with the name on the account', async () => {
    const s = await freshCustomer('+919222000003');
    await app.inject({
      method: 'POST',
      url: '/me/complete-profile',
      payload: { displayName: 'First Name', acceptedTermsVersion: '1.0' },
      headers: bearer(s.accessToken),
    });
    await app.inject({ method: 'PATCH', url: '/me', payload: { displayName: 'Second Name' }, headers: bearer(s.accessToken) });

    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(s.accessToken) });
    expect(me.json().user.displayName).toBe('Second Name');
    // The copy on the customer profile is what appears on the job card at somebody's door.
    expect(me.json().profiles.customer.fullName).toBe('Second Name');
  });
});

describe('email', () => {
  it('refuses an address that is already on another account', async () => {
    const a = await freshCustomer('+919222000004');
    const b = await freshCustomer('+919222000005');
    await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'shared@example.com' }, headers: bearer(a.accessToken) });

    const r = await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'Shared@Example.com' }, headers: bearer(b.accessToken) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('EMAIL_IN_USE');
  });

  it('drops the verified flag when the address changes', async () => {
    const s = await freshCustomer('+919222000006');
    await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'before@example.com' }, headers: bearer(s.accessToken) });

    // Verified out of band, the way a confirmation link would.
    const user = await app.ctx.store.users.findById(s.user.id);
    await app.ctx.store.users.update(s.user.id, { email_verified_at: new Date() });
    expect(user).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(s.accessToken) })).json().user.emailVerified).toBe(true);

    await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'after@example.com' }, headers: bearer(s.accessToken) });
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(s.accessToken) });
    expect(me.json().user.email).toBe('after@example.com');
    // Without this the new address would inherit the old one's tick and the flag would mean nothing.
    expect(me.json().user.emailVerified).toBe(false);
  });

  it('rejects something that is not an address', async () => {
    const s = await freshCustomer('+919222000007');
    const r = await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'not-an-email' }, headers: bearer(s.accessToken) });
    expect(r.statusCode).toBe(400);
  });

  it('lets an address be cleared', async () => {
    const s = await freshCustomer('+919222000008');
    await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'clear@example.com' }, headers: bearer(s.accessToken) });
    const r = await app.inject({ method: 'PATCH', url: '/me', payload: { email: null }, headers: bearer(s.accessToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.email).toBeNull();
  });
});

describe('avatar', () => {
  it('issues an upload target under a key scoped to the account', async () => {
    const s = await freshCustomer('+919222000009');
    const r = await app.inject({ method: 'POST', url: '/me/avatar', payload: { mime: 'image/jpeg', bytes: 40_000 }, headers: bearer(s.accessToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json().key.startsWith(`avatars/${s.user.id}/`)).toBe(true);
    expect(r.json().method).toBe('PUT');
  });

  it('refuses a key belonging to somebody else', async () => {
    const a = await freshCustomer('+919222000010');
    const b = await freshCustomer('+919222000011');

    // The attack this blocks: point an avatar at another account's identity document and have the
    // API mint a week-long readable link to it.
    const r = await app.inject({
      method: 'PATCH',
      url: '/me',
      payload: { avatarKey: `kyc/${b.user.id}/AADHAAR/1` },
      headers: bearer(a.accessToken),
    });
    expect(r.statusCode).toBe(403);

    const alsoRefused = await app.inject({
      method: 'PATCH',
      url: '/me',
      payload: { avatarKey: `avatars/${b.user.id}/whatever` },
      headers: bearer(a.accessToken),
    });
    expect(alsoRefused.statusCode).toBe(403);
  });

  it('returns a link rather than the stored key once a photo is committed', async () => {
    const s = await freshCustomer('+919222000012');
    const up = await app.inject({ method: 'POST', url: '/me/avatar', payload: { mime: 'image/png', bytes: 1000 }, headers: bearer(s.accessToken) });
    const { key } = up.json();

    const r = await app.inject({ method: 'PATCH', url: '/me', payload: { avatarKey: key }, headers: bearer(s.accessToken) });
    expect(r.statusCode).toBe(200);
    const url: string = r.json().user.avatarUrl;
    // The column holds the key; what goes over the wire is something an <Image> can load.
    expect(url).toBeTruthy();
    expect(url).not.toBe(key);
    expect(url.startsWith('http')).toBe(true);
  });
});

describe('emergency contacts', () => {
  it('saves a contact and returns the number masked', async () => {
    const s = await freshCustomer('+919222000013');
    const r = await app.inject({
      method: 'POST',
      url: '/me/emergency-contacts',
      payload: { name: 'Priya', phone: '+919812345678', relationship: 'sister' },
      headers: bearer(s.accessToken),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().contact.name).toBe('Priya');
    // Masked like every other number this API returns, even though the customer typed it.
    expect(r.json().contact.phoneMasked).not.toContain('812345');

    const list = await app.inject({ method: 'GET', url: '/me/emergency-contacts', headers: bearer(s.accessToken) });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().limit).toBe(3);
  });

  it('stops at three', async () => {
    const s = await freshCustomer('+919222000014');
    for (const n of ['+919812345601', '+919812345602', '+919812345603']) {
      const ok = await app.inject({ method: 'POST', url: '/me/emergency-contacts', payload: { name: 'Contact', phone: n }, headers: bearer(s.accessToken) });
      expect(ok.statusCode).toBe(201);
    }
    const fourth = await app.inject({
      method: 'POST',
      url: '/me/emergency-contacts',
      payload: { name: 'One More', phone: '+919812345604' },
      headers: bearer(s.accessToken),
    });
    expect(fourth.statusCode).toBe(422);
    expect(fourth.json().error.code).toBe('CONTACT_LIMIT_REACHED');
  });

  it('will not delete a contact belonging to another account', async () => {
    const a = await freshCustomer('+919222000015');
    const b = await freshCustomer('+919222000016');
    const made = await app.inject({ method: 'POST', url: '/me/emergency-contacts', payload: { name: 'Theirs', phone: '+919812345611' }, headers: bearer(a.accessToken) });
    const id = made.json().contact.id;

    // Deliberately not a 404: the delete is scoped by user id, so from b's side there is simply
    // nothing there to remove, and saying "not found" versus "forbidden" would confirm it exists.
    await app.inject({ method: 'DELETE', url: `/me/emergency-contacts/${id}`, headers: bearer(b.accessToken) });
    const stillThere = await app.inject({ method: 'GET', url: '/me/emergency-contacts', headers: bearer(a.accessToken) });
    expect(stillThere.json().items).toHaveLength(1);
  });
});
