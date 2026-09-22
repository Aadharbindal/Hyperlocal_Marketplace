import { describe, expect, it } from 'vitest';
import {
  MEDIA_LIMITS,
  checkMedia,
  checkSubmittable,
  containsProhibitedRequest,
  detectHazards,
  isLikelyDuplicate,
} from './job-rules';

describe('media rules', () => {
  const photo = { kind: 'PHOTO' as const, mime: 'image/jpeg', sizeBytes: 900_000, existingOfKind: 0 };

  it('accepts a normal photo', () => expect(checkMedia(photo)).toEqual([]));

  it('rejects the wrong mime type', () => {
    expect(checkMedia({ ...photo, mime: 'application/zip' })).toContain('MIME_NOT_ALLOWED');
  });

  it('rejects oversized files', () => {
    expect(checkMedia({ ...photo, sizeBytes: MEDIA_LIMITS.photoMaxBytes + 1 })).toContain('TOO_LARGE');
    expect(checkMedia({ ...photo, sizeBytes: 0 })).toContain('TOO_LARGE');
  });

  it('enforces the 60 second voice note limit', () => {
    const voice = { kind: 'VOICE_NOTE' as const, mime: 'audio/m4a', sizeBytes: 200_000, existingOfKind: 0 };
    expect(checkMedia({ ...voice, durationSeconds: 45 })).toEqual([]);
    expect(checkMedia({ ...voice, durationSeconds: 61 })).toContain('TOO_LONG');
    expect(checkMedia(voice)).toContain('DURATION_REQUIRED');
  });

  it('caps how many of each kind a job can hold', () => {
    expect(checkMedia({ ...photo, existingOfKind: MEDIA_LIMITS.maxPhotosPerJob })).toContain('LIMIT_REACHED');
    expect(checkMedia({ kind: 'VOICE_NOTE', mime: 'audio/m4a', sizeBytes: 1000, durationSeconds: 10, existingOfKind: 1 })).toContain('LIMIT_REACHED');
  });
});

describe('submission readiness (JOB-01, JOB-13)', () => {
  const base = {
    categoryEnabled: true,
    description: 'Kitchen tap is leaking badly',
    mediaCount: 0,
    hasAddress: true,
    addressInPilotZone: true,
    preferredStart: null,
    preferredEnd: null,
    bookedForPhoneValid: true,
  };

  it('accepts a described job', () => expect(checkSubmittable(base)).toEqual([]));

  it('accepts a job with no words but a photo', () => {
    expect(checkSubmittable({ ...base, description: null, mediaCount: 1 })).toEqual([]);
  });

  it('rejects a job with neither words nor media', () => {
    expect(checkSubmittable({ ...base, description: 'leak', mediaCount: 0 })).toContain('NEEDS_DESCRIPTION_OR_MEDIA');
  });

  it('rejects disabled categories and addresses outside the pilot zone', () => {
    expect(checkSubmittable({ ...base, categoryEnabled: false })).toContain('CATEGORY_DISABLED');
    expect(checkSubmittable({ ...base, addressInPilotZone: false })).toContain('ADDRESS_OUT_OF_ZONE');
    expect(checkSubmittable({ ...base, hasAddress: false })).toContain('ADDRESS_MISSING');
  });

  it('validates the preferred window', () => {
    const past = new Date(Date.now() - 3600_000);
    expect(checkSubmittable({ ...base, preferredStart: past })).toContain('SCHEDULE_IN_PAST');
    const start = new Date(Date.now() + 3600_000);
    expect(checkSubmittable({ ...base, preferredStart: start, preferredEnd: start })).toContain('SCHEDULE_RANGE_INVALID');
    expect(checkSubmittable({ ...base, preferredStart: start, preferredEnd: new Date(start.getTime() + 3600_000) })).toEqual([]);
  });

  it('tolerates small clock skew on the preferred start', () => {
    expect(checkSubmittable({ ...base, preferredStart: new Date(Date.now() - 30_000) })).toEqual([]);
  });

  it('blocks prohibited requests but not hazards', () => {
    expect(containsProhibitedRequest('please bypass the electricity meter')).toBe(true);
    expect(containsProhibitedRequest('gas leak in my kitchen')).toBe(false);
    expect(checkSubmittable({ ...base, description: 'help me bypass the meter please' })).toContain('PROHIBITED_CONTENT');
  });
});

describe('hazard detection (SAF-03)', () => {
  it('flags emergencies so the app can show the safety banner', () => {
    expect(detectHazards('there is a gas leak near the stove')).toContain('GAS_LEAK');
    expect(detectHazards('live wire hanging in the bathroom')).toContain('ELECTRICAL');
    expect(detectHazards('burst pipe, water everywhere')).toEqual(expect.arrayContaining(['FLOOD']));
    expect(detectHazards('please fix the kitchen tap')).toEqual([]);
  });
});

describe('duplicate detection (JOB-03)', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const existing = { categoryId: 'c1', addressId: 'a1', createdAt: new Date('2026-01-01T11:00:00Z') };

  it('flags the same category and address within the window', () => {
    expect(isLikelyDuplicate({ categoryId: 'c1', addressId: 'a1', createdAt: now }, existing, now)).toBe(true);
  });
  it('ignores a different category, address, or an older job', () => {
    expect(isLikelyDuplicate({ categoryId: 'c2', addressId: 'a1', createdAt: now }, existing, now)).toBe(false);
    expect(isLikelyDuplicate({ categoryId: 'c1', addressId: 'a2', createdAt: now }, existing, now)).toBe(false);
    const old = { ...existing, createdAt: new Date('2026-01-01T09:00:00Z') };
    expect(isLikelyDuplicate({ categoryId: 'c1', addressId: 'a1', createdAt: now }, old, now)).toBe(false);
  });
});
