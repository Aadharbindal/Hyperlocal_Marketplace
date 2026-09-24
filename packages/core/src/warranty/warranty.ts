import type { JobStatus } from '../contracts/enums';

/**
 * Warranty claims.
 *
 * Every accepted quote has carried a warranty period since M4 and nothing could be done with it.
 * That is not a small omission: PRODUCT_SPEC section 17 argues that people should book through
 * the platform *because* of the warranty and the support behind it. A warranty with no way to
 * claim it is the opposite - the first time work fails, the customer rings the professional
 * directly, and both of them learn they never needed us.
 *
 * The central decision here is that **a warranty claim is not a dispute**. A dispute is an
 * argument about what happened. A claim is "the work was fine and it has come back", which
 * usually ends with the same professional returning at no charge. Filing it as a dispute would
 * hang a strike-shaped cloud over somebody who has done nothing wrong, and professionals would
 * quietly stop offering warranties at all.
 */

export const WARRANTY_CLAIM_STATUSES = [
  'OPEN',
  'ACCEPTED',
  'DECLINED',
  'REVISIT_BOOKED',
  'RESOLVED',
  'ESCALATED',
  'EXPIRED',
] as const;
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

/** A professional has this long to answer before support steps in on the customer's behalf. */
export const WARRANTY_RESPONSE_HOURS = 48;

/**
 * The shortest warranty we will record. A professional offering "one day" is offering nothing,
 * and a customer reading it as protection would be misled.
 */
export const MIN_WARRANTY_DAYS = 7;

export type WarrantyBlocker =
  | 'JOB_NOT_FINISHED'
  | 'NO_WARRANTY_GIVEN'
  | 'WARRANTY_EXPIRED'
  | 'ALREADY_OPEN'
  | 'NOT_YOUR_JOB'
  | 'DISPUTE_OPEN';

/** Work has to be finished and paid for before a warranty on it means anything. */
const CLAIMABLE: readonly JobStatus[] = ['COMPLETED', 'SETTLED'];

export function warrantyExpiresAt(completedAt: Date, warrantyDays: number): Date {
  return new Date(completedAt.getTime() + warrantyDays * 24 * 3600_000);
}

export function checkCanClaimWarranty(input: {
  jobStatus: JobStatus;
  isCustomer: boolean;
  warrantyDays: number;
  completedAt: Date | null;
  hasOpenClaim: boolean;
  hasOpenDispute: boolean;
  now: Date;
}): WarrantyBlocker | null {
  if (!input.isCustomer) return 'NOT_YOUR_JOB';
  if (!CLAIMABLE.includes(input.jobStatus) || !input.completedAt) return 'JOB_NOT_FINISHED';
  if (input.warrantyDays <= 0) return 'NO_WARRANTY_GIVEN';
  if (input.hasOpenClaim) return 'ALREADY_OPEN';
  // An open dispute already has support looking at this job. Two parallel processes over the
  // same work would reach two answers.
  if (input.hasOpenDispute) return 'DISPUTE_OPEN';
  if (warrantyExpiresAt(input.completedAt, input.warrantyDays) < input.now) return 'WARRANTY_EXPIRED';
  return null;
}

/** What the customer is told, in their terms rather than ours. */
export function explainWarrantyBlocker(blocker: WarrantyBlocker, warrantyDays = 0): string {
  switch (blocker) {
    case 'JOB_NOT_FINISHED':
      return 'You can raise a warranty claim once the work is finished and approved.';
    case 'NO_WARRANTY_GIVEN':
      return 'This booking did not come with a warranty. Raise a dispute instead if something is wrong.';
    case 'WARRANTY_EXPIRED':
      return `The ${warrantyDays}-day warranty on this work has ended. You can still raise a dispute or book again.`;
    case 'ALREADY_OPEN':
      return 'You already have an open claim on this booking. Add to that one instead.';
    case 'DISPUTE_OPEN':
      return 'There is already a dispute open on this booking, and our team is looking at it.';
    case 'NOT_YOUR_JOB':
      return 'Only the person who made the booking can claim on its warranty.';
  }
}

/** How many days of cover are left, for the line the app shows on a finished job. */
export function warrantyDaysLeft(completedAt: Date, warrantyDays: number, now: Date): number {
  const ms = warrantyExpiresAt(completedAt, warrantyDays).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3600_000)));
}

// ---------------------------------------------------------------------------
// What a professional may do about a claim
// ---------------------------------------------------------------------------

export const WARRANTY_RESPONSES = ['ACCEPT', 'DECLINE'] as const;
export type WarrantyResponse = (typeof WARRANTY_RESPONSES)[number];

export type WarrantyResponseBlocker = 'NOT_YOUR_CLAIM' | 'ALREADY_ANSWERED' | 'CLAIM_CLOSED' | 'REASON_REQUIRED';

export function checkCanRespondToClaim(input: {
  isProvider: boolean;
  status: WarrantyClaimStatus;
  response: WarrantyResponse;
  reason?: string;
}): WarrantyResponseBlocker | null {
  if (!input.isProvider) return 'NOT_YOUR_CLAIM';
  if (input.status !== 'OPEN') {
    return ['RESOLVED', 'EXPIRED', 'ESCALATED'].includes(input.status) ? 'CLAIM_CLOSED' : 'ALREADY_ANSWERED';
  }
  // Declining is allowed - not everything that breaks later is the same fault - but it has to be
  // explained, because the customer is owed a reason and support will need one.
  if (input.response === 'DECLINE' && (input.reason ?? '').trim().length < 20) return 'REASON_REQUIRED';
  return null;
}

/**
 * A claim the professional has not answered inside the response window goes to support, who
 * decide on the customer's behalf. Silence must not be a way to run down the warranty clock.
 */
export function claimNeedsSupport(input: { status: WarrantyClaimStatus; createdAt: Date; now: Date }): boolean {
  if (input.status !== 'OPEN') return false;
  return input.now.getTime() - input.createdAt.getTime() >= WARRANTY_RESPONSE_HOURS * 3600_000;
}

/**
 * A warranty revisit carries no money, in either direction.
 *
 * Stated as a function rather than left implicit because it is the rule most likely to be
 * quietly broken later: the return visit is work the professional already agreed to when they
 * offered a warranty, and charging for it - or paying them again for it - would make the
 * warranty meaningless and the ledger wrong.
 */
export function revisitIsFreeOfCharge(): true {
  return true;
}
