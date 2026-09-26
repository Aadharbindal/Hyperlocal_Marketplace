import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  JOB_STATUS_LABEL_KEY,
  JobCancelBody,
  ProposeTimeBody,
  RescheduleBody,
  RespondToProposalBody,
  JobCreate,
  JobMediaCreate,
  JobUpdate,
  type JobStatus,
  type JobTrackView,
  type Language,
  type ScheduleProposalView,
} from '@hyperlocal/core';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';
import type { ScheduleProposalRecord } from '../../data/types';
import type { TransitionContext } from './service';

const IdParam = z.object({ id: z.string().uuid() });
const MediaParam = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() });
const ListQuery = z.object({
  scope: z.enum(['active', 'past', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const ACTIVE: JobStatus[] = [
  'DRAFT', 'SUBMITTED', 'QUALIFYING', 'OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING', 'PAYMENT_PENDING',
  'CONFIRMED', 'PROVIDER_ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS',
  'PRICE_REVISION_PENDING', 'COMPLETION_PENDING', 'CUSTOMER_APPROVAL_PENDING',
];
const PAST: JobStatus[] = [
  'COMPLETED', 'SETTLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'AUTO_CANCELLED',
  'DISPUTED', 'REFUNDED', 'ABANDONED',
];

function langOf(req: FastifyRequest): Language {
  return req.auth?.user.preferred_language ?? (req.headers['accept-language']?.toString().startsWith('hi') ? 'hi' : 'en');
}

export async function jobRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const jobs = services.jobs;

  const transitionCtx = (req: FastifyRequest): TransitionContext => {
    const auth = requireAuth(req);
    return { actorUserId: auth.userId, actorRole: auth.activeRole, actor: auth.activeRole, requestId: req.id };
  };

  // ---------------------------------------------------------------- create
  app.post('/jobs', { preHandler: requireAction('job.create') }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(JobCreate, req.body);
    const job = await jobs.createDraft({
      customerId: auth.userId,
      categoryId: body.categoryId,
      skillIds: body.skillIds,
      description: body.description,
      priority: body.priority,
      requestType: body.requestType,
      inspectionRequired: body.inspectionRequired,
      addressId: body.addressId,
      preferredStart: body.preferredStart,
      preferredEnd: body.preferredEnd,
      bookedForName: body.bookedForName,
      bookedForPhone: body.bookedForPhone,
      ctx: transitionCtx(req),
    });
    await services.audit.record(req.auditCtx(), { action: 'job.draft_created', entityType: 'job', entityId: job.id });
    return reply.code(201).send(await jobs.toJobView(job, langOf(req), { includeToken: true }));
  });

  // ---------------------------------------------------------------- read
  app.get('/me/jobs', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { scope, limit } = parse(ListQuery, req.query);
    const statuses = scope === 'active' ? ACTIVE : scope === 'past' ? PAST : undefined;
    const rows = await store.jobs.listForCustomer(auth.userId, { statuses, limit });
    const lang = langOf(req);
    return { items: await Promise.all(rows.map((j) => jobs.toListItem(j, lang))) };
  });

  app.get('/jobs/:id', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobs.ownedJob(id, auth.userId);
    return jobs.toJobView(job, langOf(req), { includeToken: true });
  });

  // ---------------------------------------------------------------- update draft
  app.patch('/jobs/:id', { preHandler: requireAction('job.create') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobs.ownedJob(id, auth.userId);
    const body = parse(JobUpdate, req.body);
    const updated = await jobs.updateDraft(job, body as Record<string, unknown>, auth.userId);
    return jobs.toJobView(updated, langOf(req), { includeToken: true });
  });

  // ---------------------------------------------------------------- media
  app.post('/jobs/:id/media', { preHandler: requireAction('job.create') }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobs.ownedJob(id, auth.userId);
    const body = parse(JobMediaCreate, req.body);
    const { media, target, uploadRequired } = await jobs.createMediaUpload(job, {
      kind: body.kind,
      mime: body.mime,
      sizeBytes: body.sizeBytes,
      durationSeconds: body.durationSeconds,
      sha256: body.sha256,
      lat: body.lat,
      lng: body.lng,
      uploaderId: auth.userId,
      uploaderRole: auth.activeRole,
    });
    const view = await jobs.toJobView(job, langOf(req), { includeToken: false });
    const mediaView = view.media.find((m) => m.id === media.id);
    return reply.code(201).send({
      media: mediaView ?? {
        id: media.id,
        kind: media.kind,
        phase: media.phase,
        mime: media.mime,
        sizeBytes: Number(media.size_bytes),
        durationSeconds: media.duration_seconds,
        url: '',
        uploadedByRole: media.uploader_role,
        createdAt: media.created_at.toISOString(),
      },
      upload: { url: target.url, method: target.method, expiresAt: target.expiresAt.toISOString(), required: uploadRequired },
    });
  });

  app.delete('/jobs/:id/media/:mediaId', { preHandler: requireAction('job.create') }, async (req) => {
    const auth = requireAuth(req);
    const { id, mediaId } = parse(MediaParam, req.params);
    const job = await jobs.ownedJob(id, auth.userId);
    await jobs.deleteMedia(job, mediaId, auth.userId);
    return { ok: true };
  });

  // ---------------------------------------------------------------- submit
  app.post('/jobs/:id/submit', { preHandler: requireAction('job.submit') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobs.ownedJob(id, auth.userId);
    const { job: submitted, duplicateOf } = await jobs.submit(job, transitionCtx(req));
    await services.audit.record(req.auditCtx(), { action: 'job.submitted', entityType: 'job', entityId: job.id });
    return { job: await jobs.toJobView(submitted, langOf(req), { includeToken: true }), duplicateOf };
  });

  // ---------------------------------------------------------------- reschedule
  /**
   * Moving a booking rather than cancelling it. Only the customer may - it is their time being
   * arranged - and the provider is told, because they blocked a slot for it.
   */
  app.post('/jobs/:id/reschedule', { preHandler: requireAction('job.reschedule') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(RescheduleBody, req.body);
    const job = await jobs.ownedJob(id, auth.userId);
    const result = await jobs.reschedule(job, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: 'job.rescheduled',
      entityType: 'job',
      entityId: job.id,
      reason: body.reason ?? null,
      before: { preferredStart: job.preferred_start?.toISOString() ?? null },
      after: { preferredStart: result.preferredStart },
    });
    return result;
  });

  // ---------------------------------------------------------------- a new time, suggested
  /**
   * The professional asking to move a visit. It is a request, not a change: the customer's time
   * is theirs to arrange, and nothing moves until they answer.
   */
  app.post('/jobs/:id/propose-time', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(ProposeTimeBody, req.body);
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');

    const proposal = await jobs.proposeTime(job, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: 'job.time_proposed',
      entityType: 'job',
      entityId: job.id,
      reason: body.reason,
      after: { newStart: body.newStart },
    });
    return reply.code(201).send({ proposal: toProposalView(proposal, auth.userId) });
  });

  app.get('/jobs/:id/time-proposal', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const proposal = await jobs.openProposal(id);
    return { proposal: proposal ? toProposalView(proposal, auth.userId) : null };
  });

  app.post('/time-proposals/:id/respond', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(RespondToProposalBody, req.body);
    const { proposal, job } = await jobs.respondToProposal(id, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: body.accept ? 'job.time_accepted' : 'job.time_declined',
      entityType: 'job',
      entityId: job.id,
      reason: body.reason ?? null,
      after: { preferredStart: job.preferred_start?.toISOString() ?? null },
    });
    return { proposal: toProposalView(proposal, auth.userId) };
  });

  app.post('/time-proposals/:id/withdraw', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const proposal = await jobs.withdrawProposal(id, auth.userId);
    return { proposal: toProposalView(proposal, auth.userId) };
  });

  // ---------------------------------------------------------------- cancel
  app.post('/jobs/:id/cancel', { preHandler: requireAction('job.cancel_as_customer') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { reason } = parse(JobCancelBody, req.body ?? {});
    const job = await jobs.ownedJob(id, auth.userId);
    // Cancelling is a money decision once a booking exists, so it goes through finance:
    // the policy charge is taken, the rest of the hold is released, and both are recorded.
    const { job: cancelled, chargePaise } = await services.finance.cancelWithMoney(job, auth.userId, reason, 'CUSTOMER', transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: 'job.cancelled',
      entityType: 'job',
      entityId: job.id,
      reason,
      after: { chargePaise },
    });
    return jobs.toJobView(cancelled, langOf(req), { includeToken: true });
  });

  /** The provider side backing out. Always free for the customer, always a strike. */
  app.post('/jobs/:id/cancel-as-provider', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { reason } = parse(JobCancelBody, req.body ?? {});
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    const assignment = await store.negotiation.getActiveAssignment(job.id);
    const onJob = [assignment?.provider_id, assignment?.technician_id].filter(Boolean).includes(auth.userId);
    if (!onJob) throw forbidden('not the assigned provider');

    const { job: cancelled } = await services.finance.cancelWithMoney(job, auth.userId, reason, 'PROVIDER', transitionCtx(req));
    await services.audit.record(req.auditCtx(), { action: 'job.cancelled_by_provider', entityType: 'job', entityId: job.id, reason });
    return { id: cancelled.id, status: cancelled.status };
  });

  // ---------------------------------------------------------------- public tracking link
  app.get('/track/:token', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(120) }), req.params);
    const job = await store.jobs.getByTrackingToken(token);
    if (!job) throw notFound('booking');
    const cats = await store.categories.listEnabled();
    const cat = cats.find((c) => c.id === job.category_id);
    const lang = langOf(req);

    let provider: JobTrackView['provider'] = null;
    if (job.confirmed_provider_id) {
      const profile = await store.users.getProviderProfile(job.confirmed_provider_id);
      provider = {
        businessName: profile?.business_name ?? null,
        technicianName: null, // filled in once technician assignment lands (M5)
        verified: profile?.verification_status === 'VERIFIED',
      };
    }
    // Deliberately minimal: no address, no phone numbers, no media (PRIVACY_DATA_MAP).
    const view: JobTrackView = {
      status: job.status,
      statusLabelKey: JOB_STATUS_LABEL_KEY[job.status],
      categoryName: cat ? (lang === 'hi' ? cat.name_hi : cat.name_en) : 'Service',
      bookedForName: job.booked_for_name,
      preferredStart: job.preferred_start?.toISOString() ?? null,
      provider,
      updatedAt: job.updated_at.toISOString(),
    };
    return view;
  });

  /** `mine` lets one shape serve both sides: the person who suggested it sees a different card. */
  function toProposalView(p: ScheduleProposalRecord, viewerId: string): ScheduleProposalView {
    return {
      id: p.id,
      jobId: p.job_id,
      previousStart: p.previous_start?.toISOString() ?? null,
      newStart: p.new_start.toISOString(),
      newEnd: p.new_end?.toISOString() ?? null,
      reason: p.reason,
      status: p.status,
      expiresAt: p.expires_at.toISOString(),
      mine: p.proposed_by === viewerId,
      createdAt: p.created_at.toISOString(),
    };
  }
}
