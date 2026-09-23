import type { FastifyReply } from 'fastify';

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
 */
export function eventsService() {
  const subscribers = new Map<string, Subscriber>();
  const byUser = new Map<string, Set<string>>();

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

  return {
    /** Attaches a stream to a signed-in user. Returns the unsubscribe. */
    subscribe(userId: string, id: string, reply: FastifyReply) {
      add(userId, id, reply);
      write(subscribers.get(id)!, 'ready', { at: new Date().toISOString() });
      return () => remove(id);
    },

    /** Tells these people that something they can see has changed. */
    publish(userIds: Array<string | null | undefined>, event: LiveEvent) {
      const unique = [...new Set(userIds.filter((u): u is string => !!u))];
      for (const userId of unique) {
        for (const id of byUser.get(userId) ?? []) {
          const sub = subscribers.get(id);
          if (sub) write(sub, event.kind, event);
        }
      }
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
