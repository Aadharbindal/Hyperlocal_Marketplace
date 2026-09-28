import { describe, expect, it } from 'vitest';
import {
  addDays,
  advance,
  blockedFromBooking,
  describeInterval,
  isDueToBook,
  type PlanSchedule,
} from './service-plan';

const plan = (over: Partial<PlanSchedule> = {}): PlanSchedule => ({
  status: 'ACTIVE',
  nextDueOn: new Date('2026-06-01T00:00:00Z'),
  intervalDays: 90,
  leadDays: 3,
  ...over,
});

describe('when a plan opens its next booking', () => {
  it('opens it the lead time before the visit, not on the day', () => {
    // A booking opened on the morning of the visit has no time to find anybody.
    expect(isDueToBook(plan(), new Date('2026-05-28T00:00:00Z'))).toBe(false);
    expect(isDueToBook(plan(), new Date('2026-05-29T00:00:00Z'))).toBe(true);
  });

  it('compares whole days, not hours', () => {
    // Otherwise a plan is due at 09:14 on one machine and 09:16 on another, and two sweeps
    // disagree about whether they have already booked it.
    expect(isDueToBook(plan(), new Date('2026-05-29T23:59:00Z'))).toBe(true);
    expect(isDueToBook(plan(), new Date('2026-05-29T00:00:01Z'))).toBe(true);
  });

  it('stays quiet while paused or cancelled', () => {
    const late = new Date('2026-09-01T00:00:00Z');
    expect(isDueToBook(plan({ status: 'PAUSED' }), late)).toBe(false);
    expect(isDueToBook(plan({ status: 'CANCELLED' }), late)).toBe(false);
  });
});

describe('moving to the next date', () => {
  it('counts from the date that was due, not from today', () => {
    // Measuring from the actual booking date makes every small delay permanent: after a year a
    // quarterly service has quietly drifted into a different season.
    const bookedTwoDaysLate = new Date('2026-06-03T00:00:00Z');
    expect(advance(plan(), bookedTwoDaysLate)).toEqual(new Date('2026-08-30T00:00:00Z'));
  });

  it('does not create a backlog when a plan has been asleep for months', () => {
    // A plan resumed after a year should book once, not produce four catch-up visits.
    const muchLater = new Date('2027-06-01T00:00:00Z');
    const next = advance(plan(), muchLater);
    expect(next.getTime()).toBeGreaterThan(muchLater.getTime());
    expect(next.getTime()).toBeLessThanOrEqual(addDays(muchLater, 90).getTime());
  });

  it('always lands in the future', () => {
    for (const interval of [14, 30, 90, 365]) {
      const next = advance(plan({ intervalDays: interval }), new Date('2026-12-25T00:00:00Z'));
      expect(next.getTime()).toBeGreaterThan(new Date('2026-12-25T00:00:00Z').getTime());
    }
  });
});

describe('when a due plan must not book', () => {
  const ok = { status: 'ACTIVE' as const, addressUsable: true, categoryEnabled: true, hasOpenJob: false };

  it('books when nothing is in the way', () => {
    expect(blockedFromBooking(ok)).toBeNull();
  });

  it('waits rather than stacking a second booking on an unfinished one', () => {
    // A customer who has not got round to accepting last month's offers should not wake up to a
    // second identical booking.
    expect(blockedFromBooking({ ...ok, hasOpenJob: true })).toBe('ALREADY_OPEN');
  });

  it('stops when the address is gone', () => {
    // People move. Booking a visit to an address they deleted is worse than not booking.
    expect(blockedFromBooking({ ...ok, addressUsable: false })).toBe('ADDRESS_GONE');
  });

  it('stops when the category has since been switched off', () => {
    expect(blockedFromBooking({ ...ok, categoryEnabled: false })).toBe('CATEGORY_DISABLED');
  });

  it('reports paused and cancelled distinctly', () => {
    // Different facts: one is a customer taking a break, the other is a plan that is over.
    expect(blockedFromBooking({ ...ok, status: 'PAUSED' })).toBe('PAUSED');
    expect(blockedFromBooking({ ...ok, status: 'CANCELLED' })).toBe('CANCELLED');
  });
});

describe('saying the interval in words', () => {
  it('uses the words people use', () => {
    expect(describeInterval(30)).toBe('every month');
    expect(describeInterval(90)).toBe('every 3 months');
    expect(describeInterval(180)).toBe('every 6 months');
    expect(describeInterval(365)).toBe('every year');
    expect(describeInterval(14)).toBe('every 2 weeks');
    expect(describeInterval(45)).toBe('every 45 days');
  });
});
