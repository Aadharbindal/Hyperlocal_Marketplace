import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

/**
 * The map-backed address picker's two server calls.
 *
 * The thing these tests are really guarding is honesty. The pilot area is a 3 km circle and the
 * maps adapter in this suite is the mock, so every assertion below is about the API saying so out
 * loud rather than letting the client assume a working Google integration and a nationwide
 * footprint. A reverse geocode that quietly returned a confident-looking address from no data at
 * all would pass a naive test and get somebody sent to the wrong house.
 */

let app: TestApp;
let headers: Record<string, string>;

/** The seeded pilot centre - Connaught Place, Delhi. */
const CENTRE = { lat: 28.6139, lng: 77.209 };

beforeAll(async () => {
  app = await makeApp();
  const cust = await login(app, '+919810000701');
  headers = bearer(cust.accessToken);
  await app.inject({ method: 'POST', url: '/me/roles', headers, payload: { role: 'CUSTOMER' } });
});
afterAll(async () => {
  await app.close();
});

describe('service area', () => {
  it('is readable without signing in, so the app can say "not your city yet" before the OTP', async () => {
    const res = await app.inject({ method: 'GET', url: '/geo/service-area' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ radiusKm: 3, city: 'Delhi' });
    expect(res.json().centre).toMatchObject(CENTRE);
  });

  it('admits that maps are mocked', async () => {
    const res = await app.inject({ method: 'GET', url: '/geo/service-area' });
    // If this ever reads true in the test suite, something has started claiming a live integration
    // that has no API key behind it.
    expect(res.json().mapsLive).toBe(false);
  });
});

describe('resolving a dragged pin', () => {
  it('turns the centre of the pilot zone into something saveable', async () => {
    const res = await app.inject({ method: 'POST', url: '/geo/resolve-point', headers, payload: CENTRE });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.inServiceArea).toBe(true);
    expect(b.distanceFromCentreKm).toBe(0);
    expect(b.formatted).toBeTruthy();
    expect(b.city).toBe('Delhi');
  });

  it('marks the mock answer coarse, so the picker asks instead of asserting', async () => {
    const res = await app.inject({ method: 'POST', url: '/geo/resolve-point', headers, payload: CENTRE });
    expect(res.json().coarse).toBe(true);
  });

  it('returns a PIN code the address contract would actually accept', async () => {
    const res = await app.inject({ method: 'POST', url: '/geo/resolve-point', headers, payload: CENTRE });
    const pincode = res.json().pincode as string;
    // Same shape `checkPincode` enforces. A prefilled PIN that the save endpoint then rejects is a
    // dead end the person cannot get out of without guessing what we wanted.
    expect(pincode).toMatch(/^[1-8]\d{5}$/);
    const save = await app.inject({
      method: 'POST', url: '/me/addresses', headers,
      payload: { line1: '7, Barakhamba Road', city: res.json().city, pincode, lat: CENTRE.lat, lng: CENTRE.lng },
    });
    expect(save.statusCode).toBe(201);
  });

  it('says a point outside the circle is outside it, before anything is typed', async () => {
    // ~11 km north of the centre: well past the 3 km pilot radius.
    const res = await app.inject({ method: 'POST', url: '/geo/resolve-point', headers, payload: { lat: 28.714, lng: 77.209 } });
    const b = res.json();
    expect(b.inServiceArea).toBe(false);
    expect(b.distanceFromCentreKm).toBeGreaterThan(10);
  });

  it('keeps an address saved from a confirmed pin at exactly that pin', async () => {
    // The whole point of the picker: the person's coordinates win, and no geocoder gets a second
    // opinion on where their gate is.
    const point = { lat: 28.6201, lng: 77.2155 };
    const res = await app.inject({
      method: 'POST', url: '/me/addresses', headers,
      payload: { label: 'Home', line1: 'B-14, Hailey Road', city: 'Delhi', pincode: '110001', ...point },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().lat).toBeCloseTo(point.lat, 6);
    expect(res.json().lng).toBeCloseTo(point.lng, 6);
    expect(res.json().inPilotZone).toBe(true);
  });

  it('refuses coordinates that are not coordinates', async () => {
    const res = await app.inject({ method: 'POST', url: '/geo/resolve-point', headers, payload: { lat: 91, lng: 77.2 } });
    expect(res.statusCode).toBe(400);
  });

  it('will not resolve a point for an anonymous caller', async () => {
    // A precise location is not something an unauthenticated caller gets to post at us, and each
    // call costs money upstream once the real key is in place.
    const res = await app.inject({ method: 'POST', url: '/geo/resolve-point', payload: CENTRE });
    expect(res.statusCode).toBe(401);
  });
});
