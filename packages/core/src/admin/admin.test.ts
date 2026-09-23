import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  currentStep,
  fromBase32,
  mfaStillValid,
  otpauthUri,
  stepToCounter,
  toBase32,
  totpAt,
  verifyTotp,
} from './mfa';
import { appealReviewerIsDifferent, checkAppeal, checkKycReview, checkSuspension, countSlaBreaches, kycStatusAfter } from './review';

const hmac = (key: Uint8Array, message: Uint8Array) =>
  Uint8Array.from(createHmac('sha1', Buffer.from(key)).update(Buffer.from(message)).digest());

/** The RFC 6238 test vector secret, "12345678901234567890" in base32. */
const RFC_SECRET = toBase32(new TextEncoder().encode('12345678901234567890'));

describe('TOTP', () => {
  it('round-trips base32', () => {
    const bytes = new TextEncoder().encode('hello world');
    expect(fromBase32(toBase32(bytes))).toEqual(bytes);
    expect(toBase32(new Uint8Array([0]))).toBe('AA');
  });

  it('matches the RFC 6238 test vectors', () => {
    // 59s, 1111111109s and 1234567890s from the RFC's SHA-1 table, truncated to 6 digits
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30), hmac)).toBe('287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30), hmac)).toBe('081804');
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30), hmac)).toBe('005924');
  });

  it('counts steps in 30 second blocks', () => {
    expect(currentStep(new Date(0))).toBe(0);
    expect(currentStep(new Date(30_000))).toBe(1);
    expect(stepToCounter(1)).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]));
  });

  it('accepts one step of drift either way, and nothing further', () => {
    const now = new Date();
    const step = currentStep(now);
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + offset, hmac), hmac, { now }).ok).toBe(true);
    }
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 2, hmac), hmac, { now })).toEqual({ ok: false, reason: 'WRONG_CODE' });
  });

  it('refuses a code that has already been used', () => {
    const now = new Date();
    const step = currentStep(now);
    const code = totpAt(RFC_SECRET, step, hmac);
    expect(verifyTotp(RFC_SECRET, code, hmac, { now, lastUsedStep: step })).toEqual({ ok: false, reason: 'CODE_REUSED' });
    // and an older code, seen over a shoulder, is no good either
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1, hmac), hmac, { now, lastUsedStep: step })).toEqual({
      ok: false,
      reason: 'CODE_REUSED',
    });
  });

  it('builds a URI an authenticator understands', () => {
    const uri = otpauthUri({ secretBase32: RFC_SECRET, account: '+91*******07', issuer: 'LocalHub' });
    expect(uri.startsWith('otpauth://totp/LocalHub')).toBe(true);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('expires an MFA check after the session window', () => {
    expect(mfaStillValid(new Date())).toBe(true);
    expect(mfaStillValid(new Date(Date.now() - 7 * 3600_000))).toBe(true);
    expect(mfaStillValid(new Date(Date.now() - 9 * 3600_000))).toBe(false);
    expect(mfaStillValid(null)).toBe(false);
  });
});

describe('KYC review', () => {
  const record = { status: 'SUBMITTED' as const, userId: 'u1' };

  it('accepts a decision from someone else', () => {
    expect(checkKycReview(record, { decision: 'APPROVE', reviewerId: 'admin' })).toBeNull();
  });

  it('never lets anyone verify themselves', () => {
    expect(checkKycReview(record, { decision: 'APPROVE', reviewerId: 'u1' })).toBe('CANNOT_REVIEW_OWN');
  });

  it('wants a usable reason for anything but an approval, and decides once', () => {
    expect(checkKycReview(record, { decision: 'REJECT', reason: 'no', reviewerId: 'admin' })).toBe('REASON_REQUIRED');
    expect(checkKycReview(record, { decision: 'REJECT', reason: 'The photo is cut off at the edge', reviewerId: 'admin' })).toBeNull();
    expect(checkKycReview({ ...record, status: 'VERIFIED' }, { decision: 'REJECT', reason: 'changed my mind now', reviewerId: 'admin' })).toBe(
      'ALREADY_DECIDED',
    );
  });

  it('maps a decision to the status it produces', () => {
    expect(kycStatusAfter('APPROVE')).toBe('VERIFIED');
    expect(kycStatusAfter('REJECT')).toBe('REJECTED');
    expect(kycStatusAfter('NEEDS_MORE')).toBe('UNDER_REVIEW');
  });
});

describe('suspension', () => {
  const base = { targetUserId: 'u1', actorId: 'admin', reason: 'Repeatedly demanded cash off-platform', secondApproverId: 'support' };

  it('takes two different people and a real reason', () => {
    expect(checkSuspension(base)).toBeNull();
    expect(checkSuspension({ ...base, secondApproverId: null })).toBe('SECOND_APPROVER_REQUIRED');
    expect(checkSuspension({ ...base, secondApproverId: 'admin' })).toBe('SECOND_APPROVER_MUST_DIFFER');
    expect(checkSuspension({ ...base, reason: 'bad provider' })).toBe('REASON_TOO_SHORT');
    expect(checkSuspension({ ...base, targetUserId: 'admin' })).toBe('CANNOT_SUSPEND_SELF');
  });
});

describe('appeals', () => {
  const dispute = {
    status: 'RESOLVED',
    resolvedAt: new Date(Date.now() - 86_400_000),
    reopenedCount: 0,
    raisedBy: 'c1',
    againstUserId: 'p1',
  };
  const reason = 'The photos they sent were of a different flat entirely';

  it('is open to either party, once, within a week', () => {
    expect(checkAppeal(dispute, { userId: 'c1', reason })).toBeNull();
    expect(checkAppeal(dispute, { userId: 'p1', reason })).toBeNull();
    expect(checkAppeal(dispute, { userId: 'stranger', reason })).toBe('NOT_ON_DISPUTE');
    expect(checkAppeal({ ...dispute, reopenedCount: 1 }, { userId: 'c1', reason })).toBe('ALREADY_REOPENED');
    expect(checkAppeal({ ...dispute, resolvedAt: new Date(Date.now() - 8 * 86_400_000) }, { userId: 'c1', reason })).toBe('APPEAL_WINDOW_CLOSED');
    expect(checkAppeal({ ...dispute, status: 'OPEN' }, { userId: 'c1', reason })).toBe('NOT_RESOLVED');
    expect(checkAppeal(dispute, { userId: 'c1', reason: 'unfair' })).toBe('REASON_TOO_SHORT');
  });

  it('is reviewed by someone other than the first decider', () => {
    expect(appealReviewerIsDifferent('agent-a', 'agent-b')).toBe(true);
    expect(appealReviewerIsDifferent('agent-a', 'agent-a')).toBe(false);
  });
});

describe('ops report', () => {
  it('counts only open disputes that are past their promised time', () => {
    const past = new Date(Date.now() - 3600_000);
    const future = new Date(Date.now() + 3600_000);
    expect(
      countSlaBreaches([
        { slaDueAt: past, status: 'OPEN' },
        { slaDueAt: past, status: 'RESOLVED' },
        { slaDueAt: future, status: 'UNDER_REVIEW' },
        { slaDueAt: past, status: 'ESCALATED' },
      ]),
    ).toBe(2);
  });
});
