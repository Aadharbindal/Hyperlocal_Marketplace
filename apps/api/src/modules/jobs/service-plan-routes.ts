import type { FastifyInstance } from 'fastify';
import {
  CreateServicePlanBody,
  SkipNextBody,
  UpdateServicePlanBody,
  describeInterval,
  startOfDay,
  type ServicePlanView,
} from '@hyperlocal/core';
import { AppError, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';
import type { ServicePlanRecord } from '../../data/types';

/**
 * Standing arrangements, from the customer's side.
 *
 * Everything here is the customer's own: nobody else creates, edits or cancels a plan, and a
 * plan carries no money, so there is no provider-facing surface at all. The professional finds
 * out the same way they find out about any other booking - the job opens and they can offer on
 * it - with one notification saying it is a customer they have worked for before.
 */
export async function servicePlanRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;

  const lang = (req: { headers: Record<string, unknown> }) => (req.headers['x-lang'] === 'hi' ? 'hi' : 'en');

  async function view(plan: ServicePlanRecord, language: 'en' | 'hi'): Promise<ServicePlanView> {
    const [categories, address, occurrences] = await Promise.all([
      store.categories.listEnabled(),
      store.addresses.get(plan.address_id),
      store.servicePlans.listOccurrences(plan.id, 6),
    ]);
    const category = categories.find((c) => c.id === plan.category_id);
    const profile = plan.preferred_provider_id ? await store.users.getProviderProfile(plan.preferred_provider_id) : null;
    const provider = plan.preferred_provider_id ? await store.users.findById(plan.preferred_provider_id) : null;

    return {
      id: plan.id,
      categoryId: plan.category_id,
      categoryName: category ? (language === 'hi' ? category.name_hi : category.name_en) : 'Service',
      iconKey: category?.icon_key ?? null,
      addressId: plan.address_id,
      addressLabel: address?.label ?? address?.line1 ?? null,
      description: plan.description,
      intervalDays: plan.interval_days,
      intervalLabel: describeInterval(plan.interval_days),
      nextDueOn: startOfDay(plan.next_due_on).toISOString().slice(0, 10),
      leadDays: plan.lead_days,
      status: plan.status,
      preferredProviderId: plan.preferred_provider_id,
      // A business name or a first name, as everywhere a counterparty is shown. Never a number.
      preferredProviderName: profile?.business_name ?? provider?.display_name?.split(' ')[0] ?? null,
      recent: occurrences.map((o) => ({
        dueOn: startOfDay(o.due_on).toISOString().slice(0, 10),
        jobId: o.job_id,
        outcome: o.outcome,
        detail: o.detail,
      })),
      createdAt: plan.created_at.toISOString(),
    };
  }

  async function ownedPlan(id: string, userId: string) {
    const plan = await store.servicePlans.get(id);
    if (!plan || plan.customer_id !== userId) throw notFound('plan');
    return plan;
  }

  app.get('/me/service-plans', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const plans = await store.servicePlans.listForCustomer(auth.userId);
    return { items: await Promise.all(plans.map((p) => view(p, lang(req)))) };
  });

  app.post('/me/service-plans', { preHandler: requireAction('job.create') }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(CreateServicePlanBody, req.body);

    // The address must be theirs and still exist - a plan pointed at somebody else's address
    // would book visits to it forever.
    const address = await store.addresses.get(body.addressId);
    if (!address || address.deleted_at || address.user_id !== auth.userId) throw notFound('address');

    const categories = await store.categories.listEnabled();
    if (!categories.some((c) => c.id === body.categoryId)) throw notFound('category');

    const firstDue = startOfDay(new Date(`${body.firstDueOn}T00:00:00Z`));
    if (Number.isNaN(firstDue.getTime())) throw new AppError('VALIDATION_ERROR', { details: { field: 'firstDueOn' } });
    // A first visit in the past would be opened by the very next sweep, which is never what
    // somebody setting up a repeat means.
    if (firstDue.getTime() < startOfDay(new Date()).getTime()) {
      throw new AppError('VALIDATION_ERROR', { details: { field: 'firstDueOn', reason: 'in_the_past' } });
    }

    const plan = await store.servicePlans.create({
      customer_id: auth.userId,
      category_id: body.categoryId,
      skill_ids: body.skillIds ?? [],
      address_id: body.addressId,
      description: body.description ?? null,
      interval_days: body.intervalDays,
      preferred_provider_id: body.preferredProviderId ?? null,
      next_due_on: firstDue,
      lead_days: body.leadDays ?? 3,
      status: 'ACTIVE',
      paused_reason: null,
      cancelled_at: null,
    });

    await services.audit.record(req.auditCtx(), {
      action: 'plan.created', entityType: 'service_plan', entityId: plan.id,
      after: { intervalDays: plan.interval_days, firstDueOn: body.firstDueOn },
    });
    return reply.code(201).send(await view(plan, lang(req)));
  });

  app.patch('/me/service-plans/:id', { preHandler: requireAction('job.create') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const plan = await ownedPlan(id, auth.userId);
    const body = parse(UpdateServicePlanBody, req.body);

    const patch: Partial<ServicePlanRecord> = {};
    if (body.intervalDays !== undefined) patch.interval_days = body.intervalDays;
    if (body.leadDays !== undefined) patch.lead_days = body.leadDays;
    if (body.description !== undefined) patch.description = body.description;
    if (body.preferredProviderId !== undefined) patch.preferred_provider_id = body.preferredProviderId;
    if (body.nextDueOn !== undefined) patch.next_due_on = startOfDay(new Date(`${body.nextDueOn}T00:00:00Z`));
    if (body.status !== undefined) {
      patch.status = body.status;
      // Cancelling is dated so the partial unique index lets a new plan be made for the same
      // work later, and so "when did this stop" has an answer.
      patch.cancelled_at = body.status === 'CANCELLED' ? new Date() : null;
    }

    const updated = await store.servicePlans.update(plan.id, patch);
    await services.audit.record(req.auditCtx(), { action: 'plan.updated', entityType: 'service_plan', entityId: plan.id, after: body });
    return view(updated, lang(req));
  });

  /**
   * Skip the next visit, keep the arrangement.
   *
   * Offered because the alternative people reach for is cancelling, and most of them never set
   * it up again.
   */
  app.post('/me/service-plans/:id/skip-next', { preHandler: requireAction('job.create') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const plan = await ownedPlan(id, auth.userId);
    const body = parse(SkipNextBody, req.body ?? {});
    if (plan.status === 'CANCELLED') throw new AppError('CONFLICT', { details: { reason: 'plan_cancelled' } });

    const updated = await services.servicePlans.skipNext(plan, body.reason, new Date());
    await services.audit.record(req.auditCtx(), { action: 'plan.skipped', entityType: 'service_plan', entityId: plan.id, reason: body.reason });
    return view(updated, lang(req));
  });
}
