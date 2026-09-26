import { describe, expect, it } from 'vitest';
import type { JobStatus } from '../contracts/enums';
import { PROPOSAL_EXPIRES_HOURS, checkCanProposeTime, explainProposalBlocker, proposalExpiresAt } from './reach';

const now = new Date('2026-09-26T10:00:00Z');

const base = {
  jobStatus: 'PROVIDER_ASSIGNED' as JobStatus,
  isProviderOnJob: true,
  hasOpenProposal: false,
  newStart: new Date('2026-09-28T09:00:00Z'),
  reason: 'My van has broken down and the part arrives tomorrow.',
  now,
};

describe('a professional suggesting a new time', () => {
  it('lets the booked professional suggest one', () => {
    expect(checkCanProposeTime(base)).toBeNull();
    expect(checkCanProposeTime({ ...base, jobStatus: 'CONFIRMED' })).toBeNull();
  });

  it('is only for the professional actually booked', () => {
    expect(checkCanProposeTime({ ...base, isProviderOnJob: false })).toBe('NOT_ON_THIS_JOB');
  });

  it('refuses a booking with no time to move, or one already under way', () => {
    expect(checkCanProposeTime({ ...base, jobStatus: 'OPEN_FOR_BIDS' })).toBe('JOB_NOT_SCHEDULED');
    expect(checkCanProposeTime({ ...base, jobStatus: 'EN_ROUTE' })).toBe('JOB_NOT_SCHEDULED');
    expect(checkCanProposeTime({ ...base, jobStatus: 'COMPLETED' })).toBe('JOB_NOT_SCHEDULED');
  });

  it('keeps one suggestion open at a time', () => {
    // Two open proposals would leave the customer choosing between times the professional may
    // no longer both have free.
    expect(checkCanProposeTime({ ...base, hasOpenProposal: true })).toBe('ALREADY_PROPOSED');
  });

  it('insists on a reason, because the customer is rearranging their day', () => {
    expect(checkCanProposeTime({ ...base, reason: 'busy' })).toBe('REASON_REQUIRED');
    expect(checkCanProposeTime({ ...base, reason: '   ' })).toBe('REASON_REQUIRED');
    expect(explainProposalBlocker('REASON_REQUIRED')).toContain('rearranging their day');
  });

  it('refuses a time that has gone, or one a month out', () => {
    expect(checkCanProposeTime({ ...base, newStart: new Date('2026-09-25T09:00:00Z') })).toBe('IN_THE_PAST');
    expect(checkCanProposeTime({ ...base, newStart: new Date('2026-12-01T09:00:00Z') })).toBe('TOO_FAR_AHEAD');
  });

  it('expires, so a suggestion cannot hang over a booking forever', () => {
    expect(proposalExpiresAt(now).getTime() - now.getTime()).toBe(PROPOSAL_EXPIRES_HOURS * 3600_000);
  });
});
