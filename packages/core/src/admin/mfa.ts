/**
 * TOTP for admin sign-in (RFC 6238), kept dependency-free and runtime-agnostic: the caller
 * supplies the HMAC, so the API can use Node crypto and a test can use whatever it likes.
 *
 * Why admins and not everyone: an admin can see identity documents, move money and suspend
 * accounts. A stolen phone number should not be enough to do any of that
 * (SECURITY_CHECKLIST, DISPUTE_POLICY section 2).
 */

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/** One step either side, so a slow clock or a slow thumb still works. */
export const TOTP_DRIFT_STEPS = 1;
/** How long an MFA check is good for before an admin has to do it again. */
export const ADMIN_MFA_SESSION_HOURS = 8;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648, no padding) - what every authenticator app expects. */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(secret: string): Uint8Array {
  const clean = secret.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function currentStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** The 8-byte big-endian counter a TOTP HMAC is taken over. */
export function stepToCounter(step: number): Uint8Array {
  const buf = new Uint8Array(8);
  let value = step;
  for (let i = 7; i >= 0; i--) {
    buf[i] = value & 255;
    value = Math.floor(value / 256);
  }
  return buf;
}

export type HmacSha1 = (key: Uint8Array, message: Uint8Array) => Uint8Array;

/** Dynamic truncation, exactly as the RFC describes it. */
export function totpFromHmac(digest: Uint8Array, digits: number = TOTP_DIGITS): string {
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secretBase32: string, step: number, hmac: HmacSha1, digits: number = TOTP_DIGITS): string {
  return totpFromHmac(hmac(fromBase32(secretBase32), stepToCounter(step)), digits);
}

export type MfaCheck = { ok: true; step: number } | { ok: false; reason: 'WRONG_CODE' | 'CODE_REUSED' };

/**
 * Verifies a code and returns the step it matched, so the caller can store it and refuse the
 * same code twice - a code seen over someone's shoulder is only good until it is used once.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  hmac: HmacSha1,
  opts: { now?: Date; lastUsedStep?: number | null; drift?: number } = {},
): MfaCheck {
  const now = opts.now ?? new Date();
  const drift = opts.drift ?? TOTP_DRIFT_STEPS;
  const centre = currentStep(now);
  for (let offset = -drift; offset <= drift; offset++) {
    const step = centre + offset;
    if (totpAt(secretBase32, step, hmac) === code) {
      if (opts.lastUsedStep != null && step <= opts.lastUsedStep) return { ok: false, reason: 'CODE_REUSED' };
      return { ok: true, step };
    }
  }
  return { ok: false, reason: 'WRONG_CODE' };
}

/** The URI an authenticator app scans. The secret never leaves this one response. */
export function otpauthUri(input: { secretBase32: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function mfaStillValid(verifiedAt: Date | null, now: Date = new Date()): boolean {
  if (!verifiedAt) return false;
  return now.getTime() - verifiedAt.getTime() < ADMIN_MFA_SESSION_HOURS * 3600_000;
}
