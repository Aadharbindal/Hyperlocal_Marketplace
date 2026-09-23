import {
  MATERIAL_QUOTE_TTL_MINUTES,
  MATERIAL_QUOTE_WINDOW_MINUTES,
  canMoveOrder,
  checkCanSelect,
  checkInvoice,
  checkMaterialQuote,
  checkMaterialRequest,
  haversineKm,
  materialQuoteScore,
  materialTotals,
  type MaterialActor,
  type MaterialItemView,
  type MaterialOrderStatus,
  type MaterialOrderView,
  type MaterialQuoteView,
  type MaterialRequestView,
  type QuotedItem,
  type VendorRequestView,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type {
  DataStore,
  JobRecord,
  MaterialOrderRecord,
  MaterialQuoteRecord,
  MaterialRequestRecord,
} from '../../data/types';
import { AppError, forbidden, notFound } from '../../lib/errors';
import type { JobService } from '../jobs/service';

export interface MaterialsDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  jobs: JobService;
}

function blocked(code: string, extra: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_ERROR', { details: { materials: [code], ...extra } });
}

export function materialsService(d: MaterialsDeps) {
  const { env, store, adapters } = d;

  async function notify(userId: string, type: string, title: string, body: string, jobId: string) {
    await store.notifications.create({
      user_id: userId,
      type,
      title,
      body,
      data: { jobId },
      channel: 'IN_APP',
      read_at: null,
      sent_at: new Date(),
    });
  }

  /** The provider side of a job: whoever may raise a material request or receive delivery. */
  async function providerSideIds(job: JobRecord): Promise<string[]> {
    const a = await store.negotiation.getActiveAssignment(job.id);
    if (!a) return job.confirmed_provider_id ? [job.confirmed_provider_id] : [];
    return [a.provider_id, a.technician_id, a.contractor_id].filter((x): x is string => !!x);
  }

  async function requireProviderSide(job: JobRecord, userId: string) {
    const ids = await providerSideIds(job);
    if (!ids.includes(userId)) throw forbidden('not the assigned provider');
  }

  /** The customer or the provider side may sign for a delivery; nobody else. */
  async function requireOnJob(job: JobRecord, userId: string) {
    const ids = await providerSideIds(job);
    if (job.customer_id !== userId && !ids.includes(userId)) throw forbidden('not on this job');
  }

  function itemViews(items: Array<Record<string, unknown>>): MaterialItemView[] {
    return items.map((i) => {
      const unitPrice = typeof i.unitPricePaise === 'number' ? i.unitPricePaise : null;
      const qty = Number(i.quantity ?? 0);
      return {
        name: String(i.name ?? ''),
        quantity: qty,
        unit: String(i.unit ?? 'PIECE'),
        brand: (i.brand as string | undefined) ?? (i.brandPreference as string | undefined) ?? null,
        unitPricePaise: unitPrice,
        linePaise: unitPrice === null ? null : Math.round(unitPrice * qty),
        inStock: typeof i.inStock === 'boolean' ? i.inStock : null,
      };
    });
  }

  function toRequestView(r: MaterialRequestRecord, quoteCount: number): MaterialRequestView {
    return {
      id: r.id,
      jobId: r.job_id,
      status: r.status,
      items: itemViews(r.items as unknown as Array<Record<string, unknown>>),
      note: r.note,
      neededBy: r.needed_by?.toISOString() ?? null,
      quoteWindowEndsAt: r.quote_window_ends_at.toISOString(),
      quoteCount,
      createdAt: r.created_at.toISOString(),
    };
  }

  async function toQuoteView(q: MaterialQuoteRecord, job: JobRecord): Promise<MaterialQuoteView> {
    const profile = await store.users.getVendorProfile(q.vendor_id);
    const user = await store.users.findById(q.vendor_id);
    const items = q.items as QuotedItem[];
    return {
      id: q.id,
      requestId: q.request_id,
      vendor: {
        // Only the shop identity is ever exposed - never the vendor's phone or address.
        shopName: profile?.shop_name ?? user?.display_name ?? 'Local supplier',
        verified: profile?.verification_status === 'VERIFIED',
        ratingAvg: null,
        distanceKm: await vendorDistanceKm(q.vendor_id, job),
      },
      items: itemViews(items as unknown as Array<Record<string, unknown>>),
      subtotalPaise: Number(q.subtotal_paise),
      deliveryPaise: Number(q.delivery_paise),
      totalPaise: Number(q.total_paise),
      etaMinutes: q.eta_minutes,
      inStockCount: items.filter((i) => i.inStock).length,
      itemCount: items.length,
      note: q.note,
      status: q.status,
      expiresAt: q.expires_at.toISOString(),
      createdAt: q.created_at.toISOString(),
    };
  }

  async function vendorDistanceKm(vendorId: string, job: JobRecord): Promise<number> {
    const profile = await store.users.getVendorProfile(vendorId);
    const addr = profile?.shop_address_id ? await store.addresses.get(profile.shop_address_id) : null;
    const from = addr?.lat != null && addr.lng != null
      ? { lat: addr.lat, lng: addr.lng }
      : { lat: env.PILOT_CENTER_LAT, lng: env.PILOT_CENTER_LNG };
    if (job.lat == null || job.lng == null) return 0;
    return Math.round(haversineKm(from, { lat: job.lat, lng: job.lng }) * 10) / 10;
  }

  async function toOrderView(o: MaterialOrderRecord): Promise<MaterialOrderView> {
    const profile = await store.users.getVendorProfile(o.vendor_id);
    const payments = await store.payments.listForJob(o.job_id);
    const payment = payments.find((p) => p.purpose === 'MATERIAL' && p.idempotency_key === `mat_${o.id}`) ?? null;
    const invoice = o.invoice_media_id ? await store.jobs.getMedia(o.invoice_media_id) : null;
    return {
      id: o.id,
      requestId: o.request_id,
      quoteId: o.quote_id,
      status: o.status,
      vendorShopName: profile?.shop_name ?? 'Local supplier',
      items: itemViews(o.items as unknown as Array<Record<string, unknown>>),
      subtotalPaise: Number(o.subtotal_paise),
      deliveryPaise: Number(o.delivery_paise),
      totalPaise: Number(o.total_paise),
      etaMinutes: o.eta_minutes,
      payment: payment ? { id: payment.id, amountPaise: Number(payment.amount_paise), status: payment.status } : null,
      deliveredAt: o.delivered_at?.toISOString() ?? null,
      confirmedAt: o.confirmed_at?.toISOString() ?? null,
      issue: o.issue,
      issueNote: o.issue_note,
      invoiceNumber: o.invoice_number,
      invoiceUrl: invoice?.storage_key ?? null,
      createdAt: o.created_at.toISOString(),
    };
  }

  return {
    toRequestView,
    toQuoteView,
    toOrderView,
    requireOnJob,

    // ------------------------------------------------------------------ request
    async createRequest(
      job: JobRecord,
      userId: string,
      input: { items: Array<{ name: string; quantity: number; unit: string; brandPreference?: string }>; neededByMinutes?: number; note?: string },
    ) {
      await requireProviderSide(job, userId);
      const quote = await store.negotiation.getActiveQuote(job.id);
      const history = await store.materials.listRequestsForJob(job.id);
      const problem = checkMaterialRequest(job, input.items, {
        openRequests: history.filter((r) => r.status === 'OPEN' || r.status === 'QUOTED').length,
        totalRequests: history.length,
        materialResponsibility: quote?.material_responsibility ?? 'PROVIDER',
      });
      if (problem) blocked(problem);

      const record = await store.materials.createRequest({
        job_id: job.id,
        requested_by: userId,
        items: input.items,
        note: input.note ?? null,
        needed_by: input.neededByMinutes ? new Date(Date.now() + input.neededByMinutes * 60_000) : null,
        quote_window_ends_at: new Date(Date.now() + MATERIAL_QUOTE_WINDOW_MINUTES * 60_000),
        status: 'OPEN',
      });
      await notify(
        job.customer_id,
        'material.requested',
        'Materials needed for your job',
        'Local suppliers are being asked for prices. You will approve before anything is bought.',
        job.id,
      );
      adapters.analytics.track('material_requested', { userId, jobId: job.id, items: input.items.length });
      return record;
    },

    async panel(job: JobRecord, viewerId: string) {
      await requireOnJob(job, viewerId);
      const requests = await store.materials.listRequestsForJob(job.id);
      const current = requests[0] ?? null;
      const quotes = current ? await store.materials.listQuotes(current.id) : [];
      const orders = await store.materials.listOrdersForJob(job.id);
      const live = orders.find((o) => o.status !== 'CANCELLED') ?? null;
      const bookingQuote = await store.negotiation.getActiveQuote(job.id);

      // Ranked for the customer: price, stock coverage, speed - never price alone.
      const cheapest = quotes.length ? Math.min(...quotes.map((q) => Number(q.total_paise))) : 0;
      const views = await Promise.all(quotes.filter((q) => q.status !== 'CANCELLED').map((q) => toQuoteView(q, job)));
      views.sort(
        (a, b) =>
          materialQuoteScore({
            totalPaise: b.totalPaise,
            cheapestTotalPaise: cheapest,
            inStockRatio: b.itemCount ? b.inStockCount / b.itemCount : 0,
            etaMinutes: b.etaMinutes,
            ratingAvg: b.vendor.ratingAvg,
          }) -
          materialQuoteScore({
            totalPaise: a.totalPaise,
            cheapestTotalPaise: cheapest,
            inStockRatio: a.itemCount ? a.inStockCount / a.itemCount : 0,
            etaMinutes: a.etaMinutes,
            ratingAvg: a.vendor.ratingAvg,
          }),
      );

      return {
        jobId: job.id,
        materialResponsibility: bookingQuote?.material_responsibility ?? 'PROVIDER',
        request: current ? toRequestView(current, quotes.length) : null,
        quotes: views,
        order: live ? await toOrderView(live) : null,
        history: await Promise.all(orders.map((o) => toOrderView(o))),
      };
    },

    // ------------------------------------------------------------------ vendor side
    /** Open material requests a vendor could supply: the list and the area, never the address. */
    async vendorFeed(vendorId: string, limit: number) {
      const profile = await store.users.getVendorProfile(vendorId);
      const blockers: string[] = [];
      if (!profile) blockers.push('no_vendor_profile');
      else {
        if (profile.verification_status !== 'VERIFIED') blockers.push('verification_pending');
        if (!profile.delivery_available) blockers.push('deliveries_paused');
      }
      if (blockers.length) return { items: [], blockers };

      const requests = await store.materials.listOpenRequests(limit * 3);
      const items: VendorRequestView[] = [];
      for (const r of requests) {
        const job = await store.jobs.get(r.job_id);
        if (!job) continue;
        const distanceKm = await vendorDistanceKm(vendorId, job);
        if (distanceKm > (profile?.delivery_radius_km ?? 3)) continue;
        const mine = await store.materials.findVendorQuote(r.id, vendorId);
        const snap = job.address_snapshot as { societyName?: string | null; city?: string } | null;
        items.push({
          id: r.id,
          jobId: r.job_id,
          areaLabel: snap?.societyName ?? snap?.city ?? 'Nearby',
          distanceKm,
          items: itemViews(r.items as unknown as Array<Record<string, unknown>>),
          note: r.note,
          neededBy: r.needed_by?.toISOString() ?? null,
          quoteWindowEndsAt: r.quote_window_ends_at.toISOString(),
          alreadyQuoted: !!mine,
          createdAt: r.created_at.toISOString(),
        });
        if (items.length >= limit) break;
      }
      return { items, blockers };
    },

    async quote(
      request: MaterialRequestRecord,
      vendorId: string,
      input: { items: QuotedItem[]; deliveryPaise: number; etaMinutes: number; note?: string },
    ) {
      const profile = await store.users.getVendorProfile(vendorId);
      const existing = await store.materials.findVendorQuote(request.id, vendorId);
      const problem = checkMaterialQuote(
        { status: request.status, itemCount: (request.items as unknown[]).length, quoteWindowEndsAt: request.quote_window_ends_at },
        input.items,
        {
          verified: profile?.verification_status === 'VERIFIED',
          available: !!profile?.delivery_available,
          alreadyQuoted: !!existing,
        },
      );
      if (problem) blocked(problem);

      const totals = materialTotals(input.items, input.deliveryPaise);
      if (totals.totalPaise <= 0) blocked('NOTHING_IN_STOCK');

      const quote = await store.materials.createQuote({
        request_id: request.id,
        vendor_id: vendorId,
        items: input.items,
        subtotal_paise: totals.subtotalPaise,
        delivery_paise: totals.deliveryPaise,
        total_paise: totals.totalPaise,
        eta_minutes: input.etaMinutes,
        note: input.note ?? null,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + MATERIAL_QUOTE_TTL_MINUTES * 60_000),
      });
      if (request.status === 'OPEN') await store.materials.updateRequest(request.id, { status: 'QUOTED' });

      const job = await store.jobs.get(request.job_id);
      if (job) {
        await notify(job.customer_id, 'material.quoted', 'Material price received', 'A supplier has sent a price for the materials.', job.id);
        await notify(request.requested_by, 'material.quoted', 'Material price received', 'A supplier has answered your material request.', job.id);
      }
      adapters.analytics.track('material_quoted', { userId: vendorId, jobId: request.job_id });
      return quote;
    },

    // ------------------------------------------------------------------ selection
    /**
     * The customer picks and pays: selecting freezes the quote, creates the order and opens a
     * separate MATERIAL authorization. The labour hold is never touched by this.
     */
    async select(job: JobRecord, quoteId: string, customerId: string) {
      if (job.customer_id !== customerId) throw forbidden('not your job');
      const quote = await store.materials.getQuote(quoteId);
      if (!quote) throw notFound('material quote');
      const request = await store.materials.getRequest(quote.request_id);
      if (!request || request.job_id !== job.id) throw notFound('material request');

      const items = quote.items as QuotedItem[];
      const live = await store.materials.findLiveOrder(request.id);
      const problem = checkCanSelect(
        { status: quote.status, expiresAt: quote.expires_at, anyInStock: items.some((i) => i.inStock) },
        { hasLiveOrder: !!live },
      );
      if (problem) blocked(problem);

      const result = await store.transaction(async (tx) => {
        // Re-read inside the transaction: two taps must not produce two orders.
        const fresh = await tx.materials.getQuote(quote.id);
        if (!fresh || fresh.status !== 'ACTIVE') blocked('QUOTE_NOT_ACTIVE');

        const totals = materialTotals(items, Number(fresh.delivery_paise));
        const order = await tx.materials.createOrder({
          request_id: request.id,
          quote_id: fresh.id,
          job_id: job.id,
          vendor_id: fresh.vendor_id,
          selected_by: customerId,
          items,
          subtotal_paise: totals.subtotalPaise,
          delivery_paise: totals.deliveryPaise,
          total_paise: totals.totalPaise,
          vendor_payable_paise: totals.vendorPayablePaise,
          eta_minutes: fresh.eta_minutes,
          status: 'PENDING_PAYMENT',
          delivered_at: null,
          confirmed_by: null,
          confirmed_at: null,
          issue: null,
          issue_note: null,
          issue_media_ids: [],
          cancel_reason: null,
          invoice_media_id: null,
          invoice_number: null,
          invoice_amount_paise: null,
        });

        await tx.materials.updateQuote(fresh.id, { status: 'SELECTED' });
        // Every other price for this list is closed out in the same transaction.
        for (const other of await tx.materials.listQuotes(request.id)) {
          if (other.id !== fresh.id && other.status === 'ACTIVE') {
            await tx.materials.updateQuote(other.id, { status: 'REJECTED' });
          }
        }
        await tx.materials.updateRequest(request.id, { status: 'ORDERED' });

        const gatewayOrder = await adapters.payment.createOrder({
          amountPaise: totals.totalPaise,
          currency: 'INR',
          receipt: `mat_${order.id}`,
          notes: { jobId: job.id, orderId: order.id },
        });
        const payment = await tx.payments.create({
          job_id: job.id,
          payer_id: customerId,
          quote_id: null,
          purpose: 'MATERIAL',
          amount_paise: totals.totalPaise,
          currency: 'INR',
          provider: adapters.payment.provider,
          provider_order_id: gatewayOrder.providerOrderId,
          provider_payment_id: null,
          status: 'PENDING',
          idempotency_key: `mat_${order.id}`,
          failure_reason: null,
          authorized_at: null,
        });
        return { order, payment };
      });

      await notify(quote.vendor_id, 'material.selected', 'Your quote was selected', 'Prepare the order; we will confirm payment shortly.', job.id);
      adapters.analytics.track('material_selected', { userId: customerId, jobId: job.id, amountPaise: Number(quote.total_paise) });
      return result;
    },

    /**
     * Called when the material authorization lands. Until then the vendor is not asked to
     * prepare anything - nobody buys stock on an unpaid promise.
     */
    async onMaterialAuthorized(orderId: string) {
      const order = await store.materials.getOrder(orderId);
      if (!order || order.status !== 'PENDING_PAYMENT') return order;
      const moved = await store.materials.updateOrder(order.id, { status: 'PREPARING' });
      await notify(order.vendor_id, 'material.paid', 'Order confirmed', 'Payment is authorized. Please prepare the order.', order.job_id);
      return moved;
    },

    // ------------------------------------------------------------------ fulfilment
    async moveOrder(order: MaterialOrderRecord, userId: string, to: MaterialOrderStatus, reason: string | undefined, actor: MaterialActor) {
      if (actor === 'VENDOR' && order.vendor_id !== userId) throw forbidden('not your order');
      if (!canMoveOrder(order.status, to, actor)) {
        blocked('INVALID_ORDER_TRANSITION', { from: order.status, to });
      }
      const patch: Partial<MaterialOrderRecord> = { status: to };
      if (to === 'DELIVERED') patch.delivered_at = new Date();
      if (to === 'CANCELLED') patch.cancel_reason = reason ?? null;
      const moved = await store.materials.updateOrder(order.id, patch);

      const job = await store.jobs.get(order.job_id);
      if (job) {
        if (to === 'OUT_FOR_DELIVERY') {
          await notify(job.customer_id, 'material.out_for_delivery', 'Materials on the way', `Arriving in about ${order.eta_minutes} minutes.`, job.id);
        }
        if (to === 'DELIVERED') {
          await notify(job.customer_id, 'material.delivered', 'Materials delivered', 'Please check the items and confirm.', job.id);
        }
        if (to === 'CANCELLED') {
          await notify(job.customer_id, 'material.cancelled', 'Material order cancelled', reason ?? '', job.id);
        }
      }
      adapters.analytics.track('material_order_moved', { userId, jobId: order.job_id, to });
      return moved;
    },

    /**
     * Receipt. Confirming is what later justifies paying the vendor, so a mismatch parks the
     * order instead of quietly accepting it.
     */
    async confirmDelivery(
      order: MaterialOrderRecord,
      job: JobRecord,
      userId: string,
      input: { ok: boolean; issue?: string; note?: string; mediaIds?: string[] },
    ) {
      await requireOnJob(job, userId);
      if (order.status !== 'DELIVERED' && order.status !== 'OUT_FOR_DELIVERY') {
        blocked('ORDER_NOT_DELIVERED', { status: order.status });
      }
      if (input.ok) {
        if (!canMoveOrder(order.status, 'CONFIRMED', 'CUSTOMER_SIDE')) blocked('INVALID_ORDER_TRANSITION', { from: order.status, to: 'CONFIRMED' });
        const confirmed = await store.materials.updateOrder(order.id, {
          status: 'CONFIRMED',
          confirmed_by: userId,
          confirmed_at: new Date(),
        });
        await notify(order.vendor_id, 'material.confirmed', 'Delivery confirmed', 'Upload the invoice to be paid for this order.', job.id);
        adapters.analytics.track('material_confirmed', { userId, jobId: job.id });
        return confirmed;
      }

      const held = await store.materials.updateOrder(order.id, {
        status: 'ON_HOLD',
        issue: input.issue ?? 'OTHER',
        issue_note: input.note ?? null,
        issue_media_ids: input.mediaIds ?? [],
      });
      // A held order is a money question, so support sees it rather than the two parties
      // arguing it out between themselves.
      await notify(order.vendor_id, 'material.mismatch', 'Problem reported with your delivery', input.note ?? '', job.id);
      adapters.analytics.track('material_issue', { userId, jobId: job.id, issue: input.issue ?? 'OTHER' });
      return held;
    },

    async fileInvoice(order: MaterialOrderRecord, vendorId: string, input: { mediaId: string; amountPaise: number; invoiceNumber?: string }) {
      if (order.vendor_id !== vendorId) throw forbidden('not your order');
      const problem = checkInvoice(
        { status: order.status, totalPaise: Number(order.total_paise), hasInvoice: !!order.invoice_media_id },
        input.amountPaise,
      );
      if (problem) blocked(problem, { orderTotalPaise: Number(order.total_paise) });

      const media = await store.jobs.getMedia(input.mediaId);
      if (!media || media.job_id !== order.job_id) throw notFound('invoice file');

      const filed = await store.materials.updateOrder(order.id, {
        invoice_media_id: input.mediaId,
        invoice_number: input.invoiceNumber ?? null,
        invoice_amount_paise: input.amountPaise,
      });
      adapters.analytics.track('material_invoice_filed', { userId: vendorId, jobId: order.job_id });
      return filed;
    },
  };
}

export type MaterialsService = ReturnType<typeof materialsService>;
