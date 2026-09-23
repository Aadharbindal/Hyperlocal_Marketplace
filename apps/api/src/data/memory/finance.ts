import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type {
  DisputeEvidenceRecord,
  DisputeRecord,
  FinanceRepo,
  LedgerEntryRecord,
  RefundRecord,
  ReviewRecord,
  SettlementRecord,
  StrikeRecord,
  SupportTicketRecord,
} from '../types';

const OPEN_DISPUTE: readonly string[] = ['OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED', 'REOPENED'];

/** In-memory finance repository mirroring the constraints in 0007_finance.sql. */
export function createMemoryFinanceRepo(): FinanceRepo {
  const ledger: LedgerEntryRecord[] = [];
  const settlements = new Map<string, SettlementRecord>();
  const refunds = new Map<string, RefundRecord>();
  const disputes = new Map<string, DisputeRecord>();
  const evidence: DisputeEvidenceRecord[] = [];
  const strikes: StrikeRecord[] = [];
  const reviews = new Map<string, ReviewRecord>();
  const tickets = new Map<string, SupportTicketRecord>();
  const now = () => new Date();

  return {
    async appendLedger(batch) {
      if (batch.length === 0) return [];
      // mirrors ledger_entries_idempotency_idx: a replayed batch writes nothing
      const key = batch[0]!.idempotency_key;
      if (ledger.some((e) => e.idempotency_key === key)) return [];
      // and the balance check the service does is worth having here too
      const sum = batch.reduce((t, e) => t + e.amount_paise, 0);
      if (sum !== 0) throw conflict({ reason: 'ledger_batch_unbalanced', sum });
      const written = batch.map((e, i) => {
        const rec: LedgerEntryRecord = {
          ...e,
          id: newId(),
          currency: 'INR',
          // each line needs its own key so the unique index still means something
          idempotency_key: i === 0 ? e.idempotency_key : `${e.idempotency_key}:${i}`,
          created_at: now(),
        } as LedgerEntryRecord;
        ledger.push(Object.freeze(rec));
        return rec;
      });
      return written;
    },
    async listLedgerForAccount(userId, limit) {
      return ledger
        .filter((e) => e.account_user_id === userId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
    async listLedgerForJob(jobId) {
      return ledger.filter((e) => e.job_id === jobId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    },
    async ledgerKeyExists(idempotencyKey) {
      return ledger.some((e) => e.idempotency_key === idempotencyKey);
    },

    async createSettlement(s) {
      if ([...settlements.values()].some((x) => x.idempotency_key === s.idempotency_key)) {
        throw conflict({ reason: 'settlement_exists' });
      }
      const rec: SettlementRecord = { ...s, id: newId(), created_at: now(), updated_at: now() } as SettlementRecord;
      settlements.set(rec.id, rec);
      return rec;
    },
    async getSettlement(id) {
      return settlements.get(id) ?? null;
    },
    async updateSettlement(id, patch) {
      const s = settlements.get(id);
      if (!s) throw new Error('settlement not found');
      const next = { ...s, ...patch, updated_at: now() };
      settlements.set(id, next);
      return next;
    },
    async findSettlement(idempotencyKey) {
      return [...settlements.values()].find((s) => s.idempotency_key === idempotencyKey) ?? null;
    },
    async listSettlementsForPayee(payeeId, limit) {
      return [...settlements.values()]
        .filter((s) => s.payee_id === payeeId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
    async listSettlementsByStatus(status, limit) {
      return [...settlements.values()]
        .filter((s) => s.status === status)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);
    },

    async createRefund(r) {
      if ([...refunds.values()].some((x) => x.idempotency_key === r.idempotency_key)) {
        throw conflict({ reason: 'refund_exists' });
      }
      const rec: RefundRecord = { ...r, id: newId(), created_at: now(), updated_at: now() } as RefundRecord;
      refunds.set(rec.id, rec);
      return rec;
    },
    async updateRefund(id, patch) {
      const r = refunds.get(id);
      if (!r) throw new Error('refund not found');
      const next = { ...r, ...patch, updated_at: now() };
      refunds.set(id, next);
      return next;
    },
    async findRefund(idempotencyKey) {
      return [...refunds.values()].find((r) => r.idempotency_key === idempotencyKey) ?? null;
    },
    async listRefundsForJob(jobId) {
      return [...refunds.values()]
        .filter((r) => r.job_id === jobId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },

    async createDispute(d) {
      // mirrors disputes_one_open_per_job_idx
      if ([...disputes.values()].some((x) => x.job_id === d.job_id && OPEN_DISPUTE.includes(x.status))) {
        throw conflict({ reason: 'dispute_already_open' });
      }
      const rec: DisputeRecord = { ...d, id: newId(), created_at: now(), updated_at: now() } as DisputeRecord;
      disputes.set(rec.id, rec);
      return rec;
    },
    async getDispute(id) {
      return disputes.get(id) ?? null;
    },
    async updateDispute(id, patch) {
      const d = disputes.get(id);
      if (!d) throw new Error('dispute not found');
      const next = { ...d, ...patch, updated_at: now() };
      // mirrors disputes_two_person_refund_trg
      if ((next.refund_paise ?? 0) > 500000) {
        if (!next.second_approver_id) throw conflict({ reason: 'second_approver_required' });
        if (next.second_approver_id === next.resolved_by) throw conflict({ reason: 'second_approver_must_differ' });
      }
      disputes.set(id, next);
      return next;
    },
    async listDisputesForJob(jobId) {
      return [...disputes.values()]
        .filter((d) => d.job_id === jobId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async findOpenDispute(jobId) {
      return [...disputes.values()].find((d) => d.job_id === jobId && OPEN_DISPUTE.includes(d.status)) ?? null;
    },
    async listDisputesByStatus(statuses, limit) {
      return [...disputes.values()]
        .filter((d) => statuses.includes(d.status))
        .sort((a, b) => a.sla_due_at.getTime() - b.sla_due_at.getTime())
        .slice(0, limit);
    },
    async addEvidence(e) {
      const rec: DisputeEvidenceRecord = { ...e, id: newId(), created_at: now() } as DisputeEvidenceRecord;
      evidence.push(Object.freeze(rec));
      return rec;
    },
    async listEvidence(disputeId) {
      return evidence.filter((e) => e.dispute_id === disputeId);
    },

    async addStrike(s) {
      const rec: StrikeRecord = { ...s, id: newId(), created_at: now() } as StrikeRecord;
      strikes.push(Object.freeze(rec));
      return rec;
    },
    async listStrikes(userId) {
      return strikes.filter((s) => s.user_id === userId).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },

    async createReview(r) {
      // mirrors unique (job_id, reviewer_id)
      if ([...reviews.values()].some((x) => x.job_id === r.job_id && x.reviewer_id === r.reviewer_id)) {
        throw conflict({ reason: 'already_reviewed' });
      }
      const rec: ReviewRecord = { ...r, id: newId(), created_at: now() } as ReviewRecord;
      reviews.set(rec.id, rec);
      return rec;
    },
    async listReviewsFor(revieweeId, limit) {
      return [...reviews.values()]
        .filter((r) => r.reviewee_id === revieweeId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },
    async findReview(jobId, reviewerId) {
      return [...reviews.values()].find((r) => r.job_id === jobId && r.reviewer_id === reviewerId) ?? null;
    },

    async createTicket(t) {
      const rec: SupportTicketRecord = { ...t, id: newId(), created_at: now(), updated_at: now() } as SupportTicketRecord;
      tickets.set(rec.id, rec);
      return rec;
    },
    async listTickets(filter) {
      return [...tickets.values()]
        .filter((t) => (!filter.status || t.status === filter.status) && (!filter.openedBy || t.opened_by === filter.openedBy))
        .sort((a, b) => a.priority - b.priority || b.created_at.getTime() - a.created_at.getTime())
        .slice(0, filter.limit);
    },
    async updateTicket(id, patch) {
      const t = tickets.get(id);
      if (!t) throw new Error('ticket not found');
      const next = { ...t, ...patch, updated_at: now() };
      tickets.set(id, next);
      return next;
    },
  };
}
