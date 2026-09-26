import type { FastifyReply } from 'fastify';
import type { ClusterRepo } from '../../data/types';

export type EventKind =
  | 'job.updated'
  | 'offer.updated'
  | 'booking.updated'
  | 'execution.updated'
  | 'material.updated'
  | 'chat.message'
  | 'money.updated'
  | 'notification';

export interface LiveEvent {
  kind: EventKind;
  jobId?: string;
  /** Small on purpose: an event says *what changed*, and the client re-reads the truth. */
  at: string;
}

interface Subscriber {
  id: string;
  userId: string;
  reply: FastifyReply;
}

/**
 * Server-sent events, so the apps stop polling every fifteen seconds.
 *
 * An event carries no data beyond what changed and which job it was: the client uses it to
 * re-read the endpoint it already trusts. That keeps the server the only source of truth even
 * when a message is delayed, duplicated or missed, and means a dropped stream degrades to the
 * old behaviour rather than to a wrong screen.
 *
 * **Every event goes through the cluster bus, including to this node's own subscribers.** A
 * stream is held open by one node, and the write that causes an event is handled by whichever
 * node got the request - so as soon as there are two, the two are usually different and a
 * customer watching their job would see nothing at all. Publishing locally *as well* would be
 * the obvious fix and the wrong one: the bus delivers back to the sender, so the local
 * subscribers would get everything twice.
 *
 * That the event carries no data is what makes this cheap to get right. A lost or duplicated
 * notification costs a client one redundant read, never a wrong screen.
 */
export function eventsService(cluster: ClusterRepo, onError: (e: unknown) => void = () => {}) {
  const subscribers = new Map<string, Subscriber>();
  const byUser = new Map<string, Set<string>>();
  let unsubscribeBus: (() => void) | null = null;

  function add(userId: string, id: string, reply: FastifyReply) {
    subscribers.set(id, { id, userId, reply });
    const set = byUser.get(userId) ?? new Set<string>();
    set.add(id);
    byUser.set(userId, set);
  }

  function remove(id: string) {
    const sub = subscribers.get(id);
    if (!sub) return;
    subscribers.delete(id);
    const set = byUser.get(sub.userId);
    set?.delete(id);
    if (set && set.size === 0) byUser.delete(sub.userId);
  }

  function write(sub: Subscriber, event: string, data: unknown) {
    try {
      sub.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // A dead socket is not an error worth surfacing; the client will reconnect.
      remove(sub.id);
    }
  }

  /** Deliver to the streams this node is holding. Everything arrives here, local or remote. */
  function deliverLocal(userIds: string[], event: LiveEvent) {
    for (const userId of userIds) {
      for (const id of byUser.get(userId) ?? []) {
        const sub = subscribers.get(id);
        if (sub) write(sub, event.kind, event);
      }
    }
  }

  return {
    /**
     * Start listening to the bus. Separate from construction because it is I/O, and a node that
     * cannot reach the bus should fail at boot rather than look healthy and go quiet.
     */
    async start() {
      unsubscribeBus = await cluster.onBroadcast('events', (payload) => {
        const msg = payload as { userIds?: string[]; event?: LiveEvent } | null;
        if (!msg?.event || !Array.isArray(msg.userIds)) return;
        deliverLocal(msg.userIds, msg.event);
      });
    },

    /** Attaches a stream to a signed-in user. Returns the unsubscribe. */
    subscribe(userId: string, id: string, reply: FastifyReply) {
      add(userId, id, reply);
      write(subscribers.get(id)!, 'ready', { at: new Date().toISOString() });
      return () => remove(id);
    },

    /**
     * Tells these people that something they can see has changed.
     *
     * Deliberately not awaited by its callers: an event is a hint, and a booking must not fail
     * or slow down because the hint could not be sent. A failure is reported rather than
     * swallowed, because a bus that has stopped working is invisible from the outside - every
     * request still succeeds and every screen just stops moving.
     */
    publish(userIds: Array<string | null | undefined>, event: LiveEvent) {
      const unique = [...new Set(userIds.filter((u): u is string => !!u))];
      if (unique.length === 0) return;
      void cluster.broadcast('events', { userIds: unique, event }).catch(onError);
    },

    /** Keeps proxies from closing an idle stream. */
    heartbeat() {
      for (const sub of subscribers.values()) {
        try {
          sub.reply.raw.write(': keep-alive\n\n');
        } catch {
          remove(sub.id);
        }
      }
    },

    stats() {
      return { streams: subscribers.size, users: byUser.size };
    },

    closeAll() {
      unsubscribeBus?.();
      unsubscribeBus = null;
      for (const sub of subscribers.values()) {
        try {
          sub.reply.raw.end();
        } catch {
          // already gone
        }
      }
      subscribers.clear();
      byUser.clear();
    },
  };
}

export type EventsService = ReturnType<typeof eventsService>;
