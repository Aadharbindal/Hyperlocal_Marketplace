import AsyncStorage from '@react-native-async-storage/async-storage';
import { newIdempotencyKey } from './ids';

/**
 * Actions taken while the connection was gone.
 *
 * Until now a tap that landed as the lift doors closed simply vanished, with an error toast and
 * nothing else - so somebody marking a job done in a basement had to remember to do it again.
 *
 * Three decisions worth stating, because they are what make this safe rather than merely
 * convenient:
 *
 * 1. **Only writes that are safe to repeat go in here.** Every queued request carries an
 *    idempotency key from the moment it is created, not from the moment it is sent, so a retry
 *    after a reply we never saw cannot produce a second booking or a second payment.
 * 2. **Money never queues.** Accepting an offer, authorising a payment and anything that moves
 *    a rupee is deliberately excluded. A person needs to watch those succeed or fail while they
 *    are looking at the screen - "we will send this later" is not an acceptable answer about
 *    somebody's money.
 * 3. **It gives up rather than retrying forever.** A request the server rejected on its merits
 *    is dropped, because retrying a 400 produces a 400. Only genuine network failures are kept.
 */

const KEY = 'outbox.v1';
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 3600_000;

export interface OutboxEntry {
  id: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey: string;
  /** What the person did, in their words, so the app can say what is waiting. */
  label: string;
  attempts: number;
  queuedAt: number;
  lastError?: string;
}

/**
 * The paths that may be queued. An allow-list rather than a deny-list on purpose: a new endpoint
 * is not silently queueable, somebody has to decide it is safe to repeat.
 */
const QUEUEABLE: Array<{ test: RegExp; label: string }> = [
  { test: /^\/jobs\/[^/]+\/progress$/, label: 'Status update' },
  { test: /^\/jobs\/[^/]+\/chat$/, label: 'Message' },
  { test: /^\/jobs\/[^/]+\/evidence$/, label: 'Photo' },
  { test: /^\/jobs\/[^/]+\/complete$/, label: 'Job marked done' },
  { test: /^\/me\/notifications\/read$/, label: 'Read receipts' },
  { test: /^\/me\/devices$/, label: 'Device registration' },
  { test: /^\/provider\/availability$/, label: 'Availability' },
];

export function isQueueable(path: string, method: string): { label: string } | null {
  if (method === 'GET') return null;
  const match = QUEUEABLE.find((q) => q.test.test(path.split('?')[0] ?? path));
  return match ? { label: match.label } : null;
}

async function read(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    // A corrupt outbox is better dropped than allowed to block every future write.
    return [];
  }
}

async function write(entries: OutboxEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Nothing useful to do: the action already failed once, and losing the queue is not worse
    // than crashing here.
  }
}

export async function enqueue(input: {
  path: string;
  method: OutboxEntry['method'];
  body?: unknown;
  idempotencyKey?: string;
  label: string;
}): Promise<void> {
  const entries = await read();
  entries.push({
    id: newIdempotencyKey(),
    path: input.path,
    method: input.method,
    body: input.body,
    // Generated here if the caller had none, so the retry is the *same* request rather than a
    // second one that happens to look similar.
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    label: input.label,
    attempts: 0,
    queuedAt: Date.now(),
  });
  await write(entries);
}

export async function pending(): Promise<OutboxEntry[]> {
  return read();
}

export async function clear(): Promise<void> {
  await write([]);
}

/**
 * Sends what is waiting, oldest first, and stops at the first network failure - if one request
 * cannot reach the server, neither can the next, and hammering a dead connection helps nobody.
 */
export async function flush(
  send: (entry: OutboxEntry) => Promise<void>,
): Promise<{ sent: number; dropped: number; remaining: number }> {
  const entries = await read();
  if (entries.length === 0) return { sent: 0, dropped: 0, remaining: 0 };

  const keep: OutboxEntry[] = [];
  let sent = 0;
  let dropped = 0;
  let offline = false;

  for (const entry of entries) {
    if (offline) {
      keep.push(entry);
      continue;
    }
    // A day-old status update is no longer news, and sending it would tell the customer
    // something that stopped being true yesterday.
    if (Date.now() - entry.queuedAt > MAX_AGE_MS) {
      dropped++;
      continue;
    }

    try {
      await send(entry);
      sent++;
    } catch (error) {
      const isNetwork = (error as { code?: string })?.code === 'NETWORK';
      if (isNetwork) {
        // Still offline. Keep this and everything after it, untouched.
        offline = true;
        keep.push(entry);
        continue;
      }
      // The server answered and said no. Retrying a 400 produces a 400, so this is dropped
      // rather than kept forever - except for a server-side fault, which may pass.
      const status = (error as { status?: number })?.status ?? 0;
      const worthRetrying = status >= 500 && entry.attempts + 1 < MAX_ATTEMPTS;
      if (worthRetrying) {
        keep.push({ ...entry, attempts: entry.attempts + 1, lastError: String((error as Error)?.message ?? 'failed') });
      } else {
        dropped++;
      }
    }
  }

  await write(keep);
  return { sent, dropped, remaining: keep.length };
}
