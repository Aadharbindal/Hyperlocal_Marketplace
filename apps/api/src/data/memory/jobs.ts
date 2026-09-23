import type { JobStatus } from '@hyperlocal/core';
import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type { JobMediaRecord, JobRecord, JobStatusEventRecord, JobsRepo } from '../types';

const OPEN_STATUSES: JobStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'QUALIFYING',
  'OPEN_FOR_BIDS',
  'BID_RECEIVED',
  'NEGOTIATING',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
];

/** In-memory jobs repository mirroring the constraints in 0002_jobs.sql. */
export function createMemoryJobsRepo(): JobsRepo & { _events: JobStatusEventRecord[] } {
  const jobs = new Map<string, JobRecord>();
  const media = new Map<string, JobMediaRecord>();
  const events: JobStatusEventRecord[] = [];
  const now = () => new Date();

  const liveDraft = (customerId: string, categoryId: string, addressId: string | null) =>
    [...jobs.values()].find(
      (j) => j.customer_id === customerId && j.category_id === categoryId && (j.address_id ?? null) === addressId && j.status === 'DRAFT' && !j.deleted_at,
    ) ?? null;

  return {
    _events: events,

    async create(j) {
      // mirrors jobs_one_draft_per_target_idx
      if ((j.status ?? 'DRAFT') === 'DRAFT' && liveDraft(j.customer_id, j.category_id, j.address_id ?? null)) {
        throw conflict({ reason: 'draft_exists' });
      }
      const rec: JobRecord = { ...j, id: j.id ?? newId(), created_at: now(), updated_at: now() } as JobRecord;
      jobs.set(rec.id, rec);
      return rec;
    },
    async get(id) {
      const j = jobs.get(id);
      return j && !j.deleted_at ? j : null;
    },
    async getByTrackingToken(token) {
      for (const j of jobs.values()) if (j.recipient_tracking_token === token && !j.deleted_at) return j;
      return null;
    },
    async update(id, patch) {
      const j = jobs.get(id);
      if (!j) throw new Error('job not found');
      const next = { ...j, ...patch, updated_at: now() };
      jobs.set(id, next);
      return next;
    },
    async listForCustomer(customerId, opts) {
      return [...jobs.values()]
        .filter((j) => j.customer_id === customerId && !j.deleted_at && (!opts.statuses || opts.statuses.includes(j.status)))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, opts.limit);
    },
    async findOpenForTarget(customerId, categoryId, addressId) {
      return [...jobs.values()].filter(
        (j) =>
          j.customer_id === customerId &&
          j.category_id === categoryId &&
          (j.address_id ?? null) === addressId &&
          !j.deleted_at &&
          OPEN_STATUSES.includes(j.status),
      );
    },
    async findDraft(customerId, categoryId, addressId) {
      return liveDraft(customerId, categoryId, addressId);
    },
    async listByStatus(statuses, limit) {
      return [...jobs.values()]
        .filter((j) => statuses.includes(j.status))
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);
    },
    async listOpenForFeed({ categoryIds, limit }) {
      const open: JobStatus[] = ['OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING'];
      return [...jobs.values()]
        .filter((j) => !j.deleted_at && open.includes(j.status) && categoryIds.includes(j.category_id))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit);
    },

    async addMedia(m) {
      // mirrors job_media_job_hash_idx: the same file twice on one job is a retry
      if (m.sha256) {
        const dup = [...media.values()].find((x) => x.job_id === m.job_id && x.sha256 === m.sha256 && !x.deleted_at);
        if (dup) return dup;
      }
      const rec: JobMediaRecord = { ...m, id: m.id ?? newId(), created_at: now() } as JobMediaRecord;
      media.set(rec.id, rec);
      return rec;
    },
    async listMedia(jobId, phase) {
      return [...media.values()]
        .filter((m) => m.job_id === jobId && !m.deleted_at && (!phase || m.phase === phase))
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    },
    async getMedia(id) {
      const m = media.get(id);
      return m && !m.deleted_at ? m : null;
    },
    async updateMedia(id, patch) {
      const m = media.get(id);
      if (!m) throw new Error('media not found');
      const next = { ...m, ...patch };
      media.set(id, next);
      return next;
    },

    async appendEvent(e) {
      const rec: JobStatusEventRecord = { ...e, id: newId(), created_at: now() };
      events.push(Object.freeze(rec));
      return rec;
    },
    async listEvents(jobId) {
      return events.filter((e) => e.job_id === jobId);
    },
  };
}
