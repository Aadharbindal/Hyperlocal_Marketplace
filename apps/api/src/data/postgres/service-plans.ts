import type { ServicePlanOccurrenceRecord, ServicePlanRecord, ServicePlansRepo } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

/** PostgreSQL service plans, against supabase/migrations/0020_service_plans.sql. */
export function createPostgresServicePlansRepo(q: Queryable): ServicePlansRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async create(p) {
      return (await one<ServicePlanRecord>(
        `insert into service_plans
           (customer_id, category_id, skill_ids, address_id, description, interval_days,
            preferred_provider_id, next_due_on, lead_days, status, paused_reason, cancelled_at)
         values ($1,$2,$3::uuid[],$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [
          p.customer_id, p.category_id, p.skill_ids, p.address_id, p.description, p.interval_days,
          p.preferred_provider_id, p.next_due_on, p.lead_days, p.status, p.paused_reason, p.cancelled_at,
        ],
      ))!;
    },

    get: (id) => one<ServicePlanRecord>('select * from service_plans where id = $1', [id]),

    async update(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<ServicePlanRecord>(`update service_plans set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },

    listForCustomer: (customerId) =>
      many<ServicePlanRecord>(
        `select * from service_plans where customer_id = $1 and status <> 'CANCELLED' order by next_due_on`,
        [customerId],
      ),

    // The lead time is applied in SQL so the partial index on next_due_on does the work, rather
    // than pulling every active plan back and filtering in JavaScript.
    listDue: (onOrBefore, limit) =>
      many<ServicePlanRecord>(
        `select * from service_plans
          where status = 'ACTIVE'
            and next_due_on - (lead_days * interval '1 day') <= $1
          order by next_due_on
          limit $2`,
        [onOrBefore, limit],
      ),

    async recordOccurrence(o) {
      // `on conflict do nothing` plus `returning` gives null when the date is already recorded,
      // which is exactly the signal the sweep needs: somebody else handled this one.
      return one<ServicePlanOccurrenceRecord>(
        `insert into service_plan_occurrences (plan_id, due_on, job_id, outcome, detail)
         values ($1,$2,$3,$4,$5)
         on conflict (plan_id, due_on) do nothing
         returning *`,
        [o.plan_id, o.due_on, o.job_id, o.outcome, o.detail],
      );
    },

    async updateOccurrence(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<ServicePlanOccurrenceRecord>(
        `update service_plan_occurrences set ${sets} where id = $1 returning *`,
        [id, ...values],
      ))!;
    },

    listOccurrences: (planId, limit) =>
      many<ServicePlanOccurrenceRecord>(
        'select * from service_plan_occurrences where plan_id = $1 order by due_on desc limit $2',
        [planId, limit],
      ),
  };
}
