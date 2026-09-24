import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type { AdminRecoveryCodeRecord, DataExportRequestRecord, TrustRepo, WarrantyClaimRecord } from '../types';

const LIVE_CLAIM: readonly string[] = ['OPEN', 'ACCEPTED', 'REVISIT_BOOKED', 'ESCALATED'];

/** In-memory trust repository mirroring the constraints in 0012_warranty_and_trust.sql. */
export function createMemoryTrustRepo(): TrustRepo {
  const claims = new Map<string, WarrantyClaimRecord>();
  const recoveryCodes: AdminRecoveryCodeRecord[] = [];
  const exports: DataExportRequestRecord[] = [];
  const now = () => new Date();

  return {
    async createClaim(c) {
      // mirrors warranty_claims_one_open_idx
      if ([...claims.values()].some((x) => x.job_id === c.job_id && LIVE_CLAIM.includes(x.status))) {
        throw conflict({ reason: 'claim_already_open' });
      }
      // mirrors warranty_claim_in_window_trg
      if (c.covered_until < now()) throw conflict({ reason: 'warranty_expired', jobId: c.job_id });
      const rec: WarrantyClaimRecord = { ...c, id: newId(), created_at: now(), updated_at: now() } as WarrantyClaimRecord;
      claims.set(rec.id, rec);
      return rec;
    },
    async getClaim(id) {
      return claims.get(id) ?? null;
    },
    async updateClaim(id, patch) {
      const c = claims.get(id);
      if (!c) throw new Error('claim not found');
      const next = { ...c, ...patch, updated_at: now() };
      claims.set(id, next);
      return next;
    },
    async findOpenClaim(jobId) {
      return [...claims.values()].find((c) => c.job_id === jobId && LIVE_CLAIM.includes(c.status)) ?? null;
    },
    async listClaimsForCustomer(customerId, limit) {
      return [...claims.values()]
        .filter((c) => c.customer_id === customerId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
    async listClaimsForProvider(providerId, limit) {
      return [...claims.values()]
        .filter((c) => c.provider_id === providerId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
    async listClaimsByStatus(statuses, limit) {
      return [...claims.values()]
        .filter((c) => statuses.includes(c.status))
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);
    },

    async replaceRecoveryCodes(userId, hashes) {
      // Generating a new set invalidates the old one outright: half-old, half-new would mean
      // somebody holding a printout could not tell which of their codes still work.
      for (let i = recoveryCodes.length - 1; i >= 0; i--) {
        if (recoveryCodes[i]!.user_id === userId) recoveryCodes.splice(i, 1);
      }
      for (const hash of hashes) {
        recoveryCodes.push({ id: newId(), user_id: userId, code_hash: hash, used_at: null, used_from_ip: null, created_at: now() });
      }
    },
    async listRecoveryCodes(userId) {
      return recoveryCodes.filter((c) => c.user_id === userId && !c.used_at);
    },
    async burnRecoveryCode(id, ip) {
      const i = recoveryCodes.findIndex((c) => c.id === id);
      if (i >= 0) recoveryCodes[i] = { ...recoveryCodes[i]!, used_at: now(), used_from_ip: ip };
    },

    async recordExport(r) {
      const rec: DataExportRequestRecord = { ...r, id: newId(), requested_at: now() } as DataExportRequestRecord;
      exports.push(Object.freeze(rec));
      return rec;
    },
  };
}
