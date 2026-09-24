import { describe, expect, it } from 'vitest';
import type { JobStatus } from '../contracts/enums';
import {
  WARRANTY_RESPONSE_HOURS,
  checkCanClaimWarranty,
  checkCanRespondToClaim,
  claimNeedsSupport,
  explainWarrantyBlocker,
  warrantyDaysLeft,
  warrantyExpiresAt,
  type WarrantyClaimStatus,
} from './warranty';

const now = new Date('2026-09-24T10:00:00Z');
const completedAt = new Date('2026-09-20T10:00:00Z');

const base = {
  jobStatus: 'COMPLETED' as JobStatus,
  isCustomer: true,
  warrantyDays: 15,
  completedAt,
  hasOpenClaim: false,
  hasOpenDispute: false,
  now,
};

describe('claiming on a warranty', () => {
  it('lets the customer claim inside the window', () => {
    expect(checkCanClaimWarranty(base)).toBeNull();
    expect(checkCanClaimWarranty({ ...base, jobStatus: 'SETTLED' })).toBeNull();
  });

  it('refuses work that is not finished, and a booking that had no warranty', () => {
    expect(checkCanClaimWarranty({ ...base, jobStatus: 'IN_PROGRESS' })).toBe('JOB_NOT_FINISHED');
    expect(checkCanClaimWarranty({ ...base, completedAt: null })).toBe('JOB_NOT_FINISHED');
    expect(checkCanClaimWarranty({ ...base, warrantyDays: 0 })).toBe('NO_WARRANTY_GIVEN');
  });

  it('closes the window when it closes, counted from completion', () => {
    // 15 days from 20 September is 5 October
    expect(warrantyExpiresAt(completedAt, 15).toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(checkCanClaimWarranty({ ...base, now: new Date('2026-10-04T10:00:00Z') })).toBeNull();
    expect(checkCanClaimWarranty({ ...base, now: new Date('2026-10-06T10:00:00Z') })).toBe('WARRANTY_EXPIRED');
  });

  it('keeps one claim per booking, and stays out of an open dispute', () => {
    expect(checkCanClaimWarranty({ ...base, hasOpenClaim: true })).toBe('ALREADY_OPEN');
    // Support is already looking at the job; two parallel processes would reach two answers.
    expect(checkCanClaimWarranty({ ...base, hasOpenDispute: true })).toBe('DISPUTE_OPEN');
  });

  it('is the customer claim to make', () => {
    expect(checkCanClaimWarranty({ ...base, isCustomer: false })).toBe('NOT_YOUR_JOB');
  });

  it('explains a refusal in terms somebody can act on', () => {
    expect(explainWarrantyBlocker('WARRANTY_EXPIRED', 15)).toContain('15-day warranty');
    expect(explainWarrantyBlocker('NO_WARRANTY_GIVEN')).toContain('dispute instead');
    expect(explainWarrantyBlocker('DISPUTE_OPEN')).toContain('our team is looking at it');
  });

  it('counts the days left, for the line shown on a finished job', () => {
    expect(warrantyDaysLeft(completedAt, 15, now)).toBe(11);
    expect(warrantyDaysLeft(completedAt, 15, new Date('2026-10-06T10:00:00Z'))).toBe(0);
  });
});

describe('answering a claim', () => {
  const open = { isProvider: true, status: 'OPEN' as WarrantyClaimStatus, response: 'ACCEPT' as const };

  it('lets the professional agree to come back', () => {
    expect(checkCanRespondToClaim(open)).toBeNull();
  });

  it('lets them decline, but never without a reason', () => {
    // Not everything that breaks later is the same fault, so declining is allowed - the customer
    // is owed an explanation, and support will need one.
    expect(checkCanRespondToClaim({ ...open, response: 'DECLINE' })).toBe('REASON_REQUIRED');
    expect(checkCanRespondToClaim({ ...open, response: 'DECLINE', reason: 'too short' })).toBe('REASON_REQUIRED');
    expect(
      checkCanRespondToClaim({
        ...open,
        response: 'DECLINE',
        reason: 'The new leak is on a different pipe, upstream of the joint I replaced.',
      }),
    ).toBeNull();
  });

  it('refuses a second answer, and one on a closed claim', () => {
    expect(checkCanRespondToClaim({ ...open, status: 'ACCEPTED' })).toBe('ALREADY_ANSWERED');
    expect(checkCanRespondToClaim({ ...open, status: 'RESOLVED' })).toBe('CLAIM_CLOSED');
    expect(checkCanRespondToClaim({ ...open, status: 'ESCALATED' })).toBe('CLAIM_CLOSED');
    expect(checkCanRespondToClaim({ ...open, isProvider: false })).toBe('NOT_YOUR_CLAIM');
  });

  it('hands a claim to support when it is ignored', () => {
    const createdAt = new Date('2026-09-24T10:00:00Z');
    const stillFresh = new Date(createdAt.getTime() + (WARRANTY_RESPONSE_HOURS - 1) * 3600_000);
    const overdue = new Date(createdAt.getTime() + WARRANTY_RESPONSE_HOURS * 3600_000);

    expect(claimNeedsSupport({ status: 'OPEN', createdAt, now: stillFresh })).toBe(false);
    // Silence must not be a way to run down the warranty clock.
    expect(claimNeedsSupport({ status: 'OPEN', createdAt, now: overdue })).toBe(true);
    // An answered claim is not support's problem, however old it gets.
    expect(claimNeedsSupport({ status: 'ACCEPTED', createdAt, now: overdue })).toBe(false);
  });
});
