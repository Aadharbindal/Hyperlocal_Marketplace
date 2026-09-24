import type {
  ChatMessageRecord,
  ChatThreadRecord,
  CompletionRecord,
  ExecutionRepo,
  PriceRevisionRecord,
  StartOtpRecord,
} from '../types';
import { conflict } from '../../lib/errors';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

/** PostgreSQL execution repository against supabase/migrations/0005_execution.sql. */
export function createPostgresExecutionRepo(q: Queryable): ExecutionRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async createStartOtp(o) {
      return (await one<StartOtpRecord>(
        `insert into start_otps (id, job_id, code_hash, attempts, max_attempts, expires_at, verified_at, verified_by,
           overridden_by, override_reason)
         values (coalesce($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [o.id ?? null, o.job_id, o.code_hash, o.attempts, o.max_attempts, o.expires_at, o.verified_at, o.verified_by,
          o.overridden_by, o.override_reason],
      ))!;
    },
    getStartOtp: (jobId) => one<StartOtpRecord>('select * from start_otps where job_id = $1', [jobId]),
    async updateStartOtp(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<StartOtpRecord>(`update start_otps set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },

    async createRevision(r) {
      return (await one<PriceRevisionRecord>(
        `insert into price_revision_requests (job_id, quote_id, requested_by, reason, extra_labour_paise,
           extra_material_paise, extra_time_minutes, original_total_paise, revised_total_paise, explanation,
           media_ids, status, responded_by, responded_at, response_message)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [r.job_id, r.quote_id, r.requested_by, r.reason, r.extra_labour_paise, r.extra_material_paise,
          r.extra_time_minutes, r.original_total_paise, r.revised_total_paise, r.explanation, r.media_ids,
          r.status, r.responded_by, r.responded_at, r.response_message],
      ))!;
    },
    getRevision: (id) => one<PriceRevisionRecord>('select * from price_revision_requests where id = $1', [id]),
    async updateRevision(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<PriceRevisionRecord>(`update price_revision_requests set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listRevisions: (jobId) =>
      many<PriceRevisionRecord>('select * from price_revision_requests where job_id = $1 order by created_at desc', [jobId]),
    findOpenRevision: (jobId) =>
      one<PriceRevisionRecord>(
        "select * from price_revision_requests where job_id = $1 and status in ('PENDING','CLARIFICATION')",
        [jobId],
      ),

    async createCompletion(c) {
      return (await one<CompletionRecord>(
        `insert into job_completions (job_id, submitted_by, summary, warranty_note, media_ids, approved_by,
           approved_at, rejection_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [c.job_id, c.submitted_by, c.summary, c.warranty_note, c.media_ids, c.approved_by, c.approved_at, c.rejection_reason],
      ))!;
    },
    async updateCompletion(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<CompletionRecord>(`update job_completions set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    latestCompletion: (jobId) =>
      one<CompletionRecord>('select * from job_completions where job_id = $1 order by submitted_at desc limit 1', [jobId]),

    async ensureThread(jobId, participantIds) {
      // a technician can join after the thread exists, so union the roster on every call
      return (await one<ChatThreadRecord>(
        `insert into chat_threads (job_id, participant_ids) values ($1, $2)
         on conflict (job_id) do update
           set participant_ids = (select array(select distinct unnest(chat_threads.participant_ids || excluded.participant_ids)))
         returning *`,
        [jobId, participantIds],
      ))!;
    },
    getThread: (jobId) => one<ChatThreadRecord>('select * from chat_threads where job_id = $1', [jobId]),
    async updateThread(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<ChatThreadRecord>(`update chat_threads set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    async addMessage(m) {
      return (await one<ChatMessageRecord>(
        `insert into chat_messages (thread_id, sender_id, sender_party, body, media_id, flagged, flag_reason, read_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [m.thread_id, m.sender_id, m.sender_party, m.body, m.media_id, m.flagged, m.flag_reason, m.read_at],
      ))!;
    },
    getMessage: (id) => one<ChatMessageRecord>('select * from chat_messages where id = $1', [id]),
    listFlaggedMessages: (limit) =>
      // Oldest first, and only what nobody has read: a queue worked newest-first leaves the worst
      // cases at the bottom forever. The partial index in 0012 matches this exactly.
      many<ChatMessageRecord>(
        'select * from chat_messages where flagged and reviewed_at is null order by created_at asc limit $1',
        [limit],
      ),
    async markMessageReviewed(id, patch) {
      const row = await one<ChatMessageRecord>(
        `update chat_messages set reviewed_by = $2, reviewed_at = now(), review_outcome = $3
         where id = $1 and reviewed_at is null returning *`,
        [id, patch.reviewed_by, patch.review_outcome],
      );
      // Null means somebody else got there first, which is a conflict rather than a failure.
      if (!row) throw conflict({ reason: 'already_reviewed' });
      return row;
    },
    async listMessages(threadId, limit) {
      const rows = await many<ChatMessageRecord>(
        'select * from chat_messages where thread_id = $1 order by created_at desc limit $2',
        [threadId, limit],
      );
      return rows.reverse();
    },
    async markRead(threadId, readerId) {
      const res = await q.query(
        'update chat_messages set read_at = now() where thread_id = $1 and sender_id <> $2 and read_at is null',
        [threadId, readerId],
      );
      return res.rowCount ?? 0;
    },
    async unreadCount(threadId, readerId) {
      const row = await one<{ count: string }>(
        'select count(*)::text as count from chat_messages where thread_id = $1 and sender_id <> $2 and read_at is null',
        [threadId, readerId],
      );
      return Number(row?.count ?? 0);
    },
  };
}
