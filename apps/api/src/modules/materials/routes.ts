import type { FastifyInstance } from 'fastify';
import {
  MaterialConfirmBody,
  MaterialInvoiceBody,
  MaterialOrderStatusBody,
  MaterialQuoteBody,
  MaterialRequestBody,
} from '@hyperlocal/core';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });
const FeedQuery = z.object({ limit: z.coerce.number().int().min(1).max(30).default(15) });

export async function materialRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const materials = services.materials;

  async function jobOr404(id: string) {
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    return job;
  }

  // ---------------------------------------------------------------- provider side
  app.post('/jobs/:id/material-request', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(MaterialRequestBody, req.body);
    const job = await jobOr404(id);
    const request = await materials.createRequest(job, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: 'material.requested',
      entityType: 'material_request',
      entityId: request.id,
      after: { items: body.items.length },
    });
    return reply.code(201).send(materials.toRequestView(request, 0));
  });

  /** The whole material leg of a job, for whichever side is asking. */
  app.get('/jobs/:id/materials', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await jobOr404(id);
    return materials.panel(job, auth.userId);
  });

  // ---------------------------------------------------------------- vendor side
  app.get('/vendor/profile', async (req) => {
    const auth = requireAuth(req);
    const profile = await store.users.getVendorProfile(auth.userId);
    if (!profile) throw notFound('vendor profile');
    return {
      shopName: profile.shop_name,
      verified: profile.verification_status === 'VERIFIED',
      verificationStatus: profile.verification_status,
      deliveryAvailable: profile.delivery_available,
      deliveryRadiusKm: profile.delivery_radius_km,
      materialCategories: profile.material_categories,
    };
  });

  /** MAT-10: a shop that is closed stops receiving requests instead of ignoring them. */
  app.post('/vendor/availability', async (req) => {
    const auth = requireAuth(req);
    const body = parse(z.object({ deliveryAvailable: z.boolean() }).strict(), req.body);
    const profile = await store.users.getVendorProfile(auth.userId);
    if (!profile) throw notFound('vendor profile');
    if (body.deliveryAvailable && profile.verification_status !== 'VERIFIED') {
      throw new AppError('FORBIDDEN', { details: { reason: 'verification_pending' } });
    }
    const saved = await store.users.upsertVendorProfile({ ...profile, delivery_available: body.deliveryAvailable });
    await services.audit.record(req.auditCtx(), {
      action: 'vendor.availability',
      entityType: 'vendor_profile',
      entityId: auth.userId,
      after: { deliveryAvailable: saved.delivery_available },
    });
    return { deliveryAvailable: saved.delivery_available };
  });

  app.get('/vendor/material-requests', async (req) => {
    const auth = requireAuth(req);
    const { limit } = parse(FeedQuery, req.query);
    return materials.vendorFeed(auth.userId, limit);
  });

  app.post('/material-requests/:id/quote', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(MaterialQuoteBody, req.body);
    const request = await store.materials.getRequest(id);
    if (!request) throw notFound('material request');

    const quote = await materials.quote(request, auth.userId, {
      items: body.items.map((i) => ({ ...i, brand: i.brand ?? null })),
      deliveryPaise: body.deliveryPaise ?? 0,
      etaMinutes: body.etaMinutes,
      note: body.note,
    });
    await services.audit.record(req.auditCtx(), {
      action: 'material.quoted',
      entityType: 'material_quote',
      entityId: quote.id,
      after: { totalPaise: Number(quote.total_paise) },
    });
    const job = await jobOr404(request.job_id);
    return reply.code(201).send(await materials.toQuoteView(quote, job));
  });

  app.get('/vendor/material-orders', async (req) => {
    const auth = requireAuth(req);
    const { limit } = parse(FeedQuery, req.query);
    const orders = await store.materials.listOrdersForVendor(auth.userId, limit);
    return { items: await Promise.all(orders.map((o) => materials.toOrderView(o))) };
  });

  // ---------------------------------------------------------------- selection
  app.post('/material-quotes/:id/select', { preHandler: requireAction('job.read_own') }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const quote = await store.materials.getQuote(id);
    if (!quote) throw notFound('material quote');
    const request = await store.materials.getRequest(quote.request_id);
    if (!request) throw notFound('material request');
    const job = await jobOr404(request.job_id);

    const { order, payment } = await materials.select(job, id, auth.userId);
    await services.audit.record(req.auditCtx(), {
      action: 'material.selected',
      entityType: 'material_order',
      entityId: order.id,
      after: { totalPaise: Number(order.total_paise), vendorId: order.vendor_id },
    });
    return reply.code(201).send({
      order: await materials.toOrderView(order),
      payment: { id: payment.id, amountPaise: Number(payment.amount_paise), status: payment.status, purpose: payment.purpose },
    });
  });

  // ---------------------------------------------------------------- fulfilment
  app.post('/material-orders/:id/status', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(MaterialOrderStatusBody, req.body);
    const order = await store.materials.getOrder(id);
    if (!order) throw notFound('material order');

    const isAdmin = auth.activeRole === 'ADMIN' || auth.activeRole === 'SUPPORT';
    const moved = await materials.moveOrder(order, auth.userId, body.to, body.reason, isAdmin ? 'ADMIN' : 'VENDOR');
    await services.audit.record(req.auditCtx(), {
      action: `material.${body.to.toLowerCase()}`,
      entityType: 'material_order',
      entityId: order.id,
      reason: body.reason ?? null,
    });
    return materials.toOrderView(moved);
  });

  app.post('/material-orders/:id/confirm', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(MaterialConfirmBody, req.body);
    const order = await store.materials.getOrder(id);
    if (!order) throw notFound('material order');
    const job = await jobOr404(order.job_id);

    const result = await materials.confirmDelivery(order, job, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: body.ok ? 'material.confirmed' : 'material.issue_reported',
      entityType: 'material_order',
      entityId: order.id,
      after: body.ok ? null : { issue: body.issue },
    });
    return materials.toOrderView(result);
  });

  app.post('/material-orders/:id/invoice', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(MaterialInvoiceBody, req.body);
    const order = await store.materials.getOrder(id);
    if (!order) throw notFound('material order');

    const filed = await materials.fileInvoice(order, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: 'material.invoice_filed',
      entityType: 'material_order',
      entityId: order.id,
      after: { amountPaise: body.amountPaise, invoiceNumber: body.invoiceNumber ?? null },
    });
    return materials.toOrderView(filed);
  });
}
