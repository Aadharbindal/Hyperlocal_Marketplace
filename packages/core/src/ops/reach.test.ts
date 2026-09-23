import { describe, expect, it } from 'vitest';
import type { JobStatus } from '../contracts/enums';
import {
  MAX_CALLS_PER_JOB_PER_DAY,
  categoryForNotification,
  checkCanCall,
  checkCanReschedule,
  isSafePushPreview,
  mayPush,
} from './reach';

describe('what may reach a phone', () => {
  const off = { jobUpdates: false, offers: false, marketing: false };
  const on = { jobUpdates: true, offers: true, marketing: true };

  it('respects the switches a person is given', () => {
    expect(mayPush('JOB', on)).toBe(true);
    expect(mayPush('JOB', off)).toBe(false);
    expect(mayPush('OFFER', off)).toBe(false);
    expect(mayPush('MARKETING', off)).toBe(false);
  });

  it('still tells someone about their money and their account', () => {
    // There is no switch for these on purpose: finding out by discovering the consequence is
    // worse for the person than an alert they did not ask for.
    expect(mayPush('MONEY', off)).toBe(true);
    expect(mayPush('ACCOUNT', off)).toBe(true);
  });

  it('files every notification type under a switch', () => {
    expect(categoryForNotification('job.arrived')).toBe('JOB');
    expect(categoryForNotification('bid.received')).toBe('OFFER');
    expect(categoryForNotification('payout.sent')).toBe('MONEY');
    expect(categoryForNotification('account.suspended')).toBe('ACCOUNT');
    expect(categoryForNotification('promo.diwali')).toBe('MARKETING');
    // Anything new is a job update until somebody decides otherwise - never marketing.
    expect(categoryForNotification('something.new')).toBe('JOB');
  });

  it('keeps a lock screen free of anything private', () => {
    expect(isSafePushPreview('Your professional is on the way')).toBe(true);
    expect(isSafePushPreview('Ramesh is outside your building')).toBe(true);
    // A preview is read by whoever is holding the phone, so no amounts, numbers or addresses
    expect(isSafePushPreview('Call Suresh on +919876543210')).toBe(false);
    expect(isSafePushPreview('You were paid ₹1,240')).toBe(false);
    expect(isSafePushPreview('Rs 500 refunded')).toBe(false);
    expect(isSafePushPreview('Arriving at 42, Green Park, 110016')).toBe(false);
  });
});

describe('talking without swapping numbers', () => {
  const base = { jobStatus: 'EN_ROUTE' as JobStatus, callerIsOnJob: true, callsToday: 0, localHour: 11 };

  it('connects two people on a live booking', () => {
    expect(checkCanCall(base)).toBeNull();
  });

  it('will not connect a stranger, or a job that is over', () => {
    expect(checkCanCall({ ...base, callerIsOnJob: false })).toBe('NOT_ON_THIS_JOB');
    // A masked number that keeps working after the job is a leak with extra steps
    expect(checkCanCall({ ...base, jobStatus: 'COMPLETED' })).toBe('JOB_FINISHED');
    expect(checkCanCall({ ...base, jobStatus: 'SETTLED' })).toBe('JOB_FINISHED');
    expect(checkCanCall({ ...base, jobStatus: 'OPEN_FOR_BIDS' })).toBe('JOB_NOT_CONFIRMED');
  });

  it('still connects a job in dispute, because that is when people most need to talk', () => {
    expect(checkCanCall({ ...base, jobStatus: 'DISPUTED' })).toBeNull();
  });

  it('stops repeated calling', () => {
    expect(checkCanCall({ ...base, callsToday: MAX_CALLS_PER_JOB_PER_DAY })).toBe('TOO_MANY_CALLS');
  });

  it('keeps a booking three days out from being used to ring somebody at 2am', () => {
    const scheduled = { ...base, jobStatus: 'PROVIDER_ASSIGNED' as JobStatus };
    expect(checkCanCall({ ...scheduled, localHour: 3 })).toBe('OUTSIDE_CALLING_HOURS');
    expect(checkCanCall({ ...scheduled, localHour: 23 })).toBe('OUTSIDE_CALLING_HOURS');
    expect(checkCanCall({ ...scheduled, localHour: 3, urgent: true })).toBeNull();
  });

  it('never gets in the way of a job that is happening right now', () => {
    // A burst pipe at eleven at night is exactly when two people need to talk. A calling-hours
    // rule that stopped them would be protecting nobody.
    expect(checkCanCall({ ...base, jobStatus: 'EN_ROUTE', localHour: 23 })).toBeNull();
    expect(checkCanCall({ ...base, jobStatus: 'ARRIVED', localHour: 2 })).toBeNull();
    expect(checkCanCall({ ...base, jobStatus: 'IN_PROGRESS', localHour: 5 })).toBeNull();
    expect(checkCanCall({ ...base, jobStatus: 'DISPUTED', localHour: 1 })).toBeNull();
  });
});

describe('moving a booking instead of losing it', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const base = {
    jobStatus: 'PROVIDER_ASSIGNED' as JobStatus,
    isCustomer: true,
    rescheduleCount: 0,
    currentStart: new Date('2026-09-25T09:00:00Z'),
    newStart: new Date('2026-09-26T09:00:00Z'),
    now,
  };

  it('lets a customer move a booking nobody has started', () => {
    expect(checkCanReschedule(base)).toBeNull();
    expect(checkCanReschedule({ ...base, jobStatus: 'OPEN_FOR_BIDS', currentStart: null })).toBeNull();
  });

  it('refuses once somebody is on their way or already working', () => {
    expect(checkCanReschedule({ ...base, jobStatus: 'EN_ROUTE' })).toBe('ALREADY_UNDER_WAY');
    expect(checkCanReschedule({ ...base, jobStatus: 'IN_PROGRESS' })).toBe('ALREADY_UNDER_WAY');
    expect(checkCanReschedule({ ...base, jobStatus: 'COMPLETED' })).toBe('JOB_NOT_RESCHEDULABLE');
  });

  it('refuses a third move, and one made at the last minute', () => {
    expect(checkCanReschedule({ ...base, rescheduleCount: 2 })).toBe('TOO_MANY_RESCHEDULES');
    // the provider may already have set out
    expect(checkCanReschedule({ ...base, currentStart: new Date('2026-09-23T11:00:00Z') })).toBe('TOO_LATE');
    // but before anyone is assigned, nobody has blocked time, so late is fine
    expect(
      checkCanReschedule({ ...base, jobStatus: 'OPEN_FOR_BIDS', currentStart: new Date('2026-09-23T11:00:00Z') }),
    ).toBeNull();
  });

  it('refuses a time that has been and gone, or one a month out', () => {
    expect(checkCanReschedule({ ...base, newStart: new Date('2026-09-22T09:00:00Z') })).toBe('IN_THE_PAST');
    expect(checkCanReschedule({ ...base, newStart: new Date('2026-12-01T09:00:00Z') })).toBe('TOO_FAR_AHEAD');
  });

  it('is the customer decision to make, not the provider one', () => {
    expect(checkCanReschedule({ ...base, isCustomer: false })).toBe('NOT_YOUR_JOB');
  });
});
