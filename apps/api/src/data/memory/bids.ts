import type { BidStatus } from '@hyperlocal/core';
import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type { BidRecord, BidRevisionRecord, BidsRepo, KycRecord, KycRepo } from '../types';

/** In-memory bids repository mirroring the constraints in 0003_bidding.sql. */
export function createMemoryBidsRepo(): BidsRepo {
  const bids = new Map<string, BidRecord>();
  const revisions: BidRevisionRecord[] = [];
  const now = () => new Date();

  const activeFor = (jobId: string, providerId: string) =>
    [...bids.values()].find((b) => b.job_id === jobId && b.provider_id === providerId && b.status === 'ACTIVE') ?? null;

  return {
    async create(b) {
      // mirrors bids_one_active_per_provider_idx
      if ((b.status ?? 'ACTIVE') === 'ACTIVE' && activeFor(b.job_id, b.provider_id)) {
        throw conflict({ reason: 'active_bid_exists' });
      }
      const rec: BidRecord = { ...b, id: b.id ?? newId(), created_at: now(), updated_at: now() } as BidRecord;
      bids.set(rec.id, rec);
      return rec;
    },
    async get(id) {
      return bids.get(id) ?? null;
    },
    async update(id, patch) {
      const b = bids.get(id);
      if (!b) throw new Error('bid not found');
      const next = { ...b, ...patch, updated_at: now() };
      bids.set(id, next);
      return next;
    },
    async listForJob(jobId, statuses) {
      return [...bids.values()]
        .filter((b) => b.job_id === jobId && (!statuses || statuses.includes(b.status)))
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    },
    async listForProvider(providerId, statuses) {
      return [...bids.values()]
        .filter((b) => b.provider_id === providerId && (!statuses || statuses.includes(b.status)))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async findActive(jobId, providerId) {
      return activeFor(jobId, providerId);
    },
    async addRevision(r) {
      const rec: BidRevisionRecord = { ...r, id: newId(), created_at: now() };
      revisions.push(rec);
      return rec;
    },
    async listRevisions(bidId) {
      return revisions.filter((r) => r.bid_id === bidId).sort((a, b) => a.revision_no - b.revision_no);
    },
  };
}

export function createMemoryKycRepo(): KycRepo {
  const records = new Map<string, KycRecord>();
  const now = () => new Date();
  const OPEN = ['SUBMITTED', 'UNDER_REVIEW'];

  return {
    async submit(k) {
      // mirrors kyc_records_open_idx: one open submission per user and document type
      const open = [...records.values()].find((r) => r.user_id === k.user_id && r.document_type === k.document_type && OPEN.includes(r.status));
      if (open) throw conflict({ reason: 'kyc_already_submitted' });
      const rec: KycRecord = { ...k, id: newId(), created_at: now(), updated_at: now() } as KycRecord;
      records.set(rec.id, rec);
      return rec;
    },
    async listForUser(userId) {
      return [...records.values()].filter((r) => r.user_id === userId).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async findOpen(userId, documentType) {
      return [...records.values()].find((r) => r.user_id === userId && r.document_type === documentType && OPEN.includes(r.status)) ?? null;
    },
    async update(id, patch) {
      const r = records.get(id);
      if (!r) throw new Error('kyc record not found');
      const next = { ...r, ...patch, updated_at: now() };
      records.set(id, next);
      return next;
    },
  };
}

export type { BidStatus };
