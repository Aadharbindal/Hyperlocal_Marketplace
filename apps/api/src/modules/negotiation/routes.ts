import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CounterOfferBody, OfferRespondBody, PaymentWebhookBody } from '@hyperlocal/core';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';
import type { TransitionContext } from '../jobs/service';

const IdParam = z.object({ id: z.string().uuid() });

export async function negotiationRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services, adapters, env } = ctx;
  const negotiation = services.negotiation;
  const jobs = services.jobs;

  const transitionCtx = (req: Parameters<typeof requireAuth>[0]): TransitionContext => {
    const auth = requireAuth(req);
    return { actorUserId: auth.userId, actorRole: auth.activeRole, actor: auth.activeRole, requestId: req.id };
  };

  // ---------------------------------------------------------------- counter-offer
  app.post('/jobs/:id/counter-offer', { preHandler: requireAction('job.read_own') }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(CounterOfferBody, req.body);
    const job = await jobs.ownedJob(id, auth.userId);
    const bid = await store.bids.get(body.bidId);
    if (!bid || bid.job_id !== job.id) throw notFound('offer');

    const offer = await negotiation.counter(job, bid, auth.userId, body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), { action: 'offer.countered', entityType: 'offer', entityId: offer.id });
    return reply.code(201).send(negotiation.toOfferView(offer, auth.userId));
  });

  // ---------------------------------------------------------------- respond to an offer
  app.post('/offers/:id/respond', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(OfferRespondBody, req.body);
    const offer = await store.negotiation.getOffer(id);
    if (!offer) throw notFound('offer');
    // Only the two parties on this thread may answer it.
    if (offer.receiver_id !== auth.userId && offer.sender_id !== auth.userId) throw forbidden('not your negotiation');

    const result = await negotiation.respond(offer, auth.userId, body.action, body, transitionCtx(req));
    await services.audit.record(req.auditCtx(), { action: `offer.${body.action.toLowerCase()}`, entityType: 'offer', entityId: offer.id });
    return negotiation.toOfferView(result.offer, auth.userId);
  });

  app.get('/jobs/:id/offer-chain', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    // Customers see the whole job; a provider sees only their own thread.
    const mine = job.customer_id === auth.userId;
    const all = await store.negotiation.listOffersForJob(id);
    const visible = mine ? all : all.filter((o) => o.sender_id === auth.userId || o.receiver_id === auth.userId);
    if (!mine && visible.length === 0) throw forbidden('not your negotiation');
    return { items: visible.map((o) => negotiation.toOfferView(o, auth.userId)) };
  });

  // ---------------------------------------------------------------- accept and confirm
  app.post('/bids/:id/accept', { preHandler: requireAction('job.cancel_as_customer') }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const bid = await store.bids.get(id);
    if (!bid) throw notFound('offer');
    const job = await jobs.ownedJob(bid.job_id, auth.userId);

    const key = typeof req.headers['idempotency-key'] === 'string' ? `booking:${job.id}:${req.headers['idempotency-key']}` : undefined;
    const { quote, payment } = await negotiation.accept(job, bid, auth.userId, transitionCtx(req), key);
    await services.audit.record(req.auditCtx(), {
      action: 'bid.accepted',
      entityType: 'job',
      entityId: job.id,
      after: { bidId: bid.id, quoteId: quote.id, totalPaise: Number(quote.total_paise) },
    });
    return {
      quote: await negotiation.toQuoteView(quote),
      payment: negotiation.toPaymentView(payment),
      jobStatus: 'PAYMENT_PENDING',
    };
  });

  app.get('/jobs/:id/booking', { preHandler: requireAction('job.read_own', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const job = await store.jobs.get(id);
    if (!job) throw notFound('job');
    const isCustomer = job.customer_id === auth.userId;
    const assignment = await store.negotiation.getActiveAssignment(id);
    const isProvider = assignment?.provider_id === auth.userId;
    if (!isCustomer && !isProvider) throw forbidden('not your booking');

    const [quote, payments] = await Promise.all([store.negotiation.getActiveQuote(id), store.payments.listForJob(id)]);
    return {
      quote: quote ? await negotiation.toQuoteView(quote) : null,
      assignment: assignment ? await negotiation.toAssignmentView(assignment) : null,
      // The provider never needs the customer's payment records.
      payments: isCustomer ? payments.map(negotiation.toPaymentView) : [],
    };
  });

  /**
   * Demo-only helper: the mock gateway has no checkout sheet, so the app asks the server to
   * emit the event a real gateway would send. Refused unless the payment adapter is the mock.
   */
  app.post('/payments/:id/mock-complete', { preHandler: requireAction('job.cancel_as_customer') }, async (req) => {
    if (!adapters.payment.isMock) throw new AppError('FORBIDDEN', { details: { reason: 'mock_only' } });
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const { outcome } = parse(z.object({ outcome: z.enum(['authorized', 'failed']).default('authorized') }), req.body ?? {});
    const payment = await store.payments.get(id);
    if (!payment) throw notFound('payment');
    if (payment.payer_id !== auth.userId) throw forbidden('not your payment');

    const body = negotiation.mockCheckoutPayload(payment, outcome);
    const result = await negotiation.applyPaymentEvent({ ...body, signatureValid: true, requestId: req.id });
    return { ok: true, replayed: result.replayed, payment: result.payment ? negotiation.toPaymentView(result.payment) : null };
  });

  // ---------------------------------------------------------------- gateway webhook
  app.post('/payments/webhook', async (req, reply) => {
    // Signature first: an unsigned body is never parsed into business state.
    const signature = req.headers['x-payment-signature'];
    const raw = JSON.stringify(req.body ?? {});
    const secret = env.PAYMENT_WEBHOOK_SECRET ?? 'mock-webhook-secret';
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const valid = typeof signature === 'string' && signature === expected;
    if (!valid) {
      req.log.warn({ requestId: req.id }, 'rejected payment webhook with an invalid signature');
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid signature', requestId: req.id } });
    }

    const body = parse(PaymentWebhookBody, req.body);
    const result = await negotiation.applyPaymentEvent({ ...body, signatureValid: true, requestId: req.id });
    // Always 200 on a replay so the gateway stops retrying (PAYMENT_FLOW section 7).
    return { ok: true, replayed: result.replayed };
  });
}
