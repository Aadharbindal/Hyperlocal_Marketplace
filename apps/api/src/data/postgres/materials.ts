import type { MaterialOrderRecord, MaterialQuoteRecord, MaterialRequestRecord, MaterialsRepo } from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

const patchSql = (patch: Record<string, unknown>, startAt: number) => {
  const keys = Object.keys(patch);
  return { sets: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '), values: keys.map((k) => patch[k]) };
};

/** PostgreSQL materials repository against supabase/migrations/0006_materials.sql. */
export function createPostgresMaterialsRepo(q: Queryable): MaterialsRepo {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await q.query(text, params)).rows[0] as T) ?? null;
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  return {
    async createRequest(r) {
      return (await one<MaterialRequestRecord>(
        `insert into material_requests (job_id, requested_by, items, note, needed_by, quote_window_ends_at, status)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [r.job_id, r.requested_by, JSON.stringify(r.items), r.note, r.needed_by, r.quote_window_ends_at, r.status],
      ))!;
    },
    getRequest: (id) => one<MaterialRequestRecord>('select * from material_requests where id = $1', [id]),
    async updateRequest(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<MaterialRequestRecord>(`update material_requests set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listRequestsForJob: (jobId) =>
      many<MaterialRequestRecord>('select * from material_requests where job_id = $1 order by created_at desc', [jobId]),
    findOpenRequest: (jobId) =>
      one<MaterialRequestRecord>("select * from material_requests where job_id = $1 and status in ('OPEN','QUOTED')", [jobId]),
    listOpenRequests: (limit) =>
      many<MaterialRequestRecord>(
        `select * from material_requests
         where status in ('OPEN','QUOTED') and quote_window_ends_at > now()
         order by created_at desc limit $1`,
        [limit],
      ),

    async createQuote(qt) {
      return (await one<MaterialQuoteRecord>(
        `insert into material_quotes (request_id, vendor_id, items, subtotal_paise, delivery_paise, total_paise,
           eta_minutes, note, status, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [qt.request_id, qt.vendor_id, JSON.stringify(qt.items), qt.subtotal_paise, qt.delivery_paise, qt.total_paise,
          qt.eta_minutes, qt.note, qt.status, qt.expires_at],
      ))!;
    },
    getQuote: (id) => one<MaterialQuoteRecord>('select * from material_quotes where id = $1', [id]),
    async updateQuote(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<MaterialQuoteRecord>(`update material_quotes set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    listQuotes: (requestId) =>
      many<MaterialQuoteRecord>('select * from material_quotes where request_id = $1 order by total_paise', [requestId]),
    findVendorQuote: (requestId, vendorId) =>
      one<MaterialQuoteRecord>(
        "select * from material_quotes where request_id = $1 and vendor_id = $2 and status in ('ACTIVE','SELECTED')",
        [requestId, vendorId],
      ),

    async createOrder(o) {
      return (await one<MaterialOrderRecord>(
        `insert into material_orders (request_id, quote_id, job_id, vendor_id, selected_by, items, subtotal_paise,
           delivery_paise, total_paise, vendor_payable_paise, eta_minutes, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [o.request_id, o.quote_id, o.job_id, o.vendor_id, o.selected_by, JSON.stringify(o.items), o.subtotal_paise,
          o.delivery_paise, o.total_paise, o.vendor_payable_paise, o.eta_minutes, o.status],
      ))!;
    },
    getOrder: (id) => one<MaterialOrderRecord>('select * from material_orders where id = $1', [id]),
    async updateOrder(id, patch) {
      const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
      return (await one<MaterialOrderRecord>(`update material_orders set ${sets} where id = $1 returning *`, [id, ...values]))!;
    },
    findLiveOrder: (requestId) =>
      one<MaterialOrderRecord>("select * from material_orders where request_id = $1 and status <> 'CANCELLED'", [requestId]),
    listOrdersForJob: (jobId) =>
      many<MaterialOrderRecord>('select * from material_orders where job_id = $1 order by created_at desc', [jobId]),
    listOrdersForVendor: (vendorId, limit) =>
      many<MaterialOrderRecord>('select * from material_orders where vendor_id = $1 order by created_at desc limit $2', [vendorId, limit]),
  };
}
