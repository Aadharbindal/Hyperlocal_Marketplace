import { z } from 'zod';

export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'AUTH_INVALID_TOKEN',
  'AUTH_SUSPENDED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'OTP_RATE_LIMITED',
  'OTP_EXPIRED',
  'OTP_INVALID',
  'OTP_LOCKED',
  'OTP_CONSUMED',
  'ROLE_NOT_SELF_SERVICE',
  'REASON_REQUIRED',
  'JOB_INVALID_TRANSITION',
  'IDEMPOTENCY_KEY_REUSED',
  'MAINTENANCE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const CategoryView = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  iconKey: z.string(),
  requiresInspectionDefault: z.boolean(),
  skills: z.array(z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']) })),
});
export type CategoryView = z.infer<typeof CategoryView>;

export const ReasonBody = z.object({ reason: z.string().trim().min(5).max(500) });
export type ReasonBody = z.infer<typeof ReasonBody>;

export const AuditLogView = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogView = z.infer<typeof AuditLogView>;

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
