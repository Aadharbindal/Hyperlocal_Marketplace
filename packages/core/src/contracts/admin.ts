import { z } from 'zod';
import { DISPUTE_QUEUE_MOVES } from '../admin/review';
import { VERIFICATION_STATUSES } from './enums';

// ---------------------------------------------------------------------------
// Admin MFA
// ---------------------------------------------------------------------------

export const MfaCodeBody = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/),
  })
  .strict();
export type MfaCodeBody = z.infer<typeof MfaCodeBody>;

export const MfaSetupView = z.object({
  /** Shown exactly once, at enrolment, and never returned again. */
  secret: z.string(),
  otpauthUri: z.string(),
  digits: z.number().int(),
  periodSeconds: z.number().int(),
});
export type MfaSetupView = z.infer<typeof MfaSetupView>;

export const MfaStatusView = z.object({
  enrolled: z.boolean(),
  verifiedForSession: z.boolean(),
  requiredForAdmin: z.boolean(),
  enabledAt: z.string().nullable(),
});
export type MfaStatusView = z.infer<typeof MfaStatusView>;

// ---------------------------------------------------------------------------
// KYC review
// ---------------------------------------------------------------------------

export const KycReviewBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'NEEDS_MORE']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.decision === 'APPROVE' || (b.reason ?? '').trim().length >= 10, {
    message: 'Say why, in a way the person can act on',
  });
export type KycReviewBody = z.infer<typeof KycReviewBody>;

export const KycReviewItem = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string(),
  /** Masked, always: the console shows who, not their document number. */
  userPhoneMasked: z.string(),
  roles: z.array(z.string()),
  documentType: z.string(),
  /** The only part of the number that is stored anywhere. */
  documentLast4: z.string().nullable(),
  status: z.enum(VERIFICATION_STATUSES),
  /** A short-lived signed URL, only ever issued to a reviewer, and the issue is audited. */
  documentUrl: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type KycReviewItem = z.infer<typeof KycReviewItem>;

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export const SuspendUserBody = z
  .object({
    reason: z.string().trim().min(20).max(500),
    /** Required: suspending someone takes two people (SECURITY_CHECKLIST). */
    secondApproverId: z.string().uuid(),
    untilIso: z.string().datetime().optional(),
  })
  .strict();
export type SuspendUserBody = z.infer<typeof SuspendUserBody>;

export const AdminUserView = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  phone: z.string(),
  status: z.string(),
  roles: z.array(z.string()),
  suspendedReason: z.string().nullable(),
  verification: z.string().nullable(),
  reliabilityScore: z.number().nullable(),
  ratingAvg: z.number().nullable(),
  completedJobs: z.number().int(),
  strikes: z.array(
    z.object({ id: z.string().uuid(), severity: z.string(), reason: z.string(), createdAt: z.string() }),
  ),
  owedPaise: z.number().int(),
  createdAt: z.string(),
});
export type AdminUserView = z.infer<typeof AdminUserView>;

// ---------------------------------------------------------------------------
// Dispute queue
// ---------------------------------------------------------------------------

export const DisputeMoveBody = z
  .object({
    to: z.enum(DISPUTE_QUEUE_MOVES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type DisputeMoveBody = z.infer<typeof DisputeMoveBody>;

export const AppealBody = z
  .object({
    reason: z.string().trim().min(20).max(1000),
  })
  .strict();
export type AppealBody = z.infer<typeof AppealBody>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const OpsReportView = z.object({
  generatedAt: z.string(),
  jobsByStatus: z.record(z.string(), z.number().int()),
  liveJobs: z.number().int(),
  completedJobs: z.number().int(),
  capturedPaise: z.number().int(),
  refundedPaise: z.number().int(),
  platformRevenuePaise: z.number().int(),
  payoutsPendingPaise: z.number().int(),
  payoutsPaidPaise: z.number().int(),
  disputesOpen: z.number().int(),
  disputesBreachingSla: z.number().int(),
  kycPending: z.number().int(),
  providersVerified: z.number().int(),
  providersSuspended: z.number().int(),
});
export type OpsReportView = z.infer<typeof OpsReportView>;
