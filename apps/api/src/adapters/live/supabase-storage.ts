import type { Env } from '../../config/env';
import type { StorageAdapter } from '../types';
import { request, requireEnv } from './http';

/**
 * Supabase Storage, using signed upload and read URLs so the app never holds a key and a media
 * link cannot be passed around after it expires.
 *
 * Buckets must be created as **private** and the service role key must never reach the app. A
 * public bucket would make every job photo and every identity document world-readable by URL,
 * which is exactly what the privacy map forbids.
 */
export function supabaseStorage(env: Env): StorageAdapter {
  const creds = requireEnv('supabase storage', {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const base = `${creds.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
  const headers = {
    authorization: `Bearer ${creds.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: creds.SUPABASE_SERVICE_ROLE_KEY,
  };
  const bucket = env.STORAGE_BUCKET;

  return {
    name: 'storage',
    provider: 'supabase',
    isMock: false,

    async health() {
      try {
        const info = await request<{ name: string; public: boolean }>('supabase-storage', `${base}/bucket/${bucket}`, {
          headers,
          timeoutMs: 5000,
        });
        // A public media bucket is a privacy incident waiting to happen, so it fails readiness.
        if (info.public) return { ok: false, detail: `bucket "${bucket}" is public; media must be private` };
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
      }
    },

    async createUploadUrl({ key }) {
      const res = await request<{ signedURL: string; token: string }>(
        'supabase-storage',
        `${base}/object/upload/sign/${bucket}/${encodeURI(key)}`,
        { method: 'POST', headers, body: {}, timeoutMs: 8000 },
      );
      // Supabase returns a path; the app PUTs the bytes straight to it.
      const url = res.signedURL.startsWith('http') ? res.signedURL : `${base}${res.signedURL}`;
      return {
        url,
        method: 'PUT' as const,
        expiresAt: new Date(Date.now() + env.STORAGE_SIGNED_URL_TTL_SECONDS * 1000),
      };
    },

    async createSignedReadUrl(key, ttlSeconds) {
      const res = await request<{ signedURL: string }>('supabase-storage', `${base}/object/sign/${bucket}/${encodeURI(key)}`, {
        method: 'POST',
        headers,
        body: { expiresIn: ttlSeconds },
        timeoutMs: 8000,
      });
      return res.signedURL.startsWith('http') ? res.signedURL : `${base}${res.signedURL}`;
    },

    async delete(key) {
      await request('supabase-storage', `${base}/object/${bucket}/${encodeURI(key)}`, {
        method: 'DELETE',
        headers,
        timeoutMs: 8000,
      });
    },
  };
}
