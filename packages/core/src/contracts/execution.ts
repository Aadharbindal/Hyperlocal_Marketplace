import { z } from 'zod';

// ---------------------------------------------------------------------------
// Assignment and arrival
// ---------------------------------------------------------------------------

export const AssignTechnicianBody = z
  .object({
    technicianId: z.string().uuid(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type AssignTechnicianBody = z.infer<typeof AssignTechnicianBody>;

/** The provider side only ever announces these two; everything else is server-driven. */
export const JobProgressBody = z
  .object({
    to: z.enum(['EN_ROUTE', 'ARRIVED']),
    etaMinutes: z.number().int().min(0).max(720).optional(),
  })
  .strict();
export type JobProgressBody = z.infer<typeof JobProgressBody>;

export const StartJobBody = z
  .object({
    code: z.string().trim().regex(/^\d{4}$/).optional(),
    /** Admin/support only: start without the code, with a reason that is kept forever. */
    override: z.boolean().optional(),
    reason: z.string().trim().max(400).optional(),
  })
  .strict()
  .refine((b) => !!b.code || b.override === true, { message: 'Enter the 4-digit start code' });
export type StartJobBody = z.input<typeof StartJobBody>;

// ---------------------------------------------------------------------------
// Price revision
// ---------------------------------------------------------------------------

export const PriceRevisionBody = z
  .object({
    reason: z.enum(['EXTRA_WORK', 'HIDDEN_DAMAGE', 'WRONG_DIAGNOSIS', 'EXTRA_MATERIAL', 'ACCESS_DIFFICULTY', 'OTHER']),
    extraLabourPaise: z.number().int().min(0).max(50_00_000).default(0),
    extraMaterialPaise: z.number().int().min(0).max(50_00_000).default(0),
    extraTimeMinutes: z.number().int().min(0).max(2880).default(0),
    explanation: z.string().trim().min(20).max(1000),
    /** Ids of media already attached to this job in the PRICE_REVISION phase. */
    mediaIds: z.array(z.string().uuid()).min(1).max(8),
  })
  .strict();
export type PriceRevisionBody = z.input<typeof PriceRevisionBody>;

export const PriceRevisionRespondBody = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'CLARIFY']),
    message: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.action !== 'CLARIFY' || !!b.message, { message: 'Say what you want clarified' });
export type PriceRevisionRespondBody = z.infer<typeof PriceRevisionRespondBody>;

export const PriceRevisionView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  reason: z.string(),
  extraLabourPaise: z.number().int(),
  extraMaterialPaise: z.number().int(),
  extraTimeMinutes: z.number().int(),
  originalTotalPaise: z.number().int(),
  revisedTotalPaise: z.number().int(),
  /** What the customer has to authorize on top of what is already held. */
  differencePaise: z.number().int(),
  explanation: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CLARIFICATION', 'CANCELLED', 'SUPPORT']),
  needsSupport: z.boolean(),
  mediaUrls: z.array(z.string()),
  respondedAt: z.string().nullable(),
  responseMessage: z.string().nullable(),
  createdAt: z.string(),
});
export type PriceRevisionView = z.infer<typeof PriceRevisionView>;

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export const CompleteJobBody = z
  .object({
    summary: z.string().trim().min(10).max(1000),
    mediaIds: z.array(z.string().uuid()).min(1).max(8),
    warrantyNote: z.string().trim().max(300).optional(),
  })
  .strict();
export type CompleteJobBody = z.infer<typeof CompleteJobBody>;

export const ApproveCompletionBody = z
  .object({
    approved: z.boolean(),
    /** Required when sending the provider back: they need to know what is wrong. */
    reason: z.string().trim().max(500).optional(),
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .refine((b) => b.approved || !!b.reason, { message: 'Tell the provider what is still pending' });
export type ApproveCompletionBody = z.infer<typeof ApproveCompletionBody>;

export const CompletionView = z.object({
  id: z.string().uuid(),
  summary: z.string(),
  warrantyNote: z.string().nullable(),
  mediaUrls: z.array(z.string()),
  submittedAt: z.string(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});
export type CompletionView = z.infer<typeof CompletionView>;

// ---------------------------------------------------------------------------
// The execution panel both sides poll
// ---------------------------------------------------------------------------

export const ExecutionView = z.object({
  jobId: z.string().uuid(),
  status: z.string(),
  /** Only ever populated for the customer - the provider must be told it in person. */
  startCode: z.string().nullable(),
  startCodeAttemptsLeft: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  startWasOverridden: z.boolean(),
  technician: z
    .object({ id: z.string().uuid(), name: z.string(), verified: z.boolean(), maskedPhone: z.string().nullable() })
    .nullable(),
  etaMinutes: z.number().int().nullable(),
  openRevision: PriceRevisionView.nullable(),
  revisions: z.array(PriceRevisionView),
  completion: CompletionView.nullable(),
  chatUnread: z.number().int(),
  /**
   * Where the job is, for the person who has to get there.
   *
   * Populated for the assigned professional and the technician, and null for the customer, who is
   * already standing in it. It had no business existing until the booking was confirmed and an
   * assignment was live, which is exactly when this panel starts being served - so the gate is the
   * panel's own.
   *
   * This closed a real hole rather than adding a nicety. The provider's "Working now" screen showed
   * the controls for a job and not one word about where it was: a professional who had won the work
   * had to go back out to the feed to find the street, and the technician's card was the only place
   * in the app with a directions link.
   */
  destination: z
    .object({
      lat: z.number(),
      lng: z.number(),
      /** One line, as typed by the customer - the part a navigation app cannot infer. */
      formatted: z.string(),
      landmark: z.string().nullable(),
      /** "Tell the guard flat B-14." The single most useful sentence on this screen. */
      gateInstructions: z.string().nullable(),
    })
    .nullable(),
});
export type ExecutionView = z.infer<typeof ExecutionView>;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const ChatSendBody = z
  .object({
    body: z.string().trim().min(1).max(1000),
  })
  .strict();
export type ChatSendBody = z.infer<typeof ChatSendBody>;

export const ChatMessageView = z.object({
  id: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string(),
  senderParty: z.enum(['CUSTOMER', 'PROVIDER', 'TECHNICIAN', 'SUPPORT']),
  body: z.string(),
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  mine: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessageView = z.infer<typeof ChatMessageView>;

export const ChatThreadView = z.object({
  threadId: z.string().uuid(),
  jobId: z.string().uuid(),
  open: z.boolean(),
  items: z.array(ChatMessageView),
});
export type ChatThreadView = z.infer<typeof ChatThreadView>;

// ---------------------------------------------------------------------------
// Arrival: where they are, while they are on their way
// ---------------------------------------------------------------------------

/**
 * A position report from a professional's phone.
 *
 * Accuracy is required rather than optional: without it the server cannot tell a GPS fix from a
 * cell-tower guess, and would end up putting a confident distance in front of a customer on the
 * strength of nothing.
 */
export const ReportPositionBody = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100_000),
  })
  .strict();
export type ReportPositionBody = z.infer<typeof ReportPositionBody>;

/**
 * What the customer is told.
 *
 * This carried a distance and a time and no coordinates at all for most of this app's life, on the
 * argument that a distance answers the question and a point is something you can follow. The point
 * is here now because customers asked for the map every other app has trained them to expect, and
 * the argument turned out to be answerable rather than absolute: the position in this payload is
 * the one already rounded to ~110 m on the way *into* the database, so no doorway-level fix exists
 * anywhere to be handed out. What the map can show is which street somebody is on.
 *
 * The narrower rules around it did not move. It is only ever the latest position and never a trail,
 * only between setting off and arriving, only to the customer on that booking, never on the
 * forwardable tracking link - and `STALE` deliberately has no point, because a three-minute-old dot
 * drawn on a map is indistinguishable from a live one.
 */
export const ArrivalPoint = z.object({ lat: z.number(), lng: z.number() });

export const ArrivalView = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NOT_TRACKING') }),
  z.object({ kind: z.literal('ARRIVING_NOW'), point: ArrivalPoint }),
  z.object({ kind: z.literal('ON_THE_WAY'), distanceKm: z.number(), etaMinutes: z.number().int(), point: ArrivalPoint }),
  z.object({ kind: z.literal('STALE'), lastSeenSecondsAgo: z.number().int() }),
]);
export type ArrivalView = z.infer<typeof ArrivalView>;
