import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, ResolvedPointView, ServiceAreaView } from '@hyperlocal/core';
import { api } from './client';

/**
 * The map's two server calls, plus the one-shot "where am I" the picker opens with.
 */

/**
 * The pilot circle, and whether the tiles behind it are real.
 *
 * Cached for the session: a 3 km circle around Connaught Place does not move, and refetching it
 * every time somebody opens the picker is a request that can only ever return the same thing.
 */
export function useServiceArea() {
  return useQuery({
    queryKey: ['service-area'],
    queryFn: () => api<ServiceAreaView>('/geo/service-area'),
    staleTime: Infinity,
  });
}

export function useResolvePoint() {
  return useMutation({
    mutationFn: (point: LatLng) => api<ResolvedPointView>('/geo/resolve-point', { method: 'POST', body: point }),
  });
}

/**
 * `expo-location`, loaded the same lazily-and-forgivingly way `arrival.ts` loads it.
 *
 * Same reason, repeated rather than shared because the two modules have no other business with
 * each other: a static import that throws takes every export in the file with it, and a phone with
 * location services off is an ordinary phone that still has to be able to save an address.
 */
type LocationModule = typeof import('expo-location');
let cached: LocationModule | null | undefined;
function loadLocation(): LocationModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-location') as LocationModule;
  } catch {
    cached = null;
  }
  return cached;
}

export type LocateState = 'idle' | 'asking' | 'locating' | 'denied' | 'unavailable' | 'failed';

/**
 * "Use my current location", as a button rather than something that happens on mount.
 *
 * Deliberately not automatic. A permission sheet that appears the instant a screen opens is how
 * people learn to press Deny without reading, and the picker is perfectly usable by dragging - it
 * starts over the pilot centre, which for this app is a better guess than most. So the prompt
 * arrives when somebody has asked for it, which is also the only moment the reason is obvious.
 *
 * Returns the point rather than storing it. Nothing here keeps a position: the caller moves the
 * camera and the reading is gone.
 */
export function useMyLocation() {
  const [state, setState] = useState<LocateState>('idle');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const locate = useCallback(async (): Promise<LatLng | null> => {
    const Location = loadLocation();
    if (!Location) {
      setState('unavailable');
      return null;
    }
    setState('asking');
    try {
      // Foreground only, as everywhere else in this app.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!alive.current) return null;
      if (!perm.granted) {
        setState('denied');
        return null;
      }
      setState('locating');
      // `High` rather than `Balanced`, unlike the en-route reporting: this is one reading that
      // decides which of four identical gates gets written down, and it is worth the extra second
      // and the extra battery. The en-route case fires every twenty-five seconds and cannot be.
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (!alive.current) return null;
      setState('idle');
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      // Indoors with no fix is the common case and not worth an error dialog - the map is still
      // there to drag.
      if (alive.current) setState('failed');
      return null;
    }
  }, []);

  return { locate, state };
}
