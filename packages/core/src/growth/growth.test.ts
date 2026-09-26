import { describe, expect, it } from 'vitest';
import {
  REFERRAL_REWARD_PAISE,
  checkPromo,
  checkReferral,
  explainPromoBlocker,
  rewardCodeFor,
  financialYearOf,
  invoiceNumber,
  promoDiscountPaise,
  receiptTotals,
  referralCodeFor,
  referralQualifies,
  type PromoTerms,
} from './growth';

const now = new Date('2026-09-24T10:00:00Z');

const flat: PromoTerms = {
  kind: 'FLAT',
  value: 10_000,
  maxDiscountPaise: null,
  minOrderPaise: 50_000,
  startsAt: new Date('2026-09-01T00:00:00Z'),
  endsAt: new Date('2026-10-01T00:00:00Z'),
  maxRedemptions: 100,
  maxPerCustomer: 1,
  firstJobOnly: false,
  redemptionCount: 10,
  active: true,
};

const context = { orderPaise: 80_000, customerRedemptions: 0, customerCompletedJobs: 3, now };

describe('promo codes', () => {
  it('accepts a live code on an order big enough for it', () => {
    expect(checkPromo(flat, context)).toBeNull();
  });

  it('refuses every way a code can be wrong', () => {
    expect(checkPromo(null, context)).toBe('NOT_FOUND');
    expect(checkPromo({ ...flat, active: false }, context)).toBe('INACTIVE');
    expect(checkPromo({ ...flat, startsAt: new Date('2026-12-01') }, context)).toBe('NOT_STARTED');
    expect(checkPromo({ ...flat, endsAt: new Date('2026-09-01') }, context)).toBe('EXPIRED');
    expect(checkPromo({ ...flat, redemptionCount: 100 }, context)).toBe('FULLY_REDEEMED');
    expect(checkPromo(flat, { ...context, customerRedemptions: 1 })).toBe('ALREADY_USED');
    expect(checkPromo(flat, { ...context, orderPaise: 10_000 })).toBe('ORDER_TOO_SMALL');
    expect(checkPromo({ ...flat, firstJobOnly: true }, context)).toBe('FIRST_JOB_ONLY');
    // and a genuinely new customer gets through the first-job gate
    expect(checkPromo({ ...flat, firstJobOnly: true }, { ...context, customerCompletedJobs: 0 })).toBeNull();
  });

  it('takes a flat amount off', () => {
    expect(promoDiscountPaise(flat, 80_000)).toBe(10_000);
  });

  it('caps a percentage, because an uncapped one is an unbounded liability', () => {
    const percent: PromoTerms = { ...flat, kind: 'PERCENT', value: 2000, maxDiscountPaise: 15_000 };
    expect(promoDiscountPaise(percent, 50_000)).toBe(10_000); // 20% of 500
    expect(promoDiscountPaise(percent, 500_000)).toBe(15_000); // would be 1000, capped at 150
  });

  it('will not let somebody spend a reward issued to another person', () => {
    // Reported as NOT_YOURS rather than NOT_FOUND, so the person it belongs to is never told
    // their own code does not exist.
    const reserved: PromoTerms = { ...flat, reservedForUserId: 'user-a' };
    expect(checkPromo(reserved, { ...context, customerId: 'user-b' })).toBe('NOT_YOURS');
    expect(checkPromo(reserved, { ...context, customerId: 'user-a' })).toBeNull();
    expect(explainPromoBlocker('NOT_YOURS')).toContain('somebody else');
  });

  it('never discounts more than the bill', () => {
    // Paying somebody to book is not a discount, and a negative total is not a thing the
    // ledger can hold.
    expect(promoDiscountPaise({ ...flat, value: 200_000 }, 50_000)).toBe(50_000);
  });
});

describe('referrals', () => {
  it('gives everyone a code that can be read aloud', () => {
    const code = referralCodeFor('8b6f1d2e-0000-4000-8000-000000000001');
    expect(code).toHaveLength(6);
    // No 0/O or 1/I, so nobody has to spell it out over the phone
    expect(code).not.toMatch(/[01OI]/);
    // and the same person always gets the same code
    expect(referralCodeFor('8b6f1d2e-0000-4000-8000-000000000001')).toBe(code);
    expect(referralCodeFor('8b6f1d2e-0000-4000-8000-000000000002')).not.toBe(code);
  });

  it('refuses the ways a referral gets farmed', () => {
    const base = { referrerId: 'a', referredId: 'b', alreadyReferred: false, referredCompletedJobs: 0 };
    expect(checkReferral(base)).toBeNull();
    expect(checkReferral({ ...base, referrerId: 'b' })).toBe('SELF_REFERRAL');
    expect(checkReferral({ ...base, alreadyReferred: true })).toBe('ALREADY_REFERRED');
    expect(checkReferral({ ...base, referrerId: null })).toBe('CODE_NOT_FOUND');
    // Somebody who already books here was coming anyway
    expect(checkReferral({ ...base, referredCompletedJobs: 2 })).toBe('NOT_A_NEW_USER');
  });

  it('pays the reward as a code that reads as theirs', () => {
    // A code, not a wallet balance: the promo path already expresses "the platform paid for
    // this, and the professional is paid in full" and a second money primitive would not.
    expect(rewardCodeFor('AB2345', 'REFERRER')).toBe('THANKSAB2345');
    expect(rewardCodeFor('AB2345', 'FRIEND')).toBe('WELCOMEAB2345');
  });

  it('pays out on completed work, never on a signup', () => {
    expect(referralQualifies({ referredCompletedJobs: 0, jobWasDisputed: false })).toBe(false);
    expect(referralQualifies({ referredCompletedJobs: 1, jobWasDisputed: false })).toBe(true);
    // A job that ended in a dispute is not evidence the referral was a good one
    expect(referralQualifies({ referredCompletedJobs: 1, jobWasDisputed: true })).toBe(false);
    expect(REFERRAL_REWARD_PAISE).toBeGreaterThan(0);
  });
});

describe('receipts', () => {
  it('numbers by the financial year an accountant works in', () => {
    // April to March
    expect(financialYearOf(new Date('2026-04-01T00:00:00Z'))).toBe('2627');
    expect(financialYearOf(new Date('2026-09-24T00:00:00Z'))).toBe('2627');
    expect(financialYearOf(new Date('2027-03-31T00:00:00Z'))).toBe('2627');
    expect(financialYearOf(new Date('2027-04-01T00:00:00Z'))).toBe('2728');
  });

  it('gives a number somebody can quote on the phone', () => {
    expect(invoiceNumber(42, new Date('2026-09-24T00:00:00Z'))).toBe('HL-2627-000042');
  });

  it('shows what left the account, not what was billed before a refund', () => {
    const lines = {
      labourPaise: 60_000,
      visitFeePaise: 10_000,
      materialPaise: 0,
      deliveryPaise: 0,
      platformFeePaise: 7_000,
      protectionFeePaise: 0,
      discountPaise: 10_000,
      taxPaise: 1_260,
      refundedPaise: 5_000,
    };
    const { chargedPaise, netPaise } = receiptTotals(lines);
    expect(chargedPaise).toBe(68_260);
    // "Total" on a receipt has to mean the number that left their account
    expect(netPaise).toBe(63_260);
  });
});
