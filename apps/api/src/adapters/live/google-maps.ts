import type { Env } from '../../config/env';
import type { GeocodeResult, MapsAdapter } from '../types';
import { request, requireEnv } from './http';

const BASE = 'https://maps.googleapis.com/maps/api/geocode/json';

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number }; location_type: string };
    address_components: Array<{ long_name: string; types: string[] }>;
  }>;
}

/** Google's own confidence, translated into the three levels the job flow reasons about. */
function confidenceOf(locationType: string): GeocodeResult['confidence'] {
  if (locationType === 'ROOFTOP') return 'HIGH';
  if (locationType === 'RANGE_INTERPOLATED' || locationType === 'GEOMETRIC_CENTER') return 'MEDIUM';
  return 'LOW';
}

/**
 * Google Maps geocoding.
 *
 * Distance between two points stays as the haversine calculation in `core/geo`: it needs no
 * network, no key and no per-call cost, and for a 3 km pilot radius the difference from a
 * routed distance is not worth the dependency. If routing ever matters, it belongs here as a
 * separate method rather than inside the matching rules.
 */
export function googleMaps(env: Env): MapsAdapter {
  const creds = requireEnv('google maps', { MAPS_API_KEY: env.MAPS_API_KEY });

  async function geocodeQuery(query: string): Promise<GeocodeResponse> {
    const url = `${BASE}?address=${encodeURIComponent(query)}&region=in&key=${creds.MAPS_API_KEY}`;
    const res = await request<GeocodeResponse>('google-maps', url, { timeoutMs: 6000 });
    if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS') {
      throw new Error(`google maps: ${res.status}${res.error_message ? ` - ${res.error_message}` : ''}`);
    }
    return res;
  }

  return {
    name: 'maps',
    provider: 'google',
    isMock: false,

    async health() {
      try {
        const res = await geocodeQuery(`${env.PILOT_CITY}, India`);
        return { ok: res.results.length > 0 };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
      }
    },

    async geocode(address) {
      const query = [address.line1, address.line2, address.city, address.pincode, 'India'].filter(Boolean).join(', ');
      const res = await geocodeQuery(query);
      const best = res.results[0];
      if (!best) throw new Error('google maps could not place that address');
      return {
        lat: best.geometry.location.lat,
        lng: best.geometry.location.lng,
        formatted: best.formatted_address,
        confidence: confidenceOf(best.geometry.location_type),
      };
    },

    async reverseGeocode(point) {
      const url = `${BASE}?latlng=${point.lat},${point.lng}&region=in&key=${creds.MAPS_API_KEY}`;
      const res = await request<GeocodeResponse>('google-maps', url, { timeoutMs: 6000 });
      const best = res.results[0];
      if (!best) return { formatted: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` };
      const pincode = best.address_components.find((c) => c.types.includes('postal_code'))?.long_name;
      return { formatted: best.formatted_address, pincode };
    },
  };
}
