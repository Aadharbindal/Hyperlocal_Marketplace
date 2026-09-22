// All money is integer paise (INR x 100). See DECISIONS.md D-006.

export type Paise = number;

export interface FeePolicy {
  /** Platform fee as basis points of (labour + visit fee). 0 = disabled. */
  platformFeeBps: number;
  /** Optional customer protection fee in basis points of (labour + visit fee). */
  protectionFeeBps: number;
  /** GST or equivalent applied on platform fee + protection fee only, in bps. */
  taxOnFeesBps: number;
  /** Minimum platform fee in paise when platformFeeBps > 0. */
  minPlatformFeePaise: Paise;
}

export const DEFAULT_FEE_POLICY: FeePolicy = {
  platformFeeBps: 500, // 5%
  protectionFeeBps: 0, // disabled until legal review
  taxOnFeesBps: 1800, // 18% GST on platform fees (verify with tax advisor)
  minPlatformFeePaise: 2000, // Rs 20
};

export interface QuoteInput {
  labourPaise: Paise;
  visitFeePaise: Paise;
  materialEstimatePaise?: Paise;
  deliveryPaise?: Paise;
  /** Approved price revisions (labour + material extras), already approved digitally. */
  approvedRevisionsPaise?: Paise;
}

export interface QuoteBreakdown {
  labourPaise: Paise;
  visitFeePaise: Paise;
  materialEstimatePaise: Paise;
  deliveryPaise: Paise;
  approvedRevisionsPaise: Paise;
  platformFeePaise: Paise;
  protectionFeePaise: Paise;
  taxPaise: Paise;
  /** What the customer pays. */
  totalPaise: Paise;
  /** What the provider is owed before settlement adjustments. */
  providerPayablePaise: Paise;
  /** Platform revenue before gateway fees. */
  platformRevenuePaise: Paise;
}

/** Round-half-up basis-point multiplication on integers. */
export function bps(amount: Paise, basisPoints: number): Paise {
  assertPaise(amount);
  return Math.round((amount * basisPoints) / 10_000);
}

export function assertPaise(v: number, label = 'amount'): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of paise, got ${v}`);
  }
}

export function computeQuote(input: QuoteInput, policy: FeePolicy = DEFAULT_FEE_POLICY): QuoteBreakdown {
  const labourPaise = input.labourPaise;
  const visitFeePaise = input.visitFeePaise;
  const materialEstimatePaise = input.materialEstimatePaise ?? 0;
  const deliveryPaise = input.deliveryPaise ?? 0;
  const approvedRevisionsPaise = input.approvedRevisionsPaise ?? 0;
  for (const [k, v] of Object.entries({
    labourPaise,
    visitFeePaise,
    materialEstimatePaise,
    deliveryPaise,
    approvedRevisionsPaise,
  })) {
    assertPaise(v, k);
  }

  const serviceBase = labourPaise + visitFeePaise + approvedRevisionsPaise;
  let platformFeePaise = policy.platformFeeBps > 0 ? bps(serviceBase, policy.platformFeeBps) : 0;
  if (policy.platformFeeBps > 0 && serviceBase > 0) {
    platformFeePaise = Math.max(platformFeePaise, policy.minPlatformFeePaise);
  }
  const protectionFeePaise = policy.protectionFeeBps > 0 ? bps(serviceBase, policy.protectionFeeBps) : 0;
  const taxPaise = bps(platformFeePaise + protectionFeePaise, policy.taxOnFeesBps);

  const totalPaise =
    serviceBase + materialEstimatePaise + deliveryPaise + platformFeePaise + protectionFeePaise + taxPaise;

  return {
    labourPaise,
    visitFeePaise,
    materialEstimatePaise,
    deliveryPaise,
    approvedRevisionsPaise,
    platformFeePaise,
    protectionFeePaise,
    taxPaise,
    totalPaise,
    providerPayablePaise: serviceBase,
    platformRevenuePaise: platformFeePaise + protectionFeePaise,
  };
}

/** Cancellation policy (PAYMENT_FLOW.md section 6). Returns what the customer is charged. */
export type CancellationStage =
  | 'BEFORE_CONFIRMATION'
  | 'AFTER_CONFIRMATION'
  | 'AFTER_EN_ROUTE'
  | 'AFTER_ARRIVED'
  | 'AFTER_STARTED';

export function customerCancellationCharge(
  stage: CancellationStage,
  quote: Pick<QuoteBreakdown, 'visitFeePaise' | 'totalPaise'>,
): Paise {
  switch (stage) {
    case 'BEFORE_CONFIRMATION':
    case 'AFTER_CONFIRMATION':
      return 0;
    case 'AFTER_EN_ROUTE':
    case 'AFTER_ARRIVED':
      return quote.visitFeePaise;
    case 'AFTER_STARTED':
      // Cancellation after start is support-mediated; default to full amount held.
      return quote.totalPaise;
  }
}

export function refundAmount(capturedPaise: Paise, chargePaise: Paise): Paise {
  assertPaise(capturedPaise, 'captured');
  assertPaise(chargePaise, 'charge');
  return Math.max(0, capturedPaise - chargePaise);
}

export function formatInr(paise: Paise): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const rupeeStr = rupees.toLocaleString('en-IN');
  return p === 0 ? `${sign}₹${rupeeStr}` : `${sign}₹${rupeeStr}.${String(p).padStart(2, '0')}`;
}
