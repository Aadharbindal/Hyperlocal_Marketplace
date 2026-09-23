/**
 * The ledger (PRODUCT_SPEC section 14, PAYMENT_FLOW.md).
 *
 * Every movement of money is written as a balanced set of entries that sums to zero, from the
 * platform's point of view: money arriving is positive, an obligation the platform now owes is
 * negative. Nothing is ever edited or deleted - a mistake is corrected with a new adjustment,
 * which is why `ledger_entries` has UPDATE and DELETE revoked in SQL.
 *
 * The vocabulary is authorization, hold, capture, settlement, refund and dispute hold. The word
 * "escrow" is never used: it is a regulated term in India (DECISIONS D-007).
 */
import type { Paise } from '../pricing/pricing';

export const LEDGER_ENTRY_TYPES = [
  'CUSTOMER_CHARGE',
  'PROVIDER_PAYABLE',
  'VENDOR_PAYABLE',
  'PLATFORM_REVENUE',
  'PROTECTION_RESERVE',
  'REFUND',
  'DISPUTE_HOLD',
  'GATEWAY_FEE',
  'TAX',
  'MANUAL_ADJUSTMENT',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerLine {
  entryType: LedgerEntryType;
  /** Signed, in paise. Positive = the platform received it; negative = the platform owes it. */
  amountPaise: Paise;
  /** Whose balance this line belongs to, when it is someone's money. */
  accountUserId?: string | null;
  note?: string;
}

export function isBalanced(lines: LedgerLine[]): boolean {
  return lines.reduce((sum, l) => sum + l.amountPaise, 0) === 0;
}

export function sumFor(lines: LedgerLine[], type: LedgerEntryType): Paise {
  return lines.filter((l) => l.entryType === type).reduce((sum, l) => sum + l.amountPaise, 0);
}

export interface CaptureInput {
  totalPaise: Paise;
  providerPayablePaise: Paise;
  platformFeePaise: Paise;
  taxPaise: Paise;
  protectionFeePaise?: Paise;
  customerId: string;
  providerId: string;
}

/**
 * Capturing a labour booking: the customer's money arrives and is immediately allocated to the
 * provider, the platform and the tax authority. The four lines must add up, or the capture is
 * refused rather than written half-right.
 */
export function buildCaptureLines(input: CaptureInput): LedgerLine[] {
  const protection = input.protectionFeePaise ?? 0;
  const lines: LedgerLine[] = [
    { entryType: 'CUSTOMER_CHARGE', amountPaise: input.totalPaise, accountUserId: input.customerId, note: 'Labour captured' },
    { entryType: 'PROVIDER_PAYABLE', amountPaise: -input.providerPayablePaise, accountUserId: input.providerId },
    { entryType: 'PLATFORM_REVENUE', amountPaise: -input.platformFeePaise, accountUserId: null },
    { entryType: 'TAX', amountPaise: -input.taxPaise, accountUserId: null },
  ];
  if (protection > 0) lines.push({ entryType: 'PROTECTION_RESERVE', amountPaise: -protection, accountUserId: null });
  return lines;
}

/** Materials carry no platform margin in the pilot (D-013): the vendor is owed the whole amount. */
export function buildMaterialCaptureLines(input: { totalPaise: Paise; customerId: string; vendorId: string }): LedgerLine[] {
  return [
    { entryType: 'CUSTOMER_CHARGE', amountPaise: input.totalPaise, accountUserId: input.customerId, note: 'Materials captured' },
    { entryType: 'VENDOR_PAYABLE', amountPaise: -input.totalPaise, accountUserId: input.vendorId },
  ];
}

export interface RefundInput {
  amountPaise: Paise;
  /** What the refund is clawed back from; these must add up to the refund. */
  fromProviderPaise: Paise;
  fromPlatformPaise: Paise;
  fromTaxPaise: Paise;
  customerId: string;
  providerId: string | null;
  reason: string;
}

/**
 * A refund reverses the allocations it came from. Taking it out of the provider's payable is the
 * honest way to show where the money went - not a bare negative line with nothing to match it.
 */
export function buildRefundLines(input: RefundInput): LedgerLine[] {
  const lines: LedgerLine[] = [{ entryType: 'REFUND', amountPaise: -input.amountPaise, accountUserId: input.customerId, note: input.reason }];
  if (input.fromProviderPaise > 0 && input.providerId) {
    lines.push({ entryType: 'PROVIDER_PAYABLE', amountPaise: input.fromProviderPaise, accountUserId: input.providerId });
  }
  if (input.fromPlatformPaise > 0) lines.push({ entryType: 'PLATFORM_REVENUE', amountPaise: input.fromPlatformPaise, accountUserId: null });
  if (input.fromTaxPaise > 0) lines.push({ entryType: 'TAX', amountPaise: input.fromTaxPaise, accountUserId: null });
  return lines;
}

/**
 * Splits a refund back across the same proportions the capture used, so a partial refund never
 * silently comes out of the provider alone.
 */
export function splitRefund(
  refundPaise: Paise,
  captured: { providerPayablePaise: Paise; platformFeePaise: Paise; taxPaise: Paise; totalPaise: Paise },
): { fromProviderPaise: Paise; fromPlatformPaise: Paise; fromTaxPaise: Paise } {
  if (refundPaise >= captured.totalPaise) {
    return {
      fromProviderPaise: captured.providerPayablePaise,
      fromPlatformPaise: captured.platformFeePaise,
      fromTaxPaise: captured.taxPaise,
    };
  }
  const ratio = refundPaise / captured.totalPaise;
  const fromPlatformPaise = Math.round(captured.platformFeePaise * ratio);
  const fromTaxPaise = Math.round(captured.taxPaise * ratio);
  // the provider line absorbs the rounding so the set still sums to the refund exactly
  return { fromProviderPaise: refundPaise - fromPlatformPaise - fromTaxPaise, fromPlatformPaise, fromTaxPaise };
}

/** A dispute parks money: it is neither the provider's nor refunded until someone decides. */
export function buildDisputeHoldLines(input: { amountPaise: Paise; providerId: string; jobRef: string }): LedgerLine[] {
  return [
    { entryType: 'PROVIDER_PAYABLE', amountPaise: input.amountPaise, accountUserId: input.providerId, note: `Held for dispute ${input.jobRef}` },
    { entryType: 'DISPUTE_HOLD', amountPaise: -input.amountPaise, accountUserId: null, note: input.jobRef },
  ];
}

export function buildDisputeReleaseLines(input: { amountPaise: Paise; providerId: string; jobRef: string }): LedgerLine[] {
  return [
    { entryType: 'DISPUTE_HOLD', amountPaise: input.amountPaise, accountUserId: null, note: input.jobRef },
    { entryType: 'PROVIDER_PAYABLE', amountPaise: -input.amountPaise, accountUserId: input.providerId, note: `Released after dispute ${input.jobRef}` },
  ];
}

/** Paying someone out: the obligation goes away and the money leaves. */
export function buildSettlementLines(input: { amountPaise: Paise; payeeId: string; type: 'PROVIDER_PAYABLE' | 'VENDOR_PAYABLE' }): LedgerLine[] {
  return [
    { entryType: input.type, amountPaise: input.amountPaise, accountUserId: input.payeeId, note: 'Settled' },
    { entryType: 'MANUAL_ADJUSTMENT', amountPaise: -input.amountPaise, accountUserId: null, note: 'Payout sent' },
  ];
}

/**
 * What someone is owed right now: the sum of their signed lines, flipped so a payable reads as a
 * positive balance to the person it belongs to.
 */
export function balanceFor(lines: Array<{ accountUserId: string | null; amountPaise: Paise }>, userId: string): Paise {
  return -lines.filter((l) => l.accountUserId === userId).reduce((sum, l) => sum + l.amountPaise, 0);
}
