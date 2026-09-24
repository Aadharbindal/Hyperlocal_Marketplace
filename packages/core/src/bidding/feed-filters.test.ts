import { describe, expect, it } from 'vitest';
import { compareForSort, explainEmptyFeed, matchesFilters, type FilterableJob } from './feed-filters';

const job = (over: Partial<FilterableJob> = {}): FilterableJob => ({
  categoryId: 'plumbing',
  distanceKm: 2,
  priority: 'NORMAL',
  requestType: 'LABOUR_ONLY',
  bidCount: 1,
  hasMyBid: false,
  hasMedia: true,
  postedAt: new Date('2026-09-24T09:00:00Z'),
  preferredStart: new Date('2026-09-25T09:00:00Z'),
  estimatedValuePaise: 70_000,
  ...over,
});

describe('narrowing a feed', () => {
  it('keeps everything when nothing is asked for', () => {
    expect(matchesFilters(job(), {})).toBe(true);
  });

  it('filters on the things a professional actually decides by', () => {
    expect(matchesFilters(job(), { categoryIds: ['electrical'] })).toBe(false);
    expect(matchesFilters(job({ distanceKm: 9 }), { maxDistanceKm: 5 })).toBe(false);
    expect(matchesFilters(job(), { priorities: ['URGENT'] })).toBe(false);
    expect(matchesFilters(job(), { requestTypes: ['LABOUR_AND_MATERIAL'] })).toBe(false);
    // a tenth bid is rarely worth writing
    expect(matchesFilters(job({ bidCount: 12 }), { maxBids: 5 })).toBe(false);
    expect(matchesFilters(job({ hasMyBid: true }), { hideMyBids: true })).toBe(false);
    // a job with no photo cannot be priced honestly
    expect(matchesFilters(job({ hasMedia: false }), { withMediaOnly: true })).toBe(false);
  });

  it('sorts by what costs a local professional most, by default', () => {
    // Travel time, not value: a bigger job two towns over is usually worth less than one down
    // the road.
    const near = job({ distanceKm: 1, estimatedValuePaise: 20_000 });
    const far = job({ distanceKm: 20, estimatedValuePaise: 500_000 });
    expect([far, near].sort(compareForSort('NEAREST'))[0]).toBe(near);
    expect([near, far].sort(compareForSort('BIGGEST'))[0]).toBe(far);
  });

  it('does not send somebody across the city just because nobody bid', () => {
    const quietFar = job({ bidCount: 0, distanceKm: 18 });
    const quietNear = job({ bidCount: 0, distanceKm: 2 });
    const busyNear = job({ bidCount: 6, distanceKm: 1 });
    const sorted = [busyNear, quietFar, quietNear].sort(compareForSort('FEWEST_BIDS'));
    expect(sorted[0]).toBe(quietNear);
    expect(sorted[2]).toBe(busyNear);
  });

  it('puts jobs with no chosen time after the ones that have one', () => {
    const noTime = job({ preferredStart: null });
    const soon = job({ preferredStart: new Date('2026-09-24T12:00:00Z') });
    expect([noTime, soon].sort(compareForSort('SOONEST'))[0]).toBe(soon);
  });

  it('says why a feed is empty, which is not the same as saying there is no work', () => {
    expect(explainEmptyFeed({}, false)).toContain('No open jobs near you');
    const narrowed = explainEmptyFeed({ maxDistanceKm: 3, withMediaOnly: true }, true);
    expect(narrowed).toContain('There is work nearby');
    expect(narrowed).toContain('within 3 km');
    expect(narrowed).toContain('with photos');
  });
});
