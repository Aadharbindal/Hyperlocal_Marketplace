import { z } from 'zod';
import { MAX_INTERVAL_DAYS, MIN_INTERVAL_DAYS } from '../jobs/service-plan';

/**
 * Standing arrangements, over the wire.
 *
 * The one thing the app must never imply is that money moves on its own. Nothing here carries a
 * price, a card or a mandate: a plan opens a booking, and that booking is quoted and paid for
 * like every other one. See 0020 for why automatic charging is a refusal rather than a gap.
 */

/** A date with no time on it. Nobody plans a geyser service to the minute. */
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-06-01');

export const CreateServicePlanBody = z
  .object({
    categoryId: z.string().uuid(),
    skillIds: z.array(z.string().uuid()).max(5).optional(),
    addressId: z.string().uuid(),
    description: z.string().trim().max(500).optional(),
    intervalDays: z.number().int().min(MIN_INTERVAL_DAYS).max(MAX_INTERVAL_DAYS),
    /** When the first visit should happen. The booking opens `leadDays` before it. */
    firstDueOn: DateOnly,
    leadDays: z.number().int().min(0).max(14).optional(),
    /**
     * Who did it last time. A preference, never a reservation - they may be unavailable or gone,
     * and the booking still has to happen.
     */
    preferredProviderId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateServicePlanBody = z.infer<typeof CreateServicePlanBody>;

export const UpdateServicePlanBody = z
  .object({
    intervalDays: z.number().int().min(MIN_INTERVAL_DAYS).max(MAX_INTERVAL_DAYS).optional(),
    nextDueOn: DateOnly.optional(),
    leadDays: z.number().int().min(0).max(14).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    preferredProviderId: z.string().uuid().nullable().optional(),
    /**
     * Pausing is not cancelling, and both are offered.
     *
     * Somebody going away for three months wants the first; somebody who has sold the flat wants
     * the second. Offering only "cancel" makes people delete the thing they meant to keep.
     */
    status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
  })
  .strict();
export type UpdateServicePlanBody = z.infer<typeof UpdateServicePlanBody>;

export const ServicePlanOccurrenceView = z.object({
  dueOn: z.string(),
  jobId: z.string().uuid().nullable(),
  outcome: z.enum(['BOOKED', 'SKIPPED', 'FAILED']),
  /** Present on the ones that went wrong, in words the customer can act on. */
  detail: z.string().nullable(),
});
export type ServicePlanOccurrenceView = z.infer<typeof ServicePlanOccurrenceView>;

export const ServicePlanView = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  iconKey: z.string().nullable(),
  addressId: z.string().uuid(),
  addressLabel: z.string().nullable(),
  description: z.string().nullable(),
  intervalDays: z.number().int(),
  /** The interval in the words people use - "every 3 months" rather than "90". */
  intervalLabel: z.string(),
  nextDueOn: z.string(),
  leadDays: z.number().int(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']),
  preferredProviderId: z.string().uuid().nullable(),
  preferredProviderName: z.string().nullable(),
  /** The last few, newest first. Includes the ones that were skipped or failed. */
  recent: z.array(ServicePlanOccurrenceView),
  createdAt: z.string(),
});
export type ServicePlanView = z.infer<typeof ServicePlanView>;

export const ServicePlansResponse = z.object({ items: z.array(ServicePlanView) });
export type ServicePlansResponse = z.infer<typeof ServicePlansResponse>;

/**
 * Skipping the next visit without ending the arrangement.
 *
 * The case this exists for: away that week, or it was done privately last month. Without it the
 * only way to avoid one unwanted booking is to cancel the plan, and most people never set it up
 * again.
 */
export const SkipNextBody = z.object({ reason: z.string().trim().max(200).optional() }).strict();
export type SkipNextBody = z.infer<typeof SkipNextBody>;
