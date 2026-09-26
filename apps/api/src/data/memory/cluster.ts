import type { ClusterRepo } from '../types';

/**
 * The single-process versions of the coordination primitives.
 *
 * These are not stubs. Each one is what the Postgres version reduces to when there is exactly
 * one node, and it is written to behave the same way at the boundary so that a test proving
 * something in memory mode is proving it about the real thing:
 *
 * - `withLock` really does exclude. A tick that overruns its interval would otherwise re-enter
 *   itself, which is the same double-run bug as two nodes racing, only from one process.
 * - `broadcast` delivers to local handlers and nothing else, which is exactly what NOTIFY does
 *   on a one-node cluster. It delivers synchronously, so tests do not need to sleep; the
 *   Postgres path is a round trip and therefore a tick later, which callers must not rely on
 *   either way.
 * - `countHit` counts in the same fixed windows as the SQL version, so a limit behaves
 *   identically in a test and in production.
 */
export function createMemoryCluster(): ClusterRepo {
  const held = new Set<string>();
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const hits = new Map<string, number>();

  return {
    async withLock(key, fn) {
      if (held.has(key)) return null;
      held.add(key);
      try {
        return await fn();
      } finally {
        held.delete(key);
      }
    },

    async broadcast(channel, payload) {
      // Round-tripped through JSON so a handler cannot be handed a live object it could mutate -
      // over NOTIFY it would have been serialised, and a test must not pass because of an
      // aliasing that production does not have.
      const copy: unknown = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
      for (const h of handlers.get(channel) ?? []) {
        try {
          h(copy);
        } catch {
          // One bad handler must not stop the others.
        }
      }
    },

    async onBroadcast(channel, handler) {
      const set = handlers.get(channel) ?? new Set<(payload: unknown) => void>();
      set.add(handler);
      handlers.set(channel, set);
      return () => {
        set.delete(handler);
        if (set.size === 0) handlers.delete(channel);
      };
    },

    async countHit(key, windowSeconds, now) {
      const start = Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
      const slot = `${key}@${start}`;
      const next = (hits.get(slot) ?? 0) + 1;
      hits.set(slot, next);
      // Fixed windows means old slots are dead the moment the window turns over; drop them here
      // rather than growing a map for the life of the process.
      if (hits.size > 5000) {
        for (const k of hits.keys()) {
          const at = Number(k.slice(k.lastIndexOf('@') + 1));
          if (at < start) hits.delete(k);
        }
      }
      return next;
    },

    async sweepHits(before) {
      let dropped = 0;
      for (const k of [...hits.keys()]) {
        if (Number(k.slice(k.lastIndexOf('@') + 1)) < before.getTime()) {
          hits.delete(k);
          dropped++;
        }
      }
      return dropped;
    },
  };
}
