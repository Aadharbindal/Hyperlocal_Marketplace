import type { FastifyInstance } from 'fastify';
import {
  AdminPromoBody,
  ClaimReferralBody,
  FavouriteBody,
  RebookBody,
} from '@hyperlocal/core';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });
const PromoQuery = z.object({ code: z.string().trim().min(3).max(24), orderPaise: z.coerce.number().int().positive() });

export async function growthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const growth = services.growth;

  async function ownedJob(id: string, customerId: string) {
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    if (job.customer_id !== customerId) throw forbidden('not your booking');
    return job;
  }

  // ---------------------------------------------------------------- receipts
  /**
   * The bill for one booking. Issued automatically when the money is captured, so by the time
   * anybody asks for it, it already exists.
   */
  app.get('/jobs/:id/invoice', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    return { invoice: await growth.invoiceFor(job, auth.userId) };
  });

  app.get('/me/invoices', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    return { items: await growth.listInvoices(auth.userId) };
  });

  // ---------------------------------------------------------------- favourites
  /**
   * Professionals worth asking for again. The note is the customer's own reminder and is never
   * shown to the provider: it is a note to self, not a review.
   */
  app.get('/me/favourites', { preHandler: requireAction('me.read') }, async (req) => {
    const auth = requireAuth(req);
    return { items: await growth.listFavourites(auth.userId) };
  });

  app.post('/providers/:id/favourite', { preHandler: requireAction('me.update') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { note } = parse(FavouriteBody, req.body ?? {});
    return { items: await growth.addFavourite(auth.userId, id, note) };
  });

  app.delete('/providers/:id/favourite', { preHandler: requireAction('me.update') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    return { items: await growth.removeFavourite(auth.userId, id) };
  });

  /**
   * Booking the same thing again. The category and address come from the earlier job, so a
   * repeat customer answers nothing they have already answered.
   *
   * `preferProviderId` is a preference, not an assignment: the job still opens for bids, and the
   * preferred professional is simply told about it first. Quietly assigning somebody would
   * remove the customer's chance to compare, which is the thing the marketplace is for.
   */
  app.post('/jobs/:id/rebook', { preHandler: requireAction('job.create') }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(RebookBody, req.body ?? {});
    const previous = await ownedJob(id, auth.userId);

    const draft = await services.jobs.createDraft({
      customerId: auth.userId,
      categoryId: previous.category_id,
      skillIds: previous.skill_ids,
      description: body.description ?? previous.description ?? undefined,
      priority: previous.priority,
      requestType: previous.request_type,
      inspectionRequired: previous.inspection_required,
      addressId: previous.address_id ?? undefined,
      preferredStart: body.preferredStart,
      ctx: { actorUserId: auth.userId, actorRole: auth.activeRole, actor: auth.activeRole, requestId: req.id },
    });

    if (body.preferProviderId) {
      await store.notifications.create({
        user_id: body.preferProviderId,
        type: 'bid.invited',
        title: 'A customer asked for you again',
        body: 'Someone you have worked for has posted a new job. Send them an offer.',
        data: { jobId: draft.id },
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
    }

    await services.audit.record(req.auditCtx(), {
      action: 'job.rebooked',
      entityType: 'job',
      entityId: draft.id,
      after: { from: previous.id, preferProviderId: body.preferProviderId ?? null },
    });
    return reply.code(201).send({ job: await services.jobs.toJobView(draft, 'en', { includeToken: true }) });
  });

  // ---------------------------------------------------------------- promo codes
  /** What a code would take off, before anybody commits to it. */
  app.get('/promo/preview', { preHandler: requireAction('me.read') }, async (req) => {
    const auth = requireAuth(req);
    const { code, orderPaise } = parse(PromoQuery, req.query);
    return { promo: await growth.previewPromo(auth.userId, code, orderPaise) };
  });

  // ---------------------------------------------------------------- referrals
  app.get('/me/referrals', { preHandler: requireAction('me.read') }, async (req) => {
    const auth = requireAuth(req);
    return await growth.referralSummary(auth.user);
  });

  app.post('/me/referrals/claim', { preHandler: requireAction('me.update') }, async (req) => {
    const auth = requireAuth(req);
    const { code } = parse(ClaimReferralBody, req.body);
    return await growth.claimReferral(auth.user, code);
  });

  // ---------------------------------------------------------------- admin
  app.get('/admin/promos', async (req) => {
    requireStaff(req);
    const rows = await store.growth.listPromos(100);
    return {
      items: rows.map((p) => ({
        id: p.id,
        code: p.code,
        kind: p.kind,
        value: p.value,
        minOrderPaise: Number(p.min_order_paise),
        maxDiscountPaise: p.max_discount_paise === null ? null : Number(p.max_discount_paise),
        redemptionCount: p.redemption_count,
        maxRedemptions: p.max_redemptions,
        firstJobOnly: p.first_job_only,
        active: p.active,
        endsAt: p.ends_at?.toISOString() ?? null,
      })),
    };
  });

  app.post('/admin/promos', async (req, reply) => {
    const auth = requireStaff(req);
    const body = parse(AdminPromoBody, req.body);
    const promo = await store.growth.createPromo({
      code: body.code.toUpperCase(),
      kind: body.kind,
      value: body.value,
      max_discount_paise: body.maxDiscountPaise ?? null,
      min_order_paise: body.minOrderPaise,
      // A discount is the platform's cost, never the provider's. The column only accepts this.
      funded_by: 'PLATFORM',
      starts_at: body.startsAt ? new Date(body.startsAt) : new Date(),
      ends_at: body.endsAt ? new Date(body.endsAt) : null,
      max_redemptions: body.maxRedemptions ?? null,
      max_per_customer: body.maxPerCustomer,
      first_job_only: body.firstJobOnly,
      redemption_count: 0,
      active: true,
      // A campaign code is for everybody; reserved ones are issued by the referral path.
      reserved_for_user_id: null,
      referral_id: null,
      created_by: auth.userId,
    });
    await services.audit.record(req.auditCtx(), {
      action: 'promo.created',
      entityType: 'promo_code',
      entityId: promo.id,
      after: { code: promo.code, kind: promo.kind, value: promo.value },
    });
    return reply.code(201).send({ promo: { id: promo.id, code: promo.code } });
  });

  /** Stopping a code. Existing bookings keep the discount they were given. */
  app.post('/admin/promos/:id/deactivate', async (req) => {
    requireStaff(req);
    const { id } = parse(IdParam, req.params);
    const promo = await store.growth.updatePromo(id, { active: false });
    await services.audit.record(req.auditCtx(), {
      action: 'promo.deactivated',
      entityType: 'promo_code',
      entityId: id,
      after: { code: promo.code },
    });
    return { ok: true };
  });

  function requireStaff(req: Parameters<typeof requireAuth>[0]) {
    const auth = requireAuth(req);
    if (auth.activeRole !== 'ADMIN' && auth.activeRole !== 'SUPPORT') throw forbidden('admin only');
    return auth;
  }
}
