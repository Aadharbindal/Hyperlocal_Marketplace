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

/**
 * Roughly what this kind of work costs, before anybody has quoted.
 *
 * `basis` is not decoration. `ACTUAL` means these are the prices customers paid on finished
 * jobs; `ESTIMATE` means it is our seeded guess and nobody has paid it yet. The app says which,
 * because "about ₹300-600" and "most people paid ₹300-600" are different promises and quietly
 * upgrading one to the other is how a price guide stops being trusted.
 *
 * Labour only. Materials are bought at a vendor's price and quoted separately.
 */
export const PriceGuide = z.object({
  minPaise: z.number().int().positive(),
  maxPaise: z.number().int().positive(),
  basis: z.enum(['ACTUAL', 'ESTIMATE']),
  sampleSize: z.number().int().nonnegative(),
});
export type PriceGuide = z.infer<typeof PriceGuide>;

export const CategoryView = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  iconKey: z.string(),
  requiresInspectionDefault: z.boolean(),
  skills: z.array(
    z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string(),
      riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      priceGuide: PriceGuide.nullable(),
    }),
  ),
  /** The category's own range: the widest of its skills, so a tile can show one number. */
  priceGuide: PriceGuide.nullable(),
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
