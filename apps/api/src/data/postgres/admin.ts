import type { AdminMfaRecord, AdminRepo, KycAccessLogRecord } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

/** PostgreSQL admin repository against supabase/migrations/0008_admin.sql. */
export function createPostgresAdminRepo(q: Queryable): AdminRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    getMfa: (userId) => one<AdminMfaRecord>('select * from admin_mfa where user_id = $1', [userId]),
    async upsertMfa(m) {
      return (await one<AdminMfaRecord>(
        `insert into admin_mfa (user_id, secret_encrypted, enabled_at, last_used_step, failed_attempts, locked_until)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (user_id) do update set secret_encrypted = excluded.secret_encrypted,
           enabled_at = excluded.enabled_at, last_used_step = excluded.last_used_step,
           failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until
         returning *`,
        [m.user_id, m.secret_encrypted, m.enabled_at, m.last_used_step, m.failed_attempts, m.locked_until],
      ))!;
    },
    async updateMfa(userId, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<AdminMfaRecord>(`update admin_mfa set ${sets} where user_id = $1 returning *`, [userId, ...values]))!;
    },

    async logKycAccess(entry) {
      return (await one<KycAccessLogRecord>(
        'insert into kyc_access_log (kyc_record_id, viewed_by, purpose, ip) values ($1,$2,$3,$4) returning *',
        [entry.kyc_record_id, entry.viewed_by, entry.purpose, entry.ip],
      ))!;
    },
    listKycAccess: (kycRecordId, limit) =>
      many<KycAccessLogRecord>('select * from kyc_access_log where kyc_record_id = $1 order by created_at desc limit $2', [kycRecordId, limit]),
  };
}
