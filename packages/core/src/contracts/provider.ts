import { z } from 'zod';
import { MATERIAL_RESPONSIBILITIES, VERIFICATION_STATUSES } from './enums';
import { PhoneSchema } from './auth';

// ---------------------------------------------------------------------------
// Provider profile
// ---------------------------------------------------------------------------
export const ProviderProfileUpdate = z
  .object({
    businessName: z.string().trim().min(2).max(80).optional(),
    bio: z.string().trim().max(500).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    serviceRadiusKm: z.number().min(0.5).max(25).optional(),
    /** Where the provider starts their day; used for the nearby feed. */
    baseAddressId: z.string().uuid().optional(),
    skillIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict();
export type ProviderProfileUpdate = z.infer<typeof ProviderProfileUpdate>;

export const AvailabilityBody = z.object({ isAvailable: z.boolean() }).strict();

export const ProviderProfileView = z.object({
  userId: z.string().uuid(),
  businessName: z.string().nullable(),
  bio: z.string().nullable(),
  experienceYears: z.number().int().nullable(),
  serviceRadiusKm: z.number(),
  isAvailable: z.boolean(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  /** Why the provider cannot receive jobs right now, in plain language. */
  blockers: z.array(z.string()),
  reliabilityScore: z.number(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  completedJobs: z.number().int(),
  strikeCount: z.number().int(),
  suspendedUntil: z.string().nullable(),
  baseAddressId: z.string().uuid().nullable(),
  skills: z.array(z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), categoryId: z.string().uuid() })),
  kyc: z.array(
    z.object({
      id: z.string().uuid(),
      documentType: z.string(),
      status: z.enum(VERIFICATION_STATUSES),
      last4: z.string().nullable(),
      rejectionReason: z.string().nullable(),
      submittedAt: z.string(),
    }),
  ),
});
export type ProviderProfileView = z.infer<typeof ProviderProfileView>;

export const KycSubmitBody = z
  .object({
    documentType: z.enum(['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID', 'SHOP_LICENCE', 'GST']),
    /** Only the last four characters are stored; the full number never reaches the database. */
    documentNumber: z.string().trim().min(4).max(24),
    mime: z.string().min(3).max(100),
    sizeBytes: z.number().int().positive(),
  })
  .strict();
export type KycSubmitBody = z.infer<typeof KycSubmitBody>;

// ---------------------------------------------------------------------------
// Nearby job feed
// ---------------------------------------------------------------------------
export const NearbyJobItem = z.object({
  jobId: z.string().uuid(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  description: z.string().nullable(),
  priority: z.enum(['NORMAL', 'URGENT']),
  requestType: z.enum(['LABOUR_ONLY', 'LABOUR_AND_MATERIAL']),
  inspectionRequired: z.boolean(),
  /** Rounded so the exact address is never exposed before confirmation (PRIVACY_DATA_MAP). */
  distanceKm: z.number(),
  areaLabel: z.string(),
  photoCount: z.number().int(),
  hasVoiceNote: z.boolean(),
  preferredStart: z.string().nullable(),
  bidWindowEndsAt: z.string().nullable(),
  bidCount: z.number().int(),
  /** The signed-in provider's own live offer on this job, if any. */
  myBid: z
    .object({ id: z.string().uuid(), labourPaise: z.number().int(), visitFeePaise: z.number().int(), revisionNo: z.number().int(), status: z.string() })
    .nullable(),
  postedAt: z.string(),
});
export type NearbyJobItem = z.infer<typeof NearbyJobItem>;

export const NearbyFeedResponse = z.object({
  items: z.array(NearbyJobItem),
  /** Empty feed is usually a settings problem, so say which one. */
  blockers: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------------
export const BidCreate = z
  .object({
    labourPaise: z.number().int().min(0).max(50_00_000),
    visitFeePaise: z.number().int().min(0).max(5_00_000).default(0),
    etaMinutes: z.number().int().min(10).max(4320),
    warrantyDays: z.number().int().min(0).max(365).default(0),
    materialResponsibility: z.enum(MATERIAL_RESPONSIBILITIES).default('PROVIDER'),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.labourPaise > 0 || b.visitFeePaise > 0, { message: 'Quote a labour price or a visit fee' });
export type BidCreate = z.input<typeof BidCreate>;

export const BidRevise = BidCreate;
export const BidWithdrawBody = z.object({ reason: z.string().trim().min(3).max(200) });

export const BidView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  labourPaise: z.number().int(),
  visitFeePaise: z.number().int(),
  /** What the customer would pay in total, fees and tax included. */
  totalPaise: z.number().int(),
  platformFeePaise: z.number().int(),
  taxPaise: z.number().int(),
  etaMinutes: z.number().int(),
  warrantyDays: z.number().int(),
  materialResponsibility: z.enum(MATERIAL_RESPONSIBILITIES),
  notes: z.string().nullable(),
  revisionNo: z.number().int(),
  revisionsLeft: z.number().int(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type BidView = z.infer<typeof BidView>;

/** What the customer sees for each offer - identity is limited until confirmation. */
export const OfferView = BidView.extend({
  provider: z.object({
    id: z.string().uuid(),
    businessName: z.string(),
    verified: z.boolean(),
    ratingAvg: z.number().nullable(),
    ratingCount: z.number().int(),
    completedJobs: z.number().int(),
    experienceYears: z.number().int().nullable(),
    distanceKm: z.number(),
  }),
  /** Ranking is skill, distance, ETA, experience, reliability, rating and price - never price alone. */
  rankScore: z.number(),
  sponsored: z.boolean(),
});
export type OfferView = z.infer<typeof OfferView>;

// ---------------------------------------------------------------------------
// Contractors and their crews
// ---------------------------------------------------------------------------

export const ContractorProfileUpdate = z
  .object({
    businessName: z.string().trim().min(3).max(80),
    baseAddressId: z.string().uuid().optional(),
    serviceRadiusKm: z.number().min(1).max(25).optional(),
  })
  .strict();
export type ContractorProfileUpdate = z.infer<typeof ContractorProfileUpdate>;

/**
 * A technician is *added*, not created: they sign in on their own phone first. A contractor who
 * could create accounts for people could also create accounts **as** people, and then send an
 * unverified stranger to somebody's home under a name the customer had reason to trust.
 */
export const AddTechnicianBody = z
  .object({
    phone: PhoneSchema,
    fullName: z.string().trim().min(3).max(80),
    skills: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict();
export type AddTechnicianBody = z.infer<typeof AddTechnicianBody>;

export const TechnicianView = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  /** A contractor sees their own crew's numbers in full; nobody else does. */
  phone: z.string(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  skills: z.array(z.string()),
  active: z.boolean(),
});
export type TechnicianView = z.infer<typeof TechnicianView>;

/** Submitting a crew member's documents. Staff decide the outcome, never the contractor. */
export const TechnicianKycBody = KycSubmitBody;
export type TechnicianKycBody = z.infer<typeof TechnicianKycBody>;

export const ContractorJobItem = z.object({
  jobId: z.string().uuid(),
  status: z.string(),
  categoryName: z.string(),
  areaLabel: z.string(),
  preferredStart: z.string().nullable(),
  technician: z.object({ userId: z.string().uuid(), fullName: z.string() }).nullable(),
  /** What a contractor opens this screen looking for. */
  needsTechnician: z.boolean(),
});
export type ContractorJobItem = z.infer<typeof ContractorJobItem>;
