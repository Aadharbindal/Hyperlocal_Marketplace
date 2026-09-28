import { describe, expect, it } from 'vitest';
import {
  REDISPATCH_INVITE_LIMIT,
  canRedispatch,
  planRedispatch,
  type RedispatchCandidate,
} from './redispatch';

/**
 * These tests are about fairness rather than mechanism, which is why the function under test is
 * pure and lives away from the routes. Each one below is a promise made to somebody: that the
 * person who walked away is not offered the job back, that nobody is asked for more money than
 * they agreed to, and that being let down does not silently downgrade who turns up.
 */

const ranking = {
  labourPaise: 50_000,
  visitFeePaise: 10_000,
  etaMinutes: 60,
  distanceKm: 2,
  completedJobs: 20,
  reliabilityScore: 4.5,
  ratingAvg: 4.5,
  skillMatchRatio: 1,
};

function candidate(over: Partial<RedispatchCandidate> & { providerId: string }): RedispatchCandidate {
  return {
    bidId: `bid-${over.providerId}`,
    totalPaise: 60_000,
    bidStatus: 'INACTIVE',
    ranking,
    ...over,
  };
}

const ctx = {
  droppedByProviderId: 'dropper',
  authorisedTotalPaise: 60_000,
  alreadyInvitedProviderIds: [],
  medianTotalPaise: 60_000,
};

describe('who gets asked when a provider drops a booking', () => {
  it('goes back to the people whose offers merely lost', () => {
    const plan = planRedispatch([candidate({ providerId: 'p1' }), candidate({ providerId: 'p2' })], ctx);
    expect(plan.invite.map((c) => c.providerId)).toEqual(['p1', 'p2']);
  });

  it('never offers the job back to whoever just walked away from it', () => {
    const plan = planRedispatch([candidate({ providerId: 'dropper' }), candidate({ providerId: 'p1' })], ctx);
    expect(plan.invite.map((c) => c.providerId)).toEqual(['p1']);
    expect(plan.skipped).toContainEqual({ providerId: 'dropper', reason: 'DROPPED_THIS_JOB' });
  });

  it('does not ask the same person twice on one job', () => {
    const plan = planRedispatch([candidate({ providerId: 'p1' })], { ...ctx, alreadyInvitedProviderIds: ['p1'] });
    expect(plan.invite).toHaveLength(0);
    expect(plan.skipped).toContainEqual({ providerId: 'p1', reason: 'ALREADY_INVITED' });
  });

  it('leaves alone anybody who withdrew their own offer', () => {
    // INACTIVE means somebody else won - that is the group this feature exists for. WITHDRAWN is
    // the provider's own decision to leave, and re-asking them ignores it.
    const plan = planRedispatch([candidate({ providerId: 'p1', bidStatus: 'WITHDRAWN' })], ctx);
    expect(plan.invite).toHaveLength(0);
    expect(plan.skipped).toContainEqual({ providerId: 'p1', reason: 'WITHDRAWN' });
  });

  it('never invites somebody who costs more than the customer already authorised', () => {
    // The whole point is to rescue a booking, not to turn a provider's cancellation into a
    // request for more money from the person it was done to.
    const plan = planRedispatch(
      [candidate({ providerId: 'dear', totalPaise: 60_001 }), candidate({ providerId: 'ok', totalPaise: 60_000 })],
      ctx,
    );
    expect(plan.invite.map((c) => c.providerId)).toEqual(['ok']);
    expect(plan.skipped).toContainEqual({ providerId: 'dear', reason: 'COSTS_MORE_THAN_AUTHORISED' });
  });

  it('ranks the invitations the way the original list was ranked, not by price', () => {
    // The cheap candidate is far away, slow, inexperienced and unreliable. A customer who has
    // already been let down once today is not owed the cheapest possible replacement.
    const cheapButBad = candidate({
      providerId: 'cheap',
      totalPaise: 20_000,
      ranking: { ...ranking, distanceKm: 4.8, etaMinutes: 230, completedJobs: 0, reliabilityScore: 1, ratingAvg: 2 },
    });
    const dearerButGood = candidate({ providerId: 'good', totalPaise: 58_000 });

    const plan = planRedispatch([cheapButBad, dearerButGood], ctx);
    expect(plan.invite[0]?.providerId).toBe('good');
  });

  it('asks several people at once rather than one at a time', () => {
    // Sequential invitations with a clock each mean a customer whose first three candidates are
    // asleep waits an hour to learn the answer is no.
    const many = Array.from({ length: 9 }, (_, i) => candidate({ providerId: `p${i}` }));
    const plan = planRedispatch(many, ctx);
    expect(plan.invite).toHaveLength(REDISPATCH_INVITE_LIMIT);
  });

  it('returns an empty plan rather than throwing when nobody is left', () => {
    // A booking with no replacement available is an ordinary outcome, and the caller has to tell
    // the customer so. It is not an error condition.
    expect(planRedispatch([], ctx).invite).toEqual([]);
  });
});

describe('when a booking may be rescued at all', () => {
  it('covers everything up to the moment somebody is at the door', () => {
    expect(canRedispatch('CONFIRMED')).toBe(true);
    expect(canRedispatch('PROVIDER_ASSIGNED')).toBe(true);
    expect(canRedispatch('EN_ROUTE')).toBe(true);
  });

  it('stops once there is a half-finished job in somebody home', () => {
    // Sending a stranger to a dismantled geyser is a second problem, not a rescue. Support
    // handles these, which is the same line `cancellationNeedsSupport` draws for the other side.
    for (const s of ['ARRIVED', 'STARTED', 'IN_PROGRESS', 'COMPLETION_PENDING']) {
      expect(canRedispatch(s)).toBe(false);
    }
  });

  it('does not try to rescue a booking that never had a provider', () => {
    for (const s of ['DRAFT', 'OPEN_FOR_BIDS', 'BID_RECEIVED', 'PAYMENT_PENDING']) {
      expect(canRedispatch(s)).toBe(false);
    }
  });
});
