import { describe, expect, it } from 'vitest';
import {
  canMoveOrder,
  checkCanSelect,
  checkInvoice,
  checkMaterialQuote,
  checkMaterialRequest,
  materialQuoteScore,
  materialSubtotal,
  materialTotals,
  type MaterialItem,
  type QuotedItem,
} from './materials';

const CARTRIDGE = { name: 'Cartridge', quantity: 2, unit: 'PIECE' };
const TAPE = { name: 'Tape', quantity: 1, unit: 'PIECE' };
const ITEMS: MaterialItem[] = [CARTRIDGE, TAPE];
const QUOTED_CARTRIDGE: QuotedItem = { ...CARTRIDGE, unitPricePaise: 18_000, inStock: true };
const QUOTED_TAPE: QuotedItem = { ...TAPE, unitPricePaise: 3_000, inStock: true };
const QUOTED: QuotedItem[] = [QUOTED_CARTRIDGE, QUOTED_TAPE];
const ctx = { openRequests: 0, totalRequests: 0, materialResponsibility: 'PROVIDER' };

describe('material requests', () => {
  it('only from a job someone is actually working on', () => {
    expect(checkMaterialRequest({ status: 'IN_PROGRESS' }, ITEMS, ctx)).toBeNull();
    expect(checkMaterialRequest({ status: 'ARRIVED' }, ITEMS, ctx)).toBeNull();
    expect(checkMaterialRequest({ status: 'PROVIDER_ASSIGNED' }, ITEMS, ctx)).toBe('JOB_NOT_ON_SITE');
    expect(checkMaterialRequest({ status: 'OPEN_FOR_BIDS' }, ITEMS, ctx)).toBe('JOB_NOT_ON_SITE');
  });

  it('never buys material the customer said they would bring', () => {
    expect(checkMaterialRequest({ status: 'IN_PROGRESS' }, ITEMS, { ...ctx, materialResponsibility: 'CUSTOMER' })).toBe(
      'CUSTOMER_SUPPLIES_MATERIAL',
    );
  });

  it('caps open and total requests, and the list length', () => {
    expect(checkMaterialRequest({ status: 'IN_PROGRESS' }, ITEMS, { ...ctx, openRequests: 1 })).toBe('REQUEST_ALREADY_OPEN');
    expect(checkMaterialRequest({ status: 'IN_PROGRESS' }, ITEMS, { ...ctx, totalRequests: 3 })).toBe('REQUEST_LIMIT_REACHED');
    expect(checkMaterialRequest({ status: 'IN_PROGRESS' }, [], ctx)).toBe('NO_ITEMS');
    const many = Array.from({ length: 16 }, () => CARTRIDGE);
    expect(checkMaterialRequest({ status: 'IN_PROGRESS' }, many, ctx)).toBe('TOO_MANY_ITEMS');
  });
});

describe('vendor quotes', () => {
  const request = { status: 'OPEN' as const, itemCount: 2, quoteWindowEndsAt: new Date(Date.now() + 60_000) };
  const vendor = { verified: true, available: true, alreadyQuoted: false };

  it('accepts a full list from a verified, available vendor', () => {
    expect(checkMaterialQuote(request, QUOTED, vendor)).toBeNull();
  });

  it('refuses an unverified or paused vendor before anything else', () => {
    expect(checkMaterialQuote(request, QUOTED, { ...vendor, verified: false })).toBe('VENDOR_NOT_VERIFIED');
    expect(checkMaterialQuote(request, QUOTED, { ...vendor, available: false })).toBe('VENDOR_UNAVAILABLE');
  });

  it('refuses a partial list, a closed window and a second quote', () => {
    expect(checkMaterialQuote(request, [QUOTED_CARTRIDGE], vendor)).toBe('ITEM_COUNT_MISMATCH');
    expect(checkMaterialQuote({ ...request, quoteWindowEndsAt: new Date(Date.now() - 1) }, QUOTED, vendor)).toBe('WINDOW_CLOSED');
    expect(checkMaterialQuote(request, QUOTED, { ...vendor, alreadyQuoted: true })).toBe('ALREADY_QUOTED');
  });

  it('refuses a quote with nothing in stock', () => {
    expect(checkMaterialQuote(request, QUOTED.map((i) => ({ ...i, inStock: false })), vendor)).toBe('NOTHING_IN_STOCK');
  });
});

describe('material money', () => {
  it('charges only for the lines that are in stock', () => {
    expect(materialSubtotal(QUOTED)).toBe(39_000);
    expect(materialSubtotal([{ ...QUOTED_CARTRIDGE, inStock: false }, QUOTED_TAPE])).toBe(3_000);
  });

  it('takes no platform margin: the vendor is owed the whole amount', () => {
    const t = materialTotals(QUOTED, 4_000);
    expect(t.totalPaise).toBe(43_000);
    expect(t.vendorPayablePaise).toBe(t.totalPaise);
  });

  it('ranks on stock and speed, not price alone', () => {
    const cheapButEmpty = materialQuoteScore({ totalPaise: 30_000, cheapestTotalPaise: 30_000, inStockRatio: 0.25, etaMinutes: 60, ratingAvg: 4 });
    const dearerButComplete = materialQuoteScore({ totalPaise: 43_000, cheapestTotalPaise: 30_000, inStockRatio: 1, etaMinutes: 40, ratingAvg: 4 });
    expect(dearerButComplete).toBeGreaterThan(cheapButEmpty);
  });
});

describe('selection and fulfilment', () => {
  const quote = { status: 'ACTIVE' as const, expiresAt: new Date(Date.now() + 60_000), anyInStock: true };

  it('guards the selection', () => {
    expect(checkCanSelect(quote, { hasLiveOrder: false })).toBeNull();
    expect(checkCanSelect(quote, { hasLiveOrder: true })).toBe('ALREADY_ORDERED');
    expect(checkCanSelect({ ...quote, expiresAt: new Date(Date.now() - 1) }, { hasLiveOrder: false })).toBe('QUOTE_EXPIRED');
    expect(checkCanSelect({ ...quote, status: 'REJECTED' }, { hasLiveOrder: false })).toBe('QUOTE_NOT_ACTIVE');
  });

  it('lets the vendor fulfil and the customer side confirm, and nobody skip a step', () => {
    expect(canMoveOrder('PREPARING', 'OUT_FOR_DELIVERY', 'VENDOR')).toBe(true);
    expect(canMoveOrder('OUT_FOR_DELIVERY', 'DELIVERED', 'VENDOR')).toBe(true);
    expect(canMoveOrder('DELIVERED', 'CONFIRMED', 'CUSTOMER_SIDE')).toBe(true);
    // a vendor cannot sign for their own delivery
    expect(canMoveOrder('DELIVERED', 'CONFIRMED', 'VENDOR')).toBe(false);
    // and nothing ships before the money is authorized
    expect(canMoveOrder('PENDING_PAYMENT', 'OUT_FOR_DELIVERY', 'VENDOR')).toBe(false);
    // only an admin releases a held order
    expect(canMoveOrder('ON_HOLD', 'CONFIRMED', 'CUSTOMER_SIDE')).toBe(false);
    expect(canMoveOrder('ON_HOLD', 'CONFIRMED', 'ADMIN')).toBe(true);
    expect(canMoveOrder('CONFIRMED', 'CANCELLED', 'ADMIN')).toBe(false);
  });
});

describe('invoices', () => {
  const order = { status: 'CONFIRMED' as const, totalPaise: 43_000, hasInvoice: false };

  it('must match the order to the paisa', () => {
    expect(checkInvoice(order, 43_000)).toBeNull();
    expect(checkInvoice(order, 43_100)).toBe('AMOUNT_MISMATCH');
    expect(checkInvoice(order, 42_900)).toBe('AMOUNT_MISMATCH');
  });

  it('is only filed once, against a confirmed order', () => {
    expect(checkInvoice({ ...order, status: 'DELIVERED' }, 43_000)).toBe('ORDER_NOT_CONFIRMED');
    expect(checkInvoice({ ...order, status: 'ON_HOLD' }, 43_000)).toBe('ORDER_NOT_CONFIRMED');
    expect(checkInvoice({ ...order, hasInvoice: true }, 43_000)).toBe('INVOICE_ALREADY_FILED');
  });
});
