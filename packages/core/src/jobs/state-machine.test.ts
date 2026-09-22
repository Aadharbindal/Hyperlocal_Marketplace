import { describe, expect, it } from 'vitest';
import { JOB_STATUSES, TERMINAL_JOB_STATUSES, type JobStatus } from '../contracts/enums';
import {
  JOB_TRANSITIONS,
  allowedTransitions,
  canTransition,
  isTerminal,
  type Actor,
} from './state-machine';

describe('job state machine', () => {
  it('covers every status in the transition table', () => {
    for (const s of JOB_STATUSES) expect(JOB_TRANSITIONS[s]).toBeDefined();
  });

  it('walks the happy path with the right actors', () => {
    const path: Array<[JobStatus, JobStatus, Actor]> = [
      ['DRAFT', 'SUBMITTED', 'CUSTOMER'],
      ['SUBMITTED', 'QUALIFYING', 'SYSTEM'],
      ['QUALIFYING', 'OPEN_FOR_BIDS', 'SYSTEM'],
      ['OPEN_FOR_BIDS', 'BID_RECEIVED', 'PROVIDER'],
      ['BID_RECEIVED', 'NEGOTIATING', 'CUSTOMER'],
      ['NEGOTIATING', 'PAYMENT_PENDING', 'CUSTOMER'],
      ['PAYMENT_PENDING', 'CONFIRMED', 'SYSTEM'],
      ['CONFIRMED', 'PROVIDER_ASSIGNED', 'PROVIDER'],
      ['PROVIDER_ASSIGNED', 'EN_ROUTE', 'PROVIDER'],
      ['EN_ROUTE', 'ARRIVED', 'PROVIDER'],
      ['ARRIVED', 'STARTED', 'SYSTEM'],
      ['STARTED', 'IN_PROGRESS', 'PROVIDER'],
      ['IN_PROGRESS', 'PRICE_REVISION_PENDING', 'PROVIDER'],
      ['PRICE_REVISION_PENDING', 'IN_PROGRESS', 'CUSTOMER'],
      ['IN_PROGRESS', 'COMPLETION_PENDING', 'PROVIDER'],
      ['COMPLETION_PENDING', 'CUSTOMER_APPROVAL_PENDING', 'PROVIDER'],
      ['CUSTOMER_APPROVAL_PENDING', 'COMPLETED', 'CUSTOMER'],
      ['COMPLETED', 'SETTLED', 'SYSTEM'],
    ];
    for (const [from, to, actor] of path) {
      expect(canTransition(from, to, actor).ok, `${from}->${to} by ${actor}`).toBe(true);
    }
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('DRAFT', 'COMPLETED', 'ADMIN').code).toBe('INVALID_TRANSITION');
    expect(canTransition('CONFIRMED', 'STARTED', 'PROVIDER').code).toBe('INVALID_TRANSITION');
    expect(canTransition('COMPLETED', 'IN_PROGRESS', 'ADMIN').code).toBe('INVALID_TRANSITION');
  });

  it('rejects the wrong actor', () => {
    expect(canTransition('CUSTOMER_APPROVAL_PENDING', 'COMPLETED', 'PROVIDER').code).toBe(
      'ACTOR_NOT_ALLOWED',
    );
    expect(canTransition('ARRIVED', 'STARTED', 'CUSTOMER').code).toBe('ACTOR_NOT_ALLOWED');
    expect(canTransition('PAYMENT_PENDING', 'CONFIRMED', 'CUSTOMER').code).toBe('ACTOR_NOT_ALLOWED');
  });

  it('never leaves terminal states except through explicit refund edges', () => {
    for (const s of TERMINAL_JOB_STATUSES) {
      expect(isTerminal(s)).toBe(true);
      const outs = JOB_TRANSITIONS[s].map((r) => r.to);
      for (const o of outs) expect(['REFUNDED']).toContain(o);
    }
    expect(canTransition('SETTLED', 'COMPLETED', 'ADMIN').code).toBe('TERMINAL_STATE');
  });

  it('a customer cannot cancel once work has started', () => {
    expect(allowedTransitions('STARTED', 'CUSTOMER').map((r) => r.to)).toEqual(['DISPUTED']);
    expect(allowedTransitions('IN_PROGRESS', 'CUSTOMER').map((r) => r.to)).toEqual(['DISPUTED']);
  });
});
