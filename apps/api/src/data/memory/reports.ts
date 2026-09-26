import type { JobRecord, KycRecord, LedgerEntryRecord, OpsOverview, ProviderProfileRecord, ReportsRepo, SettlementRecord, DisputeRecord, UserRecord } from '../types';

const OPEN_DISPUTE: readonly string[] = ['OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED', 'REOPENED'];
const OPEN_KYC: readonly string[] = ['SUBMITTED', 'UNDER_REVIEW'];

interface Sources {
  jobs: () => JobRecord[];
  ledger: () => LedgerEntryRecord[];
  settlements: () => SettlementRecord[];
  disputes: () => DisputeRecord[];
  kyc: () => KycRecord[];
  providerProfiles: () => ProviderProfileRecord[];
  users: () => UserRecord[];
}

/**
 * The ops report in memory mode, mirroring `postgres/reports.ts` field for field.
 *
 * This is the usual memory-store bargain: the numbers have to come out the same as the SQL
 * aggregates or the integration suite is proving something about a fiction. Both sides read
 * whole collections - no limit, no sample - because the point of rewriting this report was that
 * the old one quietly truncated and an operator could not tell.
 */
export function createMemoryReports(src: Sources): ReportsRepo {
  return {
    async opsOverview(now) {
      const jobsByStatus: Record<string, number> = {};
      for (const j of src.jobs()) {
        if (j.deleted_at) continue;
        jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;
      }

      let captured = 0;
      let refunded = 0;
      let revenue = 0;
      for (const e of src.ledger()) {
        const amount = Number(e.amount_paise);
        if (e.entry_type === 'CUSTOMER_CHARGE') captured += amount;
        if (e.entry_type === 'REFUND') refunded += -amount;
        if (e.entry_type === 'PLATFORM_REVENUE') revenue += -amount;
      }

      let pending = 0;
      let paid = 0;
      for (const s of src.settlements()) {
        const amount = Number(s.amount_paise);
        if (s.status === 'PENDING' || s.status === 'INITIATED' || s.status === 'ON_HOLD') pending += amount;
        if (s.status === 'PAID') paid += amount;
      }

      const open = src.disputes().filter((d) => OPEN_DISPUTE.includes(d.status));
      const suspended = new Set(src.users().filter((u) => u.status === 'SUSPENDED').map((u) => u.id));
      const providers = src.providerProfiles();

      return {
        jobsByStatus,
        capturedPaise: captured,
        refundedPaise: refunded,
        platformRevenuePaise: revenue,
        payoutsPendingPaise: pending,
        payoutsPaidPaise: paid,
        disputesOpen: open.length,
        disputesBreachingSla: open.filter((d) => d.sla_due_at < now).length,
        kycPending: src.kyc().filter((k) => OPEN_KYC.includes(k.status)).length,
        providersVerified: providers.filter((p) => p.verification_status === 'VERIFIED').length,
        providersSuspended: providers.filter((p) => suspended.has(p.user_id)).length,
      } satisfies OpsOverview;
    },
  };
}
