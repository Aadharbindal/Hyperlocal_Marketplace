import { conflict } from '../../lib/errors';
import type { ArrivalPingRecord, ArrivalRepo, JobsRepo } from '../types';

/**
 * The in-memory mirror of 0019.
 *
 * A Map keyed by job id, which is the whole point: one position per booking and no way to ask
 * where anybody has been. The two triggers in that migration are mirrored as well - a position
 * may only be written while the job is EN_ROUTE, and it disappears when the job leaves that
 * status - because those are the rules that make this feature narrow rather than a tracking
 * system, and a memory store that let them slide would make the tests proving them meaningless.
 */
export function memoryArrivalRepo(jobs: () => JobsRepo): ArrivalRepo {
  const pings = new Map<string, ArrivalPingRecord>();
  const now = () => new Date();

  return {
    async report(p) {
      // mirrors job_arrival_pings_only_en_route
      const job = await jobs().get(p.job_id);
      if (!job || job.status !== 'EN_ROUTE') {
        throw conflict({ reason: 'position may only be reported while a job is EN_ROUTE' });
      }
      const existing = pings.get(p.job_id);
      const rec: ArrivalPingRecord = { ...p, created_at: existing?.created_at ?? now(), updated_at: now() };
      pings.set(p.job_id, rec);
      return rec;
    },

    async latest(jobId) {
      return pings.get(jobId) ?? null;
    },

    async clear(jobId) {
      pings.delete(jobId);
    },
  };
}
