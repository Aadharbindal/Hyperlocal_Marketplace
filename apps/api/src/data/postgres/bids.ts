import type { BidRecord, BidRevisionRecord, BidsRepo, KycRecord, KycRepo } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

/** PostgreSQL bids repository against supabase/migrations/0003_bidding.sql. */
export function createPostgresBidsRepo(q: Queryable): BidsRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async create(b) {
      return (await one<BidRecord>(
        `insert into bids (job_id, provider_id, contractor_id, labour_paise, visit_fee_paise, eta_minutes,
           warranty_days, material_responsibility, notes, revision_no, status, expires_at, withdrawn_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [b.job_id, b.provider_id, b.contractor_id, b.labour_paise, b.visit_fee_paise, b.eta_minutes, b.warranty_days,
          b.material_responsibility, b.notes, b.revision_no, b.status, b.expires_at, b.withdrawn_reason],
      ))!;
    },
    get: (id) => one<BidRecord>('select * from bids where id = $1', [id]),
    async update(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<BidRecord>(`update bids set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listForJob: (jobId, statuses) =>
      many<BidRecord>(
        `select * from bids where job_id = $1 and ($2::bid_status[] is null or status = any($2)) order by created_at`,
        [jobId, statuses ?? null],
      ),
    listForProvider: (providerId, statuses) =>
      many<BidRecord>(
        `select * from bids where provider_id = $1 and ($2::bid_status[] is null or status = any($2)) order by created_at desc`,
        [providerId, statuses ?? null],
      ),
    findActive: (jobId, providerId) =>
      one<BidRecord>("select * from bids where job_id = $1 and provider_id = $2 and status = 'ACTIVE'", [jobId, providerId]),
    async addRevision(r) {
      return (await one<BidRevisionRecord>(
        `insert into bid_revisions (bid_id, revision_no, labour_paise, visit_fee_paise, eta_minutes, warranty_days, notes)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [r.bid_id, r.revision_no, r.labour_paise, r.visit_fee_paise, r.eta_minutes, r.warranty_days, r.notes],
      ))!;
    },
    listRevisions: (bidId) => many<BidRevisionRecord>('select * from bid_revisions where bid_id = $1 order by revision_no', [bidId]),
  };
}

export function createPostgresKycRepo(q: Queryable): KycRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async submit(k) {
      return (await one<KycRecord>(
        `insert into kyc_records (user_id, document_type, storage_key_encrypted, doc_number_last4, status)
         values ($1,$2,$3,$4,$5) returning *`,
        [k.user_id, k.document_type, k.storage_key_encrypted, k.doc_number_last4, k.status],
      ))!;
    },
    get: (id) => one<KycRecord>('select * from kyc_records where id = $1', [id]),
    listByStatus: (statuses, limit) =>
      many<KycRecord>('select * from kyc_records where status = any($1) order by created_at limit $2', [statuses, limit]),
    listForUser: (userId) => many<KycRecord>('select * from kyc_records where user_id = $1 order by created_at desc', [userId]),
    findOpen: (userId, documentType) =>
      one<KycRecord>(
        "select * from kyc_records where user_id = $1 and document_type = $2 and status in ('SUBMITTED','UNDER_REVIEW')",
        [userId, documentType],
      ),
    async update(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<KycRecord>(`update kyc_records set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
  };
}
