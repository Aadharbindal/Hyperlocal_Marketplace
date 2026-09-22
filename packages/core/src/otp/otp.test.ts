import { describe, expect, it } from 'vitest';
import { checkChallengeUsable, generateOtpCode, maskPhone, normaliseIndianPhone } from './otp';

describe('otp helpers', () => {
  it('generates fixed-length numeric codes', () => {
    expect(generateOtpCode(4, () => 7)).toBe('7777');
    expect(generateOtpCode(6, (n) => n - 1)).toBe('999999');
  });
  it('challenge usability', () => {
    const base = { attempts: 0, maxAttempts: 5, expiresAt: new Date(Date.now() + 1000), consumedAt: null };
    expect(checkChallengeUsable(base)).toBe('OK');
    expect(checkChallengeUsable({ ...base, attempts: 5 })).toBe('LOCKED');
    expect(checkChallengeUsable({ ...base, expiresAt: new Date(Date.now() - 1) })).toBe('EXPIRED');
    expect(checkChallengeUsable({ ...base, consumedAt: new Date() })).toBe('CONSUMED');
  });
  it('normalises Indian phone numbers', () => {
    expect(normaliseIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normaliseIndianPhone('09876543210')).toBe('+919876543210');
    expect(normaliseIndianPhone('+91 98765-43210')).toBe('+919876543210');
    expect(normaliseIndianPhone('12345')).toBeNull();
    expect(normaliseIndianPhone('1234567890')).toBeNull(); // must start 6-9
  });
  it('masks phone numbers', () => {
    expect(maskPhone('+919876543210')).toBe('+91********10');
  });
});
