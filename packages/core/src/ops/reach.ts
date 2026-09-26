import type { JobStatus } from '../contracts/enums';

/**
 * Reaching the people on a job: what may be sent to a phone, when two of them may talk, and
 * when a booking may be moved rather than cancelled.
 *
 * These are policy decisions, not plumbing, so they live here where they can be read and tested
 * on their own. The adapters decide *how* a message travels; this decides *whether it should*.
 */

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/**
 * Every notification belongs to exactly one of these. The category decides whether a person's
 * settings allow it to reach their phone, so a new notification type has to choose one rather
 * than quietly inheriting "send it".
 */
export const NOTIFICATION_CATEGORIES = ['JOB', 'OFFER', 'MONEY', 'ACCOUNT', 'MARKETING'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface PushPreferences {
  jobUpdates: boolean;
  offers: boolean;
  marketing: boolean;
}

/**
 * Money and account messages are not optional and deliberately have no switch. Being told that
 * a payout failed, or that an account was suspended, is not marketing - somebody who turned it
 * off would find out by discovering the consequence, which is worse for them than an alert.
 */
export function mayPush(category: NotificationCategory, prefs: PushPreferences): boolean {
  switch (category) {
    case 'JOB':
      return prefs.jobUpdates;
    case 'OFFER':
      return prefs.offers;
    case 'MARKETING':
      return prefs.marketing;
    case 'MONEY':
    case 'ACCOUNT':
      return true;
  }
}

/** Which switch a notification type answers to. Anything unrecognised is treated as a job update. */
export function categoryForNotification(type: string): NotificationCategory {
  if (type.startsWith('payout.') || type.startsWith('payment.') || type.startsWith('refund.')) return 'MONEY';
  if (type.startsWith('account.') || type.startsWith('kyc.') || type.startsWith('dispute.')) return 'ACCOUNT';
  if (type.startsWith('bid.') || type.startsWith('offer.')) return 'OFFER';
  if (type.startsWith('promo.') || type.startsWith('marketing.')) return 'MARKETING';
  return 'JOB';
}

/**
 * A push notification is a line on a lock screen, seen by whoever is holding the phone. It
 * carries what happened and never what it is about: no address, no amount, no phone number.
 * The app fetches the detail once the person has unlocked it.
 */
const SENSITIVE_IN_PREVIEW = /(\+91\d{10}|\d{6,}|₹\s?\d|\bRs\.?\s?\d)/;

export function isSafePushPreview(body: string): boolean {
  return !SENSITIVE_IN_PREVIEW.test(body);
}

// ---------------------------------------------------------------------------
// Masked calling
// ---------------------------------------------------------------------------

export type CallBlocker =
  | 'JOB_NOT_CONFIRMED'
  | 'JOB_FINISHED'
  | 'NOT_ON_THIS_JOB'
  | 'TOO_MANY_CALLS'
  | 'OUTSIDE_CALLING_HOURS';

/**
 * Once the job is over, the reason to talk is over too, and a number that keeps working is a
 * leak. Typed against JobStatus on purpose: a status name that does not exist is a guard that
 * silently never matches, and the compiler should be the one to notice.
 */
const CALLABLE_STATUSES: readonly JobStatus[] = [
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
  'DISPUTED',
];

/**
 * A job that is actually happening right now. Calling hours do not apply to these: if somebody
 * is on their way to a burst pipe at eleven at night, the two of them plainly need to talk, and
 * a rule that stopped them would be protecting nobody.
 */
const UNDER_WAY: readonly JobStatus[] = [
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
];

const FINISHED: readonly JobStatus[] = [
  'COMPLETED',
  'SETTLED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'AUTO_CANCELLED',
  'REFUNDED',
  'ABANDONED',
];

/** Somebody ringing twenty times is harassment, not a connection problem. */
export const MAX_CALLS_PER_JOB_PER_DAY = 10;

export const CALLING_HOURS = { fromHour: 7, toHour: 22 } as const;

export function checkCanCall(input: {
  jobStatus: JobStatus;
  callerIsOnJob: boolean;
  callsToday: number;
  /** Local hour where the job is, 0-23. */
  localHour: number;
  /** Set when something is going wrong; it lifts the calling-hours limit like a live job does. */
  urgent?: boolean;
}): CallBlocker | null {
  if (!input.callerIsOnJob) return 'NOT_ON_THIS_JOB';
  if (!CALLABLE_STATUSES.includes(input.jobStatus)) {
    return FINISHED.includes(input.jobStatus) ? 'JOB_FINISHED' : 'JOB_NOT_CONFIRMED';
  }
  if (input.callsToday >= MAX_CALLS_PER_JOB_PER_DAY) return 'TOO_MANY_CALLS';

  // Calling hours exist so a booking three days out cannot be used to ring somebody at 2am.
  // They have no business applying to a job already under way.
  const exempt = input.urgent || UNDER_WAY.includes(input.jobStatus) || input.jobStatus === 'DISPUTED';
  if (!exempt && (input.localHour < CALLING_HOURS.fromHour || input.localHour >= CALLING_HOURS.toHour)) {
    return 'OUTSIDE_CALLING_HOURS';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

export type RescheduleBlocker =
  | 'JOB_NOT_RESCHEDULABLE'
  | 'ALREADY_UNDER_WAY'
  | 'TOO_MANY_RESCHEDULES'
  | 'TOO_LATE'
  | 'IN_THE_PAST'
  | 'TOO_FAR_AHEAD'
  | 'NOT_YOUR_JOB';

/**
 * Moving a booking twice is a change of plan. A third time is a provider holding a slot they
 * will never use, so the booking has to be cancelled and rebooked instead - which is honest
 * about the fact that the original agreement no longer holds.
 */
export const MAX_RESCHEDULES = 2;

/** Close to the hour, a provider may already be travelling. Moving it then is a cancellation. */
export const RESCHEDULE_NOTICE_MINUTES = 120;

export const RESCHEDULE_HORIZON_DAYS = 30;

/** Anything up to and including a booked slot that nobody has set out for yet. */
const RESCHEDULABLE: readonly JobStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'QUALIFYING',
  'OPEN_FOR_BIDS',
  'BID_RECEIVED',
  'NEGOTIATING',
  'CONFIRMED',
  'PROVIDER_ASSIGNED',
];

export function checkCanReschedule(input: {
  jobStatus: JobStatus;
  isCustomer: boolean;
  rescheduleCount: number;
  /** When the job is currently due to start; null when nothing was agreed yet. */
  currentStart: Date | null;
  newStart: Date;
  now: Date;
}): RescheduleBlocker | null {
  if (!input.isCustomer) return 'NOT_YOUR_JOB';
  if (!RESCHEDULABLE.includes(input.jobStatus)) {
    return UNDER_WAY.includes(input.jobStatus) ? 'ALREADY_UNDER_WAY' : 'JOB_NOT_RESCHEDULABLE';
  }
  if (input.rescheduleCount >= MAX_RESCHEDULES) return 'TOO_MANY_RESCHEDULES';

  const ms = input.newStart.getTime() - input.now.getTime();
  if (ms <= 0) return 'IN_THE_PAST';
  if (ms > RESCHEDULE_HORIZON_DAYS * 24 * 3600_000) return 'TOO_FAR_AHEAD';

  // Only a booked slot can be "too late" to move: before that, nobody has blocked time.
  if (input.currentStart && (input.jobStatus === 'PROVIDER_ASSIGNED' || input.jobStatus === 'CONFIRMED')) {
    const noticeMs = input.currentStart.getTime() - input.now.getTime();
    if (noticeMs < RESCHEDULE_NOTICE_MINUTES * 60_000) return 'TOO_LATE';
  }
  return null;
}

// ---------------------------------------------------------------------------
// A professional proposing a new time
// ---------------------------------------------------------------------------

/**
 * Rescheduling has been the customer's alone since it was built, which left a professional whose
 * van broke down with exactly one option: cancel. That costs them the job, costs the customer
 * their booking, and writes a cancellation onto a record that should have shown a rearranged
 * visit.
 *
 * A proposal is deliberately **not** a reschedule. The customer's time is theirs to arrange, so
 * this asks rather than tells, and nothing moves until they answer.
 */
export const SCHEDULE_PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const;
export type ScheduleProposalStatus = (typeof SCHEDULE_PROPOSAL_STATUSES)[number];

export type ProposalBlocker =
  | 'NOT_ON_THIS_JOB'
  | 'JOB_NOT_SCHEDULED'
  | 'ALREADY_PROPOSED'
  | 'IN_THE_PAST'
  | 'TOO_FAR_AHEAD'
  | 'REASON_REQUIRED';

/** A time can only be proposed on a booking that has one and has not started. */
const PROPOSABLE: readonly JobStatus[] = ['CONFIRMED', 'PROVIDER_ASSIGNED'];

/** A proposal nobody answers cannot hang over a booking forever. */
export const PROPOSAL_EXPIRES_HOURS = 24;

export function checkCanProposeTime(input: {
  jobStatus: JobStatus;
  isProviderOnJob: boolean;
  hasOpenProposal: boolean;
  newStart: Date;
  reason: string;
  now: Date;
}): ProposalBlocker | null {
  if (!input.isProviderOnJob) return 'NOT_ON_THIS_JOB';
  if (!PROPOSABLE.includes(input.jobStatus)) return 'JOB_NOT_SCHEDULED';
  // A second open proposal would leave the customer choosing between two times the professional
  // may no longer both have free.
  if (input.hasOpenProposal) return 'ALREADY_PROPOSED';
  // A customer deciding whether to accept a new time deserves to know why it moved.
  if (input.reason.trim().length < 10) return 'REASON_REQUIRED';

  const ms = input.newStart.getTime() - input.now.getTime();
  if (ms <= 0) return 'IN_THE_PAST';
  if (ms > RESCHEDULE_HORIZON_DAYS * 24 * 3600_000) return 'TOO_FAR_AHEAD';
  return null;
}

export function explainProposalBlocker(blocker: ProposalBlocker): string {
  switch (blocker) {
    case 'NOT_ON_THIS_JOB':
      return 'Only the professional booked for this job can suggest a new time.';
    case 'JOB_NOT_SCHEDULED':
      return 'This booking has no agreed time to move, or the work has already started.';
    case 'ALREADY_PROPOSED':
      return 'You have already suggested a time. Wait for their answer, or withdraw it first.';
    case 'IN_THE_PAST':
      return 'Suggest a time in the future.';
    case 'TOO_FAR_AHEAD':
      return 'Suggest a time within the next month.';
    case 'REASON_REQUIRED':
      return 'Say why the time needs to move - the customer is rearranging their day around this.';
  }
}

export function proposalExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PROPOSAL_EXPIRES_HOURS * 3600_000);
}

/** What the customer is told, in the terms they think in rather than the ones the code uses. */
export function explainRescheduleBlocker(blocker: RescheduleBlocker): string {
  switch (blocker) {
    case 'ALREADY_UNDER_WAY':
      return 'Work has already started on this booking. Message your professional to agree what happens next.';
    case 'TOO_MANY_RESCHEDULES':
      return 'This booking has already been moved twice. Cancel it and book again when you know the time that works.';
    case 'TOO_LATE':
      return 'Your professional may already be on the way. Call or message them instead of moving the time.';
    case 'IN_THE_PAST':
      return 'Choose a time in the future.';
    case 'TOO_FAR_AHEAD':
      return 'Bookings can be moved up to a month ahead.';
    case 'NOT_YOUR_JOB':
      return 'Only the person who made the booking can change its time.';
    case 'JOB_NOT_RESCHEDULABLE':
      return 'This booking cannot be moved any more.';
  }
}
