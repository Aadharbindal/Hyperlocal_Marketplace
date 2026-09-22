import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ApiError as ApiErrorBody, ErrorCode } from '@hyperlocal/core';
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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
  _retry?: boolean;
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

export function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
