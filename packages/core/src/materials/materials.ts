/**
 * Material rules (PRODUCT_SPEC section 13, EDGE_CASE_MATRIX "Materials and vendors").
 *
 * Materials are always a separate leg from labour: their own quote, their own authorization,
 * their own settlement. The platform takes no margin on them in the pilot (DECISIONS D-013),
 * so what the customer pays for material is what the vendor is owed.
 */
import type { JobStatus } from '../contracts/enums';

export const MATERIAL_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CONFIRMED',
  'ON_HOLD',
  'CANCELLED',
] as const;
export type MaterialOrderStatus = (typeof MATERIAL_ORDER_STATUSES)[number];

export const MATERIAL_REQUEST_STATUSES = ['OPEN', 'QUOTED', 'ORDERED', 'CANCELLED', 'EXPIRED'] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

export const MATERIAL_QUOTE_STATUSES = ['ACTIVE', 'SELECTED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export type MaterialQuoteStatus = (typeof MATERIAL_QUOTE_STATUSES)[number];

/** A material run only makes sense once someone is actually on the job. */
export const MATERIAL_REQUEST_ALLOWED_FROM: readonly JobStatus[] = ['ARRIVED', 'STARTED', 'IN_PROGRESS'];

export const MAX_MATERIAL_REQUESTS_PER_JOB = 3;
export const MAX_MATERIAL_ITEMS = 15;
/** Vendors get this long to answer before the request goes stale. */
export const MATERIAL_QUOTE_WINDOW_MINUTES = 45;
/** How long a vendor's price holds once given. */
export const MATERIAL_QUOTE_TTL_MINUTES = 120;

export interface MaterialItem {
  name: string;
  quantity: number;
  unit: string;
  brandPreference?: string | null;
}

export type MaterialRequestBlocker =
  | 'JOB_NOT_ON_SITE'
  | 'REQUEST_ALREADY_OPEN'
  | 'REQUEST_LIMIT_REACHED'
  | 'NO_ITEMS'
  | 'TOO_MANY_ITEMS'
  | 'CUSTOMER_SUPPLIES_MATERIAL';

export function checkMaterialRequest(
  job: { status: JobStatus },
  items: MaterialItem[],
  context: { openRequests: number; totalRequests: number; materialResponsibility: string },
): MaterialRequestBlocker | null {
  if (!MATERIAL_REQUEST_ALLOWED_FROM.includes(job.status)) return 'JOB_NOT_ON_SITE';
  // If the customer said they would supply the material, the platform does not buy it for them.
  if (context.materialResponsibility === 'CUSTOMER') return 'CUSTOMER_SUPPLIES_MATERIAL';
  if (context.openRequests > 0) return 'REQUEST_ALREADY_OPEN';
  if (context.totalRequests >= MAX_MATERIAL_REQUESTS_PER_JOB) return 'REQUEST_LIMIT_REACHED';
  if (items.length === 0) return 'NO_ITEMS';
  if (items.length > MAX_MATERIAL_ITEMS) return 'TOO_MANY_ITEMS';
  return null;
}

export interface QuotedItem {
  name: string;
  quantity: number;
  unit: string;
  brand?: string | null;
  unitPricePaise: number;
  inStock: boolean;
}

export type MaterialQuoteBlocker =
  | 'REQUEST_NOT_OPEN'
  | 'WINDOW_CLOSED'
  | 'ALREADY_QUOTED'
  | 'NOTHING_IN_STOCK'
  | 'ITEM_COUNT_MISMATCH'
  | 'VENDOR_UNAVAILABLE'
  | 'VENDOR_NOT_VERIFIED';

export function checkMaterialQuote(
  request: { status: MaterialRequestStatus; itemCount: number; quoteWindowEndsAt: Date },
  items: QuotedItem[],
  vendor: { verified: boolean; available: boolean; alreadyQuoted: boolean },
  now: Date = new Date(),
): MaterialQuoteBlocker | null {
  if (!vendor.verified) return 'VENDOR_NOT_VERIFIED';
  if (!vendor.available) return 'VENDOR_UNAVAILABLE';
  if (request.status !== 'OPEN' && request.status !== 'QUOTED') return 'REQUEST_NOT_OPEN';
  if (now >= request.quoteWindowEndsAt) return 'WINDOW_CLOSED';
  if (vendor.alreadyQuoted) return 'ALREADY_QUOTED';
  // A quote answers the whole list; partial lists would be impossible to compare fairly.
  if (items.length !== request.itemCount) return 'ITEM_COUNT_MISMATCH';
  if (!items.some((i) => i.inStock)) return 'NOTHING_IN_STOCK';
  return null;
}

/** Subtotal of the in-stock lines only; an out-of-stock line is never charged for. */
export function materialSubtotal(items: QuotedItem[]): number {
  return items.reduce((sum, i) => (i.inStock ? sum + Math.round(i.unitPricePaise * i.quantity) : sum), 0);
}

export interface MaterialTotals {
  subtotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  /** No platform margin on materials in the pilot: the vendor is owed the whole amount. */
  vendorPayablePaise: number;
}

export function materialTotals(items: QuotedItem[], deliveryPaise: number): MaterialTotals {
  const subtotalPaise = materialSubtotal(items);
  const totalPaise = subtotalPaise + deliveryPaise;
  return { subtotalPaise, deliveryPaise, totalPaise, vendorPayablePaise: totalPaise };
}

export type MaterialSelectBlocker = 'QUOTE_NOT_ACTIVE' | 'QUOTE_EXPIRED' | 'ALREADY_ORDERED' | 'NOTHING_IN_STOCK';

export function checkCanSelect(
  quote: { status: MaterialQuoteStatus; expiresAt: Date; anyInStock: boolean },
  request: { hasLiveOrder: boolean },
  now: Date = new Date(),
): MaterialSelectBlocker | null {
  if (request.hasLiveOrder) return 'ALREADY_ORDERED';
  if (quote.status !== 'ACTIVE') return 'QUOTE_NOT_ACTIVE';
  if (now >= quote.expiresAt) return 'QUOTE_EXPIRED';
  if (!quote.anyInStock) return 'NOTHING_IN_STOCK';
  return null;
}

/**
 * Who may move a material order where. The vendor drives fulfilment, the customer side
 * confirms receipt, and only an admin can release a held order.
 */
export type MaterialActor = 'VENDOR' | 'CUSTOMER_SIDE' | 'SYSTEM' | 'ADMIN';

export const MATERIAL_ORDER_TRANSITIONS: Readonly<Record<MaterialOrderStatus, ReadonlyArray<{ to: MaterialOrderStatus; actors: readonly MaterialActor[] }>>> = {
  PENDING_PAYMENT: [
    { to: 'PREPARING', actors: ['SYSTEM', 'ADMIN'] },
    { to: 'CANCELLED', actors: ['CUSTOMER_SIDE', 'SYSTEM', 'ADMIN'] },
  ],
  PREPARING: [
    { to: 'OUT_FOR_DELIVERY', actors: ['VENDOR', 'ADMIN'] },
    { to: 'CANCELLED', actors: ['VENDOR', 'CUSTOMER_SIDE', 'ADMIN'] },
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', actors: ['VENDOR', 'ADMIN'] },
    { to: 'ON_HOLD', actors: ['CUSTOMER_SIDE', 'ADMIN'] },
  ],
  DELIVERED: [
    { to: 'CONFIRMED', actors: ['CUSTOMER_SIDE', 'ADMIN'] },
    { to: 'ON_HOLD', actors: ['CUSTOMER_SIDE', 'ADMIN'] },
  ],
  CONFIRMED: [],
  ON_HOLD: [
    { to: 'CONFIRMED', actors: ['ADMIN'] },
    { to: 'CANCELLED', actors: ['ADMIN'] },
  ],
  CANCELLED: [],
};

export function canMoveOrder(from: MaterialOrderStatus, to: MaterialOrderStatus, actor: MaterialActor): boolean {
  return (MATERIAL_ORDER_TRANSITIONS[from] ?? []).some((r) => r.to === to && r.actors.includes(actor));
}

export type InvoiceBlocker = 'ORDER_NOT_CONFIRMED' | 'AMOUNT_MISMATCH' | 'INVOICE_ALREADY_FILED';

/**
 * The invoice is what a vendor payout is later justified by, so it has to match the order to
 * the paisa - an invoice for a different amount is refused, not quietly accepted.
 */
export function checkInvoice(
  order: { status: MaterialOrderStatus; totalPaise: number; hasInvoice: boolean },
  amountPaise: number,
): InvoiceBlocker | null {
  if (order.status !== 'CONFIRMED') return 'ORDER_NOT_CONFIRMED';
  if (order.hasInvoice) return 'INVOICE_ALREADY_FILED';
  if (amountPaise !== order.totalPaise) return 'AMOUNT_MISMATCH';
  return null;
}

/**
 * Ranking for the customer: cheapest is not automatically best. Stock coverage and speed
 * matter as much as price, and a vendor who cannot supply half the list should not win.
 */
export function materialQuoteScore(q: {
  totalPaise: number;
  cheapestTotalPaise: number;
  inStockRatio: number;
  etaMinutes: number;
  ratingAvg: number | null;
}): number {
  const price = q.cheapestTotalPaise > 0 ? q.cheapestTotalPaise / Math.max(q.totalPaise, 1) : 1; // 1 = cheapest
  const speed = Math.max(0, 1 - q.etaMinutes / 240);
  const rating = (q.ratingAvg ?? 3.5) / 5;
  return Number((price * 0.35 + q.inStockRatio * 0.35 + speed * 0.2 + rating * 0.1).toFixed(4));
}
