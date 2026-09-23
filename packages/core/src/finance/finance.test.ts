import { describe, expect, it } from 'vitest';
import {
  buildCaptureLines,
  buildDisputeHoldLines,
  buildMaterialCaptureLines,
  buildRefundLines,
  buildSettlementLines,
  isBalanced,
  splitRefund,
} from './ledger';
import {
  cancellationNeedsSupport,
  cancellationStage,
  checkCanCapture,
  checkCanRaiseDispute,
  checkCanReview,
  checkCanSettle,
  checkCanSettleVendor,
  checkPayoutAccount,
  maskVpa,
  nextRating,
  refundNeedsTwoPeople,
  shouldSuspend,
} from './settlement';

const CAPTURE = {
  totalPaise: 95_310,
  providerPayablePaise: 70_000,
  platformFeePaise: 21_450,
  taxPaise: 3_860,
  customerId: 'c1',
  providerId: 'p1',
};

describe('ledger batches', () => {
  it('balances a capture to the paisa', () => {
    const lines = buildCaptureLines(CAPTURE);
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.entryType === 'CUSTOMER_CHARGE')!.amountPaise).toBe(95_310);
    expect(lines.find((l) => l.entryType === 'PROVIDER_PAYABLE')!.amountPaise).toBe(-70_000);
  });

  it('gives the vendor the whole material amount', () => {
    const lines = buildMaterialCaptureLines({ totalPaise: 43_000, customerId: 'c1', vendorId: 'v1' });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.entryType === 'VENDOR_PAYABLE')!.amountPaise).toBe(-43_000);
  });

  it('balances a refund, a dispute hold and a payout', () => {
    const split = splitRefund(40_000, CAPTURE);
    expect(isBalanced(buildRefundLines({ amountPaise: 40_000, ...split, customerId: 'c1', providerId: 'p1', reason: 'partial' }))).toBe(true);
    expect(isBalanced(buildDisputeHoldLines({ amountPaise: 70_000, providerId: 'p1', jobRef: 'j1' }))).toBe(true);
    expect(isBalanced(buildSettlementLines({ amountPaise: 70_000, payeeId: 'p1', type: 'PROVIDER_PAYABLE' }))).toBe(true);
  });

  it('splits a refund across the same lines the capture used', () => {
    const split = splitRefund(40_000, CAPTURE);
    // the pieces always add back up to the refund, whatever the rounding
    expect(split.fromProviderPaise + split.fromPlatformPaise + split.fromTaxPaise).toBe(40_000);
    expect(split.fromPlatformPaise).toBeGreaterThan(0);

    const full = splitRefund(95_310, CAPTURE);
    expect(full.fromProviderPaise).toBe(70_000);
    expect(full.fromPlatformPaise).toBe(21_450);
    expect(full.fromTaxPaise).toBe(3_860);
  });

  it('never leaves an odd paisa unaccounted for', () => {
    for (const amount of [1, 7, 333, 12_345, 95_309]) {
      const s = splitRefund(amount, CAPTURE);
      expect(s.fromProviderPaise + s.fromPlatformPaise + s.fromTaxPaise).toBe(amount);
    }
  });
});

describe('capture rules', () => {
  const authorized = { status: 'AUTHORIZED' };

  it('only takes money once the customer has approved', () => {
    expect(checkCanCapture({ status: 'COMPLETED' }, authorized, { openDisputes: 0 })).toBeNull();
    expect(checkCanCapture({ status: 'CUSTOMER_APPROVAL_PENDING' }, authorized, { openDisputes: 0 })).toBe('JOB_NOT_COMPLETED');
    expect(checkCanCapture({ status: 'IN_PROGRESS' }, authorized, { openDisputes: 0 })).toBe('JOB_NOT_COMPLETED');
  });

  it('will not take money while a dispute is open, or twice', () => {
    expect(checkCanCapture({ status: 'COMPLETED' }, authorized, { openDisputes: 1 })).toBe('DISPUTE_OPEN');
    expect(checkCanCapture({ status: 'COMPLETED' }, { status: 'CAPTURED' }, { openDisputes: 0 })).toBe('ALREADY_CAPTURED');
    expect(checkCanCapture({ status: 'COMPLETED' }, null, { openDisputes: 0 })).toBe('NOTHING_AUTHORIZED');
  });
});

describe('settlement rules', () => {
  const base = {
    jobStatus: 'COMPLETED' as const,
    paymentStatus: 'CAPTURED',
    capturedAt: new Date(Date.now() - 25 * 3600_000),
    amountPaise: 70_000,
    openDisputes: 0,
    existingSettlement: false,
    payeeSuspended: false,
  };

  it('pays out a completed, captured job after the hold window', () => {
    expect(checkCanSettle(base)).toBeNull();
  });

  it('holds the payout while anything is unresolved', () => {
    expect(checkCanSettle({ ...base, capturedAt: new Date() })).toBe('HOLD_PERIOD');
    expect(checkCanSettle({ ...base, openDisputes: 1 })).toBe('DISPUTE_OPEN');
    expect(checkCanSettle({ ...base, paymentStatus: 'AUTHORIZED' })).toBe('NOT_CAPTURED');
    expect(checkCanSettle({ ...base, jobStatus: 'IN_PROGRESS' })).toBe('JOB_NOT_COMPLETE');
    expect(checkCanSettle({ ...base, existingSettlement: true })).toBe('ALREADY_SETTLED');
    // a suspended account keeps the money; it just waits for the review
    expect(checkCanSettle({ ...base, payeeSuspended: true })).toBe('PAYEE_SUSPENDED');
    // and money cannot be sent to a payee who has not said where it should go
    expect(checkCanSettle({ ...base, hasPayoutAccount: false })).toBe('NO_PAYOUT_ACCOUNT');
  });

  it('pays a vendor only for confirmed goods with an invoice', () => {
    const ok = { orderStatus: 'CONFIRMED', hasInvoice: true, paymentStatus: 'CAPTURED', existingSettlement: false, openDisputes: 0 };
    expect(checkCanSettleVendor(ok)).toBeNull();
    expect(checkCanSettleVendor({ ...ok, hasInvoice: false })).toBe('NO_INVOICE');
    expect(checkCanSettleVendor({ ...ok, orderStatus: 'DELIVERED' })).toBe('ORDER_NOT_CONFIRMED');
    expect(checkCanSettleVendor({ ...ok, orderStatus: 'ON_HOLD' })).toBe('ORDER_NOT_CONFIRMED');
    expect(checkCanSettleVendor({ ...ok, openDisputes: 1 })).toBe('DISPUTE_OPEN');
  });
});

describe('payout account details', () => {
  const bank = { method: 'BANK_ACCOUNT' as const, accountHolderName: 'Ramesh Kumar', accountNumber: '918273645500', ifsc: 'HDFC0001234' };

  it('accepts details the payout rail would accept', () => {
    expect(checkPayoutAccount(bank)).toBeNull();
    expect(checkPayoutAccount({ method: 'UPI', accountHolderName: 'Ramesh Kumar', vpa: 'ramesh.k@okhdfc' })).toBeNull();
  });

  it('catches the mistakes people actually make, before the gateway does', () => {
    // an IFSC is four letters, a zero, then six more - the zero is the part people get wrong
    expect(checkPayoutAccount({ ...bank, ifsc: 'HDFCX001234' })).toBe('BAD_IFSC');
    expect(checkPayoutAccount({ ...bank, ifsc: 'hdfc0001234' })).toBeNull(); // case is not a mistake
    expect(checkPayoutAccount({ ...bank, accountNumber: '12345' })).toBe('BAD_ACCOUNT_NUMBER');
    expect(checkPayoutAccount({ ...bank, accountNumber: '9182 7364 5500' })).toBe('BAD_ACCOUNT_NUMBER');
    expect(checkPayoutAccount({ ...bank, accountHolderName: 'R' })).toBe('NAME_TOO_SHORT');
    expect(checkPayoutAccount({ method: 'UPI', accountHolderName: 'Ramesh Kumar', vpa: '9876543210' })).toBe('BAD_UPI_ID');
  });

  it('shows a UPI id without giving it away', () => {
    expect(maskVpa('ramesh.k@okhdfc')).toBe('ra******@okhdfc');
  });
});

describe('cancellation stages', () => {
  it('maps a job to what the customer owes', () => {
    expect(cancellationStage('OPEN_FOR_BIDS')).toBe('BEFORE_CONFIRMATION');
    expect(cancellationStage('PROVIDER_ASSIGNED')).toBe('AFTER_CONFIRMATION');
    expect(cancellationStage('EN_ROUTE')).toBe('AFTER_EN_ROUTE');
    expect(cancellationStage('ARRIVED')).toBe('AFTER_ARRIVED');
    expect(cancellationStage('IN_PROGRESS')).toBe('AFTER_STARTED');
  });

  it('sends a started job to support rather than a button', () => {
    expect(cancellationNeedsSupport('IN_PROGRESS')).toBe(true);
    expect(cancellationNeedsSupport('EN_ROUTE')).toBe(false);
  });
});

describe('disputes', () => {
  const job = { status: 'COMPLETED' as const, completedAt: new Date() };
  const ok = { description: 'The tap started leaking again within an hour', onJob: true, openDisputes: 0 };

  it('accepts one from someone on the job with a real description', () => {
    expect(checkCanRaiseDispute(job, ok)).toBeNull();
    expect(checkCanRaiseDispute(job, { ...ok, onJob: false })).toBe('NOT_ON_JOB');
    expect(checkCanRaiseDispute(job, { ...ok, description: 'bad job' })).toBe('REASON_TOO_SHORT');
    expect(checkCanRaiseDispute(job, { ...ok, openDisputes: 1 })).toBe('ALREADY_OPEN');
  });

  it('is not available before anyone has set off, or long after it ended', () => {
    expect(checkCanRaiseDispute({ status: 'OPEN_FOR_BIDS', completedAt: null }, ok)).toBe('JOB_TOO_EARLY');
    const old = { status: 'COMPLETED' as const, completedAt: new Date(Date.now() - 8 * 86_400_000) };
    expect(checkCanRaiseDispute(old, ok)).toBe('WINDOW_CLOSED');
  });

  it('needs two people above the refund threshold', () => {
    expect(refundNeedsTwoPeople(4_99_999)).toBe(false);
    expect(refundNeedsTwoPeople(5_00_001)).toBe(true);
  });
});

describe('strikes and reviews', () => {
  it('suspends on three major strikes in the window, or one critical', () => {
    const recent = (severity: string, daysAgo = 1) => ({ severity, createdAt: new Date(Date.now() - daysAgo * 86_400_000) });
    expect(shouldSuspend([recent('MAJOR'), recent('MAJOR')])).toBe(false);
    expect(shouldSuspend([recent('MAJOR'), recent('MAJOR'), recent('MAJOR')])).toBe(true);
    expect(shouldSuspend([recent('CRITICAL')])).toBe(true);
    // strikes age out of the window
    expect(shouldSuspend([recent('MAJOR', 100), recent('MAJOR', 120), recent('MAJOR')])).toBe(false);
  });

  it('only lets someone on a finished job review it, once', () => {
    const job = { status: 'COMPLETED' as const, completedAt: new Date() };
    expect(checkCanReview(job, { onJob: true, alreadyReviewed: false })).toBeNull();
    expect(checkCanReview(job, { onJob: true, alreadyReviewed: true })).toBe('ALREADY_REVIEWED');
    expect(checkCanReview(job, { onJob: false, alreadyReviewed: false })).toBe('NOT_ON_JOB');
    expect(checkCanReview({ status: 'IN_PROGRESS', completedAt: null }, { onJob: true, alreadyReviewed: false })).toBe('JOB_NOT_COMPLETE');
  });

  it('keeps the running rating honest', () => {
    expect(nextRating({ ratingAvg: null, ratingCount: 0 }, 5)).toEqual({ ratingAvg: 5, ratingCount: 1 });
    expect(nextRating({ ratingAvg: 4, ratingCount: 3 }, 5)).toEqual({ ratingAvg: 4.25, ratingCount: 4 });
  });
});
