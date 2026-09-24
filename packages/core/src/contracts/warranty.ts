import { z } from 'zod';
import { MODERATION_OUTCOMES, EXPORT_SECTIONS } from '../trust/trust';
import { WARRANTY_CLAIM_STATUSES, WARRANTY_RESPONSES } from '../warranty/warranty';
import { VERIFICATION_STATUSES } from './enums';

// ---------------------------------------------------------------------------
// Warranty claims
// ---------------------------------------------------------------------------

export const RaiseWarrantyClaimBody = z
  .object({
    description: z.string().trim().min(20).max(1500),
    mediaIds: z.array(z.string().uuid()).max(8).optional(),
  })
  .strict();
export type RaiseWarrantyClaimBody = z.infer<typeof RaiseWarrantyClaimBody>;

export const RespondToClaimBody = z
  .object({
    response: z.enum(WARRANTY_RESPONSES),
    /** Required when declining: the customer is owed a reason, and support will need one. */
    reason: z.string().trim().max(1000).optional(),
    /** When accepting, when the professional can come back. */
    proposedStart: z.string().datetime().optional(),
  })
  .strict();
export type RespondToClaimBody = z.infer<typeof RespondToClaimBody>;

export const WarrantyClaimView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  categoryName: z.string(),
  status: z.enum(WARRANTY_CLAIM_STATUSES),
  description: z.string(),
  mediaUrls: z.array(z.string()),
  warrantyDays: z.number().int(),
  coveredUntil: z.string(),
  providerName: z.string(),
  providerResponse: z.string().nullable(),
  declineReason: z.string().nullable(),
  /** The free return visit, once there is one. */
  revisitJobId: z.string().uuid().nullable(),
  /** Whether the professional has run out of time to answer, so the app can say what happens next. */
  awaitingSupport: z.boolean(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
});
export type WarrantyClaimView = z.infer<typeof WarrantyClaimView>;

/** What a finished job says about its own warranty, so the customer never has to work it out. */
export const WarrantyStatusView = z.object({
  warrantyDays: z.number().int(),
  coveredUntil: z.string().nullable(),
  daysLeft: z.number().int(),
  active: z.boolean(),
  canClaim: z.boolean(),
  /** Present when a claim cannot be raised, in the customer's own terms. */
  reason: z.string().nullable(),
  claim: WarrantyClaimView.nullable(),
});
export type WarrantyStatusView = z.infer<typeof WarrantyStatusView>;

// ---------------------------------------------------------------------------
// The professional a customer is choosing between
// ---------------------------------------------------------------------------

/**
 * What a customer may see about somebody before booking them.
 *
 * Deliberately not a user record: no phone number, no address, no identity documents, no exact
 * location. A customer choosing between four offers needs to know whether this person is any
 * good, not who they are and where they live.
 */
export const PublicProviderView = z.object({
  providerId: z.string().uuid(),
  businessName: z.string(),
  /** A first name only, as everywhere else a counterparty is shown. */
  contactName: z.string().nullable(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
  completedJobs: z.number().int(),
  experienceYears: z.number().int().nullable(),
  bio: z.string().nullable(),
  categories: z.array(z.string()),
  skills: z.array(z.string()),
  /** Rounded, and never an address: "about 3 km away" is what a customer needs. */
  approxDistanceKm: z.number().nullable(),
  /** So the profile can be read honestly rather than as an advert. */
  memberSince: z.string(),
  isFavourite: z.boolean(),
  reviews: z.array(
    z.object({
      id: z.string().uuid(),
      rating: z.number().int(),
      comment: z.string().nullable(),
      reviewerName: z.string(),
      createdAt: z.string(),
    }),
  ),
  /** How the ratings break down, because a 4.6 from 3 people is not a 4.6 from 300. */
  ratingBreakdown: z.array(z.object({ stars: z.number().int(), count: z.number().int() })),
});
export type PublicProviderView = z.infer<typeof PublicProviderView>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SearchQuery = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResultsView = z.object({
  query: z.string(),
  hits: z.array(
    z.object({
      categoryId: z.string().uuid(),
      skillId: z.string().uuid().nullable(),
      label: z.string(),
      categoryName: z.string(),
      /** Why this matched, so a surprising result explains itself. */
      matchedOn: z.string(),
    }),
  ),
  /** Shown when nothing has been typed yet: never a blank panel. */
  suggestions: z.array(
    z.object({ categoryId: z.string().uuid(), label: z.string(), reason: z.enum(['RECENT', 'POPULAR']) }),
  ),
});
export type SearchResultsView = z.infer<typeof SearchResultsView>;

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export const ModerateMessageBody = z
  .object({
    outcome: z.enum(MODERATION_OUTCOMES),
    /** Required for anything except ALLOWED. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type ModerateMessageBody = z.infer<typeof ModerateMessageBody>;

export const FlaggedMessageView = z.object({
  id: z.string().uuid(),
  /** What a reviewer opens to read the conversation around the message. */
  threadId: z.string().uuid(),
  body: z.string(),
  senderName: z.string(),
  senderId: z.string().uuid(),
  senderRole: z.string(),
  /** Why the filter caught it, so a reviewer is not re-deriving the match. */
  flagReason: z.string().nullable(),
  overdue: z.boolean(),
  createdAt: z.string(),
});
export type FlaggedMessageView = z.infer<typeof FlaggedMessageView>;

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export const RecoveryCodesView = z.object({
  /** Shown exactly once, at generation. After this we hold only hashes. */
  codes: z.array(z.string()),
  generatedAt: z.string(),
  warning: z.string(),
});
export type RecoveryCodesView = z.infer<typeof RecoveryCodesView>;

export const UseRecoveryCodeBody = z.object({ code: z.string().trim().min(8).max(20) }).strict();
export type UseRecoveryCodeBody = z.infer<typeof UseRecoveryCodeBody>;

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

export const DataExportView = z.object({
  generatedAt: z.string(),
  /** Every section we included, named so a missing one is visible. */
  sections: z.array(z.enum(EXPORT_SECTIONS)),
  /** What was left out and why - so nobody has to guess whether something is missing by accident. */
  exclusions: z.array(z.object({ what: z.string(), why: z.string() })),
  counts: z.record(z.number().int()),
  data: z.record(z.unknown()),
});
export type DataExportView = z.infer<typeof DataExportView>;
