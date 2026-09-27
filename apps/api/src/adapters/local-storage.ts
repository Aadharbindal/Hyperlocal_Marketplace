import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { Env } from '../config/env';
import { decryptBytes, encryptBytes } from '../lib/crypto';
import type { StorageAdapter } from './types';

/**
 * Storage that actually holds the bytes, on this machine's disk.
 *
 * This replaces a mock that was doing real damage to what the rest of the system could be
 * trusted to do. The old one issued a `mock://` URL nobody could PUT to, so the API marked every
 * media row uploaded the moment it was created and told the client to skip the transfer. The
 * effect was that **completion photos did not exist** - and completion photos are the evidence
 * the entire dispute and warranty process rests on. Every test about evidence was passing
 * against rows that referred to nothing.
 *
 * It is a real adapter rather than a better mock: bytes are written, read back, size-limited,
 * content-type checked and deleted. That means the whole chain - attach, upload, view, dispute -
 * can be exercised end to end before anybody has a Supabase or S3 credential, which is the point.
 *
 * It is **not** for production. A local disk is not shared between nodes, does not survive the
 * container, and is not backed up. `env.ts` refuses to boot production without a real provider.
 */

interface Grant {
  /** Storage key. */
  k: string;
  /** Allowed content type. */
  m: string;
  /** Byte ceiling. */
  x: number;
  /** Expiry, epoch seconds. */
  e: number;
  /** What the grant permits. A read token must not be usable to write. */
  o: 'put' | 'get';
}

function sign(grant: Grant, secret: string): string {
  const body = Buffer.from(JSON.stringify(grant)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/**
 * Verify and decode a grant. Returns null for anything that is not exactly right - a bad
 * signature, a tampered body, an expired token - because the caller has nothing useful to do
 * with the distinction and saying which part failed helps only an attacker.
 */
export function readGrant(token: string, secret: string): Grant | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Grant;
    if (typeof grant.k !== 'string' || typeof grant.e !== 'number') return null;
    if (grant.e * 1000 < Date.now()) return null;
    return grant;
  } catch {
    return null;
  }
}

/**
 * Resolve a storage key to a path inside the storage root, or null.
 *
 * Keys are generated on the server today, so this cannot currently be reached with anything
 * hostile - but "currently" is the word that ages badly, and a path that escapes its root is how
 * a file server becomes a way to read `/etc/passwd`. Checked here rather than assumed upstream.
 */
export function resolveKey(root: string, key: string): string | null {
  if (!key || key.includes('\0')) return null;
  const full = normalize(join(root, key));
  const prefix = normalize(root).endsWith(sep) ? normalize(root) : normalize(root) + sep;
  return full.startsWith(prefix) ? full : null;
}

export function localStorageAdapter(env: Env): StorageAdapter & { root: string } {
  const root = env.STORAGE_LOCAL_DIR;
  const base = env.API_PUBLIC_URL.replace(/\/$/, '');

  return {
    name: 'storage',
    provider: 'local',
    // Not a mock. It really stores the bytes, and the rest of the system is entitled to behave
    // as though the file is there - which is exactly what was wrong before.
    isMock: false,

    async health() {
      try {
        await mkdir(root, { recursive: true });
        return { ok: true, detail: root };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'storage directory unavailable' };
      }
    },

    async createUploadUrl({ key, mime, maxBytes }) {
      const expiresAt = new Date(Date.now() + env.STORAGE_SIGNED_URL_TTL_SECONDS * 1000);
      const token = sign({ k: key, m: mime, x: maxBytes, e: Math.floor(expiresAt.getTime() / 1000), o: 'put' }, env.API_JWT_SECRET);
      return { url: `${base}/storage/upload?token=${token}`, method: 'PUT' as const, expiresAt };
    },

    async createSignedReadUrl(key, ttlSeconds) {
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      const token = sign({ k: key, m: '', x: 0, e: exp, o: 'get' }, env.API_JWT_SECRET);
      return `${base}/storage/object?token=${token}`;
    },

    async delete(key) {
      const path = resolveKey(root, key);
      if (!path) return;
      await rm(path, { force: true });
    },

    root,
  };
}

/**
 * Which objects are encrypted before they touch the disk.
 *
 * Identity documents only. An Aadhaar card is the most sensitive thing this system will ever
 * hold, it is legally somebody else's, and unlike a photo of a leaking tap it is never served
 * to the person it belongs to - only to a reviewer, once, through a logged access. Job photos
 * are left in the clear because they are read constantly and the cost would buy much less.
 */
export const ENCRYPTED_AT_REST_PREFIX = 'kyc/';
export const isEncryptedAtRest = (key: string) => key.startsWith(ENCRYPTED_AT_REST_PREFIX);

/** Used by the upload route; kept here so the path and encryption rules live in one place. */
export async function writeObject(root: string, key: string, bytes: Buffer, secret: string): Promise<void> {
  const path = resolveKey(root, key);
  if (!path) throw new Error('invalid storage key');
  await mkdir(dirname(path), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, isEncryptedAtRest(key) ? encryptBytes(secret, bytes) : bytes);
}

/** Reads an object back, undoing the encryption if that key is one of the encrypted ones. */
export async function readObject(root: string, key: string, secret: string): Promise<Buffer | null> {
  const path = resolveKey(root, key);
  if (!path) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path);
    return isEncryptedAtRest(key) ? decryptBytes(secret, raw) : raw;
  } catch {
    return null;
  }
}

export async function objectSize(root: string, key: string): Promise<number | null> {
  const path = resolveKey(root, key);
  if (!path) return null;
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}
