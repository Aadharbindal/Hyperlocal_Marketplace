import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AvailabilityBody,
  BidCreate,
  BidRevise,
  BidWithdrawBody,
  KycSubmitBody,
  ProviderProfileUpdate,
  type Language,
} from '@hyperlocal/core';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });
const FeedQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

function langOf(req: FastifyRequest): Language {
  return req.auth?.user.preferred_language ?? (req.headers['accept-language']?.toString().startsWith('hi') ? 'hi' : 'en');
}

export async function providerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const provider = services.provider;
  const jobs = services.jobs;

  // ---------------------------------------------------------------- profile
  app.get('/provider/profile', { preHandler: requireAction('provider.profile.manage', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    return provider.toProfileView(auth.userId, langOf(req));
  });

  app.put('/provider/profile', { preHandler: requireAction('provider.profile.manage') }, async (req) => {
    const auth = requireAuth(req);
    const body = parse(ProviderProfileUpdate, req.body);
    await provider.updateProfile(auth.userId, body as Record<string, unknown>);
    await services.audit.record(req.auditCtx(), { action: 'provider.profile_updated', entityType: 'provider', entityId: auth.userId, after: body });
    return provider.toProfileView(auth.userId, langOf(req));
  });

  app.post('/provider/availability', { preHandler: requireAction('provider.profile.manage') }, async (req) => {
    const auth = requireAuth(req);
    const { isAvailable } = parse(AvailabilityBody, req.body);
    await provider.setAvailability(auth.userId, isAvailable);
    await services.audit.record(req.auditCtx(), { action: 'provider.availability_changed', entityType: 'provider', entityId: auth.userId, after: { isAvailable } });
    return { isAvailable };
  });

  // ---------------------------------------------------------------- KYC
  app.post('/provider/kyc', { preHandler: requireAction('provider.kyc.submit') }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(KycSubmitBody, req.body);
    const { record, upload, uploadRequired } = await provider.submitKyc(auth.userId, body);
    // The document number itself is never logged or stored - only the last four characters.
    await services.audit.record(req.auditCtx(), {
      action: 'kyc.submitted',
      entityType: 'kyc_record',
      entityId: record.id,
      after: { documentType: record.document_type, last4: record.doc_number_last4 },
    });
    return reply.code(201).send({
      kyc: { id: record.id, documentType: record.document_type, status: record.status, last4: record.doc_number_last4, submittedAt: record.created_at.toISOString() },
      upload: { url: upload.url, method: upload.method, expiresAt: upload.expiresAt.toISOString(), required: uploadRequired },
    });
  });

  // ---------------------------------------------------------------- nearby feed
  app.get('/provider/jobs/nearby', { preHandler: requireAction('job.feed.read') }, async (req) => {
    const auth = requireAuth(req);
    const { limit } = parse(FeedQuery, req.query);
    return provider.nearbyFeed(auth.userId, langOf(req), limit);
  });

  // ---------------------------------------------------------------- bids
  app.post('/jobs/:id/bids', { preHandler: requireAction('bid.create') }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(BidCreate, req.body);
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');

    const bid = await provider.placeBid(job, auth.userId, {
      labourPaise: body.labourPaise,
      visitFeePaise: body.visitFeePaise,
      etaMinutes: body.etaMinutes,
      warrantyDays: body.warrantyDays,
      materialResponsibility: body.materialResponsibility,
      notes: body.notes,
    });

    // The first live offer moves the job forward so the customer sees "Offers received".
    if (job.status === 'OPEN_FOR_BIDS') {
      await jobs.transition(job, 'BID_RECEIVED', {
        actorUserId: auth.userId,
        actorRole: auth.activeRole,
        actor: auth.activeRole,
        requestId: req.id,
      }, { reason: 'First offer received' });
    }

    await store.notifications.create({
      user_id: job.customer_id,
      type: 'job.offer_received',
      title: 'New offer received',
      body: 'A verified professional has sent you an offer.',
      data: { jobId: job.id },
      channel: 'IN_APP',
      read_at: null,
      sent_at: new Date(),
    });
    await services.audit.record(req.auditCtx(), { action: 'bid.created', entityType: 'bid', entityId: bid.id });
    return reply.code(201).send(provider.toBidView(bid));
  });

  app.post('/bids/:id/revise', { preHandler: requireAction('bid.revise') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(BidRevise, req.body);
    const bid = await store.bids.get(id);
    if (!bid) throw notFound('offer');
    if (bid.provider_id !== auth.userId) throw forbidden('not your offer');
    const job = await store.jobs.get(bid.job_id);
    if (!job) throw notFound('job');

    const updated = await provider.reviseBid(bid, job, {
      labourPaise: body.labourPaise,
      visitFeePaise: body.visitFeePaise,
      etaMinutes: body.etaMinutes,
      warrantyDays: body.warrantyDays,
      materialResponsibility: body.materialResponsibility,
      notes: body.notes,
    });
    await services.audit.record(req.auditCtx(), { action: 'bid.revised', entityType: 'bid', entityId: bid.id, after: { revisionNo: updated.revision_no } });
    return provider.toBidView(updated);
  });

  app.post('/bids/:id/withdraw', { preHandler: requireAction('bid.withdraw') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { reason } = parse(BidWithdrawBody, req.body ?? {});
    const bid = await store.bids.get(id);
    if (!bid) throw notFound('offer');
    if (bid.provider_id !== auth.userId) throw forbidden('not your offer');
    const updated = await provider.withdrawBid(bid, reason);
    await services.audit.record(req.auditCtx(), { action: 'bid.withdrawn', entityType: 'bid', entityId: bid.id, reason });
    return provider.toBidView(updated);
  });

  app.get('/provider/bids', { preHandler: requireAction('job.feed.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const lang = langOf(req);
    const bids = await store.bids.listForProvider(auth.userId);
    const cats = await store.categories.listEnabled();
    const items = await Promise.all(
      bids.map(async (b) => {
        const job = await store.jobs.get(b.job_id);
        const cat = cats.find((c) => c.id === job?.category_id);
        const snap = job?.address_snapshot as { societyName?: string | null; city?: string } | null;
        return {
          ...provider.toBidView(b),
          job: {
            id: b.job_id,
            status: job?.status ?? 'ABANDONED',
            categoryName: cat ? (lang === 'hi' ? cat.name_hi : cat.name_en) : 'Service',
            categoryIconKey: cat?.icon_key ?? 'default',
            description: job?.description ?? null,
            areaLabel: snap?.societyName ?? snap?.city ?? 'Nearby',
            priority: job?.priority ?? 'NORMAL',
          },
        };
      }),
    );
    return { items };
  });

  // ---------------------------------------------------------------- customer side: offers
  app.get('/jobs/:id/offers', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobs.ownedJob(id, auth.userId);
    return { items: await provider.offersForCustomer(job) };
  });
}
