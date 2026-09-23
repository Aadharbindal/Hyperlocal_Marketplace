/**
 * Execution rules: who may move a confirmed job, the four-digit start code, price
 * revisions and completion evidence (PRODUCT_SPEC sections 11 and 12).
 *
 * Money never moves here. A revision only ever *proposes* a new total; nothing is
 * charged until the customer approves it in writing and a fresh authorization lands.
 */
import type { JobStatus } from '../contracts/enums';
import type { MediaPhaseSchema } from '../contracts/jobs';
import type { z } from 'zod';

type MediaPhase = z.infer<typeof MediaPhaseSchema>;

/** The statuses in which the provider side is actually on the job. */
export const EXECUTION_STATUSES: readonly JobStatus[] = [
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
];

// ---------------------------------------------------------------------------
// Start code
// ---------------------------------------------------------------------------

/** Work can only begin from ARRIVED - there is no way to skip the doorstep. */
export const START_ALLOWED_FROM: JobStatus = 'ARRIVED';

export type StartBlocker =
  | 'JOB_NOT_ARRIVED'
  | 'CODE_ALREADY_USED'
  | 'CODE_EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'WRONG_CODE'
  | 'OVERRIDE_NEEDS_REASON'
  | 'OVERRIDE_NOT_ALLOWED';

export interface StartOtpState {
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
}

/**
 * Everything except the code comparison itself, which the server does in constant time
 * against a hash it alone can compute.
 */
export function checkCanStart(job: { status: JobStatus }, otp: StartOtpState, now: Date = new Date()): StartBlocker | null {
  if (job.status !== START_ALLOWED_FROM) return 'JOB_NOT_ARRIVED';
  if (otp.verifiedAt) return 'CODE_ALREADY_USED';
  if (now >= otp.expiresAt) return 'CODE_EXPIRED';
  if (otp.attempts >= otp.maxAttempts) return 'TOO_MANY_ATTEMPTS';
  return null;
}

/**
 * An admin may start a job without the code - a customer can be unreachable - but only
 * with a reason, and the override is recorded on the job forever. Settlement later has
 * to look at this: an overridden start is never sufficient proof of work on its own.
 */
export function checkCanOverrideStart(role: string, reason: string | undefined): StartBlocker | null {
  if (role !== 'ADMIN' && role !== 'SUPPORT') return 'OVERRIDE_NOT_ALLOWED';
  if (!reason || reason.trim().length < 10) return 'OVERRIDE_NEEDS_REASON';
  return null;
}

// ---------------------------------------------------------------------------
// Price revision
// ---------------------------------------------------------------------------

/** One open request at a time, and a job cannot be re-quoted endlessly. */
export const MAX_PRICE_REVISIONS_PER_JOB = 3;
export const REVISION_EXPLANATION_MIN = 20;
/** Anything past this of the locked total needs support, not a one-tap approval. */
export const REVISION_SOFT_CAP_RATIO = 1.5;

export type RevisionBlocker =
  | 'JOB_NOT_IN_PROGRESS'
  | 'REVISION_ALREADY_OPEN'
  | 'REVISION_LIMIT_REACHED'
  | 'NOTHING_EXTRA'
  | 'EXPLANATION_TOO_SHORT'
  | 'EVIDENCE_REQUIRED';

export interface RevisionInput {
  extraLabourPaise: number;
  extraMaterialPaise: number;
  extraTimeMinutes: number;
  explanation: string;
  mediaCount: number;
}

export function checkRevisionRequest(
  job: { status: JobStatus },
  input: RevisionInput,
  history: { openRequests: number; totalRequests: number },
): RevisionBlocker | null {
  if (job.status !== 'IN_PROGRESS') return 'JOB_NOT_IN_PROGRESS';
  if (history.openRequests > 0) return 'REVISION_ALREADY_OPEN';
  if (history.totalRequests >= MAX_PRICE_REVISIONS_PER_JOB) return 'REVISION_LIMIT_REACHED';
  if (input.extraLabourPaise <= 0 && input.extraMaterialPaise <= 0) return 'NOTHING_EXTRA';
  if (input.explanation.trim().length < REVISION_EXPLANATION_MIN) return 'EXPLANATION_TOO_SHORT';
  // A customer being asked for more money is entitled to see why.
  if (input.mediaCount < 1) return 'EVIDENCE_REQUIRED';
  return null;
}

/** True when the increase is large enough that we route the customer to support first. */
export function revisionNeedsSupport(originalTotalPaise: number, revisedTotalPaise: number): boolean {
  return revisedTotalPaise > Math.round(originalTotalPaise * REVISION_SOFT_CAP_RATIO);
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export const COMPLETION_MIN_PHOTOS = 1;
export const COMPLETION_NOTE_MIN = 10;
/** How long the customer has before the approval can be chased; nothing auto-approves in M5. */
export const CUSTOMER_APPROVAL_HOURS = 48;

export type CompletionBlocker = 'JOB_NOT_IN_PROGRESS' | 'PHOTOS_REQUIRED' | 'SUMMARY_TOO_SHORT' | 'REVISION_OPEN';

export function checkCompletion(
  job: { status: JobStatus },
  input: { photoCount: number; summary: string; openRevisions: number },
): CompletionBlocker | null {
  if (job.status !== 'IN_PROGRESS') return 'JOB_NOT_IN_PROGRESS';
  if (input.openRevisions > 0) return 'REVISION_OPEN';
  if (input.photoCount < COMPLETION_MIN_PHOTOS) return 'PHOTOS_REQUIRED';
  if (input.summary.trim().length < COMPLETION_NOTE_MIN) return 'SUMMARY_TOO_SHORT';
  return null;
}

/** Which media phase a job in this status is allowed to receive. */
export function mediaPhaseFor(status: JobStatus): MediaPhase | null {
  if (status === 'DRAFT' || status === 'SUBMITTED' || status === 'QUALIFYING') return 'REQUEST';
  if (status === 'PRICE_REVISION_PENDING') return 'PRICE_REVISION';
  if (status === 'IN_PROGRESS' || status === 'STARTED') return 'PROGRESS';
  if (status === 'COMPLETION_PENDING' || status === 'CUSTOMER_APPROVAL_PENDING') return 'COMPLETION';
  return null;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Chat opens with the booking and closes when the job is over - not before, not after. */
export const CHAT_OPEN_FROM: readonly JobStatus[] = [
  'CONFIRMED',
  ...EXECUTION_STATUSES,
];

export const CHAT_MESSAGE_MAX = 1000;

/** Phone numbers and payment handles in chat are a classic way to take a job off-platform. */
const CONTACT_PATTERNS: readonly RegExp[] = [
  /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/, // Indian mobile number
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, // email
  /\b\w+@(?:ok(?:axis|hdfcbank|icici|sbi)|paytm|ybl|upi|apl)\b/i, // UPI handle
];

export function flagChatMessage(body: string): 'CONTACT_DETAILS' | null {
  return CONTACT_PATTERNS.some((re) => re.test(body)) ? 'CONTACT_DETAILS' : null;
}
