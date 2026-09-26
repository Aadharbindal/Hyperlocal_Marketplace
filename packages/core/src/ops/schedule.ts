/**
 * The background work the platform owes itself: windows that have to close, money that has to
 * move on time, and records that have to be cleaned up (PAYMENT_FLOW section 8,
 * PRIVACY_DATA_MAP, EDGE_CASE_MATRIX).
 *
 * Nothing here decides anything. It names the work, says how often it is due, and gives the
 * pure helpers the server uses to pick what is actually overdue.
 */

export const SCHEDULED_TASKS = [
  'expire-bid-windows',
  'expire-offers',
  'expire-material',
  'abandon-drafts',
  'run-settlements',
  'reconcile-payments',
  'chase-approvals',
  'retention-sweep',
  'escalate-warranty',
  'expire-proposals',
] as const;
export type ScheduledTask = (typeof SCHEDULED_TASKS)[number];

export interface TaskSpec {
  task: ScheduledTask;
  everySeconds: number;
  /** What it does, in the words an operator would use when it misbehaves. */
  description: string;
}

export const TASK_SCHEDULE: readonly TaskSpec[] = [
  { task: 'expire-bid-windows', everySeconds: 60, description: 'Close bidding on jobs whose window has passed; auto-cancel the ones nobody answered' },
  { task: 'expire-offers', everySeconds: 60, description: 'Expire counter-offers nobody answered and hand the job back to its offers' },
  { task: 'expire-material', everySeconds: 120, description: 'Expire stale material quotes and requests nobody priced' },
  { task: 'abandon-drafts', everySeconds: 3600, description: 'Mark drafts nobody submitted as abandoned' },
  { task: 'run-settlements', everySeconds: 900, description: 'Send the payouts that are due and clear of disputes' },
  { task: 'reconcile-payments', everySeconds: 120, description: 'Ask the gateway about payments whose webhook never arrived' },
  { task: 'chase-approvals', everySeconds: 3600, description: 'Remind a customer sitting on a finished job, and hand it to support if they keep sitting' },
  { task: 'retention-sweep', everySeconds: 3600, description: 'Execute retention events whose time has come' },
  { task: 'escalate-warranty', everySeconds: 3600, description: 'Hand support the warranty claims a professional has left unanswered' },
  { task: 'expire-proposals', everySeconds: 900, description: 'Close the suggested times nobody answered, so they stop hanging over a booking' },
];

/** How long a draft is left alone before it is treated as abandoned. */
export const DRAFT_ABANDON_HOURS = 72;
/** A payment with no webhook after this is worth asking the gateway about. */
export const RECONCILE_AFTER_MINUTES = 2;
/** And after this, it is a support problem rather than a retry. */
export const RECONCILE_GIVE_UP_MINUTES = 30;
/** How long a finished job waits on the customer before support is told. */
export const APPROVAL_CHASE_HOURS = 48;

export interface TaskState {
  task: ScheduledTask;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
}

export function isDue(spec: TaskSpec, state: TaskState | undefined, now: Date = new Date()): boolean {
  if (!state?.lastRunAt) return true;
  return now.getTime() - state.lastRunAt.getTime() >= spec.everySeconds * 1000;
}

export function dueTasks(states: Map<ScheduledTask, TaskState>, now: Date = new Date()): TaskSpec[] {
  return TASK_SCHEDULE.filter((spec) => isDue(spec, states.get(spec.task), now));
}

/**
 * A run that takes longer than its own interval is a warning sign: the next one is already
 * due before this one finished.
 */
export function isOverrunning(spec: TaskSpec, state: TaskState | undefined): boolean {
  return !!state?.lastDurationMs && state.lastDurationMs > spec.everySeconds * 1000;
}

export type ReconcileOutcome = 'AUTHORIZED' | 'FAILED' | 'STILL_PENDING' | 'GIVE_UP';

/**
 * What to do about a payment the gateway has not told us about. The client's claim is never
 * part of this decision - only the gateway's answer and how long we have waited.
 */
export function reconcileDecision(
  gatewayStatus: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED',
  createdAt: Date,
  now: Date = new Date(),
): ReconcileOutcome {
  if (gatewayStatus === 'AUTHORIZED' || gatewayStatus === 'CAPTURED') return 'AUTHORIZED';
  if (gatewayStatus === 'FAILED') return 'FAILED';
  const waitedMinutes = (now.getTime() - createdAt.getTime()) / 60_000;
  return waitedMinutes >= RECONCILE_GIVE_UP_MINUTES ? 'GIVE_UP' : 'STILL_PENDING';
}
