import type {
  AssignmentRecord,
  BookingQuoteRecord,
  NegotiationRepo,
  OfferRecord,
  PaymentEventRecord,
  PaymentRecord,
  PaymentsRepo,
} from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

/** PostgreSQL negotiation repository against supabase/migrations/0004_negotiation.sql. */
export function createPostgresNegotiationRepo(q: Queryable): NegotiationRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async createOffer(o) {
      return (await one<OfferRecord>(
        `insert into offers (job_id, bid_id, parent_offer_id, sender_id, sender_party, receiver_id, labour_paise,
           visit_fee_paise, eta_minutes, warranty_days, material_responsibility, scope_notes, status, expires_at, responded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [o.job_id, o.bid_id, o.parent_offer_id, o.sender_id, o.sender_party, o.receiver_id, o.labour_paise,
          o.visit_fee_paise, o.eta_minutes, o.warranty_days, o.material_responsibility, o.scope_notes, o.status,
          o.expires_at, o.responded_at],
      ))!;
    },
    getOffer: (id) => one<OfferRecord>('select * from offers where id = $1', [id]),
    async updateOffer(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<OfferRecord>(`update offers set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listOffersForJob: (jobId) => many<OfferRecord>('select * from offers where job_id = $1 order by created_at', [jobId]),
    listOffersForBid: (bidId) => many<OfferRecord>('select * from offers where bid_id = $1 order by created_at', [bidId]),
    listExpiredOffers: (at, limit) =>
      many<OfferRecord>("select * from offers where status = 'PENDING' and expires_at <= $1 order by expires_at limit $2", [at, limit]),
    findPendingForBid: (bidId) => one<OfferRecord>("select * from offers where bid_id = $1 and status = 'PENDING'", [bidId]),

    async createQuote(q2) {
      return (await one<BookingQuoteRecord>(
        `insert into booking_quotes (job_id, bid_id, offer_id, provider_id, labour_paise, visit_fee_paise,
           material_estimate_paise, delivery_paise, platform_fee_paise, protection_fee_paise, tax_paise, total_paise,
           provider_payable_paise, warranty_days, eta_minutes, material_responsibility, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
        [q2.job_id, q2.bid_id, q2.offer_id, q2.provider_id, q2.labour_paise, q2.visit_fee_paise, q2.material_estimate_paise,
          q2.delivery_paise, q2.platform_fee_paise, q2.protection_fee_paise, q2.tax_paise, q2.total_paise,
          q2.provider_payable_paise, q2.warranty_days, q2.eta_minutes, q2.material_responsibility, q2.status],
      ))!;
    },
    getActiveQuote: (jobId) => one<BookingQuoteRecord>("select * from booking_quotes where job_id = $1 and status = 'ACTIVE'", [jobId]),
    getQuote: (id) => one<BookingQuoteRecord>('select * from booking_quotes where id = $1', [id]),
    async updateQuote(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<BookingQuoteRecord>(`update booking_quotes set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },

    async createAssignment(a) {
      return (await one<AssignmentRecord>(
        `insert into job_assignments (job_id, provider_id, technician_id, contractor_id, assigned_by, status, replaced_by, reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [a.job_id, a.provider_id, a.technician_id, a.contractor_id, a.assigned_by, a.status, a.replaced_by, a.reason],
      ))!;
    },
    listAssignmentsForProvider: (providerId, limit) =>
      many<AssignmentRecord>(
        `select * from job_assignments where provider_id = $1 and status = 'ACTIVE' order by created_at desc limit $2`,
        [providerId, limit],
      ),
    getActiveAssignment: (jobId) => one<AssignmentRecord>("select * from job_assignments where job_id = $1 and status = 'ACTIVE'", [jobId]),
    async updateAssignment(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<AssignmentRecord>(`update job_assignments set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
  };
}

export function createPostgresPaymentsRepo(q: Queryable): PaymentsRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async create(p) {
      // `on conflict (idempotency_key)` makes a retried checkout return the first payment
      const inserted = await one<PaymentRecord>(
        `insert into payments (job_id, payer_id, quote_id, purpose, amount_paise, currency, provider,
           provider_order_id, provider_payment_id, status, idempotency_key, failure_reason, authorized_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (idempotency_key) do nothing returning *`,
        [p.job_id, p.payer_id, p.quote_id, p.purpose, p.amount_paise, p.currency, p.provider, p.provider_order_id,
          p.provider_payment_id, p.status, p.idempotency_key, p.failure_reason, p.authorized_at],
      );
      if (inserted) return inserted;
      return (await one<PaymentRecord>('select * from payments where idempotency_key = $1', [p.idempotency_key]))!;
    },
    get: (id) => one<PaymentRecord>('select * from payments where id = $1', [id]),
    findByIdempotencyKey: (key) => one<PaymentRecord>('select * from payments where idempotency_key = $1', [key]),
    findByOrderId: (orderId) => one<PaymentRecord>('select * from payments where provider_order_id = $1', [orderId]),
    listStale: (status, before, limit) =>
      many<PaymentRecord>('select * from payments where status = $1 and created_at <= $2 order by created_at limit $3', [status, before, limit]),
    findLiveBooking: (jobId) =>
      one<PaymentRecord>(
        "select * from payments where job_id = $1 and purpose = 'BOOKING' and status in ('PENDING','AUTHORIZED','CAPTURED')",
        [jobId],
      ),
    async update(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<PaymentRecord>(`update payments set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listForJob: (jobId) => many<PaymentRecord>('select * from payments where job_id = $1 order by created_at desc', [jobId]),

    async recordEvent(e) {
      // the unique provider_event_id turns a replayed webhook into a no-op (PAY-04)
      return one<PaymentEventRecord>(
        `insert into payment_events (payment_id, provider_event_id, type, payload, signature_valid, processed_at)
         values ($1,$2,$3,$4,$5,$6) on conflict (provider_event_id) do nothing returning *`,
        [e.payment_id, e.provider_event_id, e.type, e.payload, e.signature_valid, e.processed_at],
      );
    },
  };
}
