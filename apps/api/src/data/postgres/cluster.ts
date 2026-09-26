import type pg from 'pg';
import type { ClusterRepo } from '../types';

/**
 * The coordination primitives, built on Postgres because the pilot already runs one and does not
 * already run a Redis.
 *
 * Everything here exists because of the same class of bug: something that is obviously correct
 * in one process and silently wrong in two. None of these failures announce themselves - the
 * scheduler double-sends a reminder, a customer's live screen just never updates, an OTP limit
 * turns out to be twice as generous as it reads. They are the kind of thing found in production
 * by a confused user rather than in review.
 */

/**
 * One channel for every logical topic, with the topic inside the payload.
 *
 * The alternative is `LISTEN <topic>`, which means interpolating a name into SQL that cannot be
 * parameterised, and then quoting it correctly forever. One fixed identifier and a JSON envelope
 * costs nothing and removes that whole question.
 */
const BUS = 'hyperlocal_bus';

/** NOTIFY refuses a payload over 8000 bytes. Ours are tiny; this is here so that if one ever is not, it says so. */
const MAX_PAYLOAD = 7000;

export function postgresCluster(pool: pg.Pool): ClusterRepo & { _close(): void } {
  type Handler = (payload: unknown) => void;
  const handlers = new Map<string, Set<Handler>>();

  let listener: pg.PoolClient | null = null;
  let listening: Promise<void> | null = null;
  let closed = false;

  function deliver(raw: string) {
    let envelope: { channel?: string; payload?: unknown };
    try {
      envelope = JSON.parse(raw) as { channel?: string; payload?: unknown };
    } catch {
      return; // Not ours, or truncated. Nothing useful to do with it.
    }
    if (!envelope.channel) return;
    for (const h of handlers.get(envelope.channel) ?? []) {
      try {
        h(envelope.payload);
      } catch {
        // One bad handler must not stop the others, and must not take down the listener.
      }
    }
  }

  /**
   * Hold a connection open with LISTEN on it, and put it back if it dies.
   *
   * A dropped listener is the failure worth designing for: nothing errors, no request fails,
   * screens simply stop updating on that node until somebody restarts it. So the connection
   * re-establishes itself, and because an event carries no data - only the news that something
   * changed - a gap during reconnection costs a client one stale render, which its next read
   * corrects.
   */
  async function ensureListening(): Promise<void> {
    if (closed) return;
    if (listening) return listening;
    listening = (async () => {
      const client = await pool.connect();
      client.on('notification', (msg) => {
        if (msg.channel === BUS && msg.payload) deliver(msg.payload);
      });
      client.on('error', () => {
        // Drop it and reconnect on the next use; releasing a broken client with an error tells
        // the pool to discard rather than reuse it.
        try {
          client.release(new Error('listener connection lost'));
        } catch {
          // already released
        }
        listener = null;
        listening = null;
        if (!closed) setTimeout(() => void ensureListening().catch(() => {}), 1000).unref?.();
      });
      await client.query(`listen ${BUS}`);
      listener = client;
    })();
    try {
      await listening;
    } catch (e) {
      listening = null;
      throw e;
    }
  }

  return {
    async withLock(key, fn) {
      const client = await pool.connect();
      try {
        // hashtext gives an int4; the advisory lock functions take a bigint. The key space here
        // is a handful of fixed task names, so a collision would need two of them to hash alike
        // and would cost one skipped tick, not a correctness bug.
        const res = await client.query('select pg_try_advisory_lock(hashtext($1)::bigint) as got', [key]);
        if (!res.rows[0]?.got) return null;
        try {
          return await fn();
        } finally {
          await client.query('select pg_advisory_unlock(hashtext($1)::bigint)', [key]);
        }
      } finally {
        client.release();
      }
    },

    async broadcast(channel, payload) {
      const body = JSON.stringify({ channel, payload });
      if (body.length > MAX_PAYLOAD) {
        throw new Error(`broadcast payload too large for NOTIFY (${body.length} bytes on ${channel})`);
      }
      await pool.query('select pg_notify($1, $2)', [BUS, body]);
    },

    async onBroadcast(channel, handler) {
      const set = handlers.get(channel) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(channel, set);
      await ensureListening();
      return () => {
        set.delete(handler);
        if (set.size === 0) handlers.delete(channel);
      };
    },

    async countHit(key, windowSeconds, now) {
      // A fixed window, so the row key is derivable and there is nothing to sweep per request.
      const startMs = Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
      const res = await pool.query<{ hits: number }>(
        `insert into rate_limit_hits (key, window_start, hits) values ($1, $2, 1)
         on conflict (key, window_start) do update set hits = rate_limit_hits.hits + 1
         returning hits`,
        [key, new Date(startMs)],
      );
      return res.rows[0]?.hits ?? 1;
    },

    async sweepHits(before) {
      const res = await pool.query('delete from rate_limit_hits where window_start < $1', [before]);
      return res.rowCount ?? 0;
    },

    /**
     * Stop listening and stop trying to. Called on shutdown before the pool closes, so a node on
     * its way out does not reconnect a listener a moment after its pool has gone.
     */
    _close() {
      closed = true;
      handlers.clear();
      const client = listener;
      listener = null;
      listening = null;
      try {
        client?.release();
      } catch {
        // already gone
      }
    },
  };
}
