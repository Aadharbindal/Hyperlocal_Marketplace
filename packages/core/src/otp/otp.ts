/**
 * OTP policy helpers. Code generation uses a caller-supplied CSPRNG so this module stays
 * runtime-agnostic (Node `crypto.randomInt`, RN `expo-crypto`).
 */
export interface OtpPolicy {
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  requestsPerHour: number;
  resendCooldownSeconds: number;
}

export const LOGIN_OTP_POLICY: OtpPolicy = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  requestsPerHour: 5,
  resendCooldownSeconds: 60,
};

/** Start-job OTP is fixed at four digits per PRODUCT_SPEC section 12. */
export const START_JOB_OTP_POLICY: OtpPolicy = {
  length: 4,
  ttlSeconds: 72 * 3600,
  maxAttempts: 5,
  requestsPerHour: 3,
  resendCooldownSeconds: 30,
};

export type RandomInt = (maxExclusive: number) => number;

export function generateOtpCode(length: number, randomInt: RandomInt): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String(randomInt(10));
  return s;
}

export interface ChallengeState {
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type OtpCheck = 'OK' | 'EXPIRED' | 'LOCKED' | 'CONSUMED';

export function checkChallengeUsable(c: ChallengeState, now: Date = new Date()): OtpCheck {
  if (c.consumedAt) return 'CONSUMED';
  if (now >= c.expiresAt) return 'EXPIRED';
  if (c.attempts >= c.maxAttempts) return 'LOCKED';
  return 'OK';
}

export function isE164India(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone);
}

/** Normalise common Indian inputs ("98765 43210", "09876543210", "+91 98765-43210") to E.164. */
export function normaliseIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith('091')) national = digits.slice(3);
  else return null;
  const e164 = `+91${national}`;
  return isE164India(e164) ? e164 : null;
}

export function maskPhone(e164: string): string {
  return e164.replace(/^(\+\d{2})(\d+)(\d{2})$/, (_m, cc: string, mid: string, last: string) => `${cc}${'*'.repeat(mid.length)}${last}`);
}
