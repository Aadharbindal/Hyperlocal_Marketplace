import { z } from 'zod';

/**
 * Re-dispatch, over the wire.
 *
 * Two audiences with very different needs. The customer needs to know that their booking is not
 * dead and roughly when they will have an answer, and must not be told anything that implies a
 * replacement is guaranteed. The invited professional needs enough to decide in under a minute:
 * what the job is, what they will be paid, where it is and how long they have.
 */

/** What the customer sees while their booking is being rescued. */
export const RedispatchStatusView = z.object({
  /** How many professionals were asked. Zero is a real answer and the app must render it. */
  invitedCount: z.number().int().min(0),
  /** When this stops. The app counts down to it rather than polling for a verdict. */
  deadline: z.string(),
  /** Which attempt this is. Shown to support, and to the customer from the second one on. */
  attempt: z.number().int().min(1),
  /**
   * Said plainly on the screen: the customer pays no more than they already authorised, whatever
   * happens next. Carried in the payload rather than hardcoded in the app so that the guarantee
   * and the rule that enforces it cannot drift apart.
   */
  authorisedTotalPaise: z.number().int(),
});
export type RedispatchStatusView = z.infer<typeof RedispatchStatusView>;

/** An open invitation, as the invited professional sees it in their feed. */
export const RedispatchInvitationView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  categoryName: z.string(),
  /** Coarse until they accept - the exact address is not handed out on a maybe. */
  areaLabel: z.string(),
  distanceKm: z.number(),
  /** Their own original terms, not the price the person who dropped out had agreed. */
  totalPaise: z.number().int(),
  /** Why they are being asked, so this does not look like an ordinary new job. */
  reason: z.literal('PROVIDER_DROPPED'),
  preferredStart: z.string().nullable(),
  expiresAt: z.string(),
});
export type RedispatchInvitationView = z.infer<typeof RedispatchInvitationView>;

export const RedispatchInvitationsResponse = z.object({
  items: z.array(RedispatchInvitationView),
});
export type RedispatchInvitationsResponse = z.infer<typeof RedispatchInvitationsResponse>;

export const RespondToRedispatchBody = z
  .object({
    accept: z.boolean(),
    /** Optional and never required. Making somebody justify a decline teaches them to ignore instead. */
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type RespondToRedispatchBody = z.infer<typeof RespondToRedispatchBody>;
