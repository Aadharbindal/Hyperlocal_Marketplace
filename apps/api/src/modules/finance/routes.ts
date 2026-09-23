import type { FastifyInstance } from 'fastify';
import {
  DisputeEvidenceBody,
  RaiseDisputeBody,
  ResolveDisputeBody,
  ReviewBody,
} from '@hyperlocal/core';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';
import type { TransitionContext } from '../jobs/service';

const IdParam = z.object({ id: z.string().uuid() });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function financeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const finance = services.finance;

  const transitionCtx = (req: Parameters<typeof requireAuth>[0]): TransitionContext => {
    const auth = requireAuth(req);
    return { actorUserId: auth.userId, actorRole: auth.activeRole, actor: auth.activeRole, requestId: req.id };
  };

  async function jobOr404(id: string) {
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    return job;
  }

  function requireAdmin(req: Parameters<typeof requireAuth>[0]) {
    const auth = requireAuth(req);
    if (auth.activeRole !== 'ADMIN' && auth.activeRole !== 'SUPPORT') throw forbidden('admin only');
    return auth;
  }

  // ---------------------------------------------------------------- money on a job
  app.get('/jobs/:id/money', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    return finance.jobMoney(await jobOr404(id), auth.userId);
  });

  /** What cancelling right now would cost, shown before the customer commits to it. */
  app.get('/jobs/:id/cancellation-quote', { preHandler: requireAction('job.read_own') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobOr404(id);
    if (job.customer_id !== auth.userId) throw forbidden('not your job');
    return finance.cancellationQuote(job);
  });

  // ---------------------------------------------------------------- earnings
  app.get('/me/earnings', async (req) => {
    const auth = requireAuth(req);
    return finance.earnings(auth.userId);
  });

  // ---------------------------------------------------------------- disputes
  app.post('/jobs/:id/dispute', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(RaiseDisputeBody, req.body);
    const job = await jobOr404(id);
    const dispute = await finance.raiseDispute(job, auth.userId, body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: 'dispute.raised',
      entityType: 'dispute',
      entityId: dispute.id,
      after: { category: body.category },
    });
    return reply.code(201).send(await finance.toDisputeView(dispute, auth.userId));
  });

  app.get('/jobs/:id/disputes', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobOr404(id);
    const assignment = await store.negotiation.getActiveAssignment(job.id);
    const onJob = job.customer_id === auth.userId || [assignment?.provider_id, assignment?.technician_id].filter(Boolean).includes(auth.userId);
    if (!onJob) throw forbidden('not on this job');
    const items = await store.finance.listDisputesForJob(job.id);
    return { items: await Promise.all(items.map((dpt) => finance.toDisputeView(dpt, auth.userId))) };
  });

  app.post('/disputes/:id/evidence', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(DisputeEvidenceBody, req.body);
    const dispute = await store.finance.getDispute(id);
    if (!dispute) throw notFound('dispute');
    await finance.addDisputeEvidence(dispute, auth.userId, body.mediaIds, body.note);
    return reply.code(201).send(await finance.toDisputeView((await store.finance.getDispute(id))!, auth.userId));
  });

  /** Support's queue and decision. The admin console that drives this lands in M8. */
  app.get('/admin/disputes', async (req) => {
    requireAdmin(req);
    const { limit } = parse(LimitQuery, req.query);
    const items = await store.finance.listDisputesByStatus(['OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED', 'REOPENED'], limit);
    const auth = requireAuth(req);
    return { items: await Promise.all(items.map((dpt) => finance.toDisputeView(dpt, auth.userId))) };
  });

  app.post('/admin/disputes/:id/resolve', async (req) => {
    const auth = requireAdmin(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(ResolveDisputeBody, req.body);
    const dispute = await store.finance.getDispute(id);
    if (!dispute) throw notFound('dispute');

    const resolved = await finance.resolveDispute(dispute, auth.userId, body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), {
      action: 'dispute.resolved',
      entityType: 'dispute',
      entityId: dispute.id,
      reason: body.reason,
      after: { resolution: body.resolution, refundPaise: resolved.refund_paise, secondApproverId: body.secondApproverId ?? null },
    });
    return finance.toDisputeView(resolved, auth.userId);
  });

  // ---------------------------------------------------------------- reviews
  app.post('/jobs/:id/review', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(ReviewBody, req.body);
    const job = await jobOr404(id);
    const review = await finance.review(job, auth.userId, body);
    return reply.code(201).send({
      id: review.id,
      jobId: review.job_id,
      rating: review.rating,
      comment: review.comment,
      reviewerName: 'You',
      createdAt: review.created_at.toISOString(),
    });
  });

  app.get('/providers/:id/reviews', async (req) => {
    const { id } = parse(IdParam, req.params);
    const { limit } = parse(LimitQuery, req.query);
    const items = await store.finance.listReviewsFor(id, limit);
    const names = new Map<string, string>();
    for (const r of items) {
      if (!names.has(r.reviewer_id)) {
        const u = await store.users.findById(r.reviewer_id);
        // Reviews are public, so only a first name is ever shown.
        names.set(r.reviewer_id, (u?.display_name ?? 'Customer').split(' ')[0] ?? 'Customer');
      }
    }
    return {
      items: items.map((r) => ({
        id: r.id,
        jobId: r.job_id,
        rating: r.rating,
        comment: r.comment,
        reviewerName: names.get(r.reviewer_id) ?? 'Customer',
        createdAt: r.created_at.toISOString(),
      })),
    };
  });

  // ---------------------------------------------------------------- settlements
  /**
   * Sends out what is due. There is no scheduler yet (M9), so support runs it; the hold window
   * and every other guard still apply, which is why this is safe to call repeatedly.
   */
  app.post('/admin/settlements/run', async (req) => {
    const auth = requireAdmin(req);
    const { limit } = parse(LimitQuery, req.query);
    const results = await finance.runSettlements(limit, auth.userId);
    await services.audit.record(req.auditCtx(), {
      action: 'settlements.run',
      entityType: 'settlement',
      after: { processed: results.length, paid: results.filter((r) => r.status === 'PAID').length },
    });
    return { results };
  });

  app.get('/admin/settlements', async (req) => {
    requireAdmin(req);
    const q = parse(LimitQuery.extend({ status: z.enum(['PENDING', 'INITIATED', 'PAID', 'FAILED', 'ON_HOLD']).default('PENDING') }), req.query);
    const items = await store.finance.listSettlementsByStatus(q.status, q.limit);
    return {
      items: items.map((s) => ({
        id: s.id,
        jobId: s.job_id,
        payeeId: s.payee_id,
        payeeRole: s.payee_role,
        amountPaise: Number(s.amount_paise),
        status: s.status,
        attempts: s.attempts,
        failureReason: s.failure_reason,
        createdAt: s.created_at.toISOString(),
      })),
    };
  });

  /** A refund outside a dispute: support only, always with a reason, always to the ledger. */
  app.post('/admin/jobs/:id/refund', async (req) => {
    const auth = requireAdmin(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(
      z.object({ amountPaise: z.number().int().positive(), reason: z.string().trim().min(10).max(500) }).strict(),
      req.body,
    );
    const job = await jobOr404(id);
    const refund = await finance.refund(job, body.amountPaise, body.reason, { requestedBy: auth.userId });
    await services.audit.record(req.auditCtx(), {
      action: 'refund.issued',
      entityType: 'refund',
      entityId: refund.id,
      reason: body.reason,
      after: { amountPaise: body.amountPaise },
    });
    return { id: refund.id, amountPaise: Number(refund.amount_paise), status: refund.status };
  });

  // ---------------------------------------------------------------- ledger (support only)
  app.get('/admin/jobs/:id/ledger', async (req) => {
    requireAdmin(req);
    const { id } = parse(IdParam, req.params);
    const entries = await store.finance.listLedgerForJob(id);
    return {
      items: entries.map((e) => ({
        id: e.id,
        jobId: e.job_id,
        entryType: e.entry_type,
        accountUserId: e.account_user_id,
        amountPaise: Number(e.amount_paise),
        batchId: e.batch_id,
        note: e.note,
        createdAt: e.created_at.toISOString(),
      })),
      // A job's entries must net to what the platform still holds for it.
      netPaise: entries.reduce((t, e) => t + Number(e.amount_paise), 0),
    };
  });

  // ---------------------------------------------------------------- support tickets
  app.post('/support/tickets', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(
      z
        .object({
          category: z.string().trim().min(2).max(40),
          subject: z.string().trim().min(3).max(120),
          body: z.string().trim().min(10).max(2000),
          jobId: z.string().uuid().optional(),
        })
        .strict(),
      req.body,
    );
    const ticket = await store.finance.createTicket({
      opened_by: auth.userId,
      job_id: body.jobId ?? null,
      dispute_id: null,
      category: body.category,
      subject: body.subject,
      body: body.body,
      status: 'OPEN',
      assigned_to: null,
      priority: 3,
      closed_at: null,
    });
    return reply.code(201).send({ id: ticket.id, status: ticket.status, createdAt: ticket.created_at.toISOString() });
  });

  app.get('/support/tickets', async (req) => {
    const auth = requireAuth(req);
    const { limit } = parse(LimitQuery, req.query);
    const isAdmin = auth.activeRole === 'ADMIN' || auth.activeRole === 'SUPPORT';
    const items = await store.finance.listTickets(isAdmin ? { limit } : { openedBy: auth.userId, limit });
    return {
      items: items.map((t) => ({
        id: t.id,
        subject: t.subject,
        category: t.category,
        status: t.status,
        jobId: t.job_id,
        createdAt: t.created_at.toISOString(),
      })),
    };
  });
}
