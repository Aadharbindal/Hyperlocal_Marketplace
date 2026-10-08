import { approximate, haversineKm, type LatLng } from '../geo/geo';

/**
 * "How far away are they?" - the question every customer asks while waiting at home.
 *
 * The booking has an EN_ROUTE status and, until now, nothing behind it: the app said "on the
 * way" and could not say whether that meant five minutes or fifty. Somebody who has taken the
 * afternoon off to wait for a plumber is entitled to a better answer than a word.
 *
 * This file is also where the restraint lives. Live location is the most sensitive thing this
 * product handles after identity documents, and it is a **professional's** location - a worker
 * being tracked by the platform they earn from. Every rule below narrows it:
 *
 *   - only between setting off and arriving, never before and never after
 *   - only the latest position, never a trail
 *   - rounded to roughly a hundred metres before it is stored, so a doorway never exists to leak
 *   - only to the customer on that booking, never on the shareable tracking link
 *   - and nothing at all once it has gone stale
 *   - and it goes stale honestly rather than showing an old dot as though it were live
 */

/** How coarse a stored position is. Three decimals is ~110 m - a street, not a doorway. */
export const LOCATION_PRECISION_DECIMALS = 3;

/**
 * After this long with no update, we stop claiming to know where somebody is.
 *
 * A stale dot presented as live is worse than no dot: the customer plans around it. Phones lose
 * signal in basements and lifts constantly, so this is a normal state to be in, not an error.
 */
export const PING_STALE_AFTER_SECONDS = 180;

/**
 * Assumed speed through a dense Indian city, on a two-wheeler carrying tools.
 *
 * Deliberately pessimistic. An ETA that is early makes somebody stand at the door; an ETA that
 * is late costs nothing but a pleasant surprise, so the error is pointed the harmless way.
 */
export const ASSUMED_SPEED_KMPH = 18;

/** Nothing under this is worth counting down. "Arriving now" is the honest answer. */
export const ARRIVING_NOW_METRES = 250;

export interface LocationPing {
  at: Date;
  point: LatLng;
  /** Metres of uncertainty the phone reported. A wild value is a reason not to show anything. */
  accuracyM: number;
}

/** What the customer's screen is allowed to say. */
export type ArrivalState =
  | { kind: 'NOT_TRACKING' }
  | { kind: 'ARRIVING_NOW'; point: LatLng }
  | { kind: 'ON_THE_WAY'; distanceKm: number; etaMinutes: number; point: LatLng }
  /**
   * Deliberately without a point.
   *
   * This is the state where we have not heard from the phone in three minutes, and the last thing
   * to do with a position that old is draw it on a map, where a dot looks exactly as live as a live
   * one. The card says we have lost the signal and shows nothing.
   */
  | { kind: 'STALE'; lastSeenSecondsAgo: number };

/** Coordinates are blunted before they are stored, not on the way out. */
export function blunt(point: LatLng): LatLng {
  return approximate(point, LOCATION_PRECISION_DECIMALS);
}

/**
 * Whether a professional's phone should be sending position at all.
 *
 * The single gate, so that adding a status later cannot accidentally widen it: EN_ROUTE and
 * nothing else. ARRIVED means they are at the door and there is nothing left to answer.
 */
export function shouldTrack(jobStatus: string): boolean {
  return jobStatus === 'EN_ROUTE';
}

export function etaMinutesFor(distanceKm: number, speedKmph = ASSUMED_SPEED_KMPH): number {
  if (!(distanceKm > 0) || !(speedKmph > 0)) return 0;
  // Rounded up: telling somebody four minutes when it is four and a half is how they end up
  // standing at an open door.
  return Math.max(1, Math.ceil((distanceKm / speedKmph) * 60));
}

/**
 * Turns the last known position into the one sentence the customer sees.
 *
 * Returns NOT_TRACKING rather than throwing for every "we cannot say" case, because on this
 * screen not knowing is an ordinary outcome and has to render as calmly as knowing.
 */
export function arrivalState(input: {
  jobStatus: string;
  ping: LocationPing | null;
  destination: LatLng | null;
  now?: Date;
}): ArrivalState {
  const now = input.now ?? new Date();
  if (!shouldTrack(input.jobStatus) || !input.ping || !input.destination) return { kind: 'NOT_TRACKING' };

  // A phone that reports half a kilometre of uncertainty is guessing from cell towers. Using it
  // would produce a confident number built on nothing.
  if (!(input.ping.accuracyM >= 0) || input.ping.accuracyM > 500) return { kind: 'NOT_TRACKING' };

  const ageSeconds = Math.max(0, Math.round((now.getTime() - input.ping.at.getTime()) / 1000));
  if (ageSeconds > PING_STALE_AFTER_SECONDS) return { kind: 'STALE', lastSeenSecondsAgo: ageSeconds };

  const distanceKm = haversineKm(input.ping.point, input.destination);
  if (distanceKm * 1000 <= ARRIVING_NOW_METRES) return { kind: 'ARRIVING_NOW', point: input.ping.point };

  return {
    kind: 'ON_THE_WAY',
    // The already-blunted stored position, passed straight through. `blunt` ran before this was
    // written to the database, so there is no second rounding to do here and nothing sharper than
    // ~110 m exists to leak.
    point: input.ping.point,
    // One decimal. The stored position is only accurate to ~110 m, so more digits would be a
    // precision the number does not have.
    distanceKm: Math.round(distanceKm * 10) / 10,
    etaMinutes: etaMinutesFor(distanceKm),
  };
}

/**
 * Whether this viewer may see a live position at all.
 *
 * The shareable tracking link is explicitly excluded. That URL exists to be forwarded - to a
 * neighbour, a parent, a building guard - and a forwarded link that carries somebody's live
 * position is a way to follow a worker around a city. The link says "on the way" and stops.
 */
export function maySeeLiveLocation(viewer: 'CUSTOMER' | 'PROVIDER' | 'SUPPORT' | 'TRACKING_LINK'): boolean {
  return viewer === 'CUSTOMER' || viewer === 'SUPPORT';
}
