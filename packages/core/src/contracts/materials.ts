import { z } from 'zod';
import { MATERIAL_ORDER_STATUSES, MATERIAL_QUOTE_STATUSES, MATERIAL_REQUEST_STATUSES } from '../materials/materials';

const Item = z
  .object({
    name: z.string().trim().min(2).max(80),
    quantity: z.number().positive().max(999),
    unit: z.enum(['PIECE', 'METRE', 'KG', 'LITRE', 'BOX', 'SET']),
    brandPreference: z.string().trim().max(60).optional(),
  })
  .strict();

export const MaterialRequestBody = z
  .object({
    items: z.array(Item).min(1).max(15),
    neededByMinutes: z.number().int().min(15).max(2880).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type MaterialRequestBody = z.infer<typeof MaterialRequestBody>;

const QuotedItem = z
  .object({
    name: z.string().trim().min(2).max(80),
    quantity: z.number().positive().max(999),
    unit: z.enum(['PIECE', 'METRE', 'KG', 'LITRE', 'BOX', 'SET']),
    brand: z.string().trim().max(60).optional(),
    unitPricePaise: z.number().int().min(0).max(10_00_000),
    inStock: z.boolean(),
  })
  .strict();

export const MaterialQuoteBody = z
  .object({
    items: z.array(QuotedItem).min(1).max(15),
    deliveryPaise: z.number().int().min(0).max(2_00_000).default(0),
    etaMinutes: z.number().int().min(10).max(1440),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type MaterialQuoteBody = z.input<typeof MaterialQuoteBody>;

export const MaterialOrderStatusBody = z
  .object({
    to: z.enum(['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((b) => b.to !== 'CANCELLED' || !!b.reason, { message: 'Say why the order is cancelled' });
export type MaterialOrderStatusBody = z.infer<typeof MaterialOrderStatusBody>;

export const MaterialConfirmBody = z
  .object({
    ok: z.boolean(),
    /** Required when something is wrong: wrong brand, short quantity, damage, refusal. */
    issue: z.enum(['WRONG_ITEM', 'SHORT_QUANTITY', 'DAMAGED', 'REFUSED', 'OTHER']).optional(),
    note: z.string().trim().max(400).optional(),
    mediaIds: z.array(z.string().uuid()).max(8).optional(),
  })
  .strict()
  .refine((b) => b.ok || !!b.issue, { message: 'Pick what went wrong' });
export type MaterialConfirmBody = z.infer<typeof MaterialConfirmBody>;

export const MaterialInvoiceBody = z
  .object({
    mediaId: z.string().uuid(),
    amountPaise: z.number().int().positive(),
    invoiceNumber: z.string().trim().max(40).optional(),
  })
  .strict();
export type MaterialInvoiceBody = z.infer<typeof MaterialInvoiceBody>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const MaterialItemView = z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  brand: z.string().nullable(),
  unitPricePaise: z.number().int().nullable(),
  linePaise: z.number().int().nullable(),
  inStock: z.boolean().nullable(),
});
export type MaterialItemView = z.infer<typeof MaterialItemView>;

export const MaterialRequestView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  status: z.enum(MATERIAL_REQUEST_STATUSES),
  items: z.array(MaterialItemView),
  note: z.string().nullable(),
  neededBy: z.string().nullable(),
  quoteWindowEndsAt: z.string(),
  quoteCount: z.number().int(),
  createdAt: z.string(),
});
export type MaterialRequestView = z.infer<typeof MaterialRequestView>;

export const MaterialQuoteView = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  vendor: z.object({
    shopName: z.string(),
    verified: z.boolean(),
    ratingAvg: z.number().nullable(),
    distanceKm: z.number(),
  }),
  items: z.array(MaterialItemView),
  subtotalPaise: z.number().int(),
  deliveryPaise: z.number().int(),
  totalPaise: z.number().int(),
  etaMinutes: z.number().int(),
  inStockCount: z.number().int(),
  itemCount: z.number().int(),
  note: z.string().nullable(),
  status: z.enum(MATERIAL_QUOTE_STATUSES),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type MaterialQuoteView = z.infer<typeof MaterialQuoteView>;

export const MaterialOrderView = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  quoteId: z.string().uuid(),
  status: z.enum(MATERIAL_ORDER_STATUSES),
  vendorShopName: z.string(),
  items: z.array(MaterialItemView),
  subtotalPaise: z.number().int(),
  deliveryPaise: z.number().int(),
  totalPaise: z.number().int(),
  etaMinutes: z.number().int(),
  /** The separate authorization for this material leg, if one exists yet. */
  payment: z.object({ id: z.string().uuid(), amountPaise: z.number().int(), status: z.string() }).nullable(),
  deliveredAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  issue: z.string().nullable(),
  issueNote: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type MaterialOrderView = z.infer<typeof MaterialOrderView>;

/** Everything the material leg of a job looks like, for whichever side is asking. */
export const MaterialPanelView = z.object({
  jobId: z.string().uuid(),
  materialResponsibility: z.string(),
  request: MaterialRequestView.nullable(),
  quotes: z.array(MaterialQuoteView),
  order: MaterialOrderView.nullable(),
  history: z.array(MaterialOrderView),
});
export type MaterialPanelView = z.infer<typeof MaterialPanelView>;

/** A request as a vendor sees it: the list and the area, never the customer's address. */
export const VendorRequestView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  areaLabel: z.string(),
  distanceKm: z.number(),
  items: z.array(MaterialItemView),
  note: z.string().nullable(),
  neededBy: z.string().nullable(),
  quoteWindowEndsAt: z.string(),
  alreadyQuoted: z.boolean(),
  createdAt: z.string(),
});
export type VendorRequestView = z.infer<typeof VendorRequestView>;
