import { describe, expect, it } from 'vitest';
import { MAX_NEGOTIATION_ROUNDS, checkCanAccept, checkCanRespond, counterOfferExpiry, counterparty } from './negotiation';

const base = {
  offerStatus: 'PENDING' as const,
  offerExpiresAt: new Date(Date.now() + 600_000),
  receiverId: 'u1',
  responderId: 'u1',
  roundsSoFar: 1,
  jobAcceptsNegotiation: true,
  bidIsActive: true,
};

describe('responding to a counter-offer', () => {
  it('allows the receiver to answer a live offer', () => {
    expect(checkCanRespond(base)).toEqual([]);
  });

  it('refuses when it is not your turn', () => {
    expect(checkCanRespond({ ...base, responderId: 'someone-else' })).toContain('NOT_YOUR_TURN');
  });

  it('refuses an offer that has lapsed or already been answered', () => {
    expect(checkCanRespond({ ...base, offerExpiresAt: new Date(Date.now() - 1) })).toContain('OFFER_EXPIRED');
    expect(checkCanRespond({ ...base, offerStatus: 'ACCEPTED' })).toContain('OFFER_NOT_PENDING');
    // an already-answered offer is reported as such rather than also claiming it expired
    expect(checkCanRespond({ ...base, offerStatus: 'REJECTED', offerExpiresAt: new Date(Date.now() - 1) })).toEqual(['OFFER_NOT_PENDING']);
  });

  it('stops an endless back and forth', () => {
    expect(checkCanRespond({ ...base, roundsSoFar: MAX_NEGOTIATION_ROUNDS })).toContain('ROUND_LIMIT_REACHED');
    expect(checkCanRespond({ ...base, roundsSoFar: MAX_NEGOTIATION_ROUNDS - 1 })).toEqual([]);
  });

  it('refuses once the job or the underlying offer has moved on', () => {
    expect(checkCanRespond({ ...base, jobAcceptsNegotiation: false })).toContain('JOB_NOT_NEGOTIABLE');
    expect(checkCanRespond({ ...base, bidIsActive: false })).toContain('BID_NOT_ACTIVE');
  });
});

describe('accepting an offer', () => {
  const acc = {
    jobAcceptsAcceptance: true,
    bidIsActive: true,
    bidExpiresAt: new Date(Date.now() + 600_000),
    alreadyHasActiveQuote: false,
  };

  it('allows a live offer on an open job', () => expect(checkCanAccept(acc)).toEqual([]));

  it('refuses a withdrawn or expired offer (BID-11)', () => {
    expect(checkCanAccept({ ...acc, bidIsActive: false })).toContain('BID_NOT_ACTIVE');
    expect(checkCanAccept({ ...acc, bidExpiresAt: new Date(Date.now() - 1) })).toContain('BID_EXPIRED');
  });

  it('refuses a second acceptance (BID-12)', () => {
    expect(checkCanAccept({ ...acc, alreadyHasActiveQuote: true })).toContain('ALREADY_CONFIRMED');
    expect(checkCanAccept({ ...acc, jobAcceptsAcceptance: false })).toContain('JOB_NOT_ACCEPTABLE');
  });
});

describe('helpers', () => {
  it('expires a counter-offer twenty minutes out', () => {
    const from = new Date('2026-01-01T10:00:00Z');
    expect(counterOfferExpiry(from).toISOString()).toBe('2026-01-01T10:20:00.000Z');
  });
  it('flips the party', () => {
    expect(counterparty('CUSTOMER')).toBe('PROVIDER');
    expect(counterparty('PROVIDER')).toBe('CUSTOMER');
  });
});
