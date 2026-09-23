import type { FastifyInstance } from 'fastify';
import {
  ApproveCompletionBody,
  AssignTechnicianBody,
  ChatSendBody,
  StartCallBody,
  CompleteJobBody,
  JobProgressBody,
  PriceRevisionBody,
  JobMediaCreate,
  PriceRevisionRespondBody,
  StartJobBody,
  mediaPhaseFor,
} from '@hyperlocal/core';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';
import type { TransitionContext } from '../jobs/service';

const IdParam = z.object({ id: z.string().uuid() });

export async function executionRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const execution = services.execution;

  const transitionCtx = (req: Parameters<typeof requireAuth>[0]): TransitionContext => {
    const auth = requireAuth(req);
    return { actorUserId: auth.userId, actorRole: auth.activeRole, actor: auth.activeRole, requestId: req.id };
  };

  /** Everyone on this job may read it; only the service decides who may write. */
  async function jobForParty(req: Parameters<typeof requireAuth>[0], id: string) {
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    return job;
  }

  // ---------------------------------------------------------------- technician
  app.post('/jobs/:id/technician', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(AssignTechnicianBody, req.body);
    const job = await jobForParty(req, id);
    const assignment = await execution.assignTechnician(job, auth.userId, body.technicianId);
    await services.audit.record(req.auditCtx(), {
      action: 'job.technician_assigned',
      entityType: 'job_assignment',
      entityId: assignment.id,
      after: { technicianId: body.technicianId },
    });
    return reply.code(200).send({ assignmentId: assignment.id, technicianId: assignment.technician_id });
  });

  // ---------------------------------------------------------------- on the way / arrived
  app.post('/jobs/:id/progress', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(JobProgressBody, req.body);
    const job = await jobForParty(req, id);
    const moved = await execution.progress(job, auth.userId, body.to, body.etaMinutes, transitionCtx(req));
    await services.audit.record(req.auditCtx(), { action: `job.${body.to.toLowerCase()}`, entityType: 'job', entityId: job.id });
    return { id: moved.id, status: moved.status };
  });

  // ---------------------------------------------------------------- start code
  app.post('/jobs/:id/start', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(StartJobBody, req.body);
    const job = await jobForParty(req, id);
    const started = await execution.start(job, auth.userId, auth.activeRole ?? '', body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: body.override ? 'job.start_overridden' : 'job.started',
      entityType: 'job',
      entityId: job.id,
      // the code itself is never written to the audit trail, only the fact of the start
      reason: body.override ? (body.reason ?? null) : null,
    });
    return { id: started.id, status: started.status };
  });

  // ---------------------------------------------------------------- price revision
  app.post('/jobs/:id/price-revision', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(PriceRevisionBody, req.body);
    const job = await jobForParty(req, id);
    const revision = await execution.requestRevision(
      job,
      auth.userId,
      {
        reason: body.reason,
        extraLabourPaise: body.extraLabourPaise ?? 0,
        extraMaterialPaise: body.extraMaterialPaise ?? 0,
        extraTimeMinutes: body.extraTimeMinutes ?? 0,
        explanation: body.explanation,
        mediaIds: body.mediaIds,
      },
      transitionCtx(req),
    );
    await services.audit.record(req.auditCtx(), {
      action: 'job.price_revision_requested',
      entityType: 'price_revision',
      entityId: revision.id,
      after: { revisedTotalPaise: Number(revision.revised_total_paise) },
    });
    return reply.code(201).send(execution.toRevisionView(revision));
  });

  app.post('/price-revisions/:id/respond', { preHandler: requireAction('job.read_own') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(PriceRevisionRespondBody, req.body);
    const revision = await store.execution.getRevision(id);
    if (!revision) throw notFound('price revision');
    const job = await store.jobs.get(revision.job_id);
    if (!job) throw notFound('job');

    const result = await execution.respondToRevision(job, revision, auth.userId, body.action, body.message, transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: `job.price_revision_${body.action.toLowerCase()}`,
      entityType: 'price_revision',
      entityId: revision.id,
    });
    return {
      revision: execution.toRevisionView(result.revision),
      payment: result.payment
        ? {
            id: result.payment.id,
            amountPaise: Number(result.payment.amount_paise),
            status: result.payment.status,
            purpose: result.payment.purpose,
          }
        : null,
    };
  });

  // ---------------------------------------------------------------- completion
  app.post('/jobs/:id/complete', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(CompleteJobBody, req.body);
    const job = await jobForParty(req, id);
    const result = await execution.complete(job, auth.userId, body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: 'job.completion_submitted',
      entityType: 'job_completion',
      entityId: result.completion.id,
    });
    return reply.code(201).send({ status: result.job.status, completion: execution.toCompletionView(result.completion) });
  });

  app.post('/jobs/:id/approve', { preHandler: requireAction('job.read_own') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(ApproveCompletionBody, req.body);
    const job = await jobForParty(req, id);
    const result = await execution.approveCompletion(job, auth.userId, body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: body.approved ? 'job.completion_approved' : 'job.completion_rejected',
      entityType: 'job_completion',
      entityId: result.completion.id,
    });
    return { status: result.job.status, completion: execution.toCompletionView(result.completion) };
  });

  // ---------------------------------------------------------------- evidence upload
  // The provider side attaches progress, revision and completion media here; the phase is
  // decided by where the job is, never by the caller.
  app.post('/jobs/:id/evidence', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(JobMediaCreate, req.body);
    const job = await jobForParty(req, id);
    const phase = mediaPhaseFor(job.status);
    if (!phase || phase === 'REQUEST') {
      throw new AppError('CONFLICT', { details: { reason: 'media_phase_closed', status: job.status } });
    }
    await execution.requireOnJob(job, auth.userId);
    const { media, target, uploadRequired } = await services.jobs.createMediaUpload(job, {
      kind: body.kind,
      mime: body.mime,
      sizeBytes: body.sizeBytes,
      durationSeconds: body.durationSeconds,
      sha256: body.sha256,
      lat: body.lat,
      lng: body.lng,
      uploaderId: auth.userId,
      uploaderRole: auth.activeRole,
      phase,
    });
    return reply.code(201).send({
      media: { id: media.id, kind: media.kind, phase: media.phase, url: media.storage_key },
      upload: { url: target.url, method: target.method, expiresAt: target.expiresAt.toISOString(), required: uploadRequired },
    });
  });

  // ---------------------------------------------------------------- the shared panel
  app.get('/jobs/:id/execution', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobForParty(req, id);
    return execution.view(job, auth.userId);
  });

  // ---------------------------------------------------------------- calling
  /**
   * Connects the two people on this job through the telephony provider. Neither number is ever
   * sent to the other side - the response carries only the number to dial and who it reaches.
   */
  app.post('/jobs/:id/call', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(StartCallBody, req.body ?? {});
    const job = await jobForParty(req, id);
    const call = await execution.startCall(job, auth.userId, body);
    return reply.code(201).send({ call });
  });

  // ---------------------------------------------------------------- chat
  app.get('/jobs/:id/chat', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobForParty(req, id);
    return execution.messages(job, auth.userId);
  });

  app.post('/jobs/:id/chat', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(ChatSendBody, req.body);
    const job = await jobForParty(req, id);
    const message = await execution.sendMessage(job, auth.userId, body.body);
    return reply.code(201).send({ id: message.id, flagged: message.flagged, createdAt: message.created_at.toISOString() });
  });
}
