import { rankScore, type RankableBid } from '../bidding/bidding';

/**
 * Finding the booking another professional, after the first one walked away.
 *
 * The rules live here, away from the database and the routes, because every one of them is a
 * judgement about fairness rather than a mechanism - who may be asked, at what price, for how
 * long - and those are the parts that have to be arguable in a review and provable in a test.
 *
 * The shape of the answer is deliberately an *invitation*, not an assignment. A bid somebody
 * placed on Tuesday is not consent to be given the job on Thursday afternoon: they may be on
 * another roof by then. Uber re-dispatches by offering with a short clock, and so does this.
 */

/** A losing offer, as it sits in the table after somebody else won the job. */
export interface RedispatchCandidate {
  bidId: string;
  providerId: string;
  /** What this provider asked for, all in. They are re-invited at their own number, not another's. */
  totalPaise: number;
  /** Offers are marked INACTIVE when a rival wins; WITHDRAWN means they pulled out themselves. */
  bidStatus: string;
  ranking: RankableBid;
}

export interface RedispatchContext {
  /** The provider who just dropped the booking. Never re-invited to it. */
  droppedByProviderId: string;
  /**
   * What the customer already authorised. Nobody dearer is invited, so a re-dispatch can never
   * quietly become a request for more money from somebody whose day has already been ruined.
   */
  authorisedTotalPaise: number;
  /** Providers already asked on this job, whatever they said. Nobody is asked twice. */
  alreadyInvitedProviderIds: readonly string[];
  /** Used to score price relative to the field, exactly as the original ranking does. */
  medianTotalPaise: number;
}

/** Why a candidate was passed over, for the support answer to "why wasn't X asked?". */
export type RedispatchSkipReason =
  | 'DROPPED_THIS_JOB'
  | 'ALREADY_INVITED'
  | 'WITHDRAWN'
  | 'COSTS_MORE_THAN_AUTHORISED';

export interface RedispatchPlan {
  invite: RedispatchCandidate[];
  skipped: Array<{ providerId: string; reason: RedispatchSkipReason }>;
}

/**
 * How many people are asked at once.
 *
 * Everyone eligible, rather than one at a time. Asking sequentially with a fifteen-minute clock
 * each means a customer whose first three candidates are asleep waits an hour to find out the
 * answer is no - and the whole point of this feature is that they have already been let down
 * once today. First to accept wins; the unique index in 0018 makes that safe rather than hopeful.
 */
export const REDISPATCH_INVITE_LIMIT = 5;

/** How long the invited professionals have. Short, because somebody is waiting at home. */
export const REDISPATCH_WINDOW_MINUTES = 20;

/**
 * What one dropped booking costs the professional's reliability score, out of 5.
 *
 * Small on purpose. A single bad morning - a child ill, a van that would not start - should not
 * cost somebody their livelihood, and a penalty large enough to do that mostly teaches people to
 * go silent and no-show instead, which is worse for the customer. It is the repetition that
 * matters, and repetition is what an accumulating score is good at measuring.
 */
export const REDISPATCH_RELIABILITY_PENALTY = 0.25;

export function planRedispatch(candidates: readonly RedispatchCandidate[], ctx: RedispatchContext): RedispatchPlan {
  const invited = new Set(ctx.alreadyInvitedProviderIds);
  const skipped: RedispatchPlan['skipped'] = [];
  const eligible: RedispatchCandidate[] = [];

  for (const c of candidates) {
    if (c.providerId === ctx.droppedByProviderId) {
      skipped.push({ providerId: c.providerId, reason: 'DROPPED_THIS_JOB' });
      continue;
    }
    if (invited.has(c.providerId)) {
      skipped.push({ providerId: c.providerId, reason: 'ALREADY_INVITED' });
      continue;
    }
    // WITHDRAWN is the provider's own decision to leave; INACTIVE only means somebody else won,
    // which is exactly the group this feature exists to go back to.
    if (c.bidStatus === 'WITHDRAWN') {
      skipped.push({ providerId: c.providerId, reason: 'WITHDRAWN' });
      continue;
    }
    if (c.totalPaise > ctx.authorisedTotalPaise) {
      skipped.push({ providerId: c.providerId, reason: 'COSTS_MORE_THAN_AUTHORISED' });
      continue;
    }
    eligible.push(c);
  }

  // Same ranking as the original offer list: never price-only. The customer chose on a blend of
  // distance, rating, experience and reliability the first time, and being let down does not
  // mean they now want whoever is cheapest.
  eligible.sort((a, b) => rankScore(b.ranking, { medianTotalPaise: ctx.medianTotalPaise }) - rankScore(a.ranking, { medianTotalPaise: ctx.medianTotalPaise }));

  return { invite: eligible.slice(0, REDISPATCH_INVITE_LIMIT), skipped };
}

/**
 * Whether a booking this far along may be re-dispatched at all.
 *
 * Only before anyone has arrived. Once a professional is at the door or has started work there
 * is a half-finished job, a customer who has met somebody, and often a dismantled geyser -
 * sending a stranger to that is not a rescue, it is a second problem. Those cases go to support,
 * which is what `cancellationNeedsSupport` already decides for the other side.
 */
export function canRedispatch(status: string): boolean {
  return status === 'CONFIRMED' || status === 'PROVIDER_ASSIGNED' || status === 'EN_ROUTE';
}

/**
 * The honest summary for the customer's screen while this is happening.
 *
 * Written here rather than in the app because the app must not be able to imply more certainty
 * than the system has. There is no promise that somebody will be found.
 */
export function redispatchStatusKey(invitedCount: number): string {
  return invitedCount > 0 ? 'status.redispatching' : 'status.redispatching_none';
}
