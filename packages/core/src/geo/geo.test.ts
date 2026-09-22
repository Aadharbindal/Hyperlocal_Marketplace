import { describe, expect, it } from 'vitest';
import { approximate, geohash, haversineKm, isValidLatLng, isWithinRadius } from './geo';

const connaughtPlace = { lat: 28.6315, lng: 77.2167 };
const indiaGate = { lat: 28.6129, lng: 77.2295 };

describe('geo', () => {
  it('haversine distance between Connaught Place and India Gate is about 2.4 km', () => {
    const d = haversineKm(connaughtPlace, indiaGate);
    expect(d).toBeGreaterThan(2.2);
    expect(d).toBeLessThan(2.6);
  });
  it('radius checks', () => {
    expect(isWithinRadius(connaughtPlace, indiaGate, 3)).toBe(true);
    expect(isWithinRadius(connaughtPlace, indiaGate, 2)).toBe(false);
  });
  it('validates coordinates', () => {
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: NaN })).toBe(false);
    expect(isValidLatLng(indiaGate)).toBe(true);
  });
  it('approximates and geohashes deterministically', () => {
    expect(approximate({ lat: 28.61294, lng: 77.22951 })).toEqual({ lat: 28.613, lng: 77.23 });
    expect(geohash(indiaGate)).toHaveLength(7);
    // Nearby points share a coarse prefix; Delhi cells start with "ttn".
    expect(geohash(indiaGate, 3)).toBe('ttn');
    expect(geohash(indiaGate, 4)).toBe(geohash(connaughtPlace, 4));
  });
});
