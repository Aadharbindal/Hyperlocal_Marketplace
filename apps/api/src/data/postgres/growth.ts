import type pg from 'pg';
import type {
  FavouriteProviderRecord,
  GrowthRepo,
  InvoiceRecord,
  PromoCodeRecord,
  PromoRedemptionRecord,
  ReferralRecord,
} from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };

export function createPostgresGrowthRepo(q: Queryable): GrowthRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> =>
    ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async createInvoice(i) {
      return (await one<InvoiceRecord>(
        `insert into invoices (job_id, customer_id, number, labour_paise, visit_fee_paise, material_paise, delivery_paise,
           platform_fee_paise, protection_fee_paise, tax_paise, total_paise, refunded_paise, provider_name, category_name,
           service_address, issued_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
        [i.job_id, i.customer_id, i.number, i.labour_paise, i.visit_fee_paise, i.material_paise, i.delivery_paise,
          i.platform_fee_paise, i.protection_fee_paise, i.tax_paise, i.total_paise, i.refunded_paise, i.provider_name,
          i.category_name, i.service_address, i.issued_at],
      ))!;
    },
    getInvoiceForJob: (jobId) => one<InvoiceRecord>('select * from invoices where job_id = $1', [jobId]),
    listInvoices: (customerId, limit) =>
      many<InvoiceRecord>('select * from invoices where customer_id = $1 order by issued_at desc limit $2', [customerId, limit]),
    async updateInvoice(id, patch) {
      const keys = Object.keys(patch);
      const sets = keys.map((k, idx) => `${k} = $${idx + 2}`).join(', ');
      return (await one<InvoiceRecord>(`update invoices set ${sets} where id = $1 returning *`, [id, ...keys.map((k) => (patch as Record<string, unknown>)[k])]))!;
    },
    async nextInvoiceSequence(financialYear) {
      // Counted from the numbers already issued in that year rather than a separate counter,
      // so there is one source of truth and no way for the two to drift apart.
      const r = await one<{ n: number }>(
        `select count(*)::int as n from invoices where number like $1`,
        [`HL-${financialYear}-%`],
      );
      return (r?.n ?? 0) + 1;
    },

    async addFavourite(f) {
      // Saving somebody twice is the same fact, not an error.
      return (await one<FavouriteProviderRecord>(
        `insert into favourite_providers (customer_id, provider_id, note) values ($1,$2,$3)
         on conflict (customer_id, provider_id) do update set note = excluded.note returning *`,
        [f.customer_id, f.provider_id, f.note],
      ))!;
    },
    async removeFavourite(customerId, providerId) {
      await q.query('delete from favourite_providers where customer_id = $1 and provider_id = $2', [customerId, providerId]);
    },
    listFavourites: (customerId) =>
      many<FavouriteProviderRecord>('select * from favourite_providers where customer_id = $1 order by created_at desc', [customerId]),
    async isFavourite(customerId, providerId) {
      const r = await one<{ n: number }>(
        'select count(*)::int as n from favourite_providers where customer_id = $1 and provider_id = $2',
        [customerId, providerId],
      );
      return (r?.n ?? 0) > 0;
    },

    async createPromo(p) {
      return (await one<PromoCodeRecord>(
        `insert into promo_codes (code, kind, value, max_discount_paise, min_order_paise, starts_at, ends_at,
           max_redemptions, max_per_customer, first_job_only, active, created_by, reserved_for_user_id, referral_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [p.code, p.kind, p.value, p.max_discount_paise, p.min_order_paise, p.starts_at, p.ends_at,
          p.max_redemptions, p.max_per_customer, p.first_job_only, p.active, p.created_by,
          p.reserved_for_user_id, p.referral_id],
      ))!;
    },
    findPromo: (code) => one<PromoCodeRecord>('select * from promo_codes where upper(code) = upper($1)', [code.trim()]),
    // Reserved codes are somebody's personal reward, not part of the campaign list.
    listPromos: (limit) =>
      many<PromoCodeRecord>(
        'select * from promo_codes where reserved_for_user_id is null order by created_at desc limit $1',
        [limit],
      ),
    async updatePromo(id, patch) {
      const keys = Object.keys(patch);
      const sets = keys.map((k, idx) => `${k} = $${idx + 2}`).join(', ');
      return (await one<PromoCodeRecord>(`update promo_codes set ${sets} where id = $1 returning *`, [id, ...keys.map((k) => (patch as Record<string, unknown>)[k])]))!;
    },
    async countRedemptions(promoId, customerId) {
      const r = await one<{ n: number }>(
        'select count(*)::int as n from promo_redemptions where promo_id = $1 and customer_id = $2',
        [promoId, customerId],
      );
      return r?.n ?? 0;
    },
    async redeemPromo(r) {
      const row = (await one<PromoRedemptionRecord>(
        `insert into promo_redemptions (promo_id, customer_id, job_id, discount_paise) values ($1,$2,$3,$4) returning *`,
        [r.promo_id, r.customer_id, r.job_id, r.discount_paise],
      ))!;
      // Incremented in the same breath as the redemption, so the cap means something.
      await q.query('update promo_codes set redemption_count = redemption_count + 1 where id = $1', [r.promo_id]);
      return row;
    },
    findRedemptionForJob: (jobId) => one<PromoRedemptionRecord>('select * from promo_redemptions where job_id = $1', [jobId]),

    async createReferral(r) {
      return (await one<ReferralRecord>(
        `insert into referrals (referrer_id, referred_id, code, status, qualifying_job_id, reward_paise, rewarded_at, rejection_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [r.referrer_id, r.referred_id, r.code, r.status, r.qualifying_job_id, r.reward_paise, r.rewarded_at, r.rejection_reason],
      ))!;
    },
    findReferralForUser: (referredId) => one<ReferralRecord>('select * from referrals where referred_id = $1', [referredId]),
    listReferralsBy: (referrerId) =>
      many<ReferralRecord>('select * from referrals where referrer_id = $1 order by created_at desc', [referrerId]),
    async updateReferral(id, patch) {
      const keys = Object.keys(patch);
      const sets = keys.map((k, idx) => `${k} = $${idx + 2}`).join(', ');
      return (await one<ReferralRecord>(`update referrals set ${sets} where id = $1 returning *`, [id, ...keys.map((k) => (patch as Record<string, unknown>)[k])]))!;
    },
  };
}
