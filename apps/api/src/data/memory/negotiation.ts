import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type {
  AssignmentRecord,
  BookingQuoteRecord,
  NegotiationRepo,
  OfferRecord,
  PaymentEventRecord,
  PaymentRecord,
  PaymentsRepo,
} from '../types';

/** In-memory negotiation repository mirroring the constraints in 0004_negotiation.sql. */
export function createMemoryNegotiationRepo(): NegotiationRepo {
  const offers = new Map<string, OfferRecord>();
  const quotes = new Map<string, BookingQuoteRecord>();
  const assignments = new Map<string, AssignmentRecord>();
  const now = () => new Date();

  return {
    async createOffer(o) {
      // mirrors offers_one_pending_per_bid_idx
      if ((o.status ?? 'PENDING') === 'PENDING') {
        const pending = [...offers.values()].find((x) => x.bid_id === o.bid_id && x.status === 'PENDING');
        if (pending) throw conflict({ reason: 'offer_already_pending' });
      }
      const rec: OfferRecord = { ...o, id: o.id ?? newId(), created_at: now(), updated_at: now() } as OfferRecord;
      offers.set(rec.id, rec);
      return rec;
    },
    async getOffer(id) {
      return offers.get(id) ?? null;
    },
    async updateOffer(id, patch) {
      const o = offers.get(id);
      if (!o) throw new Error('offer not found');
      const next = { ...o, ...patch, updated_at: now() };
      offers.set(id, next);
      return next;
    },
    async listOffersForJob(jobId) {
      return [...offers.values()].filter((o) => o.job_id === jobId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    },
    async listOffersForBid(bidId) {
      return [...offers.values()].filter((o) => o.bid_id === bidId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    },
    async listExpiredOffers(at, limit) {
      return [...offers.values()]
        .filter((o) => o.status === 'PENDING' && o.expires_at <= at)
        .sort((a, b) => a.expires_at.getTime() - b.expires_at.getTime())
        .slice(0, limit);
    },
    async findPendingForBid(bidId) {
      return [...offers.values()].find((o) => o.bid_id === bidId && o.status === 'PENDING') ?? null;
    },

    async createQuote(q) {
      // mirrors booking_quotes_one_active_idx: exactly one live quote per job
      if ((q.status ?? 'ACTIVE') === 'ACTIVE') {
        const live = [...quotes.values()].find((x) => x.job_id === q.job_id && x.status === 'ACTIVE');
        if (live) throw conflict({ reason: 'quote_already_active' });
      }
      const rec: BookingQuoteRecord = { ...q, id: q.id ?? newId(), locked_at: now(), created_at: now(), updated_at: now() } as BookingQuoteRecord;
      quotes.set(rec.id, rec);
      return rec;
    },
    async getActiveQuote(jobId) {
      return [...quotes.values()].find((q) => q.job_id === jobId && q.status === 'ACTIVE') ?? null;
    },
    async getQuote(id) {
      return quotes.get(id) ?? null;
    },
    async updateQuote(id, patch) {
      const q = quotes.get(id);
      if (!q) throw new Error('quote not found');
      const next = { ...q, ...patch, updated_at: now() };
      quotes.set(id, next);
      return next;
    },

    async createAssignment(a) {
      // mirrors job_assignments_one_active_idx: exactly one confirmed provider per job
      if ((a.status ?? 'ACTIVE') === 'ACTIVE') {
        const live = [...assignments.values()].find((x) => x.job_id === a.job_id && x.status === 'ACTIVE');
        if (live) throw conflict({ reason: 'assignment_already_active' });
      }
      const rec: AssignmentRecord = { ...a, id: a.id ?? newId(), created_at: now(), updated_at: now() } as AssignmentRecord;
      assignments.set(rec.id, rec);
      return rec;
    },
    async getActiveAssignment(jobId) {
      return [...assignments.values()].find((a) => a.job_id === jobId && a.status === 'ACTIVE') ?? null;
    },
    async updateAssignment(id, patch) {
      const a = assignments.get(id);
      if (!a) throw new Error('assignment not found');
      const next = { ...a, ...patch, updated_at: now() };
      assignments.set(id, next);
      return next;
    },
  };
}

/** In-memory payments repository. Money operations are keyed by idempotency key. */
export function createMemoryPaymentsRepo(): PaymentsRepo {
  const payments = new Map<string, PaymentRecord>();
  const events = new Map<string, PaymentEventRecord>();
  const LIVE = ['PENDING', 'AUTHORIZED', 'CAPTURED'];
  const now = () => new Date();

  return {
    async create(p) {
      // mirrors the unique idempotency_key: the same call twice returns the first payment
      const existing = [...payments.values()].find((x) => x.idempotency_key === p.idempotency_key);
      if (existing) return existing;
      // mirrors payments_one_live_booking_idx
      if (p.purpose === 'BOOKING') {
        const live = [...payments.values()].find((x) => x.job_id === p.job_id && x.purpose === 'BOOKING' && LIVE.includes(x.status));
        if (live) throw conflict({ reason: 'payment_already_live' });
      }
      const rec: PaymentRecord = { ...p, id: p.id ?? newId(), created_at: now(), updated_at: now() } as PaymentRecord;
      payments.set(rec.id, rec);
      return rec;
    },
    async get(id) {
      return payments.get(id) ?? null;
    },
    async findByIdempotencyKey(key) {
      return [...payments.values()].find((p) => p.idempotency_key === key) ?? null;
    },
    async findByOrderId(orderId) {
      return [...payments.values()].find((p) => p.provider_order_id === orderId) ?? null;
    },
    async listStale(status, before, limit) {
      return [...payments.values()]
        .filter((p) => p.status === status && p.created_at <= before)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);
    },
    async findLiveBooking(jobId) {
      return [...payments.values()].find((p) => p.job_id === jobId && p.purpose === 'BOOKING' && LIVE.includes(p.status)) ?? null;
    },
    async update(id, patch) {
      const p = payments.get(id);
      if (!p) throw new Error('payment not found');
      const next = { ...p, ...patch, updated_at: now() };
      payments.set(id, next);
      return next;
    },
    async listForJob(jobId) {
      return [...payments.values()].filter((p) => p.job_id === jobId).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },

    async recordEvent(e) {
      // mirrors the unique provider_event_id: a replayed webhook is acknowledged and ignored
      if (events.has(e.provider_event_id)) return null;
      const rec: PaymentEventRecord = { ...e, id: newId(), created_at: now() };
      events.set(rec.provider_event_id, Object.freeze(rec));
      return rec;
    },
  };
}
