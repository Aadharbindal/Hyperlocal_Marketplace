import { TERMINAL_JOB_STATUSES, type JobStatus, type UserRole } from '../contracts/enums';

/** Who may trigger a transition. SYSTEM = server-side scheduler/webhook, no human actor. */
export type Actor = UserRole | 'SYSTEM';

export interface TransitionRule {
  to: JobStatus;
  /** Actors allowed to request this transition. Server still validates resource ownership. */
  actors: readonly Actor[];
  /** Human-readable reason shown in audit/status events. */
  label: string;
}

const A_ADMIN: readonly Actor[] = ['ADMIN', 'SUPPORT'];
const A_CUSTOMER: readonly Actor[] = ['CUSTOMER', ...A_ADMIN];
const A_PROVIDER: readonly Actor[] = ['PROVIDER', 'TECHNICIAN', 'CONTRACTOR', ...A_ADMIN];
const A_SYSTEM: readonly Actor[] = ['SYSTEM', ...A_ADMIN];

const CANCEL_BY_CUSTOMER: TransitionRule = {
  to: 'CANCELLED_BY_CUSTOMER',
  actors: A_CUSTOMER,
  label: 'Cancelled by customer',
};
const CANCEL_BY_PROVIDER: TransitionRule = {
  to: 'CANCELLED_BY_PROVIDER',
  actors: A_PROVIDER,
  label: 'Cancelled by provider',
};
const AUTO_CANCEL: TransitionRule = { to: 'AUTO_CANCELLED', actors: A_SYSTEM, label: 'Auto-cancelled' };
const DISPUTE: TransitionRule = {
  to: 'DISPUTED',
  actors: [...A_CUSTOMER, ...A_PROVIDER],
  label: 'Dispute raised',
};

/**
 * The canonical job state machine (PRODUCT_SPEC section 9). Only the server executes it.
 * Every edge must be represented here; anything else is an invalid transition.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly TransitionRule[]>> = {
  DRAFT: [
    { to: 'SUBMITTED', actors: A_CUSTOMER, label: 'Request submitted' },
    { to: 'ABANDONED', actors: A_SYSTEM, label: 'Draft abandoned' },
    CANCEL_BY_CUSTOMER,
  ],
  SUBMITTED: [
    { to: 'QUALIFYING', actors: A_SYSTEM, label: 'Qualifying request' },
    CANCEL_BY_CUSTOMER,
  ],
  QUALIFYING: [
    { to: 'OPEN_FOR_BIDS', actors: A_SYSTEM, label: 'Open for offers' },
    { to: 'DRAFT', actors: A_SYSTEM, label: 'Needs more information' },
    CANCEL_BY_CUSTOMER,
    AUTO_CANCEL,
  ],
  OPEN_FOR_BIDS: [
    { to: 'BID_RECEIVED', actors: [...A_PROVIDER, 'SYSTEM'], label: 'First offer received' },
    CANCEL_BY_CUSTOMER,
    AUTO_CANCEL,
  ],
  BID_RECEIVED: [
    { to: 'NEGOTIATING', actors: [...A_CUSTOMER, ...A_PROVIDER], label: 'Negotiation started' },
    { to: 'PAYMENT_PENDING', actors: A_CUSTOMER, label: 'Offer accepted' },
    CANCEL_BY_CUSTOMER,
    AUTO_CANCEL,
  ],
  NEGOTIATING: [
    { to: 'PAYMENT_PENDING', actors: [...A_CUSTOMER, ...A_PROVIDER], label: 'Terms agreed' },
    { to: 'BID_RECEIVED', actors: A_SYSTEM, label: 'Offer expired' },
    CANCEL_BY_CUSTOMER,
    AUTO_CANCEL,
  ],
  PAYMENT_PENDING: [
    { to: 'CONFIRMED', actors: A_SYSTEM, label: 'Payment authorized' },
    { to: 'BID_RECEIVED', actors: A_SYSTEM, label: 'Payment failed or expired' },
    CANCEL_BY_CUSTOMER,
    AUTO_CANCEL,
  ],
  CONFIRMED: [
    { to: 'PROVIDER_ASSIGNED', actors: [...A_PROVIDER, 'SYSTEM'], label: 'Provider assigned' },
    CANCEL_BY_CUSTOMER,
    CANCEL_BY_PROVIDER,
  ],
  PROVIDER_ASSIGNED: [
    { to: 'EN_ROUTE', actors: A_PROVIDER, label: 'Provider is on the way' },
    CANCEL_BY_CUSTOMER,
    CANCEL_BY_PROVIDER,
  ],
  EN_ROUTE: [
    { to: 'ARRIVED', actors: A_PROVIDER, label: 'Provider has arrived' },
    CANCEL_BY_CUSTOMER,
    CANCEL_BY_PROVIDER,
    DISPUTE,
  ],
  ARRIVED: [
    { to: 'STARTED', actors: [...A_PROVIDER, 'SYSTEM'], label: 'Work started (OTP verified)' },
    CANCEL_BY_CUSTOMER,
    CANCEL_BY_PROVIDER,
    DISPUTE,
  ],
  STARTED: [
    { to: 'IN_PROGRESS', actors: [...A_PROVIDER, 'SYSTEM'], label: 'Work in progress' },
    DISPUTE,
  ],
  IN_PROGRESS: [
    { to: 'PRICE_REVISION_PENDING', actors: A_PROVIDER, label: 'Additional approval required' },
    { to: 'COMPLETION_PENDING', actors: A_PROVIDER, label: 'Work completed, evidence pending' },
    DISPUTE,
  ],
  PRICE_REVISION_PENDING: [
    { to: 'IN_PROGRESS', actors: [...A_CUSTOMER, 'SYSTEM'], label: 'Revision resolved' },
    CANCEL_BY_CUSTOMER,
    DISPUTE,
  ],
  COMPLETION_PENDING: [
    { to: 'CUSTOMER_APPROVAL_PENDING', actors: A_PROVIDER, label: 'Awaiting customer approval' },
    { to: 'IN_PROGRESS', actors: A_PROVIDER, label: 'Resumed work' },
    DISPUTE,
  ],
  CUSTOMER_APPROVAL_PENDING: [
    { to: 'COMPLETED', actors: A_CUSTOMER, label: 'Customer approved completion' },
    { to: 'IN_PROGRESS', actors: A_CUSTOMER, label: 'Customer reported incomplete work' },
    DISPUTE,
  ],
  COMPLETED: [
    { to: 'SETTLED', actors: A_SYSTEM, label: 'Payment settled' },
    DISPUTE,
  ],
  SETTLED: [],
  CANCELLED_BY_CUSTOMER: [{ to: 'REFUNDED', actors: A_SYSTEM, label: 'Refund completed' }],
  CANCELLED_BY_PROVIDER: [{ to: 'REFUNDED', actors: A_SYSTEM, label: 'Refund completed' }],
  AUTO_CANCELLED: [{ to: 'REFUNDED', actors: A_SYSTEM, label: 'Refund completed' }],
  DISPUTED: [
    { to: 'COMPLETED', actors: A_ADMIN, label: 'Dispute resolved - work accepted' },
    { to: 'REFUNDED', actors: A_ADMIN, label: 'Dispute resolved - refunded' },
    { to: 'IN_PROGRESS', actors: A_ADMIN, label: 'Dispute resolved - rework' },
  ],
  REFUNDED: [],
  ABANDONED: [],
};

export interface TransitionCheck {
  ok: boolean;
  code?: 'INVALID_TRANSITION' | 'ACTOR_NOT_ALLOWED' | 'TERMINAL_STATE';
  rule?: TransitionRule;
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** Pure check - the server calls this inside a transaction before writing the status event. */
export function canTransition(from: JobStatus, to: JobStatus, actor: Actor): TransitionCheck {
  if (isTerminal(from) && (JOB_TRANSITIONS[from]?.length ?? 0) === 0) {
    return { ok: false, code: 'TERMINAL_STATE' };
  }
  const rule = JOB_TRANSITIONS[from]?.find((r) => r.to === to);
  if (!rule) return { ok: false, code: 'INVALID_TRANSITION' };
  if (!rule.actors.includes(actor)) return { ok: false, code: 'ACTOR_NOT_ALLOWED', rule };
  return { ok: true, rule };
}

export function allowedTransitions(from: JobStatus, actor?: Actor): readonly TransitionRule[] {
  const rules = JOB_TRANSITIONS[from] ?? [];
  return actor ? rules.filter((r) => r.actors.includes(actor)) : rules;
}

/** Plain-language status keys for customers (PRODUCT_SPEC section 12), resolved by i18n. */
export const JOB_STATUS_LABEL_KEY: Readonly<Record<JobStatus, string>> = {
  DRAFT: 'status.draft',
  SUBMITTED: 'status.submitted',
  QUALIFYING: 'status.finding_providers',
  OPEN_FOR_BIDS: 'status.finding_providers',
  BID_RECEIVED: 'status.offers_received',
  NEGOTIATING: 'status.offers_received',
  PAYMENT_PENDING: 'status.payment_pending',
  CONFIRMED: 'status.provider_confirmed',
  PROVIDER_ASSIGNED: 'status.provider_confirmed',
  EN_ROUTE: 'status.on_the_way',
  ARRIVED: 'status.arrived',
  STARTED: 'status.work_started',
  IN_PROGRESS: 'status.work_started',
  PRICE_REVISION_PENDING: 'status.approval_required',
  COMPLETION_PENDING: 'status.work_completed',
  CUSTOMER_APPROVAL_PENDING: 'status.awaiting_approval',
  COMPLETED: 'status.completed',
  SETTLED: 'status.payment_completed',
  CANCELLED_BY_CUSTOMER: 'status.cancelled',
  CANCELLED_BY_PROVIDER: 'status.cancelled_by_provider',
  AUTO_CANCELLED: 'status.auto_cancelled',
  DISPUTED: 'status.disputed',
  REFUNDED: 'status.refunded',
  ABANDONED: 'status.abandoned',
};
