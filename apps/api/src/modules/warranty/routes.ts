import type { FastifyInstance } from 'fastify';
import { RaiseWarrantyClaimBody, RespondToClaimBody } from '@hyperlocal/core';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });
const RevisitBody = z.object({ preferredStart: z.string().datetime().optional() }).strict();
const ResolveBody = z.object({ note: z.string().trim().min(3).max(500) }).strict();

/**
 * The warranty every quote has promised since M4 and nothing could be claimed against.
 *
 * The whole argument for booking through a platform rather than ringing somebody directly is
 * what happens when the work fails. Until now, that answer was "nothing" - so the customer rang
 * the professional directly, which is the leakage PRODUCT_SPEC section 17 exists to prevent.
 */
export async function warrantyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const warranty = services.warranty;

  async function jobOr404(id: string) {
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    return job;
  }

  /** What a finished job says about its own cover. The app never has to work this out. */
  app.get('/jobs/:id/warranty', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    return warranty.statusFor(await jobOr404(id), auth.userId);
  });

  app.post('/jobs/:id/warranty-claim', { preHandler: requireAction('job.read_own') }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(RaiseWarrantyClaimBody, req.body);
    const claim = await warranty.raise(await jobOr404(id), auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: 'warranty.claimed',
      entityType: 'warranty_claim',
      entityId: claim.id,
      after: { jobId: id },
    });
    return reply.code(201).send({ claim });
  });

  app.get('/me/warranty-claims', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    // A professional sees claims against their work; everybody else sees their own.
    const items =
      auth.activeRole === 'PROVIDER' || auth.activeRole === 'CONTRACTOR'
        ? await warranty.listForProvider(auth.userId)
        : await warranty.listForCustomer(auth.userId);
    return { items };
  });

  app.post('/warranty-claims/:id/respond', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(RespondToClaimBody, req.body);
    const claim = await warranty.respond(id, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: `warranty.${body.response.toLowerCase()}ed`,
      entityType: 'warranty_claim',
      entityId: id,
      reason: body.reason ?? null,
      after: { status: claim.status },
    });
    return { claim };
  });

  /** Books the free return visit. Either side may arrange it once the claim is accepted. */
  app.post('/warranty-claims/:id/revisit', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { preferredStart } = parse(RevisitBody, req.body ?? {});
    const claim = await warranty.bookRevisit(id, auth.userId, preferredStart);
    await services.audit.record(req.auditCtx(), {
      action: 'warranty.revisit_booked',
      entityType: 'warranty_claim',
      entityId: id,
      after: { revisitJobId: claim.revisitJobId },
    });
    return reply.code(201).send({ claim });
  });

  app.post('/warranty-claims/:id/resolve', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { note } = parse(ResolveBody, req.body);
    const claim = await warranty.resolve(id, auth.userId, note);
    await services.audit.record(req.auditCtx(), {
      action: 'warranty.resolved',
      entityType: 'warranty_claim',
      entityId: id,
      reason: note,
    });
    return { claim };
  });
}
