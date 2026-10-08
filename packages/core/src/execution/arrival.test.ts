import { describe, expect, it } from 'vitest';
import {
  ARRIVING_NOW_METRES,
  PING_STALE_AFTER_SECONDS,
  arrivalState,
  blunt,
  etaMinutesFor,
  maySeeLiveLocation,
  shouldTrack,
} from './arrival';

/**
 * Half of these are about answering the customer's question and half are about refusing to
 * answer it. The refusals matter more: this is a worker's live position, and every case below
 * where the honest output is "we cannot say" is a case where a more helpful-looking answer would
 * have been either a lie or a surveillance feature.
 */

const HOME = { lat: 28.5921, lng: 77.2195 };
const ping = (over: Partial<{ at: Date; point: { lat: number; lng: number }; accuracyM: number }> = {}) => ({
  at: new Date(),
  point: { lat: 28.6, lng: 77.22 },
  accuracyM: 20,
  ...over,
});

describe('when a phone should be reporting position at all', () => {
  it('is on the way, and nothing else', () => {
    expect(shouldTrack('EN_ROUTE')).toBe(true);
    // Not before they set off, and not once they are at the door. ARRIVED in particular: there
    // is nothing left to answer and the tracking would just be following somebody at a house.
    for (const s of ['CONFIRMED', 'PROVIDER_ASSIGNED', 'ARRIVED', 'STARTED', 'IN_PROGRESS', 'COMPLETED']) {
      expect(shouldTrack(s)).toBe(false);
    }
  });
});

describe('what the customer is told', () => {
  it('gives a distance and a time while they are on the way', () => {
    const s = arrivalState({ jobStatus: 'EN_ROUTE', ping: ping(), destination: HOME });
    expect(s.kind).toBe('ON_THE_WAY');
    if (s.kind === 'ON_THE_WAY') {
      expect(s.distanceKm).toBeGreaterThan(0);
      expect(s.etaMinutes).toBeGreaterThanOrEqual(1);
    }
  });

  it('says "arriving now" instead of counting down the last few metres', () => {
    const almost = { lat: HOME.lat + 0.001, lng: HOME.lng };
    expect(arrivalState({ jobStatus: 'EN_ROUTE', ping: ping({ point: almost }), destination: HOME }).kind).toBe('ARRIVING_NOW');
    expect(ARRIVING_NOW_METRES).toBeGreaterThan(0);
  });

  it('admits when it has lost them rather than showing an old position as live', () => {
    // Phones lose signal in basements and lifts constantly. A stale dot presented as live is
    // worse than no dot, because the customer plans around it.
    const old = new Date(Date.now() - (PING_STALE_AFTER_SECONDS + 10) * 1000);
    const s = arrivalState({ jobStatus: 'EN_ROUTE', ping: ping({ at: old }), destination: HOME });
    expect(s.kind).toBe('STALE');
  });

  it('says nothing when the phone is only guessing', () => {
    // Half a kilometre of uncertainty is a cell-tower fix. A confident "2 km away" built on that
    // is a number with nothing behind it.
    expect(arrivalState({ jobStatus: 'EN_ROUTE', ping: ping({ accuracyM: 900 }), destination: HOME }).kind).toBe('NOT_TRACKING');
  });

  it('says nothing when there is no position, no destination, or the job is not on the way', () => {
    expect(arrivalState({ jobStatus: 'EN_ROUTE', ping: null, destination: HOME }).kind).toBe('NOT_TRACKING');
    expect(arrivalState({ jobStatus: 'EN_ROUTE', ping: ping(), destination: null }).kind).toBe('NOT_TRACKING');
    expect(arrivalState({ jobStatus: 'ARRIVED', ping: ping(), destination: HOME }).kind).toBe('NOT_TRACKING');
  });
});

describe('the time estimate', () => {
  it('rounds up, never down', () => {
    // Telling somebody four minutes when it is four and a half is how they end up standing at an
    // open door. The error is pointed the harmless way on purpose.
    expect(etaMinutesFor(1.4, 18)).toBe(5);
    expect(etaMinutesFor(0.01, 18)).toBe(1);
  });

  it('never returns a negative or nonsensical number', () => {
    expect(etaMinutesFor(0)).toBe(0);
    expect(etaMinutesFor(-5)).toBe(0);
    expect(etaMinutesFor(5, 0)).toBe(0);
  });
});

describe('privacy', () => {
  it('blunts a position to roughly a street before it is stored', () => {
    const b = blunt({ lat: 28.59217384, lng: 77.21956211 });
    expect(b).toEqual({ lat: 28.592, lng: 77.22 });
  });

  it('keeps live position off the shareable tracking link', () => {
    // That URL exists to be forwarded - to a neighbour, a parent, a building guard - and a
    // forwarded link carrying a live position is a way to follow a worker around a city.
    expect(maySeeLiveLocation('TRACKING_LINK')).toBe(false);
    expect(maySeeLiveLocation('PROVIDER')).toBe(false);
    expect(maySeeLiveLocation('CUSTOMER')).toBe(true);
    expect(maySeeLiveLocation('SUPPORT')).toBe(true);
  });
});

describe('the point the map draws', () => {
  it('comes back for a live position, exactly as stored', () => {
    const point = { lat: 28.6, lng: 77.22 };
    const s = arrivalState({ jobStatus: 'EN_ROUTE', ping: ping({ point }), destination: HOME });
    expect(s.kind).toBe('ON_THE_WAY');
    // Passed through untouched: `blunt` already ran on the way into the database, so there is no
    // sharper reading in existence for this to be a rounding of.
    expect(s).toMatchObject({ point });
  });

  it('comes back at the door too, so the dot does not vanish on arrival', () => {
    const almost = { lat: HOME.lat + 0.001, lng: HOME.lng };
    const s = arrivalState({ jobStatus: 'EN_ROUTE', ping: ping({ point: almost }), destination: HOME });
    expect(s.kind).toBe('ARRIVING_NOW');
    expect(s).toMatchObject({ point: almost });
  });

  it('is withheld once the position is stale', () => {
    // The whole reason STALE exists. A three-minute-old dot drawn on a map is indistinguishable
    // from a live one, and the customer plans their afternoon around it.
    const old = new Date(Date.now() - (PING_STALE_AFTER_SECONDS + 30) * 1000);
    const s = arrivalState({ jobStatus: 'EN_ROUTE', ping: ping({ at: old }), destination: HOME });
    expect(s.kind).toBe('STALE');
    expect(s).not.toHaveProperty('point');
  });

  it('is withheld entirely when there is nothing worth showing', () => {
    expect(arrivalState({ jobStatus: 'ARRIVED', ping: ping(), destination: HOME })).toEqual({ kind: 'NOT_TRACKING' });
    expect(arrivalState({ jobStatus: 'EN_ROUTE', ping: null, destination: HOME })).toEqual({ kind: 'NOT_TRACKING' });
  });
});
