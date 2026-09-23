/**
 * Settlement, cancellation and dispute rules (PAYMENT_FLOW.md sections 3-6,
 * DISPUTE_POLICY.md). None of this decides money on its own - it decides whether the server is
 * allowed to, and the server writes the ledger.
 */
import type { JobStatus } from '../contracts/enums';
import type { Paise } from '../pricing/pricing';

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/** Money is only taken once the customer has said the work is done. */
export const CAPTURE_ALLOWED_FROM: readonly JobStatus[] = ['COMPLETED'];

export type CaptureBlocker = 'JOB_NOT_COMPLETED' | 'NOTHING_AUTHORIZED' | 'ALREADY_CAPTURED' | 'DISPUTE_OPEN';

export function checkCanCapture(
  job: { status: JobStatus },
  payment: { status: string } | null,
  context: { openDisputes: number },
): CaptureBlocker | null {
  if (!CAPTURE_ALLOWED_FROM.includes(job.status)) return 'JOB_NOT_COMPLETED';
  if (context.openDisputes > 0) return 'DISPUTE_OPEN';
  if (!payment) return 'NOTHING_AUTHORIZED';
  if (payment.status === 'CAPTURED' || payment.status === 'SETTLED') return 'ALREADY_CAPTURED';
  if (payment.status !== 'AUTHORIZED') return 'NOTHING_AUTHORIZED';
  return null;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * A payout waits this long after capture. It is the window in which a customer notices
 * something wrong, and it is why a settlement is never written in the same breath as a capture.
 */
export const SETTLEMENT_HOLD_HOURS = 24;

export const SETTLEMENT_STATUSES = ['PENDING', 'INITIATED', 'PAID', 'FAILED', 'ON_HOLD'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Three failures and a human looks at it instead of the queue retrying forever. */
export const SETTLEMENT_MAX_ATTEMPTS = 3;

export type SettlementBlocker =
  | 'JOB_NOT_COMPLETE'
  | 'NOT_CAPTURED'
  | 'DISPUTE_OPEN'
  | 'HOLD_PERIOD'
  | 'ALREADY_SETTLED'
  | 'NOTHING_OWED'
  | 'PAYEE_SUSPENDED'
  | 'NO_PAYOUT_ACCOUNT';

export function checkCanSettle(
  input: {
    jobStatus: JobStatus;
    paymentStatus: string;
    capturedAt: Date | null;
    amountPaise: Paise;
    openDisputes: number;
    existingSettlement: boolean;
    payeeSuspended: boolean;
    /** The payout rail pays a registered account, not a person - see `payout_accounts`. */
    hasPayoutAccount?: boolean;
  },
  now: Date = new Date(),
): SettlementBlocker | null {
  if (input.jobStatus !== 'COMPLETED' && input.jobStatus !== 'SETTLED') return 'JOB_NOT_COMPLETE';
  if (input.paymentStatus !== 'CAPTURED' && input.paymentStatus !== 'SETTLED') return 'NOT_CAPTURED';
  if (input.openDisputes > 0) return 'DISPUTE_OPEN';
  if (input.existingSettlement) return 'ALREADY_SETTLED';
  if (input.amountPaise <= 0) return 'NOTHING_OWED';
  // A suspended account keeps what it earned; the payout waits for the review (DISPUTE_POLICY §5).
  if (input.payeeSuspended) return 'PAYEE_SUSPENDED';
  // Nowhere to send it is not a failure to retry, it is something the payee has to fix.
  if (input.hasPayoutAccount === false) return 'NO_PAYOUT_ACCOUNT';
  if (!input.capturedAt) return 'NOT_CAPTURED';
  const due = new Date(input.capturedAt.getTime() + SETTLEMENT_HOLD_HOURS * 3600_000);
  if (now < due) return 'HOLD_PERIOD';
  return null;
}

// ---------------------------------------------------------------------------
// Where the money goes
// ---------------------------------------------------------------------------

export const PAYOUT_METHODS = ['BANK_ACCOUNT', 'UPI'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export type PayoutAccountBlocker = 'NAME_TOO_SHORT' | 'BAD_IFSC' | 'BAD_ACCOUNT_NUMBER' | 'BAD_UPI_ID';

/** `ABCD0123456`: four letters, a zero, then six alphanumerics. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian account numbers run from nine to eighteen digits. */
const ACCOUNT_NUMBER = /^\d{9,18}$/;
/** `name@handle`, the shape every UPI id takes. */
const VPA = /^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/;

/**
 * Checked here as well as by the bank, because a typo in an account number is the one mistake
 * in this product that sends real money to a stranger.
 */
export function checkPayoutAccount(
  input:
    | { method: 'BANK_ACCOUNT'; accountHolderName: string; accountNumber: string; ifsc: string }
    | { method: 'UPI'; accountHolderName: string; vpa: string },
): PayoutAccountBlocker | null {
  if (input.accountHolderName.trim().length < 3) return 'NAME_TOO_SHORT';
  if (input.method === 'BANK_ACCOUNT') {
    if (!ACCOUNT_NUMBER.test(input.accountNumber.trim())) return 'BAD_ACCOUNT_NUMBER';
    if (!IFSC.test(input.ifsc.trim().toUpperCase())) return 'BAD_IFSC';
    return null;
  }
  if (!VPA.test(input.vpa.trim())) return 'BAD_UPI_ID';
  return null;
}

/** What the payee sees back: enough to recognise the account, never enough to use it. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');
  return digits.length <= 4 ? '****' : `${'*'.repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskVpa(vpa: string): string {
  const [name = '', handle = ''] = vpa.split('@');
  const shown = name.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(2, name.length - 2))}@${handle}`;
}

/** A vendor is paid for goods the customer confirmed receiving, with an invoice on file. */
export type VendorSettlementBlocker = 'ORDER_NOT_CONFIRMED' | 'NO_INVOICE' | 'NOT_CAPTURED' | 'ALREADY_SETTLED' | 'DISPUTE_OPEN';

export function checkCanSettleVendor(input: {
  orderStatus: string;
  hasInvoice: boolean;
  paymentStatus: string;
  existingSettlement: boolean;
  openDisputes: number;
}): VendorSettlementBlocker | null {
  if (input.openDisputes > 0) return 'DISPUTE_OPEN';
  if (input.orderStatus !== 'CONFIRMED') return 'ORDER_NOT_CONFIRMED';
  if (!input.hasInvoice) return 'NO_INVOICE';
  if (input.paymentStatus !== 'CAPTURED' && input.paymentStatus !== 'SETTLED') return 'NOT_CAPTURED';
  if (input.existingSettlement) return 'ALREADY_SETTLED';
  return null;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export type CancellationStageName = 'BEFORE_CONFIRMATION' | 'AFTER_CONFIRMATION' | 'AFTER_EN_ROUTE' | 'AFTER_ARRIVED' | 'AFTER_STARTED';

/** Where a job is when it is cancelled decides what the customer pays (PAYMENT_FLOW §6). */
export function cancellationStage(status: JobStatus): CancellationStageName {
  switch (status) {
    case 'DRAFT':
    case 'SUBMITTED':
    case 'QUALIFYING':
    case 'OPEN_FOR_BIDS':
    case 'BID_RECEIVED':
    case 'NEGOTIATING':
    case 'PAYMENT_PENDING':
      return 'BEFORE_CONFIRMATION';
    case 'CONFIRMED':
    case 'PROVIDER_ASSIGNED':
      return 'AFTER_CONFIRMATION';
    case 'EN_ROUTE':
      return 'AFTER_EN_ROUTE';
    case 'ARRIVED':
      return 'AFTER_ARRIVED';
    default:
      return 'AFTER_STARTED';
  }
}

/** Cancelling after the work has begun is a support conversation, not a button. */
export function cancellationNeedsSupport(status: JobStatus): boolean {
  return cancellationStage(status) === 'AFTER_STARTED';
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export const DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'RESOLVED', 'REJECTED', 'ESCALATED', 'REOPENED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_RESOLUTIONS = [
  'NO_ACTION',
  'REWORK',
  'PARTIAL_REFUND',
  'FULL_REFUND',
  'ADJUSTMENT_CREDIT',
  'REPLACEMENT_PROVIDER',
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

/** SLA in hours per category (DISPUTE_POLICY §1). */
export const DISPUTE_SLA_HOURS: Readonly<Record<string, number>> = {
  LATE_ARRIVAL: 24,
  NO_SHOW: 12,
  INCORRECT_PRICING: 48,
  POOR_WORKMANSHIP: 72,
  PROPERTY_DAMAGE: 72,
  INCOMPLETE_WORK: 48,
  MATERIAL_MISMATCH: 48,
  PAYMENT_ISSUE: 24,
  ABUSIVE_BEHAVIOUR: 12,
  SUSPECTED_FRAUD: 24,
};

/** These are never decided by an automated rule - a person has to look (DISPUTE_POLICY §3). */
export const HUMAN_ONLY_CATEGORIES: readonly string[] = ['PROPERTY_DAMAGE', 'ABUSIVE_BEHAVIOUR', 'SUSPECTED_FRAUD'];

/** A refund past this needs a second approver (DISPUTE_POLICY §2). */
export const TWO_PERSON_REFUND_THRESHOLD_PAISE = 5_00_000;

export function refundNeedsTwoPeople(amountPaise: Paise): boolean {
  return amountPaise > TWO_PERSON_REFUND_THRESHOLD_PAISE;
}

/** A dispute can be raised from the moment someone is on the way until a week after completion. */
export const DISPUTE_WINDOW_DAYS = 7;

export type DisputeBlocker = 'JOB_TOO_EARLY' | 'WINDOW_CLOSED' | 'ALREADY_OPEN' | 'NOT_ON_JOB' | 'REASON_TOO_SHORT';

const DISPUTABLE_FROM: readonly JobStatus[] = [
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
  'COMPLETED',
  'SETTLED',
  'DISPUTED',
];

export function checkCanRaiseDispute(
  job: { status: JobStatus; completedAt: Date | null },
  input: { description: string; onJob: boolean; openDisputes: number },
  now: Date = new Date(),
): DisputeBlocker | null {
  if (!input.onJob) return 'NOT_ON_JOB';
  if (!DISPUTABLE_FROM.includes(job.status)) return 'JOB_TOO_EARLY';
  if (input.openDisputes > 0) return 'ALREADY_OPEN';
  if (input.description.trim().length < 20) return 'REASON_TOO_SHORT';
  if (job.completedAt) {
    const closes = new Date(job.completedAt.getTime() + DISPUTE_WINDOW_DAYS * 86_400_000);
    if (now > closes) return 'WINDOW_CLOSED';
  }
  return null;
}

export function disputeIsOpen(status: DisputeStatus): boolean {
  return status === 'OPEN' || status === 'UNDER_REVIEW' || status === 'AWAITING_PARTY' || status === 'ESCALATED' || status === 'REOPENED';
}

// ---------------------------------------------------------------------------
// Strikes
// ---------------------------------------------------------------------------

/** What a strike costs a provider's reliability score (DISPUTE_POLICY §5). */
export const STRIKE_RELIABILITY_COST: Readonly<Record<string, number>> = { MINOR: 0.25, MAJOR: 1, CRITICAL: 5 };
export const MAJOR_STRIKES_BEFORE_SUSPENSION = 3;
export const STRIKE_WINDOW_DAYS = 90;

export function shouldSuspend(strikes: Array<{ severity: string; createdAt: Date }>, now: Date = new Date()): boolean {
  if (strikes.some((s) => s.severity === 'CRITICAL')) return true;
  const since = new Date(now.getTime() - STRIKE_WINDOW_DAYS * 86_400_000);
  return strikes.filter((s) => s.severity === 'MAJOR' && s.createdAt >= since).length >= MAJOR_STRIKES_BEFORE_SUSPENSION;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewBlocker = 'JOB_NOT_COMPLETE' | 'ALREADY_REVIEWED' | 'NOT_ON_JOB' | 'WINDOW_CLOSED';

/** Reviews close after a month so ratings stay about recent work. */
export const REVIEW_WINDOW_DAYS = 30;

export function checkCanReview(
  job: { status: JobStatus; completedAt: Date | null },
  input: { onJob: boolean; alreadyReviewed: boolean },
  now: Date = new Date(),
): ReviewBlocker | null {
  if (!input.onJob) return 'NOT_ON_JOB';
  if (job.status !== 'COMPLETED' && job.status !== 'SETTLED') return 'JOB_NOT_COMPLETE';
  if (input.alreadyReviewed) return 'ALREADY_REVIEWED';
  if (job.completedAt && now > new Date(job.completedAt.getTime() + REVIEW_WINDOW_DAYS * 86_400_000)) return 'WINDOW_CLOSED';
  return null;
}

/** Running average, kept as integers until the last step so it cannot drift. */
export function nextRating(current: { ratingAvg: number | null; ratingCount: number }, rating: number): { ratingAvg: number; ratingCount: number } {
  const count = current.ratingCount + 1;
  const total = (current.ratingAvg ?? 0) * current.ratingCount + rating;
  return { ratingAvg: Number((total / count).toFixed(2)), ratingCount: count };
}
