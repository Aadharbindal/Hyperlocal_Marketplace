import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

export const newId = (): string => randomUUID();

export const secureRandomInt = (maxExclusive: number): number => randomInt(0, maxExclusive);

/** Opaque refresh token: 32 random bytes, base64url. Only its hash is stored. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keyed hash for OTP codes so a DB leak alone cannot be brute-forced offline cheaply. */
export function hmacOtp(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * A job's start code. Derived from the server secret plus the code record's id, so the
 * plaintext never has to be stored and the customer's app can be shown it again on demand,
 * while a database dump alone reveals nothing.
 */
export function deriveOtpDigits(secret: string, scope: string, length: number): string {
  const digest = createHmac('sha256', secret).update(scope).digest();
  const n = digest.readUInt32BE(0) % 10 ** length;
  return String(n).padStart(length, '0');
}

/**
 * Symmetric encryption for a secret the server must be able to read back, such as an admin's
 * TOTP seed. AES-256-GCM with a random IV and the auth tag appended, keyed by the server
 * secret. This is not a substitute for a KMS: the production plan is envelope encryption
 * (KNOWN_LIMITATIONS), and this keeps the plaintext out of the database meanwhile.
 */
export function encryptSecret(key: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function decryptSecret(key: string, payload: string): string {
  const [ivB64, dataB64, tagB64] = payload.split('.');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('malformed secret');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}
