import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { API_URL } from './client';
import { useSession } from '@/store/session';

type EventKind =
  | 'job.updated'
  | 'offer.updated'
  | 'booking.updated'
  | 'execution.updated'
  | 'material.updated'
  | 'chat.message'
  | 'money.updated'
  | 'notification';

interface LiveEvent {
  kind: EventKind;
  jobId?: string;
  at: string;
}

/** What each kind of event makes stale. The event itself never carries data. */
function keysFor(event: LiveEvent): unknown[][] {
  const keys: unknown[][] = [['jobs'], ['me', 'notifications']];
  if (event.jobId) {
    keys.push(
      ['job', event.jobId],
      ['job', event.jobId, 'execution'],
      ['job', event.jobId, 'booking'],
      ['job', event.jobId, 'materials'],
      ['job', event.jobId, 'money'],
      ['job', event.jobId, 'chat'],
      ['job', event.jobId, 'offers'],
    );
  }
  if (event.kind === 'money.updated' || event.kind === 'notification') keys.push(['me', 'earnings']);
  return keys;
}

/**
 * The live connection. An event only says *what* changed, so this marks the matching queries
 * stale and React Query re-reads them from the server: a delayed, duplicated or missed event
 * can never put a wrong number on screen, and a dropped stream just means the next screen
 * focus refetches as before.
 *
 * `EventSource` exists on web and in modern React Native runtimes. Where it does not, this
 * quietly does nothing and the app keeps working off its normal refetch behaviour.
 */
export function useLiveUpdates() {
  const token = useSession((s) => s.accessToken);
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const retryRef = useRef(0);

  useEffect(() => {
    const Source = (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (!token || !Source) return;

    let source: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      // The token goes in the query string because EventSource cannot set headers; it is the
      // short-lived access token, never the refresh token.
      source = new Source(`${API_URL}/events?access_token=${encodeURIComponent(token)}`);

      source.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };

      const onEvent = (raw: MessageEvent) => {
        try {
          const event = JSON.parse(raw.data as string) as LiveEvent;
          for (const key of keysFor(event)) void qc.invalidateQueries({ queryKey: key });
        } catch {
          // A malformed frame is not worth crashing a screen over.
        }
      };
      for (const kind of [
        'job.updated',
        'offer.updated',
        'booking.updated',
        'execution.updated',
        'material.updated',
        'chat.message',
        'money.updated',
        'notification',
      ]) {
        source.addEventListener(kind, onEvent as EventListener);
      }

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (closed) return;
        // Back off, but never so far that the app feels dead.
        retryRef.current = Math.min(retryRef.current + 1, 5);
        reconnect = setTimeout(connect, retryRef.current * 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      source?.close();
      setConnected(false);
    };
  }, [token, qc]);

  return { connected };
}
