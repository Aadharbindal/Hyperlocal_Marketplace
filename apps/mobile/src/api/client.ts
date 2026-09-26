import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ApiError as ApiErrorBody, ErrorCode } from '@hyperlocal/core';
import { enqueue, flush, isQueueable } from './outbox';
import { useSession } from '@/store/session';

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // On a physical device "localhost" is the phone itself; use the Metro host instead.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web') return `http://${host}:4000`;
  return 'http://localhost:4000';
}

export const API_URL = resolveBaseUrl();

export class ApiError extends Error {
  code: ErrorCode | 'NETWORK' | 'UNKNOWN';
  status: number;
  details: unknown;
  requestId?: string;
  constructor(code: ApiError['code'], message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
  _retry?: boolean;
  /** Set when the outbox is replaying: it must never queue its own retry back into itself. */
  _replaying?: boolean;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken, setTokens, signOut } = useSession.getState();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        await signOut();
        return false;
      }
      const json = (await res.json()) as { accessToken: string; refreshToken: string };
      await setTokens(json);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Typed fetch wrapper: auth header, active-role header, language, refresh-on-401, error mapping. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { accessToken, activeRole, language } = useSession.getState();
  const headers: Record<string, string> = { accept: 'application/json', 'accept-language': language };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (activeRole) headers['x-active-role'] = activeRole;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch (e) {
    const method = opts.method ?? 'GET';
    // A tap that landed as the lift doors closed used to simply vanish. Writes that are safe to
    // repeat are kept instead, with the idempotency key they already had - so the retry is the
    // same request rather than a second one that looks similar.
    //
    // Money is deliberately not in the allow-list: a person needs to watch a payment succeed or
    // fail while they are looking at it, and "we will send this later" is not an acceptable
    // answer about somebody's money.
    const queueable = opts._replaying ? null : isQueueable(path, method);
    if (queueable) {
      await enqueue({
        path,
        method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        body: opts.body,
        idempotencyKey: opts.idempotencyKey,
        label: queueable.label,
      });
      throw new ApiError('NETWORK', 'Saved. We will send this the moment you are back online.', 0, e);
    }
    throw new ApiError('NETWORK', 'Network request failed', 0, e);
  }

  if (res.status === 401 && opts.auth !== false && !opts._retry && (await tryRefresh())) {
    return api<T>(path, { ...opts, _retry: true });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? 'UNKNOWN', err?.message ?? `Request failed (${res.status})`, res.status, err?.details, err?.requestId);
  }
  return json as T;
}

/**
 * Replays whatever the outbox is holding. Called when the connection returns; safe to call at
 * any time, because an empty outbox does nothing.
 */
export async function flushOutbox() {
  return flush((entry) =>
    api(entry.path, {
      method: entry.method,
      body: entry.body,
      idempotencyKey: entry.idempotencyKey,
      _replaying: true,
    }).then(() => undefined),
  );
}

export { newIdempotencyKey } from './ids';
