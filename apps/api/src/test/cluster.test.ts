import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyReply } from 'fastify';
import { buildApp } from '../app';
import { createDataStore } from '../data';
import type { DataStore } from '../data/types';
import { makeApp, type TestApp } from './helpers';

/**
 * What stops being true when the API is more than one process.
 *
 * These are the bugs that do not announce themselves. Nothing throws, no request fails, no test
 * that runs in one process can see them: the scheduler quietly does everything twice, a
 * customer's live screen quietly stops updating, a limit is quietly twice what it says. The only
 * way to have any confidence is to actually run two nodes and watch them disagree, so that is
 * what these tests do.
 *
 * "Two nodes" means something slightly different in each mode, and deliberately so:
 *
 * - Against **Postgres** it is two apps with two stores, two pools and two connections, sharing
 *   one database. That exercises the real `pg_try_advisory_lock` and the real LISTEN/NOTIFY, so
 *   a passing run says something about production.
 * - In **memory** mode it is two apps sharing one store, which is what a single process reduces
 *   to. It cannot prove anything about Postgres, but it does prove the wiring: that the services
 *   coordinate through the store rather than through their own local state, which is the mistake
 *   being guarded against.
 */

const IS_POSTGRES = process.env.DATA_MODE === 'postgres';

describe('running on more than one node', () => {
  let nodeA: TestApp;
  let nodeB: TestApp;
  let extraStore: DataStore | null = null;

  beforeAll(async () => {
    nodeA = await makeApp();

    if (IS_POSTGRES) {
      // A second store means a second pool and a second connection: a real other node.
      extraStore = createDataStore(nodeA.ctx.env);
      nodeB = await buildApp({ envOverrides: { APP_ENV: 'test', DATA_MODE: 'postgres', DATABASE_URL: nodeA.ctx.env.DATABASE_URL! }, store: extraStore, seed: false });
    } else {
      nodeB = await buildApp({ envOverrides: { APP_ENV: 'test', DATA_MODE: 'memory' }, store: nodeA.ctx.store, seed: false });
    }
    await nodeB.ready();
  });

  afterAll(async () => {
    await nodeB.close();
    await nodeA.close();
    // nodeB.close() disposes the store it was given, so there is nothing left to close here.
    extraStore = null;
  });

  // ------------------------------------------------------------------ the lock

  it('lets exactly one node into the locked section', async () => {
    // Deliberately a barrier rather than two racing timers.
    //
    // The first version of this test started both nodes at once and asserted that only one body
    // ran. It passed in memory mode and failed against Postgres - not because the lock was
    // broken, but because opening a pooled connection takes longer than the work being guarded,
    // so the first node had finished and released before the second one even asked. The lock was
    // fine; the test was measuring connection latency. A test that depends on who wins a race
    // proves nothing on the run where it happens to pass.
    //
    // So node A goes in and *stays* in until node B has had its turn to try.
    let inside = false;
    let releaseA: () => void = () => {};
    const bHasTried = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const aRun = nodeA.ctx.store.cluster.withLock('test:exclusive', async () => {
      inside = true;
      await bHasTried;
      return 'A';
    });

    await waitFor(() => inside);

    // B asks while A is provably still holding it.
    const bRun = await nodeB.ctx.store.cluster.withLock('test:exclusive', async () => 'B');
    releaseA();

    expect(await aRun).toBe('A');
    // Turned away as `null` rather than an error: losing the race is the normal case, and
    // happens on every tick of every node but one.
    expect(bRun).toBeNull();
  });

  it('hands the lock on once the holder is finished', async () => {
    expect(await nodeA.ctx.store.cluster.withLock('test:handover', async () => 'first')).toBe('first');
    // Not held forever: the next caller, on a different node, gets it.
    expect(await nodeB.ctx.store.cluster.withLock('test:handover', async () => 'second')).toBe('second');
  });

  it('releases the lock even when the work inside it throws', async () => {
    await expect(
      nodeA.ctx.store.cluster.withLock('test:throws', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If the failure had leaked the lock, this would return null forever and the scheduler would
    // stop running on every node at once - the worst possible way for this to fail.
    const after = await nodeB.ctx.store.cluster.withLock('test:throws', async () => 'free');
    expect(after).toBe('free');
  });

  // ------------------------------------------------------- the schedule itself

  it('does not re-run a task just because a different node is asking', async () => {
    await nodeA.ctx.services.scheduler.runTask('abandon-drafts');
    const onA = (await nodeA.ctx.services.scheduler.status()).find((t) => t.task === 'abandon-drafts')!;
    expect(onA.runs).toBeGreaterThan(0);

    // The point of the whole exercise: node B has never run this task and has an empty map of
    // its own. Before the state moved into the store it would have believed the task had never
    // run, and fired it again - and again on the tick after that.
    const onB = (await nodeB.ctx.services.scheduler.status()).find((t) => t.task === 'abandon-drafts')!;
    expect(onB.runs).toBe(onA.runs);
    expect(onB.lastRunAt).toBe(onA.lastRunAt);

    const before = onA.runs;
    await nodeB.ctx.services.scheduler.runDue();
    const after = (await nodeA.ctx.services.scheduler.status()).find((t) => t.task === 'abandon-drafts')!.runs;
    expect(after).toBe(before);
  });

  // -------------------------------------------------------------- stream fan-out

  it('delivers an event published on one node to a stream held by the other', async () => {
    const written: string[] = [];
    const fakeReply = { raw: { write: (chunk: string) => written.push(chunk), end: () => {} } } as unknown as FastifyReply;

    // The subscriber is attached to node B.
    const unsubscribe = nodeB.ctx.services.events.subscribe('user-fanout-1', 'stream-1', fakeReply);
    expect(written.join('')).toContain('event: ready');
    written.length = 0;

    // The write happens on node A, which is the ordinary case: the request went to whichever
    // node the load balancer picked, and that is rarely the one holding the stream.
    nodeA.ctx.services.events.publish(['user-fanout-1'], { kind: 'job.updated', jobId: 'job-1', at: new Date().toISOString() });

    await waitFor(() => written.some((w) => w.includes('job.updated')));
    const body = written.join('');
    expect(body).toContain('event: job.updated');
    expect(body).toContain('job-1');

    // Exactly once. Delivering locally *as well* as over the bus is the obvious implementation
    // and it double-sends, because the bus delivers back to the node that published.
    expect(body.match(/event: job\.updated/g)).toHaveLength(1);

    unsubscribe();
  });

  it('sends nothing to somebody the event was not addressed to', async () => {
    const mine: string[] = [];
    const theirs: string[] = [];
    const reply = (sink: string[]) => ({ raw: { write: (c: string) => sink.push(c), end: () => {} } }) as unknown as FastifyReply;

    const un1 = nodeB.ctx.services.events.subscribe('user-fanout-2', 'stream-2', reply(mine));
    const un2 = nodeB.ctx.services.events.subscribe('user-fanout-3', 'stream-3', reply(theirs));
    mine.length = 0;
    theirs.length = 0;

    nodeA.ctx.services.events.publish(['user-fanout-2'], { kind: 'chat.message', jobId: 'job-2', at: new Date().toISOString() });
    await waitFor(() => mine.some((w) => w.includes('chat.message')));

    // The bus is a broadcast; who an event is *for* is still decided per subscriber. A fan-out
    // that leaked across users would be a privacy bug, not a delivery bug.
    expect(theirs.join('')).not.toContain('chat.message');

    un1();
    un2();
  });

  // ------------------------------------------------------------ shared counters

  it('counts rate-limit hits once for the cluster, not once per node', async () => {
    const key = `test-limit-${Date.now()}`;
    const now = new Date();

    const a1 = await nodeA.ctx.store.cluster.countHit(key, 60, now);
    const b1 = await nodeB.ctx.store.cluster.countHit(key, 60, now);
    const a2 = await nodeA.ctx.store.cluster.countHit(key, 60, now);

    // 1, 2, 3 - not 1, 1, 2. Per-node counters are how a limit ends up N times looser than the
    // number written next to it.
    expect([a1, b1, a2]).toEqual([1, 2, 3]);
  });

  it('starts a fresh count when the window turns over', async () => {
    const key = `test-window-${Date.now()}`;
    const first = new Date();
    const later = new Date(first.getTime() + 61_000);

    expect(await nodeA.ctx.store.cluster.countHit(key, 60, first)).toBe(1);
    expect(await nodeB.ctx.store.cluster.countHit(key, 60, first)).toBe(2);
    expect(await nodeB.ctx.store.cluster.countHit(key, 60, later)).toBe(1);
  });
});

/** Postgres delivers a notification a round trip later, so the assertion has to wait for it. */
async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for the event to arrive');
}
