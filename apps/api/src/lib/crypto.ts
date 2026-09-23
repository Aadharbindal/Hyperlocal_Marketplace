import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

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
