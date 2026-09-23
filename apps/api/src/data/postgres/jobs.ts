import type { JobMediaRecord, JobRecord, JobStatusEventRecord, JobsRepo } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

/** PostgreSQL jobs repository against supabase/migrations/0002_jobs.sql. */
export function createPostgresJobsRepo(q: Queryable): JobsRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];
  const patchSql = (patch: Record<string, unknown>, startAt: number) => {
    const keys = Object.keys(patch);
    return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
  };

  return {
    async create(j) {
      return (await one<JobRecord>(
        `insert into jobs (customer_id, booked_for_name, booked_for_phone_e164, recipient_tracking_token, category_id,
           skill_ids, description, priority, request_type, inspection_required, hazards, preferred_start, preferred_end,
           address_id, address_snapshot, lat, lng, geohash, status, payment_status, bid_window_ends_at, submitted_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
        [j.customer_id, j.booked_for_name, j.booked_for_phone_e164, j.recipient_tracking_token, j.category_id,
          j.skill_ids, j.description, j.priority, j.request_type, j.inspection_required, j.hazards, j.preferred_start,
          j.preferred_end, j.address_id, j.address_snapshot, j.lat, j.lng, j.geohash, j.status, j.payment_status,
          j.bid_window_ends_at, j.submitted_at],
      ))!;
    },
    get: (id) => one<JobRecord>('select * from jobs where id = $1 and deleted_at is null', [id]),
    getByTrackingToken: (token) => one<JobRecord>('select * from jobs where recipient_tracking_token = $1 and deleted_at is null', [token]),
    async update(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<JobRecord>(`update jobs set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listForCustomer: (customerId, opts) =>
      many<JobRecord>(
        `select * from jobs where customer_id = $1 and deleted_at is null
           and ($2::job_status[] is null or status = any($2))
         order by created_at desc limit $3`,
        [customerId, opts.statuses ?? null, opts.limit],
      ),
    findOpenForTarget: (customerId, categoryId, addressId) =>
      many<JobRecord>(
        `select * from jobs where customer_id = $1 and category_id = $2
           and coalesce(address_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           and deleted_at is null
           and status not in ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_PROVIDER','AUTO_CANCELLED','REFUNDED','ABANDONED','SETTLED','DISPUTED')`,
        [customerId, categoryId, addressId],
      ),
    listByStatus: (statuses, limit) =>
      many<JobRecord>('select * from jobs where status = any($1) order by created_at limit $2', [statuses, limit]),
    listOpenForFeed: ({ categoryIds, limit }) =>
      many<JobRecord>(
        `select * from jobs
          where deleted_at is null
            and status in ('OPEN_FOR_BIDS','BID_RECEIVED','NEGOTIATING')
            and category_id = any($1::uuid[])
          order by created_at desc limit $2`,
        [categoryIds, limit],
      ),
    findDraft: (customerId, categoryId, addressId) =>
      one<JobRecord>(
        `select * from jobs where customer_id = $1 and category_id = $2
           and coalesce(address_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           and status = 'DRAFT' and deleted_at is null limit 1`,
        [customerId, categoryId, addressId],
      ),

    async addMedia(m) {
      // `on conflict` matches job_media_job_hash_idx so a retried upload returns the first row
      const inserted = await one<JobMediaRecord>(
        `insert into job_media (job_id, uploader_id, uploader_role, kind, phase, storage_key, mime, size_bytes,
           duration_seconds, sha256, lat, lng, transcript, review_status, uploaded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict do nothing returning *`,
        [m.job_id, m.uploader_id, m.uploader_role, m.kind, m.phase, m.storage_key, m.mime, m.size_bytes,
          m.duration_seconds, m.sha256, m.lat, m.lng, m.transcript, m.review_status, m.uploaded_at],
      );
      if (inserted) return inserted;
      return (await one<JobMediaRecord>('select * from job_media where job_id = $1 and sha256 = $2 and deleted_at is null', [m.job_id, m.sha256]))!;
    },
    listMedia: (jobId, phase) =>
      many<JobMediaRecord>(
        `select * from job_media where job_id = $1 and deleted_at is null
           and ($2::media_phase is null or phase = $2) order by created_at`,
        [jobId, phase ?? null],
      ),
    getMedia: (id) => one<JobMediaRecord>('select * from job_media where id = $1 and deleted_at is null', [id]),
    async updateMedia(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<JobMediaRecord>(`update job_media set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },

    async appendEvent(e) {
      return (await one<JobStatusEventRecord>(
        `insert into job_status_events (job_id, actor_user_id, actor_role, from_status, to_status, reason, metadata, request_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [e.job_id, e.actor_user_id, e.actor_role, e.from_status, e.to_status, e.reason, e.metadata, e.request_id],
      ))!;
    },
    listEvents: (jobId) => many<JobStatusEventRecord>('select * from job_status_events where job_id = $1 order by created_at', [jobId]),
  };
}
