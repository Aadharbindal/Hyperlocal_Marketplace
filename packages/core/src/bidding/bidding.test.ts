import { describe, expect, it } from 'vitest';
import { bidWindowEnd, isOfferExpired, providerEligibility, rankScore, validateBid } from './bidding';

const base = {
  verificationStatus: 'VERIFIED' as const,
  roleStatus: 'ACTIVE' as const,
  isAvailable: true,
  distanceKm: 1.2,
  serviceRadiusKm: 3,
  providerSkillIds: ['tap', 'leak'],
  requiredSkillIds: ['leak'],
  categoryIds: ['plumbing'],
  jobCategoryId: 'plumbing',
  reliabilityScore: 4.5,
};

describe('bid windows', () => {
  it('uses 30 min normal and 10 min urgent', () => {
    const t = new Date('2026-01-01T10:00:00Z');
    expect(bidWindowEnd(t, 'NORMAL').toISOString()).toBe('2026-01-01T10:30:00.000Z');
    expect(bidWindowEnd(t, 'URGENT').toISOString()).toBe('2026-01-01T10:10:00.000Z');
  });
});

describe('provider eligibility', () => {
  it('accepts a verified, available, in-radius, skilled provider', () => {
    expect(providerEligibility(base)).toEqual({ eligible: true, reasons: [] });
  });
  it('lists every failing reason', () => {
    const r = providerEligibility({
      ...base,
      verificationStatus: 'SUBMITTED',
      isAvailable: false,
      distanceKm: 4,
      providerSkillIds: [],
      reliabilityScore: 1,
      suspendedUntil: new Date(Date.now() + 1000),
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining(['NOT_VERIFIED', 'UNAVAILABLE', 'OUT_OF_RADIUS', 'SKILL_MISMATCH', 'LOW_RELIABILITY', 'SUSPENDED']),
    );
  });
  it('rejects suspended role', () => {
    expect(providerEligibility({ ...base, roleStatus: 'SUSPENDED' }).reasons).toContain('ROLE_INACTIVE');
  });
});

describe('bid validation', () => {
  const ctx = {
    windowEndsAt: new Date(Date.now() + 60_000),
    existingActiveBidByProvider: false,
    revisionNo: 0,
    activeBidCount: 0,
  };
  const terms = { labourPaise: 50_000, visitFeePaise: 10_000, etaMinutes: 60, warrantyDays: 7 };
  it('accepts a valid bid', () => expect(validateBid(terms, ctx)).toEqual([]));
  it('rejects after window closes', () => {
    expect(validateBid(terms, { ...ctx, windowEndsAt: new Date(Date.now() - 1) })).toContain('WINDOW_CLOSED');
  });
  it('rejects duplicate active bid and more than two revisions', () => {
    expect(validateBid(terms, { ...ctx, existingActiveBidByProvider: true })).toContain('DUPLICATE_ACTIVE_BID');
    expect(validateBid(terms, { ...ctx, revisionNo: 3 })).toContain('TOO_MANY_REVISIONS');
    expect(validateBid(terms, { ...ctx, revisionNo: 2, existingActiveBidByProvider: true })).toEqual([]);
  });
  it('rejects bad amounts and ranges', () => {
    expect(validateBid({ ...terms, labourPaise: -1 }, ctx)).toContain('NEGATIVE_AMOUNT');
    expect(validateBid({ ...terms, labourPaise: 0, visitFeePaise: 0 }, ctx)).toContain('LABOUR_REQUIRED');
    expect(validateBid({ ...terms, etaMinutes: 5 }, ctx)).toContain('ETA_OUT_OF_RANGE');
    expect(validateBid({ ...terms, warrantyDays: 400 }, ctx)).toContain('WARRANTY_OUT_OF_RANGE');
  });
  it('caps active bids per job', () => {
    expect(validateBid(terms, { ...ctx, activeBidCount: 8 })).toContain('JOB_FULL');
  });
});

describe('offers and ranking', () => {
  it('expiry is inclusive of the expiry instant', () => {
    const t = new Date('2026-01-01T10:00:00Z');
    expect(isOfferExpired(t, new Date(t.getTime() - 1))).toBe(false);
    expect(isOfferExpired(t, t)).toBe(true);
  });
  it('does not rank by price alone', () => {
    const cheapUnreliable = rankScore(
      { labourPaise: 30_000, visitFeePaise: 0, etaMinutes: 180, distanceKm: 4, completedJobs: 1, reliabilityScore: 2, ratingAvg: 2.5, skillMatchRatio: 0.5 },
      { medianTotalPaise: 50_000 },
    );
    const fairReliable = rankScore(
      { labourPaise: 50_000, visitFeePaise: 0, etaMinutes: 45, distanceKm: 1, completedJobs: 60, reliabilityScore: 4.8, ratingAvg: 4.7, skillMatchRatio: 1 },
      { medianTotalPaise: 50_000 },
    );
    expect(fairReliable).toBeGreaterThan(cheapUnreliable);
  });
});
