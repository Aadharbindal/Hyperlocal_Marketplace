import { z } from 'zod';
import { PhoneSchema } from './auth';

/**
 * The people a customer can tell about a job that is happening in their home.
 *
 * A ride-hailing app treats this as a nice-to-have because the journey is in public and over in
 * twenty minutes. Here the exposure is different in kind: an address, a time the customer has
 * confirmed they will be in, and a stranger with tools. The feature is small on purpose - a name
 * and a number, typed by the customer - because every extra field is somebody else's personal
 * data sitting in our database without their consent.
 */
export const EmergencyContactBody = z
  .object({
    name: z.string().trim().min(2).max(60),
    phone: PhoneSchema,
    /** Free text, not an enum: "landlord" and "didi" are both real answers and neither is on a list. */
    relationship: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type EmergencyContactBody = z.infer<typeof EmergencyContactBody>;

export const EmergencyContactView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Masked, like every other number this API returns. The customer typed it; they know it. */
  phoneMasked: z.string(),
  relationship: z.string().nullable(),
  createdAt: z.string(),
});
export type EmergencyContactView = z.infer<typeof EmergencyContactView>;

/** Three is the cap the database enforces; repeated here so the app can grey the button out. */
export const EMERGENCY_CONTACT_LIMIT = 3;

export const EmergencyContactsResponse = z.object({
  items: z.array(EmergencyContactView),
  limit: z.literal(EMERGENCY_CONTACT_LIMIT),
});
export type EmergencyContactsResponse = z.infer<typeof EmergencyContactsResponse>;

/**
 * Sharing a live job with one of those contacts.
 *
 * What is shared is a link to a read-only status page, never the customer's account. The link
 * dies with the job: a share that outlives the visit is a standing disclosure of somebody's
 * address to whoever later gets hold of the message.
 */
export const ShareJobBody = z
  .object({
    contactId: z.string().uuid(),
  })
  .strict();
export type ShareJobBody = z.infer<typeof ShareJobBody>;

export const ShareJobResponse = z.object({
  sharedWith: z.string(),
  expiresAt: z.string(),
});
export type ShareJobResponse = z.infer<typeof ShareJobResponse>;
