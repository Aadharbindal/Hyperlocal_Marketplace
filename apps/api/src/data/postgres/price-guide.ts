import type { PriceGuideRow } from '../types';

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * What a job of this kind usually costs, preferring what people actually paid.
 *
 * Two sources, and the order matters. The seeded range in `service_skills` is somebody's
 * estimate; the quotes customers accepted on finished jobs are a fact. So once a skill has
 * enough finished jobs the estimate is dropped entirely, and `basis` says which answer the
 * caller is looking at - because "about ₹300-600" and "27 people paid between ₹300 and ₹600"
 * are different claims and only one of them should ever be dressed up as the other.
 *
 * The range is the inter-quartile one rather than min-max. A single emergency geyser
 * replacement at midnight should not drag the top of "tap repair" to four thousand rupees and
 * make the whole number useless; the middle half is what somebody is actually likely to pay.
 */
const MIN_SAMPLE = 5;

export function postgresPriceGuide(q: Queryable) {
  return {
    async priceGuides(): Promise<PriceGuideRow[]> {
      const { rows } = await q.query(
        `with paid as (
           select s.id as skill_id, bq.labour_paise
             from service_skills s
             join jobs j on s.id = any(j.skill_ids)
             join booking_quotes bq on bq.job_id = j.id and bq.id = j.active_quote_id
            where j.status in ('COMPLETED', 'SETTLED')
              and j.deleted_at is null
         ),
         actual as (
           select skill_id,
                  count(*) as n,
                  percentile_cont(0.25) within group (order by labour_paise) as lo,
                  percentile_cont(0.75) within group (order by labour_paise) as hi
             from paid
            group by skill_id
         )
         select s.id as skill_id,
                case when a.n >= $1 then round(a.lo)::bigint else s.typical_min_paise end as min_paise,
                case when a.n >= $1 then round(a.hi)::bigint else s.typical_max_paise end as max_paise,
                case when a.n >= $1 then 'ACTUAL' else 'ESTIMATE' end as basis,
                coalesce(a.n, 0)::int as sample_size
           from service_skills s
           left join actual a on a.skill_id = s.id`,
        [MIN_SAMPLE],
      );

      return (rows as Array<{ skill_id: string; min_paise: string | null; max_paise: string | null; basis: string; sample_size: number }>)
        .filter((r) => r.min_paise !== null && r.max_paise !== null)
        .map((r) => ({
          skillId: r.skill_id,
          minPaise: Number(r.min_paise),
          maxPaise: Number(r.max_paise),
          basis: r.basis as 'ACTUAL' | 'ESTIMATE',
          sampleSize: Number(r.sample_size),
        }));
    },
  };
}

export { MIN_SAMPLE };
