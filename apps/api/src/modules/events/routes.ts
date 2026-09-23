import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import { newId } from '../../lib/crypto';
import type { AppContext } from '../../app';
import type { ScheduledTask } from '@hyperlocal/core';
import { SCHEDULED_TASKS } from '@hyperlocal/core';
import { forbidden } from '../../lib/errors';

export async function eventRoutes(app: FastifyInstance, ctx: AppContext) {
  const { services } = ctx;

  /**
   * The live stream. It replaces polling: the client re-reads whatever endpoint the event
   * names, so a missed or duplicated event can never put a wrong number on screen.
   */
  app.get('/events', async (req, reply) => {
    const auth = requireAuth(req);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // the apps talk to this from a different origin in development
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no',
    });

    const id = newId();
    const unsubscribe = services.events.subscribe(auth.userId, id, reply);
    req.raw.on('close', unsubscribe);
    // Fastify must not try to send a body of its own for this request.
    return reply;
  });

  // ---------------------------------------------------------------- scheduler (support only)
  const TaskBody = z.object({ task: z.enum(SCHEDULED_TASKS).optional() }).strict();

  app.get('/admin/scheduler', async (req) => {
    const auth = requireAuth(req);
    services.admin.requireStaff(auth.activeRole);
    return { tasks: services.scheduler.status(), streams: services.events.stats() };
  });

  /**
   * Runs the background work now. The worker runs on a timer in the server process; this is
   * here so support can force a sweep and so the tests can drive time deterministically.
   */
  app.post('/admin/scheduler/run', async (req) => {
    const auth = requireAuth(req);
    services.admin.requireStaff(auth.activeRole);
    await services.admin.requireFreshMfa(auth.userId, auth.sessionId);
    const body = parse(TaskBody, req.body ?? {});
    const results = body.task
      ? [await services.scheduler.runTask(body.task as ScheduledTask)]
      : await services.scheduler.runDue();
    await services.audit.record(req.auditCtx(), {
      action: 'admin.scheduler.run',
      entityType: 'scheduler',
      after: { tasks: results.map((r) => ({ task: r.task, handled: r.handled, error: r.error ?? null })) },
    });
    return { results };
  });

  /** A deliberate non-route: there is no way for a client to publish an event. */
  app.post('/events', async () => {
    throw forbidden('events are published by the server only');
  });
}
