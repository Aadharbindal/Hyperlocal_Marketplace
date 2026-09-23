import type {
  DisputeEvidenceRecord,
  DisputeRecord,
  FinanceRepo,
  LedgerEntryRecord,
  PayoutAccountRecord,
  RefundRecord,
  ReviewRecord,
  SettlementRecord,
  StrikeRecord,
  SupportTicketRecord,
} from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

const OPEN_DISPUTE = "('OPEN','UNDER_REVIEW','AWAITING_PARTY','ESCALATED','REOPENED')";

/** PostgreSQL finance repository against supabase/migrations/0007_finance.sql. */
export function createPostgresFinanceRepo(q: Queryable): FinanceRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async appendLedger(batch) {
      if (batch.length === 0) return [];
      const key = batch[0]!.idempotency_key;
      const seen = await one<{ id: string }>('select id from ledger_entries where idempotency_key = $1', [key]);
      if (seen) return [];
      const rows: LedgerEntryRecord[] = [];
      for (const [i, e] of batch.entries()) {
        const row = await one<LedgerEntryRecord>(
          `insert into ledger_entries (job_id, payment_id, entry_type, account_user_id, amount_paise, batch_id,
             idempotency_key, reference_type, reference_id, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
          [e.job_id, e.payment_id, e.entry_type, e.account_user_id, e.amount_paise, e.batch_id,
            i === 0 ? e.idempotency_key : `${e.idempotency_key}:${i}`, e.reference_type, e.reference_id, e.note, e.created_by],
        );
        if (row) rows.push(row);
      }
      return rows;
    },
    listLedgerForAccount: (userId, limit) =>
      many<LedgerEntryRecord>('select * from ledger_entries where account_user_id = $1 order by created_at desc limit $2', [userId, limit]),
    listLedgerForJob: (jobId) => many<LedgerEntryRecord>('select * from ledger_entries where job_id = $1 order by created_at', [jobId]),
    async ledgerKeyExists(idempotencyKey) {
      return !!(await one('select 1 from ledger_entries where idempotency_key = $1', [idempotencyKey]));
    },

    async createSettlement(s) {
      return (await one<SettlementRecord>(
        `insert into settlements (job_id, payee_id, payee_role, material_order_id, amount_paise, status, attempts,
           failure_reason, provider_transfer_id, idempotency_key, initiated_at, paid_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [s.job_id, s.payee_id, s.payee_role, s.material_order_id, s.amount_paise, s.status, s.attempts,
          s.failure_reason, s.provider_transfer_id, s.idempotency_key, s.initiated_at, s.paid_at],
      ))!;
    },
    getSettlement: (id) => one<SettlementRecord>('select * from settlements where id = $1', [id]),
    async updateSettlement(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<SettlementRecord>(`update settlements set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    findSettlement: (key) => one<SettlementRecord>('select * from settlements where idempotency_key = $1', [key]),
    listSettlementsForPayee: (payeeId, limit) =>
      many<SettlementRecord>('select * from settlements where payee_id = $1 order by created_at desc limit $2', [payeeId, limit]),
    listSettlementsByStatus: (status, limit) =>
      many<SettlementRecord>('select * from settlements where status = $1 order by created_at limit $2', [status, limit]),

    async createRefund(r) {
      return (await one<RefundRecord>(
        `insert into refunds (payment_id, job_id, amount_paise, reason, status, provider_refund_id, idempotency_key,
           requested_by, dispute_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [r.payment_id, r.job_id, r.amount_paise, r.reason, r.status, r.provider_refund_id, r.idempotency_key, r.requested_by, r.dispute_id],
      ))!;
    },
    async updateRefund(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<RefundRecord>(`update refunds set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    findRefund: (key) => one<RefundRecord>('select * from refunds where idempotency_key = $1', [key]),
    listRefundsForJob: (jobId) => many<RefundRecord>('select * from refunds where job_id = $1 order by created_at desc', [jobId]),

    async createDispute(d) {
      return (await one<DisputeRecord>(
        `insert into disputes (job_id, raised_by, against_user_id, category, description, status, resolution,
           resolution_reason, refund_paise, resolved_by, second_approver_id, resolved_at, reopened_count, sla_due_at,
           assigned_to, queue_note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
        [d.job_id, d.raised_by, d.against_user_id, d.category, d.description, d.status, d.resolution,
          d.resolution_reason, d.refund_paise, d.resolved_by, d.second_approver_id, d.resolved_at, d.reopened_count,
          d.sla_due_at, d.assigned_to, d.queue_note],
      ))!;
    },
    getDispute: (id) => one<DisputeRecord>('select * from disputes where id = $1', [id]),
    async updateDispute(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<DisputeRecord>(`update disputes set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listDisputesForJob: (jobId) => many<DisputeRecord>('select * from disputes where job_id = $1 order by created_at desc', [jobId]),
    findOpenDispute: (jobId) => one<DisputeRecord>(`select * from disputes where job_id = $1 and status in ${OPEN_DISPUTE}`, [jobId]),
    listDisputesByStatus: (statuses, limit) =>
      many<DisputeRecord>('select * from disputes where status = any($1) order by sla_due_at limit $2', [statuses, limit]),
    async addEvidence(e) {
      return (await one<DisputeEvidenceRecord>(
        'insert into dispute_evidence (dispute_id, uploaded_by, media_id, note) values ($1,$2,$3,$4) returning *',
        [e.dispute_id, e.uploaded_by, e.media_id, e.note],
      ))!;
    },
    listEvidence: (disputeId) => many<DisputeEvidenceRecord>('select * from dispute_evidence where dispute_id = $1 order by created_at', [disputeId]),

    async addStrike(s) {
      return (await one<StrikeRecord>(
        'insert into strikes (user_id, severity, reason, issued_by, dispute_id, job_id, expires_at) values ($1,$2,$3,$4,$5,$6,$7) returning *',
        [s.user_id, s.severity, s.reason, s.issued_by, s.dispute_id, s.job_id, s.expires_at],
      ))!;
    },
    listStrikes: (userId) => many<StrikeRecord>('select * from strikes where user_id = $1 order by created_at desc', [userId]),

    async createReview(r) {
      return (await one<ReviewRecord>(
        'insert into reviews (job_id, reviewer_id, reviewee_id, rating, comment) values ($1,$2,$3,$4,$5) returning *',
        [r.job_id, r.reviewer_id, r.reviewee_id, r.rating, r.comment],
      ))!;
    },
    listReviewsFor: (revieweeId, limit) =>
      many<ReviewRecord>('select * from reviews where reviewee_id = $1 order by created_at desc limit $2', [revieweeId, limit]),
    findReview: (jobId, reviewerId) => one<ReviewRecord>('select * from reviews where job_id = $1 and reviewer_id = $2', [jobId, reviewerId]),

    async createPayoutAccount(a) {
      // changing where money goes replaces the old account rather than adding a second one
      await q.query(
        "update payout_accounts set status = 'DISABLED' where user_id = $1 and status in ('PENDING','VERIFIED')",
        [a.user_id],
      );
      return (await one<PayoutAccountRecord>(
        `insert into payout_accounts (user_id, method, account_holder_name, account_last4, ifsc, vpa,
           provider_contact_id, provider_fund_account_id, status, verified_at, rejection_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [a.user_id, a.method, a.account_holder_name, a.account_last4, a.ifsc, a.vpa, a.provider_contact_id,
          a.provider_fund_account_id, a.status, a.verified_at, a.rejection_reason],
      ))!;
    },
    getPayoutAccount: (userId) =>
      one<PayoutAccountRecord>(
        "select * from payout_accounts where user_id = $1 and status in ('VERIFIED','PENDING') order by created_at desc limit 1",
        [userId],
      ),
    async updatePayoutAccount(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<PayoutAccountRecord>(`update payout_accounts set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },

    async createTicket(t) {
      return (await one<SupportTicketRecord>(
        `insert into support_tickets (opened_by, job_id, dispute_id, category, subject, body, status, assigned_to, priority, closed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [t.opened_by, t.job_id, t.dispute_id, t.category, t.subject, t.body, t.status, t.assigned_to, t.priority, t.closed_at],
      ))!;
    },
    listTickets: (filter) =>
      many<SupportTicketRecord>(
        `select * from support_tickets
         where ($1::text is null or status = $1::ticket_status) and ($2::uuid is null or opened_by = $2)
         order by priority, created_at desc limit $3`,
        [filter.status ?? null, filter.openedBy ?? null, filter.limit],
      ),
    async updateTicket(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<SupportTicketRecord>(`update support_tickets set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
  };
}
