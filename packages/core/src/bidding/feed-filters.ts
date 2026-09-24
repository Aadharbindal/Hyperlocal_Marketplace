import type { JobPriority, JobRequestType } from '../contracts/enums';

/**
 * Filters and sorting on a provider's nearby feed (PRODUCT_SPEC section 5).
 *
 * These run on the server, not in the app, for a reason that matters: the feed is already
 * trimmed to what a provider is *eligible* for, and eligibility is not something a client gets
 * to widen. A filter can only ever narrow what the server already decided to show.
 */

export const FEED_SORTS = ['NEAREST', 'NEWEST', 'BIGGEST', 'FEWEST_BIDS', 'SOONEST'] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

export interface FeedFilters {
  categoryIds?: string[];
  /** Kilometres. Never widens the provider's own service radius, only narrows within it. */
  maxDistanceKm?: number;
  priorities?: JobPriority[];
  requestTypes?: JobRequestType[];
  /** Hide jobs that already have a crowd - a tenth bid is rarely worth writing. */
  maxBids?: number;
  /** Hide anything already bid on, which is the common case once a feed is being worked through. */
  hideMyBids?: boolean;
  /** Only jobs with photos or a voice note, which are the ones that can be priced honestly. */
  withMediaOnly?: boolean;
  sort?: FeedSort;
}

/** What a feed item has to expose for filtering; deliberately less than the full view. */
export interface FilterableJob {
  categoryId: string;
  distanceKm: number;
  priority: JobPriority;
  requestType: JobRequestType;
  bidCount: number;
  hasMyBid: boolean;
  hasMedia: boolean;
  postedAt: Date;
  preferredStart: Date | null;
  /** The best available guess at what the job is worth, for sorting by size. */
  estimatedValuePaise: number;
}

export function matchesFilters(job: FilterableJob, filters: FeedFilters): boolean {
  if (filters.categoryIds?.length && !filters.categoryIds.includes(job.categoryId)) return false;
  if (filters.maxDistanceKm !== undefined && job.distanceKm > filters.maxDistanceKm) return false;
  if (filters.priorities?.length && !filters.priorities.includes(job.priority)) return false;
  if (filters.requestTypes?.length && !filters.requestTypes.includes(job.requestType)) return false;
  if (filters.maxBids !== undefined && job.bidCount > filters.maxBids) return false;
  if (filters.hideMyBids && job.hasMyBid) return false;
  if (filters.withMediaOnly && !job.hasMedia) return false;
  return true;
}

/**
 * Sorting. `NEAREST` is the default because travel time is the cost a local professional
 * actually feels: a job worth more two towns over is usually worth less than one down the road.
 */
export function compareForSort(sort: FeedSort): (a: FilterableJob, b: FilterableJob) => number {
  switch (sort) {
    case 'NEWEST':
      return (a, b) => b.postedAt.getTime() - a.postedAt.getTime();
    case 'BIGGEST':
      return (a, b) => b.estimatedValuePaise - a.estimatedValuePaise;
    case 'FEWEST_BIDS':
      // Ties broken by distance, so "nobody has bid" does not mean "drive across the city".
      return (a, b) => a.bidCount - b.bidCount || a.distanceKm - b.distanceKm;
    case 'SOONEST':
      // Jobs with no preferred time sit after the ones that have one, not in front of them.
      return (a, b) => (a.preferredStart?.getTime() ?? Infinity) - (b.preferredStart?.getTime() ?? Infinity);
    case 'NEAREST':
    default:
      return (a, b) => a.distanceKm - b.distanceKm;
  }
}

/**
 * A short, honest sentence for when a filter leaves nothing behind. An empty feed with no
 * explanation reads as "there is no work", which is a different and much worse message than
 * "your filters are narrow".
 */
export function explainEmptyFeed(filters: FeedFilters, hadResultsBeforeFilters: boolean): string {
  if (!hadResultsBeforeFilters) return 'No open jobs near you right now. We will notify you when one appears.';
  const narrowed: string[] = [];
  if (filters.maxDistanceKm !== undefined) narrowed.push(`within ${filters.maxDistanceKm} km`);
  if (filters.categoryIds?.length) narrowed.push('in these categories');
  if (filters.maxBids !== undefined) narrowed.push('with few bids');
  if (filters.withMediaOnly) narrowed.push('with photos');
  if (filters.hideMyBids) narrowed.push('you have not bid on');
  return narrowed.length
    ? `There is work nearby, but none ${narrowed.join(', ')}. Try widening your filters.`
    : 'There is work nearby, but none matching your filters.';
}
