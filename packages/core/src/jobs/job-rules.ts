import type { JobPriority } from '../contracts/enums';

// ---------------------------------------------------------------------------
// Media limits (PRODUCT_SPEC section 4: photos, voice note up to 60 s)
// ---------------------------------------------------------------------------
export const MEDIA_LIMITS = {
  maxPhotosPerJob: 8,
  maxVoiceNotesPerJob: 1,
  maxVideosPerJob: 2,
  voiceNoteMaxSeconds: 60,
  videoMaxSeconds: 60,
  photoMaxBytes: 8 * 1024 * 1024,
  voiceNoteMaxBytes: 4 * 1024 * 1024,
  videoMaxBytes: 40 * 1024 * 1024,
} as const;

export const ALLOWED_MIME: Readonly<Record<'PHOTO' | 'VOICE_NOTE' | 'VIDEO' | 'DOCUMENT', readonly string[]>> = {
  PHOTO: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  VOICE_NOTE: ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg'],
  VIDEO: ['video/mp4', 'video/quicktime'],
  DOCUMENT: ['application/pdf', 'image/jpeg', 'image/png'],
};

export type MediaKind = keyof typeof ALLOWED_MIME;

export type MediaRejection =
  | 'MIME_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'TOO_LONG'
  | 'LIMIT_REACHED'
  | 'DURATION_REQUIRED';

export interface MediaCheckInput {
  kind: MediaKind;
  mime: string;
  sizeBytes: number;
  durationSeconds?: number;
  /** How many of this kind the job already has. */
  existingOfKind: number;
}

export function checkMedia(i: MediaCheckInput): MediaRejection[] {
  const errors: MediaRejection[] = [];
  if (!ALLOWED_MIME[i.kind].includes(i.mime.toLowerCase())) errors.push('MIME_NOT_ALLOWED');

  const maxBytes =
    i.kind === 'PHOTO' || i.kind === 'DOCUMENT'
      ? MEDIA_LIMITS.photoMaxBytes
      : i.kind === 'VOICE_NOTE'
        ? MEDIA_LIMITS.voiceNoteMaxBytes
        : MEDIA_LIMITS.videoMaxBytes;
  if (i.sizeBytes <= 0 || i.sizeBytes > maxBytes) errors.push('TOO_LARGE');

  if (i.kind === 'VOICE_NOTE' || i.kind === 'VIDEO') {
    if (i.durationSeconds === undefined) errors.push('DURATION_REQUIRED');
    else {
      const maxSeconds = i.kind === 'VOICE_NOTE' ? MEDIA_LIMITS.voiceNoteMaxSeconds : MEDIA_LIMITS.videoMaxSeconds;
      if (i.durationSeconds <= 0 || i.durationSeconds > maxSeconds) errors.push('TOO_LONG');
    }
  }

  const maxCount =
    i.kind === 'PHOTO'
      ? MEDIA_LIMITS.maxPhotosPerJob
      : i.kind === 'VOICE_NOTE'
        ? MEDIA_LIMITS.maxVoiceNotesPerJob
        : i.kind === 'VIDEO'
          ? MEDIA_LIMITS.maxVideosPerJob
          : MEDIA_LIMITS.maxPhotosPerJob;
  if (i.existingOfKind >= maxCount) errors.push('LIMIT_REACHED');

  return errors;
}

// ---------------------------------------------------------------------------
// Submission readiness (EDGE_CASE_MATRIX JOB-01)
// ---------------------------------------------------------------------------
export const MIN_DESCRIPTION_LENGTH = 12;

export type SubmitBlocker =
  | 'CATEGORY_DISABLED'
  | 'NEEDS_DESCRIPTION_OR_MEDIA'
  | 'ADDRESS_MISSING'
  | 'ADDRESS_OUT_OF_ZONE'
  | 'SCHEDULE_IN_PAST'
  | 'SCHEDULE_RANGE_INVALID'
  | 'PROHIBITED_CONTENT'
  | 'RECIPIENT_PHONE_INVALID';

export interface SubmitCheckInput {
  categoryEnabled: boolean;
  description: string | null;
  mediaCount: number;
  hasAddress: boolean;
  addressInPilotZone: boolean;
  preferredStart: Date | null;
  preferredEnd: Date | null;
  bookedForPhoneValid: boolean;
  now?: Date;
}

export function checkSubmittable(i: SubmitCheckInput): SubmitBlocker[] {
  const blockers: SubmitBlocker[] = [];
  const now = i.now ?? new Date();

  if (!i.categoryEnabled) blockers.push('CATEGORY_DISABLED');
  const described = (i.description ?? '').trim().length >= MIN_DESCRIPTION_LENGTH;
  if (!described && i.mediaCount === 0) blockers.push('NEEDS_DESCRIPTION_OR_MEDIA');
  if (!i.hasAddress) blockers.push('ADDRESS_MISSING');
  else if (!i.addressInPilotZone) blockers.push('ADDRESS_OUT_OF_ZONE');

  if (i.preferredStart) {
    // A minute of slack absorbs clock skew between the phone and the server (NET-07).
    if (i.preferredStart.getTime() < now.getTime() - 60_000) blockers.push('SCHEDULE_IN_PAST');
    if (i.preferredEnd && i.preferredEnd.getTime() <= i.preferredStart.getTime()) blockers.push('SCHEDULE_RANGE_INVALID');
  }
  if (!i.bookedForPhoneValid) blockers.push('RECIPIENT_PHONE_INVALID');
  if (containsProhibitedRequest(i.description ?? '')) blockers.push('PROHIBITED_CONTENT');

  return blockers;
}

/**
 * Requests we will not broker (EDGE_CASE_MATRIX JOB-13). Deliberately narrow: this blocks the
 * request, so it only covers things the platform genuinely cannot dispatch a local tradesperson
 * to. Safety hazards are NOT blocked - they are flagged and escalated instead.
 */
const PROHIBITED_PATTERNS: RegExp[] = [
  /\b(gun|pistol|firearm|ammunition)\b/i,
  /\b(illegal|stolen)\s+(electricity|connection|meter)\b/i,
  /\bbypass\s+(the\s+)?(meter|electricity meter)\b/i,
  /\b(drugs?|narcotics)\b/i,
  /\b(hack|hacking)\s+(into|someone)/i,
];

export function containsProhibitedRequest(text: string): boolean {
  return PROHIBITED_PATTERNS.some((p) => p.test(text));
}

/**
 * Safety hazards that need an emergency banner before anything else
 * (EDGE_CASE_MATRIX SAF-03, JOB-12).
 */
const HAZARD_PATTERNS: Array<{ pattern: RegExp; hazard: string }> = [
  { pattern: /\b(gas\s*leak|lpg\s*leak|smell(ing)?\s+gas)\b/i, hazard: 'GAS_LEAK' },
  { pattern: /\b(fire|burning|smoke\s+coming)\b/i, hazard: 'FIRE' },
  { pattern: /\b(live\s*wire|electric\s*shock|sparking|short\s*circuit)\b/i, hazard: 'ELECTRICAL' },
  { pattern: /\b(flood|water\s+everywhere|burst\s+pipe|major\s+leak)\b/i, hazard: 'FLOOD' },
  { pattern: /\b(crack(ed)?\s+(wall|ceiling|beam)|collapse|collapsing)\b/i, hazard: 'STRUCTURAL' },
];

export function detectHazards(text: string): string[] {
  return HAZARD_PATTERNS.filter((h) => h.pattern.test(text)).map((h) => h.hazard);
}

// ---------------------------------------------------------------------------
// Duplicate detection (EDGE_CASE_MATRIX JOB-03)
// ---------------------------------------------------------------------------
export const DUPLICATE_WINDOW_MINUTES = 120;

export function isLikelyDuplicate(
  candidate: { categoryId: string; addressId: string | null; createdAt: Date },
  existing: { categoryId: string; addressId: string | null; createdAt: Date },
  now: Date = new Date(),
): boolean {
  if (candidate.categoryId !== existing.categoryId) return false;
  if (candidate.addressId !== existing.addressId) return false;
  return now.getTime() - existing.createdAt.getTime() < DUPLICATE_WINDOW_MINUTES * 60_000;
}

// ---------------------------------------------------------------------------
// Cancellation stage (maps a live job status onto the pricing policy)
// ---------------------------------------------------------------------------
export const AUTO_CANCEL_AFTER_WINDOWS = 2;

/** How long a submitted job may sit unattended before the system cancels it. */
export function autoCancelAt(openedAt: Date, priority: JobPriority, windowMinutes: number): Date {
  return new Date(openedAt.getTime() + windowMinutes * AUTO_CANCEL_AFTER_WINDOWS * 60_000 + (priority === 'URGENT' ? 0 : 0));
}
