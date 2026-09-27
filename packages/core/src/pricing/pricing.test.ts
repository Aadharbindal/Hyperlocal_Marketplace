import { describe, expect, it } from 'vitest';
import {
  computeQuote,
  customerCancellationCharge,
  formatInr,
  refundAmount,
  bps,
  formatInrRange,
} from './pricing';

describe('pricing', () => {
  it('computes an integer breakdown with platform fee and tax on fees only', () => {
    const q = computeQuote({ labourPaise: 80_000, visitFeePaise: 20_000, materialEstimatePaise: 50_000 });
    expect(q.platformFeePaise).toBe(5_000); // 5% of 1,00,000
    expect(q.taxPaise).toBe(900); // 18% of 5,000
    expect(q.protectionFeePaise).toBe(0);
    expect(q.totalPaise).toBe(80_000 + 20_000 + 50_000 + 5_000 + 900);
    expect(q.providerPayablePaise).toBe(100_000);
    expect(q.platformRevenuePaise).toBe(5_000);
    for (const v of Object.values(q)) expect(Number.isInteger(v)).toBe(true);
  });

  it('applies the minimum platform fee', () => {
    const q = computeQuote({ labourPaise: 10_000, visitFeePaise: 0 });
    expect(q.platformFeePaise).toBe(2_000);
  });

  it('includes approved revisions in provider payable and fees', () => {
    const q = computeQuote({ labourPaise: 100_000, visitFeePaise: 0, approvedRevisionsPaise: 20_000 });
    expect(q.providerPayablePaise).toBe(120_000);
    expect(q.platformFeePaise).toBe(6_000);
  });

  it('rejects non-integer or negative money', () => {
    expect(() => computeQuote({ labourPaise: 10.5, visitFeePaise: 0 })).toThrow(RangeError);
    expect(() => computeQuote({ labourPaise: -1, visitFeePaise: 0 })).toThrow(RangeError);
  });

  it('rounds basis points half-up', () => {
    expect(bps(101, 500)).toBe(5); // 5.05 -> 5
    expect(bps(110, 500)).toBe(6); // 5.5 -> 6
  });

  it('cancellation charges follow the stage policy', () => {
    const quote = { visitFeePaise: 15_000, totalPaise: 120_000 };
    expect(customerCancellationCharge('BEFORE_CONFIRMATION', quote)).toBe(0);
    expect(customerCancellationCharge('AFTER_CONFIRMATION', quote)).toBe(0);
    expect(customerCancellationCharge('AFTER_EN_ROUTE', quote)).toBe(15_000);
    expect(customerCancellationCharge('AFTER_ARRIVED', quote)).toBe(15_000);
    expect(customerCancellationCharge('AFTER_STARTED', quote)).toBe(120_000);
    expect(refundAmount(120_000, 15_000)).toBe(105_000);
    expect(refundAmount(10_000, 15_000)).toBe(0);
  });

  it('formats INR', () => {
    expect(formatInr(123_456)).toBe('₹1,234.56');
    expect(formatInr(100_000)).toBe('₹1,000');
    expect(formatInr(-500)).toBe('-₹5');
  });
});

describe('price guidance, as somebody would say it', () => {
  it('reads as a range rather than two prices', () => {
    expect(formatInrRange(25_000, 60_000)).toBe('₹250-600');
    expect(formatInrRange(90_000, 400_000)).toBe('₹900-4,000');
  });

  it('collapses to one number when there is no range', () => {
    expect(formatInrRange(50_000, 50_000)).toBe('₹500');
  });

  it('rounds to whole rupees, because paise on an estimate are a lie about precision', () => {
    // A range accurate to the paise would be a quote, and a quote comes from the professional
    // after they have seen the work.
    expect(formatInrRange(25_049, 60_051)).toBe('₹250-601');
  });
});
