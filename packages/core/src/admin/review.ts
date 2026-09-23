/**
 * Review rules for the support console: KYC decisions, suspensions and the queue's own
 * guard rails (PRODUCT_SPEC section 15, SECURITY_CHECKLIST, DISPUTE_POLICY section 2).
 *
 * The console is the one place where a person can see identity documents, move money and take
 * someone's livelihood away for a while. Every rule here exists to make that hard to do
 * casually and impossible to do invisibly.
 */
import type { VerificationStatus } from '../contracts/enums';

export type KycDecision = 'APPROVE' | 'REJECT' | 'NEEDS_MORE';

export type KycBlocker = 'ALREADY_DECIDED' | 'REASON_REQUIRED' | 'CANNOT_REVIEW_OWN';

export function checkKycReview(
  record: { status: VerificationStatus; userId: string },
  input: { decision: KycDecision; reason?: string; reviewerId: string },
): KycBlocker | null {
  // Nobody verifies themselves, whatever roles they hold.
  if (record.userId === input.reviewerId) return 'CANNOT_REVIEW_OWN';
  if (record.status === 'VERIFIED' || record.status === 'REJECTED') return 'ALREADY_DECIDED';
  // A rejection has to be explainable to the person it affects.
  if (input.decision !== 'APPROVE' && (input.reason ?? '').trim().length < 10) return 'REASON_REQUIRED';
  return null;
}

export function kycStatusAfter(decision: KycDecision): VerificationStatus {
  return decision === 'APPROVE' ? 'VERIFIED' : decision === 'REJECT' ? 'REJECTED' : 'UNDER_REVIEW';
}

// ---------------------------------------------------------------------------
// Suspension
// ---------------------------------------------------------------------------

export type SuspensionBlocker = 'REASON_TOO_SHORT' | 'SECOND_APPROVER_REQUIRED' | 'SECOND_APPROVER_MUST_DIFFER' | 'CANNOT_SUSPEND_SELF';

/**
 * Suspending an account stops someone earning, so it takes two people and a written reason
 * (SECURITY_CHECKLIST: two-person approval for high-risk admin actions).
 */
export function checkSuspension(input: {
  targetUserId: string;
  actorId: string;
  reason: string;
  secondApproverId?: string | null;
}): SuspensionBlocker | null {
  if (input.targetUserId === input.actorId) return 'CANNOT_SUSPEND_SELF';
  if (input.reason.trim().length < 20) return 'REASON_TOO_SHORT';
  if (!input.secondApproverId) return 'SECOND_APPROVER_REQUIRED';
  if (input.secondApproverId === input.actorId) return 'SECOND_APPROVER_MUST_DIFFER';
  return null;
}

// ---------------------------------------------------------------------------
// Dispute queue
// ---------------------------------------------------------------------------

export const DISPUTE_QUEUE_MOVES = ['UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED'] as const;
export type DisputeQueueMove = (typeof DISPUTE_QUEUE_MOVES)[number];

export type AppealBlocker = 'NOT_RESOLVED' | 'APPEAL_WINDOW_CLOSED' | 'ALREADY_REOPENED' | 'REASON_TOO_SHORT' | 'NOT_ON_DISPUTE';

/** One appeal, within a week, with new grounds (DISPUTE_POLICY section 6). */
export const APPEAL_WINDOW_DAYS = 7;

export function checkAppeal(
  dispute: { status: string; resolvedAt: Date | null; reopenedCount: number; raisedBy: string; againstUserId: string | null },
  input: { userId: string; reason: string },
  now: Date = new Date(),
): AppealBlocker | null {
  if (dispute.raisedBy !== input.userId && dispute.againstUserId !== input.userId) return 'NOT_ON_DISPUTE';
  if (dispute.status !== 'RESOLVED' && dispute.status !== 'REJECTED') return 'NOT_RESOLVED';
  if (dispute.reopenedCount >= 1) return 'ALREADY_REOPENED';
  if (input.reason.trim().length < 20) return 'REASON_TOO_SHORT';
  if (!dispute.resolvedAt) return 'NOT_RESOLVED';
  if (now.getTime() - dispute.resolvedAt.getTime() > APPEAL_WINDOW_DAYS * 86_400_000) return 'APPEAL_WINDOW_CLOSED';
  return null;
}

/** An appeal is reviewed by someone other than whoever decided it the first time. */
export function appealReviewerIsDifferent(resolvedBy: string | null, reviewerId: string): boolean {
  return resolvedBy !== reviewerId;
}

// ---------------------------------------------------------------------------
// Ops report
// ---------------------------------------------------------------------------

export interface OpsSnapshot {
  jobsByStatus: Record<string, number>;
  liveJobs: number;
  completedJobs: number;
  capturedPaise: number;
  refundedPaise: number;
  platformRevenuePaise: number;
  payoutsPendingPaise: number;
  payoutsPaidPaise: number;
  disputesOpen: number;
  disputesBreachingSla: number;
  kycPending: number;
  providersVerified: number;
  providersSuspended: number;
}

/** Which disputes are past their promised answer time - the number support is judged on. */
export function countSlaBreaches(disputes: Array<{ slaDueAt: Date; status: string }>, now: Date = new Date()): number {
  const open = ['OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED', 'REOPENED'];
  return disputes.filter((d) => open.includes(d.status) && d.slaDueAt < now).length;
}
