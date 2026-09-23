import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type { MaterialOrderRecord, MaterialQuoteRecord, MaterialRequestRecord, MaterialsRepo } from '../types';

const OPEN_REQUEST: readonly string[] = ['OPEN', 'QUOTED'];
const LIVE_QUOTE: readonly string[] = ['ACTIVE', 'SELECTED'];

/** In-memory materials repository mirroring the constraints in 0006_materials.sql. */
export function createMemoryMaterialsRepo(): MaterialsRepo {
  const requests = new Map<string, MaterialRequestRecord>();
  const quotes = new Map<string, MaterialQuoteRecord>();
  const orders = new Map<string, MaterialOrderRecord>();
  const now = () => new Date();

  return {
    async createRequest(r) {
      // mirrors material_requests_one_open_idx
      if ([...requests.values()].some((x) => x.job_id === r.job_id && OPEN_REQUEST.includes(x.status))) {
        throw conflict({ reason: 'material_request_already_open' });
      }
      const rec: MaterialRequestRecord = { ...r, id: newId(), created_at: now(), updated_at: now() } as MaterialRequestRecord;
      requests.set(rec.id, rec);
      return rec;
    },
    async getRequest(id) {
      return requests.get(id) ?? null;
    },
    async updateRequest(id, patch) {
      const r = requests.get(id);
      if (!r) throw new Error('material request not found');
      const next = { ...r, ...patch, updated_at: now() };
      requests.set(id, next);
      return next;
    },
    async listRequestsForJob(jobId) {
      return [...requests.values()]
        .filter((r) => r.job_id === jobId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async findOpenRequest(jobId) {
      return [...requests.values()].find((r) => r.job_id === jobId && OPEN_REQUEST.includes(r.status)) ?? null;
    },
    async listOpenRequests(limit) {
      const t = now();
      return [...requests.values()]
        .filter((r) => OPEN_REQUEST.includes(r.status) && r.quote_window_ends_at > t)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },

    async createQuote(q) {
      // mirrors material_quotes_one_live_per_vendor_idx
      const dupe = [...quotes.values()].some(
        (x) => x.request_id === q.request_id && x.vendor_id === q.vendor_id && LIVE_QUOTE.includes(x.status),
      );
      if (dupe) throw conflict({ reason: 'material_quote_already_given' });
      const rec: MaterialQuoteRecord = { ...q, id: newId(), created_at: now(), updated_at: now() } as MaterialQuoteRecord;
      quotes.set(rec.id, rec);
      return rec;
    },
    async getQuote(id) {
      return quotes.get(id) ?? null;
    },
    async updateQuote(id, patch) {
      const q = quotes.get(id);
      if (!q) throw new Error('material quote not found');
      const next = { ...q, ...patch, updated_at: now() };
      quotes.set(id, next);
      return next;
    },
    async listQuotes(requestId) {
      return [...quotes.values()]
        .filter((q) => q.request_id === requestId)
        .sort((a, b) => a.total_paise - b.total_paise);
    },
    async findVendorQuote(requestId, vendorId) {
      return (
        [...quotes.values()].find((q) => q.request_id === requestId && q.vendor_id === vendorId && LIVE_QUOTE.includes(q.status)) ?? null
      );
    },

    async createOrder(o) {
      // mirrors material_orders_one_live_idx
      if ([...orders.values()].some((x) => x.request_id === o.request_id && x.status !== 'CANCELLED')) {
        throw conflict({ reason: 'material_already_ordered' });
      }
      const rec: MaterialOrderRecord = { ...o, id: newId(), created_at: now(), updated_at: now() } as MaterialOrderRecord;
      orders.set(rec.id, rec);
      return rec;
    },
    async getOrder(id) {
      return orders.get(id) ?? null;
    },
    async updateOrder(id, patch) {
      const o = orders.get(id);
      if (!o) throw new Error('material order not found');
      const next = { ...o, ...patch, updated_at: now() };
      // mirrors material_invoice_matches_order_trg
      if (next.invoice_media_id) {
        if (next.status !== 'CONFIRMED') throw conflict({ reason: 'invoice_needs_confirmed_order' });
        if (next.invoice_amount_paise !== next.total_paise) throw conflict({ reason: 'invoice_amount_mismatch' });
      }
      orders.set(id, next);
      return next;
    },
    async findLiveOrder(requestId) {
      return [...orders.values()].find((o) => o.request_id === requestId && o.status !== 'CANCELLED') ?? null;
    },
    async listOrdersForJob(jobId) {
      return [...orders.values()]
        .filter((o) => o.job_id === jobId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async listOrdersForVendor(vendorId, limit) {
      return [...orders.values()]
        .filter((o) => o.vendor_id === vendorId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
  };
}
