import type { OpsOverview, ReportsRepo } from '../types';

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * The operations overview, answered by the database.
 *
 * The previous version walked the store: up to 500 customers, up to 200 jobs each, and one
 * ledger read per job. Two things were wrong with that. The obvious one is cost - several
 * thousand round trips to render one screen. The one that mattered more is that it was
 * *silently truncated*: the 501st customer did not count, and the report said nothing about it,
 * so an operator could not tell a quiet week from a missing thousand jobs. A number that might
 * be wrong by an unknown amount is worse than no number, because people make decisions on it.
 *
 * Six aggregates, each over whole tables, run in parallel. The live/completed groupings are done
 * by the caller from `jobsByStatus`, so the definition of "live" stays in one place in the
 * domain rather than being half here in SQL.
 */
export function postgresReports(q: Queryable): ReportsRepo {
  const rows = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async opsOverview(now) {
      const [jobRows, ledgerRows, settlementRows, disputeRows, kycRows, providerRows] = await Promise.all([
        rows<{ status: string; n: string }>('select status, count(*)::text as n from jobs where deleted_at is null group by status'),

        // Signs follow the ledger's own convention, which the walking version also relied on:
        // a customer charge is positive, revenue and refunds are negative as seen from the
        // platform's side. Negating here keeps the report's fields all positive, the way an
        // operator reads them.
        rows<{ entry_type: string; total: string }>(
          `select entry_type, coalesce(sum(amount_paise), 0)::text as total
             from ledger_entries
            where entry_type in ('CUSTOMER_CHARGE', 'REFUND', 'PLATFORM_REVENUE')
            group by entry_type`,
        ),

        rows<{ status: string; total: string }>(
          'select status, coalesce(sum(amount_paise), 0)::text as total from settlements group by status',
        ),

        // Open disputes and the subset past their promised answer time, in one pass. The status
        // list mirrors `countSlaBreaches` in core; both are the same rule about what "still
        // somebody's problem" means.
        rows<{ open: string; breaching: string }>(
          `select count(*)::text as open,
                  count(*) filter (where sla_due_at < $1)::text as breaching
             from disputes
            where status in ('OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED', 'REOPENED')`,
          [now],
        ),

        rows<{ n: string }>(
          `select count(*)::text as n from kyc_records where status in ('SUBMITTED', 'UNDER_REVIEW')`,
        ),

        // A provider is suspended if the *account* is, which is where suspension is recorded -
        // the profile's verification_status is a separate question about their documents.
        rows<{ verified: string; suspended: string }>(
          `select count(*) filter (where p.verification_status = 'VERIFIED')::text as verified,
                  count(*) filter (where u.status = 'SUSPENDED')::text as suspended
             from provider_profiles p
             join users u on u.id = p.user_id`,
        ),
      ]);

      const jobsByStatus: Record<string, number> = {};
      for (const r of jobRows) jobsByStatus[r.status] = Number(r.n);

      const ledger = (type: string) => Number(ledgerRows.find((r) => r.entry_type === type)?.total ?? 0);
      const settled = (...statuses: string[]) =>
        settlementRows.filter((r) => statuses.includes(r.status)).reduce((t, r) => t + Number(r.total), 0);

      return {
        jobsByStatus,
        capturedPaise: ledger('CUSTOMER_CHARGE'),
        refundedPaise: -ledger('REFUND'),
        platformRevenuePaise: -ledger('PLATFORM_REVENUE'),
        payoutsPendingPaise: settled('PENDING', 'INITIATED', 'ON_HOLD'),
        payoutsPaidPaise: settled('PAID'),
        disputesOpen: Number(disputeRows[0]?.open ?? 0),
        disputesBreachingSla: Number(disputeRows[0]?.breaching ?? 0),
        kycPending: Number(kycRows[0]?.n ?? 0),
        providersVerified: Number(providerRows[0]?.verified ?? 0),
        providersSuspended: Number(providerRows[0]?.suspended ?? 0),
      } satisfies OpsOverview;
    },
  };
}
