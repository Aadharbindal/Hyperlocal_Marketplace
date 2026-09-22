import { z } from 'zod';
import { JOB_PRIORITIES, JOB_REQUEST_TYPES, JOB_STATUSES, PAYMENT_STATUSES } from './enums';
import { PhoneSchema } from './auth';

export const JobStatusSchema = z.enum(JOB_STATUSES);
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const MediaKindSchema = z.enum(['PHOTO', 'VOICE_NOTE', 'VIDEO', 'DOCUMENT']);
export const MediaPhaseSchema = z.enum(['REQUEST', 'PROGRESS', 'COMPLETION', 'DISPUTE', 'PRICE_REVISION']);

/** Creating a job always starts a DRAFT; nothing is broadcast until it is submitted. */
export const JobCreate = z
  .object({
    categoryId: z.string().uuid(),
    skillIds: z.array(z.string().uuid()).max(6).optional(),
    description: z.string().trim().max(1500).optional(),
    priority: z.enum(JOB_PRIORITIES).default('NORMAL'),
    requestType: z.enum(JOB_REQUEST_TYPES).default('LABOUR_ONLY'),
    inspectionRequired: z.boolean().optional(),
    addressId: z.string().uuid().optional(),
    preferredStart: z.string().datetime().optional(),
    preferredEnd: z.string().datetime().optional(),
    /** Booking for someone else (PRODUCT_SPEC section 4). */
    bookedForName: z.string().trim().min(2).max(60).optional(),
    bookedForPhone: PhoneSchema.optional(),
  })
  .strict();
export type JobCreate = z.input<typeof JobCreate>;

export const JobUpdate = JobCreate.partial();
export type JobUpdate = z.input<typeof JobUpdate>;

export const JobMediaCreate = z
  .object({
    kind: MediaKindSchema,
    mime: z.string().min(3).max(100),
    sizeBytes: z.number().int().positive(),
    durationSeconds: z.number().int().positive().max(600).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();
export type JobMediaCreate = z.infer<typeof JobMediaCreate>;

export const JobMediaView = z.object({
  id: z.string().uuid(),
  kind: MediaKindSchema,
  phase: MediaPhaseSchema,
  mime: z.string(),
  sizeBytes: z.number().int(),
  durationSeconds: z.number().int().nullable(),
  url: z.string(),
  uploadedByRole: z.string(),
  createdAt: z.string(),
});
export type JobMediaView = z.infer<typeof JobMediaView>;

export const JobMediaUploadTarget = z.object({
  media: JobMediaView,
  upload: z.object({
    url: z.string(),
    method: z.enum(['PUT', 'POST']),
    expiresAt: z.string(),
    /** false when the storage adapter is mocked - the client skips the transfer. */
    required: z.boolean(),
  }),
});
export type JobMediaUploadTarget = z.infer<typeof JobMediaUploadTarget>;

export const JobStatusEventView = z.object({
  id: z.string().uuid(),
  fromStatus: JobStatusSchema.nullable(),
  toStatus: JobStatusSchema,
  actorRole: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type JobStatusEventView = z.infer<typeof JobStatusEventView>;

const AddressSnapshot = z.object({
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  societyName: z.string().nullable(),
  gateInstructions: z.string().nullable(),
  city: z.string(),
  pincode: z.string(),
});

export const JobView = z.object({
  id: z.string().uuid(),
  status: JobStatusSchema,
  /** i18n key for the plain-language status shown to customers. */
  statusLabelKey: z.string(),
  paymentStatus: PaymentStatusSchema,
  category: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), iconKey: z.string() }),
  skillIds: z.array(z.string().uuid()),
  description: z.string().nullable(),
  priority: z.enum(JOB_PRIORITIES),
  requestType: z.enum(JOB_REQUEST_TYPES),
  inspectionRequired: z.boolean(),
  preferredStart: z.string().nullable(),
  preferredEnd: z.string().nullable(),
  address: AddressSnapshot.nullable(),
  addressId: z.string().uuid().nullable(),
  bookedForName: z.string().nullable(),
  bookedForPhoneMasked: z.string().nullable(),
  /** Present for the customer only, so they can share live status with the recipient. */
  trackingUrlToken: z.string().nullable(),
  bidWindowEndsAt: z.string().nullable(),
  media: z.array(JobMediaView),
  events: z.array(JobStatusEventView),
  hazards: z.array(z.string()),
  cancelledReason: z.string().nullable(),
  createdAt: z.string(),
  submittedAt: z.string().nullable(),
});
export type JobView = z.infer<typeof JobView>;

export const JobListItem = z.object({
  id: z.string().uuid(),
  status: JobStatusSchema,
  statusLabelKey: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  description: z.string().nullable(),
  priority: z.enum(JOB_PRIORITIES),
  addressLabel: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  preferredStart: z.string().nullable(),
  createdAt: z.string(),
});
export type JobListItem = z.infer<typeof JobListItem>;

export const JobSubmitResponse = z.object({
  job: JobView,
  /** Set when an open job for the same category and address already exists (JOB-03). */
  duplicateOf: z.string().uuid().nullable(),
});

export const JobCancelBody = z.object({ reason: z.string().trim().min(3).max(300) });
export type JobCancelBody = z.infer<typeof JobCancelBody>;

/** What the recipient of a shared tracking link may see - deliberately minimal. */
export const JobTrackView = z.object({
  status: JobStatusSchema,
  statusLabelKey: z.string(),
  categoryName: z.string(),
  bookedForName: z.string().nullable(),
  preferredStart: z.string().nullable(),
  provider: z.object({ businessName: z.string().nullable(), technicianName: z.string().nullable(), verified: z.boolean() }).nullable(),
  updatedAt: z.string(),
});
export type JobTrackView = z.infer<typeof JobTrackView>;
