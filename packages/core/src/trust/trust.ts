/**
 * Three small things that each close a hole: reading the messages we flag, getting back in when
 * an admin loses their phone, and answering "what do you hold about me".
 */

// ---------------------------------------------------------------------------
// Moderating what was flagged
// ---------------------------------------------------------------------------

/**
 * Chat messages carrying a phone number, an email or a UPI handle have been flagged since M5,
 * and nobody has ever read one. A flag nobody reads is worse than no flag at all: it is the
 * appearance of moderation without the fact of it, and it is the appearance we would be relying
 * on if somebody asked how we police off-platform payment.
 */
export const MODERATION_OUTCOMES = ['ALLOWED', 'WARNED', 'STRIKE', 'SUSPENDED'] as const;
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number];

/**
 * Most flags are innocent - people share a number so a delivery can be let through the gate.
 * `ALLOWED` is therefore the expected outcome and carries no consequence at all; it exists so a
 * reviewer can clear a message rather than leave it in the queue forever.
 */
export function outcomeNeedsReason(outcome: ModerationOutcome): boolean {
  return outcome !== 'ALLOWED';
}

/** Which outcomes actually cost the sender something, and so need the two-person path. */
export function outcomeIsPunitive(outcome: ModerationOutcome): boolean {
  return outcome === 'STRIKE' || outcome === 'SUSPENDED';
}

/**
 * How long a flagged message may sit unread before it stops meaning anything. Not a hard rule in
 * code - it drives the "oldest first" ordering and an ops warning - but it is written down so
 * the queue has a standard rather than a vibe.
 */
export const MODERATION_SLA_HOURS = 24;

export function moderationIsOverdue(flaggedAt: Date, now: Date): boolean {
  return now.getTime() - flaggedAt.getTime() >= MODERATION_SLA_HOURS * 3600_000;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Admin MFA has had TOTP, single-use codes and a five-failure lock since M8, and no way back in:
 * a lost phone meant hand-editing production, at speed, under pressure. That is the situation in
 * which people make the mistake that becomes the incident.
 *
 * Ten codes, shown once, stored hashed. We can say a code was accepted; we can never say what
 * somebody's codes are - the same promise we make about every other secret.
 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Groups of four from an alphabet with no 0/O and no 1/I, because these get written on paper and
 * read back later by somebody who is already having a bad day.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function formatRecoveryCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return cleaned.replace(/(.{4})(?=.)/g, '$1-');
}

export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Builds one code from bytes a caller supplies, so the randomness stays with the server. */
export function recoveryCodeFromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += RECOVERY_ALPHABET[(bytes[i] ?? 0) % RECOVERY_ALPHABET.length];
  }
  return out;
}

export function isPlausibleRecoveryCode(input: string): boolean {
  const cleaned = normaliseRecoveryCode(input);
  return cleaned.length === 8 && [...cleaned].every((c) => RECOVERY_ALPHABET.includes(c));
}

// ---------------------------------------------------------------------------
// What we hold about somebody
// ---------------------------------------------------------------------------

/**
 * Deletion has existed since M1; access has not. The DPDP Act 2023 gives people the right to know
 * what is held about them, and it is not a right we get to implement only when asked.
 *
 * The export is deliberately a list of *what is included*, declared here rather than assembled
 * ad hoc, so that adding a table later forces a decision about whether it belongs in somebody's
 * copy of their own data.
 */
export const EXPORT_SECTIONS = [
  'profile',
  'addresses',
  'consents',
  'jobs',
  'bookings',
  'payments',
  'invoices',
  'reviews',
  'disputes',
  'warrantyClaims',
  'messages',
  'notifications',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

/**
 * What is deliberately left out, and why. Returned with the export so nobody has to guess
 * whether something is missing by accident.
 */
export const EXPORT_EXCLUSIONS: Array<{ what: string; why: string }> = [
  {
    what: 'Identity documents',
    why: 'Held encrypted for verification and never returned through the app, to anyone, including you.',
  },
  {
    what: 'Other people’s messages and details',
    why: 'A conversation belongs to both sides; you get your own messages and the other person’s first name.',
  },
  {
    what: 'Internal notes and fraud signals',
    why: 'Releasing these would tell somebody exactly how to avoid being caught next time.',
  },
];
