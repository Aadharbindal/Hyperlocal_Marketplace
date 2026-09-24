import { financialYearOf } from '@hyperlocal/core';
import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type {
  FavouriteProviderRecord,
  GrowthRepo,
  InvoiceRecord,
  PromoCodeRecord,
  PromoRedemptionRecord,
  ReferralRecord,
} from '../types';

/** In-memory growth repository mirroring the constraints in 0011_receipts_and_growth.sql. */
export function createMemoryGrowthRepo(): GrowthRepo {
  const invoices = new Map<string, InvoiceRecord>();
  const favourites = new Map<string, FavouriteProviderRecord>();
  const promos = new Map<string, PromoCodeRecord>();
  const redemptions: PromoRedemptionRecord[] = [];
  const referrals = new Map<string, ReferralRecord>();
  const now = () => new Date();
  const favKey = (c: string, p: string) => `${c}:${p}`;

  return {
    async createInvoice(i) {
      // mirrors invoices_job_idx: a second receipt for one job would be a different document
      if ([...invoices.values()].some((x) => x.job_id === i.job_id)) throw conflict({ reason: 'invoice_exists' });
      if ([...invoices.values()].some((x) => x.number === i.number)) throw conflict({ reason: 'invoice_number_taken' });
      const rec: InvoiceRecord = { ...i, id: newId(), created_at: now(), updated_at: now() } as InvoiceRecord;
      invoices.set(rec.id, rec);
      return rec;
    },
    async getInvoiceForJob(jobId) {
      return [...invoices.values()].find((i) => i.job_id === jobId) ?? null;
    },
    async listInvoices(customerId, limit) {
      return [...invoices.values()]
        .filter((i) => i.customer_id === customerId)
        .sort((a, b) => b.issued_at.getTime() - a.issued_at.getTime())
        .slice(0, limit);
    },
    async updateInvoice(id, patch) {
      const i = invoices.get(id);
      if (!i) throw new Error('invoice not found');
      const next = { ...i, ...patch, updated_at: now() };
      invoices.set(id, next);
      return next;
    },
    async nextInvoiceSequence(financialYear) {
      return [...invoices.values()].filter((i) => financialYearOf(i.issued_at) === financialYear).length + 1;
    },

    async addFavourite(f) {
      const rec: FavouriteProviderRecord = { ...f, created_at: now() } as FavouriteProviderRecord;
      // mirrors the composite primary key: saving twice is not an error, it is the same fact
      favourites.set(favKey(rec.customer_id, rec.provider_id), rec);
      return rec;
    },
    async removeFavourite(customerId, providerId) {
      favourites.delete(favKey(customerId, providerId));
    },
    async listFavourites(customerId) {
      return [...favourites.values()]
        .filter((f) => f.customer_id === customerId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async isFavourite(customerId, providerId) {
      return favourites.has(favKey(customerId, providerId));
    },

    async createPromo(p) {
      // mirrors promo_codes_code_idx, which is on upper(code)
      if ([...promos.values()].some((x) => x.code.toUpperCase() === p.code.toUpperCase())) {
        throw conflict({ reason: 'promo_code_taken' });
      }
      const rec: PromoCodeRecord = { ...p, id: newId(), created_at: now(), updated_at: now() } as PromoCodeRecord;
      promos.set(rec.id, rec);
      return rec;
    },
    async findPromo(code) {
      return [...promos.values()].find((p) => p.code.toUpperCase() === code.trim().toUpperCase()) ?? null;
    },
    async listPromos(limit) {
      return [...promos.values()].sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
    },
    async updatePromo(id, patch) {
      const p = promos.get(id);
      if (!p) throw new Error('promo not found');
      const next = { ...p, ...patch, updated_at: now() };
      promos.set(id, next);
      return next;
    },
    async countRedemptions(promoId, customerId) {
      return redemptions.filter((r) => r.promo_id === promoId && r.customer_id === customerId).length;
    },
    async redeemPromo(r) {
      // mirrors promo_redemptions_job_idx: one code per booking, whatever a retry thinks
      if (redemptions.some((x) => x.job_id === r.job_id)) throw conflict({ reason: 'promo_already_applied' });
      const rec: PromoRedemptionRecord = { ...r, id: newId(), created_at: now() } as PromoRedemptionRecord;
      redemptions.push(Object.freeze(rec));
      const promo = promos.get(rec.promo_id);
      if (promo) promos.set(promo.id, { ...promo, redemption_count: promo.redemption_count + 1, updated_at: now() });
      return rec;
    },
    async findRedemptionForJob(jobId) {
      return redemptions.find((r) => r.job_id === jobId) ?? null;
    },

    async createReferral(r) {
      // mirrors referral_not_self and referrals_referred_idx
      if (r.referrer_id === r.referred_id) throw conflict({ reason: 'self_referral' });
      if ([...referrals.values()].some((x) => x.referred_id === r.referred_id)) {
        throw conflict({ reason: 'already_referred' });
      }
      const rec: ReferralRecord = { ...r, id: newId(), created_at: now(), updated_at: now() } as ReferralRecord;
      referrals.set(rec.id, rec);
      return rec;
    },
    async findReferralForUser(referredId) {
      return [...referrals.values()].find((r) => r.referred_id === referredId) ?? null;
    },
    async listReferralsBy(referrerId) {
      return [...referrals.values()]
        .filter((r) => r.referrer_id === referrerId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async updateReferral(id, patch) {
      const r = referrals.get(id);
      if (!r) throw new Error('referral not found');
      const next = { ...r, ...patch, updated_at: now() };
      referrals.set(id, next);
      return next;
    },
  };
}
