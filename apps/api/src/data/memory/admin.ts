import { newId } from '../../lib/crypto';
import type { AdminMfaRecord, AdminRepo, KycAccessLogRecord } from '../types';

/** In-memory admin repository mirroring the constraints in 0008_admin.sql. */
export function createMemoryAdminRepo(): AdminRepo {
  const mfa = new Map<string, AdminMfaRecord>();
  const kycAccess: KycAccessLogRecord[] = [];
  const now = () => new Date();

  return {
    async getMfa(userId) {
      return mfa.get(userId) ?? null;
    },
    async upsertMfa(m) {
      const rec = { ...m, updated_at: now() };
      mfa.set(m.user_id, rec);
      return rec;
    },
    async updateMfa(userId, patch) {
      const m = mfa.get(userId);
      if (!m) throw new Error('mfa not enrolled');
      const next = { ...m, ...patch, updated_at: now() };
      mfa.set(userId, next);
      return next;
    },

    async logKycAccess(entry) {
      // this log is the evidence that a look at someone's ID was legitimate, so it is frozen
      const rec: KycAccessLogRecord = { ...entry, id: newId(), created_at: now() } as KycAccessLogRecord;
      kycAccess.push(Object.freeze(rec));
      return rec;
    },
    async listKycAccess(kycRecordId, limit) {
      return kycAccess
        .filter((a) => a.kyc_record_id === kycRecordId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
  };
}
