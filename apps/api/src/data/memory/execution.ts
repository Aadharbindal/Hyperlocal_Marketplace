import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type {
  ChatMessageRecord,
  ChatThreadRecord,
  CompletionRecord,
  ExecutionRepo,
  PriceRevisionRecord,
  StartOtpRecord,
} from '../types';

const OPEN_REVISION: readonly string[] = ['PENDING', 'CLARIFICATION'];

/** In-memory execution repository mirroring the constraints in 0005_execution.sql. */
export function createMemoryExecutionRepo(): ExecutionRepo {
  const otps = new Map<string, StartOtpRecord>();
  const revisions = new Map<string, PriceRevisionRecord>();
  const completions = new Map<string, CompletionRecord>();
  const threads = new Map<string, ChatThreadRecord>();
  const messages = new Map<string, ChatMessageRecord>();
  const now = () => new Date();

  return {
    async createStartOtp(o) {
      // mirrors start_otps_one_per_job_idx
      if ([...otps.values()].some((x) => x.job_id === o.job_id)) throw conflict({ reason: 'start_code_exists' });
      const rec: StartOtpRecord = { ...o, id: o.id ?? newId(), created_at: now(), updated_at: now() } as StartOtpRecord;
      otps.set(rec.id, rec);
      return rec;
    },
    async getStartOtp(jobId) {
      return [...otps.values()].find((o) => o.job_id === jobId) ?? null;
    },
    async updateStartOtp(id, patch) {
      const o = otps.get(id);
      if (!o) throw new Error('start code not found');
      const next = { ...o, ...patch, updated_at: now() };
      otps.set(id, next);
      return next;
    },

    async createRevision(r) {
      // mirrors price_revision_one_open_idx
      const open = [...revisions.values()].some((x) => x.job_id === r.job_id && OPEN_REVISION.includes(x.status));
      if (open) throw conflict({ reason: 'revision_already_open' });
      const rec: PriceRevisionRecord = { ...r, id: newId(), created_at: now(), updated_at: now() } as PriceRevisionRecord;
      revisions.set(rec.id, rec);
      return rec;
    },
    async getRevision(id) {
      return revisions.get(id) ?? null;
    },
    async updateRevision(id, patch) {
      const r = revisions.get(id);
      if (!r) throw new Error('revision not found');
      const next = { ...r, ...patch, updated_at: now() };
      revisions.set(id, next);
      return next;
    },
    async listRevisions(jobId) {
      return [...revisions.values()]
        .filter((r) => r.job_id === jobId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    async findOpenRevision(jobId) {
      return [...revisions.values()].find((r) => r.job_id === jobId && OPEN_REVISION.includes(r.status)) ?? null;
    },

    async createCompletion(c) {
      // mirrors job_completions_one_open_idx
      const open = [...completions.values()].some((x) => x.job_id === c.job_id && !x.approved_at);
      if (open) throw conflict({ reason: 'completion_already_submitted' });
      const rec: CompletionRecord = {
        ...c,
        id: newId(),
        submitted_at: now(),
        created_at: now(),
        updated_at: now(),
      } as CompletionRecord;
      completions.set(rec.id, rec);
      return rec;
    },
    async updateCompletion(id, patch) {
      const c = completions.get(id);
      if (!c) throw new Error('completion not found');
      const next = { ...c, ...patch, updated_at: now() };
      completions.set(id, next);
      return next;
    },
    async latestCompletion(jobId) {
      return (
        [...completions.values()]
          .filter((c) => c.job_id === jobId)
          .sort((a, b) => b.submitted_at.getTime() - a.submitted_at.getTime())[0] ?? null
      );
    },

    async ensureThread(jobId, participantIds) {
      const existing = [...threads.values()].find((t) => t.job_id === jobId);
      if (existing) {
        // a technician can join later, so keep the roster current
        const merged = [...new Set([...existing.participant_ids, ...participantIds])];
        if (merged.length !== existing.participant_ids.length) {
          const next = { ...existing, participant_ids: merged, updated_at: now() };
          threads.set(next.id, next);
          return next;
        }
        return existing;
      }
      const rec: ChatThreadRecord = {
        id: newId(),
        job_id: jobId,
        participant_ids: [...new Set(participantIds)],
        closed_at: null,
        created_at: now(),
        updated_at: now(),
      };
      threads.set(rec.id, rec);
      return rec;
    },
    async getThread(jobId) {
      return [...threads.values()].find((t) => t.job_id === jobId) ?? null;
    },
    async updateThread(id, patch) {
      const t = threads.get(id);
      if (!t) throw new Error('thread not found');
      const next = { ...t, ...patch, updated_at: now() };
      threads.set(id, next);
      return next;
    },
    async addMessage(m) {
      // mirrors chat_sender_on_thread_trg
      const thread = threads.get(m.thread_id);
      if (!thread || !thread.participant_ids.includes(m.sender_id)) throw conflict({ reason: 'not_on_thread' });
      const rec: ChatMessageRecord = { ...m, id: newId(), created_at: now() } as ChatMessageRecord;
      messages.set(rec.id, rec);
      return rec;
    },
    async listMessages(threadId, limit) {
      return [...messages.values()]
        .filter((m) => m.thread_id === threadId)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(-limit);
    },
    async markRead(threadId, readerId) {
      let n = 0;
      for (const m of messages.values()) {
        if (m.thread_id === threadId && m.sender_id !== readerId && !m.read_at) {
          messages.set(m.id, { ...m, read_at: now() });
          n += 1;
        }
      }
      return n;
    },
    async unreadCount(threadId, readerId) {
      return [...messages.values()].filter((m) => m.thread_id === threadId && m.sender_id !== readerId && !m.read_at).length;
    },
  };
}
