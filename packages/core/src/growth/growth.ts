/**
 * Discounts, referrals and receipts.
 *
 * One rule runs through all of this and is worth stating before the code: **a discount is the
 * platform's cost, never the provider's.** A professional is paid exactly what the accepted
 * quote said, whatever the customer ended up paying. Anything else quietly takes money from the
 * person who did the work to fund our marketing, which is both unfair and, once they notice,
 * the end of their trust in the platform.
 */

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

export const PROMO_KINDS = ['FLAT', 'PERCENT'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export type PromoBlocker =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'FULLY_REDEEMED'
  | 'ALREADY_USED'
  | 'FIRST_JOB_ONLY'
  | 'ORDER_TOO_SMALL';

export interface PromoTerms {
  kind: PromoKind;
  /** Paise for FLAT, basis points for PERCENT (1000 = 10%). */
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  startsAt: Date;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number;
  firstJobOnly: boolean;
  redemptionCount: number;
  active: boolean;
}

export function checkPromo(
  promo: PromoTerms | null,
  context: { orderPaise: number; customerRedemptions: number; customerCompletedJobs: number; now: Date },
): PromoBlocker | null {
  if (!promo) return 'NOT_FOUND';
  if (!promo.active) return 'INACTIVE';
  if (promo.startsAt > context.now) return 'NOT_STARTED';
  if (promo.endsAt && promo.endsAt <= context.now) return 'EXPIRED';
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) return 'FULLY_REDEEMED';
  if (context.customerRedemptions >= promo.maxPerCustomer) return 'ALREADY_USED';
  if (promo.firstJobOnly && context.customerCompletedJobs > 0) return 'FIRST_JOB_ONLY';
  if (context.orderPaise < promo.minOrderPaise) return 'ORDER_TOO_SMALL';
  return null;
}

/**
 * What the code takes off. Never more than the order itself: a discount that exceeds the bill
 * would mean paying somebody to book, and a negative total is not a thing the ledger can hold.
 */
export function promoDiscountPaise(promo: PromoTerms, orderPaise: number): number {
  const raw = promo.kind === 'FLAT' ? promo.value : Math.floor((orderPaise * promo.value) / 10_000);
  const capped = promo.maxDiscountPaise === null ? raw : Math.min(raw, promo.maxDiscountPaise);
  return Math.max(0, Math.min(capped, orderPaise));
}

/** What the customer is told, in their terms rather than ours. */
export function explainPromoBlocker(blocker: PromoBlocker, minOrderPaise = 0): string {
  switch (blocker) {
    case 'NOT_FOUND':
      return 'We do not recognise that code. Check it and try again.';
    case 'INACTIVE':
    case 'EXPIRED':
      return 'That code has expired.';
    case 'NOT_STARTED':
      return 'That code is not live yet.';
    case 'FULLY_REDEEMED':
      return 'That code has been fully claimed.';
    case 'ALREADY_USED':
      return 'You have already used that code.';
    case 'FIRST_JOB_ONLY':
      return 'That code is for a first booking only.';
    case 'ORDER_TOO_SMALL':
      return `That code applies to bookings over ${formatInrShort(minOrderPaise)}.`;
  }
}

function formatInrShort(paise: number): string {
  return `Rs ${Math.round(paise / 100)}`;
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/**
 * A referral code somebody can say out loud over a chai. Derived from the user id, so there is
 * nothing to allocate and nothing to run out of.
 *
 * The confusable characters are left out on purpose: somebody reading a code to a neighbour
 * should not have to explain whether it was a one or an I.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function referralCodeFor(seed: string): string {
  // A small, stable hash over the id. Not a secret - a referral code is meant to be shared -
  // just a short, pronounceable handle that does not collide in practice.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[h % CODE_ALPHABET.length];
    h = Math.floor(h / CODE_ALPHABET.length) + Math.imul(h, 31);
    h = h >>> 0;
  }
  return out;
}

export const REFERRAL_STATUSES = ['PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export type ReferralBlocker = 'SELF_REFERRAL' | 'ALREADY_REFERRED' | 'NOT_A_NEW_USER' | 'CODE_NOT_FOUND';

/**
 * A referral is only accepted from somebody who has not booked yet. Letting an established
 * customer be "referred" is how a referral programme turns into a discount programme for people
 * who were coming anyway.
 */
export function checkReferral(input: {
  referrerId: string | null;
  referredId: string;
  alreadyReferred: boolean;
  referredCompletedJobs: number;
}): ReferralBlocker | null {
  if (!input.referrerId) return 'CODE_NOT_FOUND';
  if (input.referrerId === input.referredId) return 'SELF_REFERRAL';
  if (input.alreadyReferred) return 'ALREADY_REFERRED';
  if (input.referredCompletedJobs > 0) return 'NOT_A_NEW_USER';
  return null;
}

/**
 * A referral pays out on a **completed** job, not on a signup. Rewarding signups rewards
 * signups - which is how these programmes get farmed rather than used.
 */
export const REFERRAL_REWARD_PAISE = 10_000; // Rs 100 to each side

export function referralQualifies(input: { referredCompletedJobs: number; jobWasDisputed: boolean }): boolean {
  return input.referredCompletedJobs >= 1 && !input.jobWasDisputed;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * A receipt number people can quote on the phone: the Indian financial year it belongs to, then
 * a sequence. April to March, because that is the year a customer's accountant works in.
 */
export function financialYearOf(date: Date): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

export function invoiceNumber(sequence: number, issuedAt: Date): string {
  return `HL-${financialYearOf(issuedAt)}-${String(sequence).padStart(6, '0')}`;
}

export interface ReceiptLines {
  labourPaise: number;
  visitFeePaise: number;
  materialPaise: number;
  deliveryPaise: number;
  platformFeePaise: number;
  protectionFeePaise: number;
  discountPaise: number;
  taxPaise: number;
  refundedPaise: number;
}

/**
 * What the customer actually parted with. Stated as its own function because "total" on a
 * receipt has to mean the number that left their account, not the number we billed before
 * anything came back.
 */
export function receiptTotals(lines: ReceiptLines): { chargedPaise: number; netPaise: number } {
  const charged =
    lines.labourPaise +
    lines.visitFeePaise +
    lines.materialPaise +
    lines.deliveryPaise +
    lines.platformFeePaise +
    lines.protectionFeePaise +
    lines.taxPaise -
    lines.discountPaise;
  return { chargedPaise: charged, netPaise: charged - lines.refundedPaise };
}
