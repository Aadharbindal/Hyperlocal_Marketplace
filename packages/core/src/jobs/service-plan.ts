/**
 * Work that comes back.
 *
 * Almost everything a home needs is repeat work - the AC before summer, the RO filter, the
 * seasonal clean - and the pattern is always the same: the customer knows it is due, forgets
 * until something breaks, and the professional who did it last time never hears about it.
 *
 * A plan is a reminder that books itself. When an occurrence falls due the system creates an
 * ordinary job, which is then quoted, negotiated and paid for exactly as any other. Nothing in
 * the existing flow is bypassed, and in particular **nothing is charged automatically** - see
 * 0020 for why that is a deliberate refusal rather than a missing feature.
 *
 * The rules live here because they are all about somebody's time and money, and they have to be
 * arguable in a review rather than buried in a scheduler.
 */

/** The shortest and longest useful repeat. Below this is a staffing arrangement; above it, a note to self. */
export const MIN_INTERVAL_DAYS = 14;
export const MAX_INTERVAL_DAYS = 365;

/** How many days before the visit the booking opens, by default, so there is time to find somebody. */
export const DEFAULT_LEAD_DAYS = 3;

export type PlanStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

export interface PlanSchedule {
  status: PlanStatus;
  /** The date the work should happen, not the date the booking opens. */
  nextDueOn: Date;
  intervalDays: number;
  leadDays: number;
}

/** Midnight UTC for a date, so comparisons are about days rather than hours. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  const out = startOfDay(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Whether it is time to open the booking for this plan's next visit.
 *
 * Compared as whole days. An hours-based comparison would make a plan due at 09:14 on one
 * machine and 09:16 on another, and the only thing that would achieve is two sweeps disagreeing
 * about whether they had already booked it.
 */
export function isDueToBook(plan: PlanSchedule, now: Date): boolean {
  if (plan.status !== 'ACTIVE') return false;
  const opensOn = addDays(plan.nextDueOn, -plan.leadDays);
  return startOfDay(now).getTime() >= opensOn.getTime();
}

/**
 * The next due date after one has been dealt with.
 *
 * Counted **from the date that was due, not from today**. A plan set to every 90 days that is
 * booked two days late should still land on the original rhythm; measuring from the actual
 * booking date makes every small delay permanent, and after a year a quarterly service has
 * quietly drifted into a different season.
 *
 * The exception is a plan that has fallen far behind - a paused plan resumed after months - where
 * rolling forward one interval at a time would create a backlog of dates all in the past. Those
 * are advanced to the first future date instead, because nobody wants six catch-up bookings.
 */
export function advance(plan: PlanSchedule, now: Date): Date {
  let next = addDays(plan.nextDueOn, plan.intervalDays);
  const today = startOfDay(now);
  // A bounded loop, not a while(true): a corrupt interval must not hang the sweep.
  for (let i = 0; i < 1000 && next.getTime() <= today.getTime(); i++) {
    next = addDays(next, plan.intervalDays);
  }
  return next;
}

/** Why a due plan was not turned into a booking. Recorded, because silence looks like health. */
export type PlanSkipReason =
  | 'PAUSED'
  | 'CANCELLED'
  | 'ADDRESS_GONE'
  | 'CATEGORY_DISABLED'
  | 'ALREADY_OPEN';

export interface PlanBookCheck {
  status: PlanStatus;
  addressUsable: boolean;
  categoryEnabled: boolean;
  /** A booking from this plan that has not finished yet. */
  hasOpenJob: boolean;
}

/**
 * Whether a due plan may actually produce a booking now.
 *
 * `hasOpenJob` is the one that is easy to miss. A customer who has not got round to accepting
 * last month's offers should not wake up to a second identical booking - the plan waits, and the
 * occurrence is recorded as skipped with a reason rather than passing in silence.
 */
export function blockedFromBooking(c: PlanBookCheck): PlanSkipReason | null {
  if (c.status === 'CANCELLED') return 'CANCELLED';
  if (c.status === 'PAUSED') return 'PAUSED';
  if (!c.addressUsable) return 'ADDRESS_GONE';
  if (!c.categoryEnabled) return 'CATEGORY_DISABLED';
  if (c.hasOpenJob) return 'ALREADY_OPEN';
  return null;
}

/** Plain words for an interval, for a screen and for a notification. */
export function describeInterval(days: number): string {
  if (days % 365 === 0) return days === 365 ? 'every year' : `every ${days / 365} years`;
  if (days % 30 === 0) {
    const months = days / 30;
    if (months === 1) return 'every month';
    if (months === 3) return 'every 3 months';
    if (months === 6) return 'every 6 months';
    return `every ${months} months`;
  }
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? 'every week' : `every ${weeks} weeks`;
  }
  return `every ${days} days`;
}
