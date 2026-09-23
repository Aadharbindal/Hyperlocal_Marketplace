import type { OfferStatus } from '../contracts/enums';

/** How long a counter-offer waits for an answer before it lapses. */
export const COUNTER_OFFER_TTL_MINUTES = 20;

/** How many times the two sides may go back and forth on one offer thread. */
export const MAX_NEGOTIATION_ROUNDS = 6;

export type NegotiationBlocker =
  | 'OFFER_NOT_PENDING'
  | 'OFFER_EXPIRED'
  | 'NOT_YOUR_TURN'
  | 'ROUND_LIMIT_REACHED'
  | 'JOB_NOT_NEGOTIABLE'
  | 'BID_NOT_ACTIVE';

export interface RespondCheckInput {
  offerStatus: OfferStatus;
  offerExpiresAt: Date;
  /** The user answering must be the offer's receiver. */
  receiverId: string;
  responderId: string;
  /** How many offers already exist in this thread, including the one being answered. */
  roundsSoFar: number;
  jobAcceptsNegotiation: boolean;
  bidIsActive: boolean;
  now?: Date;
}

export function checkCanRespond(i: RespondCheckInput): NegotiationBlocker[] {
  const blockers: NegotiationBlocker[] = [];
  const now = i.now ?? new Date();
  if (i.offerStatus !== 'PENDING') blockers.push('OFFER_NOT_PENDING');
  else if (now >= i.offerExpiresAt) blockers.push('OFFER_EXPIRED');
  if (i.receiverId !== i.responderId) blockers.push('NOT_YOUR_TURN');
  if (i.roundsSoFar >= MAX_NEGOTIATION_ROUNDS) blockers.push('ROUND_LIMIT_REACHED');
  if (!i.jobAcceptsNegotiation) blockers.push('JOB_NOT_NEGOTIABLE');
  if (!i.bidIsActive) blockers.push('BID_NOT_ACTIVE');
  return blockers;
}

export interface AcceptCheckInput {
  jobAcceptsAcceptance: boolean;
  bidIsActive: boolean;
  bidExpiresAt: Date;
  /** Set when the job already has a confirmed provider. */
  alreadyHasActiveQuote: boolean;
  now?: Date;
}

export type AcceptBlocker = 'JOB_NOT_ACCEPTABLE' | 'BID_NOT_ACTIVE' | 'BID_EXPIRED' | 'ALREADY_CONFIRMED';

/**
 * Guards the acceptance path. The database still enforces the single-winner rule with a partial
 * unique index; this gives the customer a readable reason before we get there (BID-11, BID-12).
 */
export function checkCanAccept(i: AcceptCheckInput): AcceptBlocker[] {
  const blockers: AcceptBlocker[] = [];
  const now = i.now ?? new Date();
  if (!i.jobAcceptsAcceptance) blockers.push('JOB_NOT_ACCEPTABLE');
  if (!i.bidIsActive) blockers.push('BID_NOT_ACTIVE');
  else if (now >= i.bidExpiresAt) blockers.push('BID_EXPIRED');
  if (i.alreadyHasActiveQuote) blockers.push('ALREADY_CONFIRMED');
  return blockers;
}

export function counterOfferExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + COUNTER_OFFER_TTL_MINUTES * 60_000);
}

/** The other side of a negotiation. */
export function counterparty(party: 'CUSTOMER' | 'PROVIDER'): 'CUSTOMER' | 'PROVIDER' {
  return party === 'CUSTOMER' ? 'PROVIDER' : 'CUSTOMER';
}
