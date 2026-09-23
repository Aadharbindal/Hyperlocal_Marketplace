import { describe, expect, it } from 'vitest';
import {
  RECONCILE_GIVE_UP_MINUTES,
  SCHEDULED_TASKS,
  TASK_SCHEDULE,
  dueTasks,
  isDue,
  isOverrunning,
  reconcileDecision,
  type ScheduledTask,
  type TaskState,
} from './schedule';

const spec = TASK_SCHEDULE.find((t) => t.task === 'expire-offers')!;
const state = (over: Partial<TaskState> = {}): TaskState => ({
  task: 'expire-offers',
  lastRunAt: new Date(),
  lastDurationMs: 10,
  lastError: null,
  runs: 1,
  ...over,
});

describe('the schedule', () => {
  it('names every task exactly once, with an interval and a description', () => {
    expect(TASK_SCHEDULE).toHaveLength(SCHEDULED_TASKS.length);
    expect(new Set(TASK_SCHEDULE.map((t) => t.task)).size).toBe(SCHEDULED_TASKS.length);
    expect(TASK_SCHEDULE.every((t) => t.everySeconds >= 60 && t.description.length > 10)).toBe(true);
  });

  it('treats a task that has never run as due', () => {
    expect(isDue(spec, undefined)).toBe(true);
    expect(isDue(spec, state({ lastRunAt: null }))).toBe(true);
  });

  it('waits out the interval before running again', () => {
    const justRan = state({ lastRunAt: new Date() });
    expect(isDue(spec, justRan)).toBe(false);
    const longAgo = state({ lastRunAt: new Date(Date.now() - (spec.everySeconds + 1) * 1000) });
    expect(isDue(spec, longAgo)).toBe(true);
  });

  it('only offers the tasks that are actually due', () => {
    const states = new Map<ScheduledTask, TaskState>();
    expect(dueTasks(states)).toHaveLength(TASK_SCHEDULE.length);
    for (const t of TASK_SCHEDULE) states.set(t.task, state({ task: t.task, lastRunAt: new Date() }));
    expect(dueTasks(states)).toHaveLength(0);
  });

  it('notices a task that takes longer than its own interval', () => {
    expect(isOverrunning(spec, state({ lastDurationMs: 10 }))).toBe(false);
    expect(isOverrunning(spec, state({ lastDurationMs: spec.everySeconds * 1000 + 1 }))).toBe(true);
  });
});

describe('reconciliation', () => {
  const justNow = new Date();
  const longAgo = new Date(Date.now() - (RECONCILE_GIVE_UP_MINUTES + 5) * 60_000);

  it('follows the gateway, never the client', () => {
    expect(reconcileDecision('AUTHORIZED', justNow)).toBe('AUTHORIZED');
    expect(reconcileDecision('CAPTURED', justNow)).toBe('AUTHORIZED');
    expect(reconcileDecision('FAILED', justNow)).toBe('FAILED');
  });

  it('keeps waiting for a while, then hands it to a person', () => {
    expect(reconcileDecision('PENDING', justNow)).toBe('STILL_PENDING');
    expect(reconcileDecision('PENDING', longAgo)).toBe('GIVE_UP');
  });
});
