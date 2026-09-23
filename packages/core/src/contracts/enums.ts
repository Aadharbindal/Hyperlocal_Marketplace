// Enums shared by API, DB (mirrored as PostgreSQL enums) and mobile.

export const USER_ROLES = [
  'CUSTOMER',
  'PROVIDER',
  'CONTRACTOR',
  'TECHNICIAN',
  'VENDOR',
  'ADMIN',
  'SUPPORT',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles a user may grant themselves during onboarding. */
export const SELF_SERVICE_ROLES: readonly UserRole[] = ['CUSTOMER', 'PROVIDER', 'CONTRACTOR', 'VENDOR'];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETION_SCHEDULED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ROLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const JOB_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'QUALIFYING',
  'OPEN_FOR_BIDS',
  'BID_RECEIVED',
  'NEGOTIATING',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
  'COMPLETED',
  'SETTLED',
  // terminal
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'AUTO_CANCELLED',
  'DISPUTED',
  'REFUNDED',
  'ABANDONED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'SETTLED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'AUTO_CANCELLED',
  'REFUNDED',
  'ABANDONED',
];

export const PAYMENT_STATUSES = [
  'NONE',
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'SETTLED',
  /** Authorization let go without ever taking the money. */
  'RELEASED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DISPUTE_HOLD',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const JOB_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const JOB_REQUEST_TYPES = ['LABOUR_ONLY', 'LABOUR_AND_MATERIAL'] as const;
export type JobRequestType = (typeof JOB_REQUEST_TYPES)[number];

export const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const BID_STATUSES = ['ACTIVE', 'WITHDRAWN', 'REJECTED', 'ACCEPTED', 'EXPIRED', 'INACTIVE'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const MATERIAL_RESPONSIBILITIES = ['PROVIDER', 'CUSTOMER', 'VENDOR'] as const;
export type MaterialResponsibility = (typeof MATERIAL_RESPONSIBILITIES)[number];

export const CONSENT_TYPES = ['TERMS', 'PRIVACY', 'MARKETING', 'LOCATION', 'VOICE_RECORDING'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const DISPUTE_CATEGORIES = [
  'LATE_ARRIVAL',
  'NO_SHOW',
  'INCORRECT_PRICING',
  'POOR_WORKMANSHIP',
  'PROPERTY_DAMAGE',
  'INCOMPLETE_WORK',
  'MATERIAL_MISMATCH',
  'PAYMENT_ISSUE',
  'ABUSIVE_BEHAVIOUR',
  'SUSPECTED_FRAUD',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const STRIKE_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export type StrikeSeverity = (typeof STRIKE_SEVERITIES)[number];

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
