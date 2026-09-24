import { z } from 'zod';
import { FEED_SORTS } from '../bidding/feed-filters';
import { JOB_PRIORITIES, JOB_REQUEST_TYPES } from './enums';
import { PROMO_KINDS, REFERRAL_STATUSES } from '../growth/growth';

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * A receipt a customer can keep, forward or claim against. Every figure is snapshotted at the
 * moment of issue: if a later correction changes the ledger that is a credit note, not a quiet
 * edit to a document somebody has already filed.
 */
export const InvoiceView = z.object({
  id: z.string().uuid(),
  number: z.string(),
  jobId: z.string().uuid(),
  issuedAt: z.string(),
  providerName: z.string(),
  categoryName: z.string(),
  serviceAddress: z.string().nullable(),
  lines: z.object({
    labourPaise: z.number().int(),
    visitFeePaise: z.number().int(),
    materialPaise: z.number().int(),
    deliveryPaise: z.number().int(),
    platformFeePaise: z.number().int(),
    protectionFeePaise: z.number().int(),
    discountPaise: z.number().int(),
    taxPaise: z.number().int(),
  }),
  totalPaise: z.number().int(),
  refundedPaise: z.number().int(),
  /** What actually left the customer's account, after anything that came back. */
  netPaise: z.number().int(),
});
export type InvoiceView = z.infer<typeof InvoiceView>;

// ---------------------------------------------------------------------------
// Favourites and rebooking
// ---------------------------------------------------------------------------

export const FavouriteBody = z.object({ note: z.string().trim().max(200).optional() }).strict();
export type FavouriteBody = z.infer<typeof FavouriteBody>;

export const FavouriteProviderView = z.object({
  providerId: z.string().uuid(),
  businessName: z.string(),
  /** A first name only, the same as everywhere else a counterparty is shown. */
  contactName: z.string().nullable(),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
  categories: z.array(z.string()),
  /** Whether they can actually be asked right now, so the button can say so honestly. */
  available: z.boolean(),
  verified: z.boolean(),
  jobsTogether: z.number().int(),
  lastJobAt: z.string().nullable(),
  /** The job worth repeating, so "book again" does not need the client to go looking. */
  lastJobId: z.string().uuid().nullable(),
  note: z.string().nullable(),
});
export type FavouriteProviderView = z.infer<typeof FavouriteProviderView>;

/** Booking the same work again: the category and address are taken from the earlier job. */
export const RebookBody = z
  .object({
    /** Leave out to open the job to everyone, as normal. */
    preferProviderId: z.string().uuid().optional(),
    description: z.string().trim().max(1500).optional(),
    preferredStart: z.string().datetime().optional(),
  })
  .strict();
export type RebookBody = z.infer<typeof RebookBody>;

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

export const ApplyPromoBody = z.object({ code: z.string().trim().min(3).max(24) }).strict();
export type ApplyPromoBody = z.infer<typeof ApplyPromoBody>;

export const PromoPreview = z.object({
  code: z.string(),
  kind: z.enum(PROMO_KINDS),
  discountPaise: z.number().int(),
  /** What the booking comes to with the code applied. */
  newTotalPaise: z.number().int(),
  description: z.string(),
});
export type PromoPreview = z.infer<typeof PromoPreview>;

export const AdminPromoBody = z
  .object({
    code: z.string().trim().min(3).max(24),
    kind: z.enum(PROMO_KINDS),
    /** Paise for FLAT, basis points for PERCENT. */
    value: z.number().int().positive(),
    maxDiscountPaise: z.number().int().positive().optional(),
    minOrderPaise: z.number().int().min(0).default(0),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    maxRedemptions: z.number().int().positive().optional(),
    maxPerCustomer: z.number().int().positive().default(1),
    firstJobOnly: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.kind !== 'PERCENT' || b.maxDiscountPaise !== undefined, {
    message: 'A percentage code needs a maximum discount; an uncapped one is an unbounded liability',
  });
export type AdminPromoBody = z.infer<typeof AdminPromoBody>;

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export const ReferralView = z.object({
  /** The caller's own code, to share. */
  code: z.string(),
  rewardPaise: z.number().int(),
  /** How it works, in one sentence, so nobody has to guess when they get paid. */
  terms: z.string(),
  invited: z.number().int(),
  qualified: z.number().int(),
  earnedPaise: z.number().int(),
  people: z.array(
    z.object({
      name: z.string(),
      status: z.enum(REFERRAL_STATUSES),
      joinedAt: z.string(),
      rewardPaise: z.number().int(),
    }),
  ),
});
export type ReferralView = z.infer<typeof ReferralView>;

export const ClaimReferralBody = z.object({ code: z.string().trim().min(4).max(12) }).strict();
export type ClaimReferralBody = z.infer<typeof ClaimReferralBody>;

// ---------------------------------------------------------------------------
// Feed filters
// ---------------------------------------------------------------------------

/** Query parameters on the nearby feed. Comma-separated lists, because these arrive in a URL. */
export const FeedFilterQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    categoryIds: z.string().optional(),
    maxDistanceKm: z.coerce.number().min(0.5).max(50).optional(),
    priorities: z.string().optional(),
    requestTypes: z.string().optional(),
    maxBids: z.coerce.number().int().min(0).max(50).optional(),
    hideMyBids: z.coerce.boolean().optional(),
    withMediaOnly: z.coerce.boolean().optional(),
    sort: z.enum(FEED_SORTS).optional(),
  })
  .strict();
export type FeedFilterQuery = z.infer<typeof FeedFilterQuery>;

/** The filter values a provider is offered, built from what is actually in their feed today. */
export const FeedFacetsView = z.object({
  categories: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int() })),
  priorities: z.array(z.object({ value: z.enum(JOB_PRIORITIES), count: z.number().int() })),
  requestTypes: z.array(z.object({ value: z.enum(JOB_REQUEST_TYPES), count: z.number().int() })),
  furthestKm: z.number(),
  total: z.number().int(),
});
export type FeedFacetsView = z.infer<typeof FeedFacetsView>;
