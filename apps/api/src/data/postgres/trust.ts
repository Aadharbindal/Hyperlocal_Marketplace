import type pg from 'pg';
import type {
  AdminRecoveryCodeRecord,
  DataExportRequestRecord,
  TrustRepo,
  WarrantyClaimRecord,
} from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };

export function createPostgresTrustRepo(q: Queryable): TrustRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> =>
    ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];
  const patchSql = (patch: Record<string, unknown>) => {
    const keys = Object.keys(patch);
    return { sets: keys.map((k, i) => `${k} = $${i + 2}`).join(', '), values: keys.map((k) => patch[k]) };
  };

  return {
    async createClaim(c) {
      return (await one<WarrantyClaimRecord>(
        `insert into warranty_claims (job_id, customer_id, provider_id, description, media_ids, status,
           warranty_days, covered_until, provider_response, responded_at, decline_reason, revisit_job_id,
           resolved_at, resolution_note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [c.job_id, c.customer_id, c.provider_id, c.description, c.media_ids, c.status, c.warranty_days,
          c.covered_until, c.provider_response, c.responded_at, c.decline_reason, c.revisit_job_id,
          c.resolved_at, c.resolution_note],
      ))!;
    },
    getClaim: (id) => one<WarrantyClaimRecord>('select * from warranty_claims where id = $1', [id]),
    async updateClaim(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>);
      return (await one<WarrantyClaimRecord>(`update warranty_claims set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    findOpenClaim: (jobId) =>
      one<WarrantyClaimRecord>(
        `select * from warranty_claims where job_id = $1
           and status in ('OPEN','ACCEPTED','REVISIT_BOOKED','ESCALATED') limit 1`,
        [jobId],
      ),
    listClaimsForCustomer: (customerId, limit) =>
      many<WarrantyClaimRecord>('select * from warranty_claims where customer_id = $1 order by created_at desc limit $2', [customerId, limit]),
    listClaimsForProvider: (providerId, limit) =>
      many<WarrantyClaimRecord>('select * from warranty_claims where provider_id = $1 order by created_at desc limit $2', [providerId, limit]),
    listClaimsByStatus: (statuses, limit) =>
      many<WarrantyClaimRecord>(
        'select * from warranty_claims where status = any($1::warranty_claim_status[]) order by created_at asc limit $2',
        [statuses, limit],
      ),

    async replaceRecoveryCodes(userId, hashes) {
      // A new set invalidates the old outright. Half-old and half-new would mean somebody
      // holding a printout cannot tell which of their codes still work.
      await q.query('delete from admin_recovery_codes where user_id = $1 and used_at is null', [userId]);
      for (const hash of hashes) {
        await q.query('insert into admin_recovery_codes (user_id, code_hash) values ($1,$2)', [userId, hash]);
      }
    },
    listRecoveryCodes: (userId) =>
      many<AdminRecoveryCodeRecord>('select * from admin_recovery_codes where user_id = $1 and used_at is null', [userId]),
    async burnRecoveryCode(id, ip) {
      await q.query('update admin_recovery_codes set used_at = now(), used_from_ip = $2 where id = $1', [id, ip]);
    },

    async recordExport(r) {
      return (await one<DataExportRequestRecord>(
        'insert into data_export_requests (user_id, status, record_counts) values ($1,$2,$3) returning *',
        [r.user_id, r.status, r.record_counts],
      ))!;
    },
  };
}
