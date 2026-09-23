import {
  DEFAULT_FEE_POLICY,
  checkCanAccept,
  checkCanRespond,
  computeQuote,
  counterOfferExpiry,
  counterparty,
  type AssignmentView,
  type BookingQuoteView,
  type JobStatus,
  type OfferChainItem,
  type PaymentView,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type {
  AssignmentRecord,
  BidRecord,
  BookingQuoteRecord,
  DataStore,
  JobRecord,
  OfferRecord,
  PaymentRecord,
} from '../../data/types';
import { newId } from '../../lib/crypto';
import { AppError, notFound } from '../../lib/errors';
import type { JobService, TransitionContext } from '../jobs/service';

export interface NegotiationDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  jobs: JobService;
}

/** Job statuses in which the two sides may still move the terms. */
const NEGOTIABLE: JobStatus[] = ['BID_RECEIVED', 'NEGOTIATING'];
/** Job statuses from which an offer can be accepted outright. */
const ACCEPTABLE: JobStatus[] = ['BID_RECEIVED', 'NEGOTIATING'];

export function negotiationService(d: NegotiationDeps) {
  const { store, adapters, jobs } = d;

  function quoteFor(terms: { labour_paise: number; visit_fee_paise: number }) {
    return computeQuote(
      { labourPaise: Number(terms.labour_paise), visitFeePaise: Number(terms.visit_fee_paise) },
      DEFAULT_FEE_POLICY,
    );
  }

  function toOfferView(o: OfferRecord, viewerId: string): OfferChainItem {
    const q = quoteFor(o);
    return {
      id: o.id,
      parentOfferId: o.parent_offer_id,
      bidId: o.bid_id,
      senderParty: o.sender_party,
      labourPaise: Number(o.labour_paise),
      visitFeePaise: Number(o.visit_fee_paise),
      totalPaise: q.totalPaise,
      etaMinutes: o.eta_minutes,
      warrantyDays: o.warranty_days,
      materialResponsibility: o.material_responsibility,
      scopeNotes: o.scope_notes,
      status: o.status,
      expiresAt: o.expires_at.toISOString(),
      awaitingYou: o.status === 'PENDING' && o.receiver_id === viewerId,
      createdAt: o.created_at.toISOString(),
      respondedAt: o.responded_at?.toISOString() ?? null,
    };
  }

  async function toQuoteView(q: BookingQuoteRecord): Promise<BookingQuoteView> {
    const profile = await store.users.getProviderProfile(q.provider_id);
    return {
      id: q.id,
      jobId: q.job_id,
      providerId: q.provider_id,
      providerBusinessName: profile?.business_name ?? null,
      labourPaise: Number(q.labour_paise),
      visitFeePaise: Number(q.visit_fee_paise),
      materialEstimatePaise: Number(q.material_estimate_paise),
      platformFeePaise: Number(q.platform_fee_paise),
      protectionFeePaise: Number(q.protection_fee_paise),
      taxPaise: Number(q.tax_paise),
      totalPaise: Number(q.total_paise),
      providerPayablePaise: Number(q.provider_payable_paise),
      warrantyDays: q.warranty_days,
      etaMinutes: q.eta_minutes,
      materialResponsibility: q.material_responsibility,
      status: q.status,
      lockedAt: q.locked_at.toISOString(),
    };
  }

  function toPaymentView(p: PaymentRecord): PaymentView {
    return {
      id: p.id,
      jobId: p.job_id,
      purpose: p.purpose,
      amountPaise: Number(p.amount_paise),
      currency: 'INR',
      status: p.status,
      providerOrderId: p.provider_order_id,
      provider: p.provider,
      createdAt: p.created_at.toISOString(),
    };
  }

  async function toAssignmentView(a: AssignmentRecord): Promise<AssignmentView> {
    const [profile, technician] = await Promise.all([
      store.users.getProviderProfile(a.provider_id),
      a.technician_id ? store.users.findById(a.technician_id) : Promise.resolve(null),
    ]);
    return {
      id: a.id,
      providerId: a.provider_id,
      providerBusinessName: profile?.business_name ?? null,
      providerVerified: profile?.verification_status === 'VERIFIED',
      technicianId: a.technician_id,
      technicianName: technician?.display_name ?? null,
      status: a.status,
      createdAt: a.created_at.toISOString(),
    };
  }

  /** The live terms for a bid: the newest accepted/pending offer, else the bid itself. */
  async function currentTerms(bid: BidRecord) {
    const offers = await store.negotiation.listOffersForBid(bid.id);
    const latest = [...offers].reverse().find((o) => o.status === 'PENDING' || o.status === 'ACCEPTED');
    if (!latest) {
      return {
        labour_paise: Number(bid.labour_paise),
        visit_fee_paise: Number(bid.visit_fee_paise),
        eta_minutes: bid.eta_minutes,
        warranty_days: bid.warranty_days,
        material_responsibility: bid.material_responsibility,
        offerId: null as string | null,
      };
    }
    return {
      labour_paise: Number(latest.labour_paise),
      visit_fee_paise: Number(latest.visit_fee_paise),
      eta_minutes: latest.eta_minutes,
      warranty_days: latest.warranty_days,
      material_responsibility: latest.material_responsibility,
      offerId: latest.id,
    };
  }

  return {
    toOfferView,
    toQuoteView,
    toPaymentView,
    toAssignmentView,
    currentTerms,

    /** The customer counters a provider's offer. */
    async counter(
      job: JobRecord,
      bid: BidRecord,
      customerId: string,
      terms: { labourPaise: number; visitFeePaise?: number; etaMinutes?: number; warrantyDays?: number; materialResponsibility?: BidRecord['material_responsibility']; scopeNotes?: string },
      ctx: TransitionContext,
    ) {
      if (!NEGOTIABLE.includes(job.status)) {
        throw new AppError('CONFLICT', { details: { reason: 'job_not_negotiable', status: job.status } });
      }
      if (bid.status !== 'ACTIVE') throw new AppError('CONFLICT', { details: { reason: 'bid_not_active' } });

      const existing = await store.negotiation.findPendingForBid(bid.id);
      if (existing) throw new AppError('CONFLICT', { details: { reason: 'offer_already_pending', offerId: existing.id } });

      const chain = await store.negotiation.listOffersForBid(bid.id);
      const base = await currentTerms(bid);
      const offer = await store.negotiation.createOffer({
        job_id: job.id,
        bid_id: bid.id,
        parent_offer_id: chain[chain.length - 1]?.id ?? null,
        sender_id: customerId,
        sender_party: 'CUSTOMER',
        receiver_id: bid.provider_id,
        labour_paise: terms.labourPaise,
        visit_fee_paise: terms.visitFeePaise ?? base.visit_fee_paise,
        eta_minutes: terms.etaMinutes ?? base.eta_minutes,
        warranty_days: terms.warrantyDays ?? base.warranty_days,
        material_responsibility: terms.materialResponsibility ?? base.material_responsibility,
        scope_notes: terms.scopeNotes ?? null,
        status: 'PENDING',
        expires_at: counterOfferExpiry(),
        responded_at: null,
      });

      if (job.status === 'BID_RECEIVED') {
        await jobs.transition(job, 'NEGOTIATING', ctx, { reason: 'Counter-offer sent' });
      }
      await store.notifications.create({
        user_id: bid.provider_id,
        type: 'offer.countered',
        title: 'Customer sent a counter-offer',
        body: 'Open the job to accept, reject or counter back.',
        data: { jobId: job.id, offerId: offer.id },
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
      adapters.analytics.track('counter_offer_sent', { userId: customerId, jobId: job.id });
      return offer;
    },

    /** Either side answers a pending offer: accept, reject, or counter back. */
    async respond(
      offer: OfferRecord,
      responderId: string,
      action: 'ACCEPT' | 'REJECT' | 'COUNTER',
      terms: { labourPaise?: number; visitFeePaise?: number; etaMinutes?: number; warrantyDays?: number; materialResponsibility?: BidRecord['material_responsibility']; scopeNotes?: string },
      ctx: TransitionContext,
    ) {
      const [job, bid, chain] = await Promise.all([
        store.jobs.get(offer.job_id),
        store.bids.get(offer.bid_id),
        store.negotiation.listOffersForBid(offer.bid_id),
      ]);
      if (!job || !bid) throw notFound('offer');

      const blockers = checkCanRespond({
        offerStatus: offer.status,
        offerExpiresAt: offer.expires_at,
        receiverId: offer.receiver_id,
        responderId,
        roundsSoFar: chain.length,
        jobAcceptsNegotiation: NEGOTIABLE.includes(job.status),
        bidIsActive: bid.status === 'ACTIVE',
      });
      if (blockers.length) throw new AppError('CONFLICT', { details: { negotiation: blockers } });

      if (action === 'REJECT') {
        const rejected = await store.negotiation.updateOffer(offer.id, { status: 'REJECTED', responded_at: new Date() });
        await store.notifications.create({
          user_id: offer.sender_id,
          type: 'offer.rejected',
          title: 'Your counter-offer was declined',
          body: 'The original offer still stands.',
          data: { jobId: job.id, offerId: offer.id },
          channel: 'IN_APP',
          read_at: null,
          sent_at: new Date(),
        });
        return { offer: rejected, accepted: null };
      }

      if (action === 'COUNTER') {
        const superseded = await store.negotiation.updateOffer(offer.id, { status: 'SUPERSEDED', responded_at: new Date() });
        const next = await store.negotiation.createOffer({
          job_id: job.id,
          bid_id: bid.id,
          parent_offer_id: offer.id,
          sender_id: responderId,
          sender_party: counterparty(offer.sender_party),
          receiver_id: offer.sender_id,
          labour_paise: terms.labourPaise ?? Number(offer.labour_paise),
          visit_fee_paise: terms.visitFeePaise ?? Number(offer.visit_fee_paise),
          eta_minutes: terms.etaMinutes ?? offer.eta_minutes,
          warranty_days: terms.warrantyDays ?? offer.warranty_days,
          material_responsibility: terms.materialResponsibility ?? offer.material_responsibility,
          scope_notes: terms.scopeNotes ?? null,
          status: 'PENDING',
          expires_at: counterOfferExpiry(),
          responded_at: null,
        });
        await store.notifications.create({
          user_id: offer.sender_id,
          type: 'offer.countered',
          title: 'You have a new counter-offer',
          body: 'Open the job to review the new terms.',
          data: { jobId: job.id, offerId: next.id },
          channel: 'IN_APP',
          read_at: null,
          sent_at: new Date(),
        });
        void superseded;
        return { offer: next, accepted: null };
      }

      // ACCEPT: the provider agreeing to the customer's counter locks those terms.
      const accepted = await store.negotiation.updateOffer(offer.id, { status: 'ACCEPTED', responded_at: new Date() });
      await store.bids.update(bid.id, {
        labour_paise: Number(offer.labour_paise),
        visit_fee_paise: Number(offer.visit_fee_paise),
        eta_minutes: offer.eta_minutes,
        warranty_days: offer.warranty_days,
        material_responsibility: offer.material_responsibility,
      });
      await store.notifications.create({
        user_id: offer.sender_id,
        type: 'offer.accepted',
        title: 'Your counter-offer was accepted',
        body: 'Confirm the booking to lock the price.',
        data: { jobId: job.id, offerId: offer.id },
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
      void ctx;
      return { offer: accepted, accepted: bid };
    },

    /**
     * The customer accepts an offer. One transaction freezes the quote, closes every other
     * offer on the job, records the assignment and creates the payment authorization, so two
     * providers can never both win (PRODUCT_SPEC section 10, BID-12).
     */
    async accept(job: JobRecord, bid: BidRecord, customerId: string, ctx: TransitionContext, idempotencyKey?: string) {
      const activeQuote = await store.negotiation.getActiveQuote(job.id);
      const blockers = checkCanAccept({
        jobAcceptsAcceptance: ACCEPTABLE.includes(job.status),
        bidIsActive: bid.status === 'ACTIVE',
        bidExpiresAt: bid.expires_at,
        alreadyHasActiveQuote: !!activeQuote,
      });
      if (blockers.length) throw new AppError('CONFLICT', { details: { acceptance: blockers } });

      const terms = await currentTerms(bid);
      const priced = quoteFor(terms);

      const { quote, payment } = await store.transaction(async (tx) => {
        // re-read inside the transaction: another tap may have won in between
        const fresh = await tx.jobs.get(job.id);
        if (!fresh) throw notFound('job');
        if (!ACCEPTABLE.includes(fresh.status)) {
          throw new AppError('CONFLICT', { details: { acceptance: ['JOB_NOT_ACCEPTABLE'], status: fresh.status } });
        }
        if (await tx.negotiation.getActiveQuote(job.id)) {
          throw new AppError('CONFLICT', { details: { acceptance: ['ALREADY_CONFIRMED'] } });
        }

        const q = await tx.negotiation.createQuote({
          job_id: job.id,
          bid_id: bid.id,
          offer_id: terms.offerId,
          provider_id: bid.provider_id,
          labour_paise: priced.labourPaise,
          visit_fee_paise: priced.visitFeePaise,
          material_estimate_paise: 0,
          delivery_paise: 0,
          platform_fee_paise: priced.platformFeePaise,
          protection_fee_paise: priced.protectionFeePaise,
          tax_paise: priced.taxPaise,
          total_paise: priced.totalPaise,
          provider_payable_paise: priced.providerPayablePaise,
          warranty_days: terms.warranty_days,
          eta_minutes: terms.eta_minutes,
          material_responsibility: terms.material_responsibility,
          status: 'ACTIVE',
        });

        // the winner is accepted; every other live offer on this job is closed
        await tx.bids.update(bid.id, { status: 'ACCEPTED' });
        for (const other of await tx.bids.listForJob(job.id, ['ACTIVE'])) {
          if (other.id !== bid.id) await tx.bids.update(other.id, { status: 'INACTIVE' });
        }
        for (const o of await tx.negotiation.listOffersForJob(job.id)) {
          if (o.status === 'PENDING') await tx.negotiation.updateOffer(o.id, { status: 'CANCELLED', responded_at: new Date() });
        }

        const providerProfile = await tx.users.getProviderProfile(bid.provider_id);
        await tx.negotiation.createAssignment({
          job_id: job.id,
          provider_id: bid.provider_id,
          technician_id: null,
          contractor_id: providerProfile?.contractor_id ?? null,
          assigned_by: customerId,
          status: 'ACTIVE',
          replaced_by: null,
          reason: 'Offer accepted by customer',
        });

        const key = idempotencyKey ?? `booking:${job.id}:${q.id}`;
        const order = await adapters.payment.createOrder({
          amountPaise: priced.totalPaise,
          currency: 'INR',
          receipt: key,
          notes: { jobId: job.id, quoteId: q.id },
        });
        const p = await tx.payments.create({
          job_id: job.id,
          payer_id: customerId,
          quote_id: q.id,
          purpose: 'BOOKING',
          amount_paise: priced.totalPaise,
          currency: 'INR',
          provider: adapters.payment.provider,
          provider_order_id: order.providerOrderId,
          provider_payment_id: null,
          status: 'PENDING',
          idempotency_key: key,
          failure_reason: null,
          authorized_at: null,
        });

        await tx.jobs.update(job.id, { active_quote_id: q.id, confirmed_provider_id: bid.provider_id, payment_status: 'PENDING' });
        return { quote: q, payment: p };
      });

      // Status moves after the money record exists, so the customer never sees
      // PAYMENT_PENDING without something to pay.
      const moved = await jobs.transition(job, 'PAYMENT_PENDING', ctx, {
        reason: 'Offer accepted',
        metadata: { quoteId: quote.id, bidId: bid.id },
      });

      await store.notifications.create({
        user_id: bid.provider_id,
        type: 'bid.accepted',
        title: 'Your offer was accepted',
        body: 'The customer is confirming payment. We will notify you when it is confirmed.',
        data: { jobId: job.id },
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
      adapters.analytics.track('bid_accepted', { userId: customerId, jobId: job.id, providerId: bid.provider_id });
      return { job: moved, quote, payment };
    },

    /**
     * Applies a gateway event. Replays are acknowledged and ignored; the job only moves to
     * CONFIRMED once the authorization is recorded (PAYMENT_FLOW.md section 7).
     */
    async applyPaymentEvent(input: {
      eventId: string;
      type: 'payment.authorized' | 'payment.failed';
      orderId: string;
      paymentId: string;
      amountPaise: number;
      failureReason?: string;
      signatureValid: boolean;
      requestId: string | null;
    }) {
      const payment = await store.payments.findByOrderId(input.orderId);
      const event = await store.payments.recordEvent({
        payment_id: payment?.id ?? null,
        provider_event_id: input.eventId,
        type: input.type,
        payload: { orderId: input.orderId, paymentId: input.paymentId, amountPaise: input.amountPaise },
        signature_valid: input.signatureValid,
        processed_at: null,
      });
      if (!event) return { replayed: true, payment };
      if (!payment) return { replayed: false, payment: null };

      if (Number(payment.amount_paise) !== input.amountPaise) {
        // PAY-06: never move a booking forward on a mismatched amount.
        await store.payments.update(payment.id, { status: 'FAILED', failure_reason: 'amount_mismatch' });
        throw new AppError('CONFLICT', { details: { reason: 'amount_mismatch' } });
      }

      const job = await store.jobs.get(payment.job_id);
      if (!job) throw notFound('job');

      if (input.type === 'payment.failed') {
        await store.payments.update(payment.id, { status: 'FAILED', failure_reason: input.failureReason ?? 'gateway_failure', provider_payment_id: input.paymentId });
        await store.jobs.update(job.id, { payment_status: 'FAILED' });
        // the job falls back so the customer can pick another offer (PAYMENT_FLOW section 8)
        if (job.status === 'PAYMENT_PENDING') {
          await jobs.transition(job, 'BID_RECEIVED', { actorUserId: null, actorRole: null, actor: 'SYSTEM', requestId: input.requestId }, {
            reason: 'Payment failed or expired',
          });
          const quote = await store.negotiation.getActiveQuote(job.id);
          if (quote) await store.negotiation.updateQuote(quote.id, { status: 'CANCELLED' });
          const assignment = await store.negotiation.getActiveAssignment(job.id);
          if (assignment) await store.negotiation.updateAssignment(assignment.id, { status: 'CANCELLED', reason: 'Payment failed' });
          await store.jobs.update(job.id, { active_quote_id: null, confirmed_provider_id: null });
        }
        await store.notifications.create({
          user_id: payment.payer_id,
          type: 'payment.failed',
          title: "Payment didn't go through",
          body: 'Your booking is not confirmed. You can try again or pick another offer.',
          data: { jobId: job.id },
          channel: 'IN_APP',
          read_at: null,
          sent_at: new Date(),
        });
        return { replayed: false, payment: await store.payments.get(payment.id) };
      }

      const authorized = await store.payments.update(payment.id, {
        status: 'AUTHORIZED',
        provider_payment_id: input.paymentId,
        authorized_at: new Date(),
      });
      await store.jobs.update(job.id, { payment_status: 'AUTHORIZED' });

      if (job.status === 'PAYMENT_PENDING') {
        const confirmed = await jobs.transition(job, 'CONFIRMED', { actorUserId: null, actorRole: null, actor: 'SYSTEM', requestId: input.requestId }, {
          reason: 'Payment authorized',
          metadata: { paymentId: payment.id },
        });
        // The provider is already assigned, so the job goes straight to PROVIDER_ASSIGNED.
        await jobs.transition(confirmed, 'PROVIDER_ASSIGNED', { actorUserId: null, actorRole: null, actor: 'SYSTEM', requestId: input.requestId }, {
          reason: 'Provider assigned',
        });
      }

      await Promise.all([
        store.notifications.create({
          user_id: payment.payer_id,
          type: 'job.confirmed',
          title: 'Booking confirmed',
          body: 'Your provider is confirmed. You will get a start code when they arrive.',
          data: { jobId: job.id },
          channel: 'IN_APP',
          read_at: null,
          sent_at: new Date(),
        }),
        job.confirmed_provider_id
          ? store.notifications.create({
              user_id: job.confirmed_provider_id,
              type: 'job.confirmed',
              title: 'Booking confirmed',
              body: 'Payment is authorized. Head over at the agreed time.',
              data: { jobId: job.id },
              channel: 'IN_APP',
              read_at: null,
              sent_at: new Date(),
            })
          : Promise.resolve(null),
      ]);
      adapters.analytics.track('payment_authorized', { userId: payment.payer_id, jobId: job.id });
      return { replayed: false, payment: authorized };
    },

    /** Used by tests and the demo app to drive the mock gateway without a real checkout. */
    mockCheckoutPayload(payment: PaymentRecord, outcome: 'authorized' | 'failed') {
      return {
        eventId: `evt_${newId()}`,
        type: outcome === 'authorized' ? ('payment.authorized' as const) : ('payment.failed' as const),
        orderId: payment.provider_order_id ?? '',
        paymentId: `pay_mock_${payment.id.slice(0, 12)}`,
        amountPaise: Number(payment.amount_paise),
      };
    },
  };
}

export type NegotiationService = ReturnType<typeof negotiationService>;
