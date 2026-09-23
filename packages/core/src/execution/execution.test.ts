import { describe, expect, it } from 'vitest';
import {
  checkCanOverrideStart,
  checkCanStart,
  checkCompletion,
  checkRevisionRequest,
  flagChatMessage,
  mediaPhaseFor,
  revisionNeedsSupport,
} from './execution';

const future = () => new Date(Date.now() + 60_000);

describe('start code', () => {
  const fresh = { attempts: 0, maxAttempts: 5, expiresAt: future(), verifiedAt: null };

  it('only opens from ARRIVED', () => {
    expect(checkCanStart({ status: 'ARRIVED' }, fresh)).toBeNull();
    expect(checkCanStart({ status: 'EN_ROUTE' }, fresh)).toBe('JOB_NOT_ARRIVED');
    expect(checkCanStart({ status: 'PROVIDER_ASSIGNED' }, fresh)).toBe('JOB_NOT_ARRIVED');
  });

  it('refuses a spent, expired or locked code', () => {
    expect(checkCanStart({ status: 'ARRIVED' }, { ...fresh, verifiedAt: new Date() })).toBe('CODE_ALREADY_USED');
    expect(checkCanStart({ status: 'ARRIVED' }, { ...fresh, expiresAt: new Date(Date.now() - 1) })).toBe('CODE_EXPIRED');
    expect(checkCanStart({ status: 'ARRIVED' }, { ...fresh, attempts: 5 })).toBe('TOO_MANY_ATTEMPTS');
  });

  it('lets only admin and support override, and only with a real reason', () => {
    expect(checkCanOverrideStart('PROVIDER', 'The customer said it was fine')).toBe('OVERRIDE_NOT_ALLOWED');
    expect(checkCanOverrideStart('ADMIN', 'too long')).toBe('OVERRIDE_NEEDS_REASON');
    expect(checkCanOverrideStart('ADMIN', undefined)).toBe('OVERRIDE_NEEDS_REASON');
    expect(checkCanOverrideStart('SUPPORT', 'Customer unreachable, neighbour confirmed access')).toBeNull();
  });
});

describe('price revision', () => {
  const ok = {
    extraLabourPaise: 20_000,
    extraMaterialPaise: 0,
    extraTimeMinutes: 30,
    explanation: 'The pipe behind the wall is rusted through and has to be replaced',
    mediaCount: 2,
  };
  const none = { openRequests: 0, totalRequests: 0 };

  it('accepts a complete request on a job in progress', () => {
    expect(checkRevisionRequest({ status: 'IN_PROGRESS' }, ok, none)).toBeNull();
  });

  it('refuses one before work has started', () => {
    expect(checkRevisionRequest({ status: 'ARRIVED' }, ok, none)).toBe('JOB_NOT_IN_PROGRESS');
  });

  it('never asks the customer two money questions at once', () => {
    expect(checkRevisionRequest({ status: 'IN_PROGRESS' }, ok, { openRequests: 1, totalRequests: 1 })).toBe('REVISION_ALREADY_OPEN');
    expect(checkRevisionRequest({ status: 'IN_PROGRESS' }, ok, { openRequests: 0, totalRequests: 3 })).toBe('REVISION_LIMIT_REACHED');
  });

  it('demands something extra, an explanation and evidence', () => {
    expect(checkRevisionRequest({ status: 'IN_PROGRESS' }, { ...ok, extraLabourPaise: 0 }, none)).toBe('NOTHING_EXTRA');
    expect(checkRevisionRequest({ status: 'IN_PROGRESS' }, { ...ok, explanation: 'more work' }, none)).toBe('EXPLANATION_TOO_SHORT');
    expect(checkRevisionRequest({ status: 'IN_PROGRESS' }, { ...ok, mediaCount: 0 }, none)).toBe('EVIDENCE_REQUIRED');
  });

  it('routes a very large increase to support instead of a one-tap approval', () => {
    expect(revisionNeedsSupport(100_000, 140_000)).toBe(false);
    expect(revisionNeedsSupport(100_000, 160_000)).toBe(true);
  });
});

describe('completion', () => {
  const ok = { photoCount: 2, summary: 'Replaced the cartridge and tested it', openRevisions: 0 };

  it('needs a photo and a real summary', () => {
    expect(checkCompletion({ status: 'IN_PROGRESS' }, ok)).toBeNull();
    expect(checkCompletion({ status: 'IN_PROGRESS' }, { ...ok, photoCount: 0 })).toBe('PHOTOS_REQUIRED');
    expect(checkCompletion({ status: 'IN_PROGRESS' }, { ...ok, summary: 'done' })).toBe('SUMMARY_TOO_SHORT');
  });

  it('cannot be submitted while the customer still owes an answer on money', () => {
    expect(checkCompletion({ status: 'IN_PROGRESS' }, { ...ok, openRevisions: 1 })).toBe('REVISION_OPEN');
  });
});

describe('media phase', () => {
  it('follows the job, never the caller', () => {
    expect(mediaPhaseFor('DRAFT')).toBe('REQUEST');
    expect(mediaPhaseFor('IN_PROGRESS')).toBe('PROGRESS');
    expect(mediaPhaseFor('PRICE_REVISION_PENDING')).toBe('PRICE_REVISION');
    expect(mediaPhaseFor('CUSTOMER_APPROVAL_PENDING')).toBe('COMPLETION');
    expect(mediaPhaseFor('OPEN_FOR_BIDS')).toBeNull();
  });
});

describe('chat safety', () => {
  it('flags attempts to move the job off the platform', () => {
    expect(flagChatMessage('I will be there in ten minutes')).toBeNull();
    expect(flagChatMessage('Call me on 9876543210')).toBe('CONTACT_DETAILS');
    expect(flagChatMessage('Pay to ramesh@okaxis instead')).toBe('CONTACT_DETAILS');
    expect(flagChatMessage('mail me at ram@example.com')).toBe('CONTACT_DETAILS');
  });
});
