import type { RedispatchInvitationRecord, RedispatchRepo } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

/**
 * Re-dispatch, against the tables in 0018.
 *
 * The interesting method is `respond`. Two invited professionals can tap "take it" in the same
 * second, and only one of them may win - otherwise two people set off for the same address and
 * one of them wastes an afternoon. That is settled by a conditional UPDATE plus the partial
 * unique index, not by reading and then writing, which is the version that loses the race.
 */
export function createPostgresRedispatchRepo(q: Queryable): RedispatchRepo {
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T | null> => {
    const r = await q.query(sql, params);
    return (r.rows[0] as T | undefined) ?? null;
  };
  const many = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const r = await q.query(sql, params);
    return r.rows as T[];
  };

  return {
    async invite(i) {
      return (await one<RedispatchInvitationRecord>(
        `insert into redispatch_invitations (job_id, provider_id, bid_id, total_paise, invited_at, expires_at, responded_at, outcome)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [i.job_id, i.provider_id, i.bid_id, i.total_paise, i.invited_at, i.expires_at, i.responded_at, i.outcome],
      ))!;
    },

    listForJob: (jobId) =>
      many<RedispatchInvitationRecord>('select * from redispatch_invitations where job_id = $1 order by invited_at', [jobId]),

    listOpenForProvider: (providerId, at) =>
      many<RedispatchInvitationRecord>(
        'select * from redispatch_invitations where provider_id = $1 and responded_at is null and expires_at > $2 order by expires_at',
        [providerId, at],
      ),

    get: (id) => one<RedispatchInvitationRecord>('select * from redispatch_invitations where id = $1', [id]),

    async respond(id, outcome, at) {
      // `responded_at is null` in the WHERE is what makes this single-use: a second call updates
      // no rows and returns null rather than overwriting somebody's answer.
      //
      // The `not exists` is the winner check. It is belt and braces with
      // redispatch_invitations_one_winner - the index is the guarantee, this is what turns a
      // loss into a clean null instead of an exception the route would have to decode.
      return one<RedispatchInvitationRecord>(
        `update redispatch_invitations
            set responded_at = $3, outcome = $2
          where id = $1
            and responded_at is null
            and (
              $2 <> 'ACCEPTED'
              or not exists (
                select 1 from redispatch_invitations w
                 where w.job_id = redispatch_invitations.job_id and w.outcome = 'ACCEPTED'
              )
            )
          returning *`,
        [id, outcome, at],
      );
    },

    async closeOpen(jobId, outcome, at) {
      const r = await q.query(
        `update redispatch_invitations set responded_at = $3, outcome = $2
          where job_id = $1 and responded_at is null`,
        [jobId, outcome, at],
      );
      return r.rowCount ?? 0;
    },

  };
}
