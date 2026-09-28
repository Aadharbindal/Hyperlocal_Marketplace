import type { ArrivalPingRecord, ArrivalRepo } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

/**
 * Arrival position, against 0019.
 *
 * Small on purpose. There is no list method and no query by area, because the only question this
 * table is allowed to answer is "where is the person coming to this one booking". The two
 * triggers in the migration do the rest: a row may only exist while the job is EN_ROUTE, and it
 * is deleted the moment that stops being true.
 */
export function createPostgresArrivalRepo(q: Queryable): ArrivalRepo {
  return {
    async report(p) {
      const r = await q.query(
        `insert into job_arrival_pings (job_id, provider_id, lat, lng, accuracy_m, reported_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (job_id) do update set
           provider_id = excluded.provider_id,
           lat = excluded.lat,
           lng = excluded.lng,
           accuracy_m = excluded.accuracy_m,
           reported_at = excluded.reported_at
         returning *`,
        [p.job_id, p.provider_id, p.lat, p.lng, p.accuracy_m, p.reported_at],
      );
      // The upsert is what makes "no trail" true rather than aspirational: there is exactly one
      // row per booking and writing a new position destroys the old one.
      return r.rows[0] as ArrivalPingRecord;
    },

    async latest(jobId) {
      const r = await q.query('select * from job_arrival_pings where job_id = $1', [jobId]);
      const row = r.rows[0] as (Omit<ArrivalPingRecord, 'lat' | 'lng'> & { lat: string; lng: string }) | undefined;
      if (!row) return null;
      // numeric comes back as a string from pg; the callers do arithmetic on these.
      return { ...row, lat: Number(row.lat), lng: Number(row.lng) };
    },

    async clear(jobId) {
      await q.query('delete from job_arrival_pings where job_id = $1', [jobId]);
    },
  };
}
