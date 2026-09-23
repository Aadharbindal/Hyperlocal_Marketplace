import { z } from 'zod';
import { MATERIAL_RESPONSIBILITIES, OFFER_STATUSES, PAYMENT_STATUSES } from './enums';

// ---------------------------------------------------------------------------
// Counter-offers
// ---------------------------------------------------------------------------
export const CounterOfferBody = z
  .object({
    /** Which provider's offer is being countered. */
    bidId: z.string().uuid(),
    labourPaise: z.number().int().min(0).max(50_00_000),
    visitFeePaise: z.number().int().min(0).max(5_00_000).optional(),
    etaMinutes: z.number().int().min(10).max(4320).optional(),
    warrantyDays: z.number().int().min(0).max(365).optional(),
    materialResponsibility: z.enum(MATERIAL_RESPONSIBILITIES).optional(),
    scopeNotes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((o) => o.labourPaise > 0 || (o.visitFeePaise ?? 0) > 0, { message: 'Counter with a labour price or a visit fee' });
export type CounterOfferBody = z.input<typeof CounterOfferBody>;

export const OfferRespondBody = z
  .object({
    action: z.enum(['ACCEPT', 'REJECT', 'COUNTER']),
    /** Required when countering. */
    labourPaise: z.number().int().min(0).max(50_00_000).optional(),
    visitFeePaise: z.number().int().min(0).max(5_00_000).optional(),
    etaMinutes: z.number().int().min(10).max(4320).optional(),
    warrantyDays: z.number().int().min(0).max(365).optional(),
    materialResponsibility: z.enum(MATERIAL_RESPONSIBILITIES).optional(),
    scopeNotes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((o) => o.action !== 'COUNTER' || (o.labourPaise ?? 0) > 0 || (o.visitFeePaise ?? 0) > 0, {
    message: 'A counter needs a price',
  });
export type OfferRespondBody = z.infer<typeof OfferRespondBody>;

export const OfferChainItem = z.object({
  id: z.string().uuid(),
  parentOfferId: z.string().uuid().nullable(),
  bidId: z.string().uuid(),
  senderParty: z.enum(['CUSTOMER', 'PROVIDER']),
  labourPaise: z.number().int(),
  visitFeePaise: z.number().int(),
  totalPaise: z.number().int(),
  etaMinutes: z.number().int(),
  warrantyDays: z.number().int(),
  materialResponsibility: z.enum(MATERIAL_RESPONSIBILITIES),
  scopeNotes: z.string().nullable(),
  status: z.enum(OFFER_STATUSES),
  expiresAt: z.string(),
  /** True when the signed-in user is the one who has to answer. */
  awaitingYou: z.boolean(),
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
});
export type OfferChainItem = z.infer<typeof OfferChainItem>;

// ---------------------------------------------------------------------------
// The locked quote and the confirmed booking
// ---------------------------------------------------------------------------
export const BookingQuoteView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  providerId: z.string().uuid(),
  providerBusinessName: z.string().nullable(),
  labourPaise: z.number().int(),
  visitFeePaise: z.number().int(),
  materialEstimatePaise: z.number().int(),
  platformFeePaise: z.number().int(),
  protectionFeePaise: z.number().int(),
  taxPaise: z.number().int(),
  totalPaise: z.number().int(),
  providerPayablePaise: z.number().int(),
  warrantyDays: z.number().int(),
  etaMinutes: z.number().int(),
  materialResponsibility: z.enum(MATERIAL_RESPONSIBILITIES),
  status: z.enum(['ACTIVE', 'SUPERSEDED', 'CANCELLED']),
  lockedAt: z.string(),
});
export type BookingQuoteView = z.infer<typeof BookingQuoteView>;

export const PaymentView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  purpose: z.enum(['BOOKING', 'MATERIAL', 'MILESTONE', 'PRICE_REVISION']),
  amountPaise: z.number().int(),
  currency: z.literal('INR'),
  status: z.enum(PAYMENT_STATUSES),
  /** The gateway order the client hands to its checkout SDK. */
  providerOrderId: z.string().nullable(),
  provider: z.string(),
  createdAt: z.string(),
});
export type PaymentView = z.infer<typeof PaymentView>;

/** What `POST /bids/:id/accept` returns: the frozen quote plus what to pay next. */
export const AcceptOfferResponse = z.object({
  quote: BookingQuoteView,
  payment: PaymentView,
  jobStatus: z.string(),
});
export type AcceptOfferResponse = z.infer<typeof AcceptOfferResponse>;

export const AssignmentView = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  providerBusinessName: z.string().nullable(),
  providerVerified: z.boolean(),
  technicianId: z.string().uuid().nullable(),
  technicianName: z.string().nullable(),
  status: z.enum(['ACTIVE', 'REPLACED', 'CANCELLED']),
  createdAt: z.string(),
});
export type AssignmentView = z.infer<typeof AssignmentView>;

/**
 * The mock gateway callback the app posts after its checkout sheet closes. A live gateway
 * signs its own webhook; this body carries the same shape so the handler does not change.
 */
export const PaymentWebhookBody = z
  .object({
    eventId: z.string().min(6).max(120),
    type: z.enum(['payment.authorized', 'payment.failed']),
    orderId: z.string().min(4).max(120),
    paymentId: z.string().min(4).max(120),
    amountPaise: z.number().int().positive(),
    failureReason: z.string().max(200).optional(),
  })
  .strict();
export type PaymentWebhookBody = z.infer<typeof PaymentWebhookBody>;
