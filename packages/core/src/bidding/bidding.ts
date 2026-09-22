import type { JobPriority, VerificationStatus, RoleStatus } from '../contracts/enums';

export const BID_WINDOW_MINUTES: Readonly<Record<JobPriority, number>> = { NORMAL: 30, URGENT: 10 };
export const MAX_BID_REVISIONS = 2;
export const MAX_ACTIVE_BIDS_PER_JOB = 8;
export const OFFER_TTL_MINUTES = 30;

export function bidWindowEnd(openedAt: Date, priority: JobPriority): Date {
  return new Date(openedAt.getTime() + BID_WINDOW_MINUTES[priority] * 60_000);
}

export interface ProviderEligibilityInput {
  verificationStatus: VerificationStatus;
  roleStatus: RoleStatus;
  isAvailable: boolean;
  distanceKm: number;
  serviceRadiusKm: number;
  providerSkillIds: readonly string[];
  requiredSkillIds: readonly string[];
  categoryIds: readonly string[];
  jobCategoryId: string;
  reliabilityScore: number;
  suspendedUntil?: Date | null;
  now?: Date;
}

export type EligibilityReason =
  | 'NOT_VERIFIED'
  | 'ROLE_INACTIVE'
  | 'UNAVAILABLE'
  | 'OUT_OF_RADIUS'
  | 'CATEGORY_MISMATCH'
  | 'SKILL_MISMATCH'
  | 'LOW_RELIABILITY'
  | 'SUSPENDED';

export const MIN_RELIABILITY_TO_BID = 2.5;

/** Server-side eligibility (PRODUCT_SPEC section 10). Returns every failing reason for auditing. */
export function providerEligibility(i: ProviderEligibilityInput): { eligible: boolean; reasons: EligibilityReason[] } {
  const reasons: EligibilityReason[] = [];
  const now = i.now ?? new Date();
  if (i.verificationStatus !== 'VERIFIED') reasons.push('NOT_VERIFIED');
  if (i.roleStatus !== 'ACTIVE') reasons.push('ROLE_INACTIVE');
  if (i.suspendedUntil && i.suspendedUntil > now) reasons.push('SUSPENDED');
  if (!i.isAvailable) reasons.push('UNAVAILABLE');
  if (i.distanceKm > i.serviceRadiusKm) reasons.push('OUT_OF_RADIUS');
  if (!i.categoryIds.includes(i.jobCategoryId)) reasons.push('CATEGORY_MISMATCH');
  if (i.requiredSkillIds.length > 0 && !i.requiredSkillIds.every((s) => i.providerSkillIds.includes(s))) {
    reasons.push('SKILL_MISMATCH');
  }
  if (i.reliabilityScore < MIN_RELIABILITY_TO_BID) reasons.push('LOW_RELIABILITY');
  return { eligible: reasons.length === 0, reasons };
}

export interface BidTerms {
  labourPaise: number;
  visitFeePaise: number;
  etaMinutes: number;
  warrantyDays: number;
  notes?: string;
}

export type BidValidationError =
  | 'WINDOW_CLOSED'
  | 'LABOUR_REQUIRED'
  | 'NEGATIVE_AMOUNT'
  | 'ETA_OUT_OF_RANGE'
  | 'WARRANTY_OUT_OF_RANGE'
  | 'TOO_MANY_REVISIONS'
  | 'DUPLICATE_ACTIVE_BID'
  | 'JOB_FULL';

export interface BidContext {
  windowEndsAt: Date;
  now?: Date;
  existingActiveBidByProvider: boolean;
  revisionNo: number;
  activeBidCount: number;
}

export function validateBid(terms: BidTerms, ctx: BidContext): BidValidationError[] {
  const errors: BidValidationError[] = [];
  const now = ctx.now ?? new Date();
  if (now > ctx.windowEndsAt) errors.push('WINDOW_CLOSED');
  if (!Number.isInteger(terms.labourPaise) || !Number.isInteger(terms.visitFeePaise)) errors.push('NEGATIVE_AMOUNT');
  else if (terms.labourPaise < 0 || terms.visitFeePaise < 0) errors.push('NEGATIVE_AMOUNT');
  if (terms.labourPaise === 0 && terms.visitFeePaise === 0) errors.push('LABOUR_REQUIRED');
  if (!Number.isInteger(terms.etaMinutes) || terms.etaMinutes < 10 || terms.etaMinutes > 72 * 60) {
    errors.push('ETA_OUT_OF_RANGE');
  }
  if (!Number.isInteger(terms.warrantyDays) || terms.warrantyDays < 0 || terms.warrantyDays > 365) {
    errors.push('WARRANTY_OUT_OF_RANGE');
  }
  if (ctx.revisionNo > MAX_BID_REVISIONS) errors.push('TOO_MANY_REVISIONS');
  if (ctx.revisionNo === 0 && ctx.existingActiveBidByProvider) errors.push('DUPLICATE_ACTIVE_BID');
  if (ctx.revisionNo === 0 && ctx.activeBidCount >= MAX_ACTIVE_BIDS_PER_JOB) errors.push('JOB_FULL');
  return errors;
}

export function isOfferExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** Ranking (never price-only). Higher is better. Sponsored placement is applied separately and labelled. */
export interface RankableBid {
  labourPaise: number;
  visitFeePaise: number;
  etaMinutes: number;
  distanceKm: number;
  completedJobs: number;
  reliabilityScore: number; // 0..5
  ratingAvg: number | null; // 1..5
  skillMatchRatio: number; // 0..1
}

export function rankScore(b: RankableBid, ctx: { medianTotalPaise: number }): number {
  const total = b.labourPaise + b.visitFeePaise;
  const priceRel = ctx.medianTotalPaise > 0 ? Math.min(2, total / ctx.medianTotalPaise) : 1;
  const priceScore = 1 - Math.min(1, Math.max(0, priceRel - 0.5)); // 0.5x median -> 1, 1.5x -> 0
  const etaScore = 1 - Math.min(1, b.etaMinutes / 240);
  const distScore = 1 - Math.min(1, b.distanceKm / 5);
  const expScore = Math.min(1, b.completedJobs / 50);
  const relScore = b.reliabilityScore / 5;
  const ratingScore = b.ratingAvg == null ? 0.6 : b.ratingAvg / 5;
  return (
    0.2 * b.skillMatchRatio +
    0.15 * distScore +
    0.15 * etaScore +
    0.15 * expScore +
    0.15 * relScore +
    0.1 * ratingScore +
    0.1 * priceScore
  );
}
