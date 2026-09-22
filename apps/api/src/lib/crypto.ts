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
