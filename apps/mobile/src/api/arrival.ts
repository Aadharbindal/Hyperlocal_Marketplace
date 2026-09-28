import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ArrivalView } from '@hyperlocal/core';
import { api } from './client';

/**
 * Telling the customer how far away you are, and being told how far away they are.
 *
 * Two halves of one feature and they are deliberately asymmetric. The provider's side sends a
 * position and is told nothing back; the customer's side receives a distance and never a
 * position. That asymmetry is the privacy design, not an oversight.
 */

/** How often a position goes up while somebody is on their way. */
const REPORT_EVERY_MS = 25_000;

/**
 * How often the customer's screen asks. Faster than the reports, so the countdown moves rather
 * than jumping, and cheap because the answer is two numbers.
 */
const POLL_EVERY_MS = 15_000;

/**
 * `expo-location` loaded lazily, exactly like `expo-notifications`.
 *
 * The same lesson: a static import that throws on load takes the whole module's exports with it,
 * and the screen renders blank with an error about something unrelated. A phone with location
 * services disabled, a de-Googled device or a restricted work profile are all ordinary, and the
 * job must still be workable without this.
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

export function useArrival(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['arrival', jobId],
    enabled,
    queryFn: () => api<ArrivalView>(`/jobs/${jobId}/arrival`),
    refetchInterval: enabled ? POLL_EVERY_MS : false,
    // A distance from ten seconds ago is not worth keeping when the screen reopens.
    staleTime: 0,
    gcTime: 0,
  });
}

export function useReportPosition() {
  return useMutation({
    mutationFn: (input: { jobId: string; lat: number; lng: number; accuracyM: number }) =>
      api<void>(`/jobs/${input.jobId}/position`, {
        method: 'POST',
        body: { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM },
      }),
  });
}

export type SharingState = 'off' | 'asking' | 'denied' | 'unavailable' | 'sharing';

/**
 * Shares the professional's position while - and only while - they are on their way.
 *
 * Three things this deliberately does not do. It does not run in the background: there is no
 * background location permission, no task manager, and closing the app stops it, because a
 * worker should not be trackable by an app they think they have put away. It does not ask for
 * permission on mount, only when a job actually goes EN_ROUTE, so the prompt arrives with a
 * reason attached. And it stops the instant `active` goes false, which the caller ties to the
 * job status - so arriving ends it without anything needing to remember to.
 */
export function useShareArrivalPosition(jobId: string, active: boolean) {
  const report = useReportPosition();
  const [state, setState] = useState<SharingState>('off');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };

    if (!active) {
      stop();
      setState('off');
      return;
    }

    const Location = loadLocation();
    if (!Location) {
      setState('unavailable');
      return;
    }

    void (async () => {
      setState('asking');
      // Foreground only. `requestBackgroundPermissionsAsync` is never called anywhere in this
      // app, and that is a deliberate product decision rather than an omission.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!perm.granted) {
        setState('denied');
        return;
      }
      setState('sharing');

      const send = async () => {
        // Nothing is sent while the app is not in front. The operating system may allow a last
        // reading; not taking it is the point.
        if (AppState.currentState !== 'active') return;
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          await report.mutateAsync({
            jobId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Math.round(pos.coords.accuracy ?? 0),
          });
        } catch {
          // A failed reading or a failed request is not worth telling anybody about: the next
          // one is twenty-five seconds away, and the customer's screen already knows how to say
          // "we have lost them" on its own.
        }
      };

      await send();
      if (cancelled) return;
      timer.current = setInterval(() => void send(), REPORT_EVERY_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // Deliberately only [jobId, active]. `report` is recreated each render, and depending on it
    // would tear down and restart the interval constantly - the position would go up far more
    // often than every twenty-five seconds, which is the opposite of what this is for.
  }, [jobId, active]);

  return state;
}
