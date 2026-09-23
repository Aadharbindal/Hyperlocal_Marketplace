import pg from 'pg';
import { createPostgresBidsRepo, createPostgresKycRepo } from './bids';
import { createPostgresJobsRepo } from './jobs';
import { createPostgresExecutionRepo } from './execution';
import { createPostgresMaterialsRepo } from './materials';
import { createPostgresNegotiationRepo, createPostgresPaymentsRepo } from './negotiation';
import type {
  AddressRecord,
  AuditLogRecord,
  ConsentRecord,
  DataStore,
  OtpChallengeRecord,
  SessionRecord,
  UserRecord,
  UserRoleRecord,
} from '../types';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };

/**
 * PostgreSQL implementation against the schema in supabase/migrations. Uses the service role
 * connection; authorization is enforced in modules (RLS is defence in depth).
 *
 * Status: written for Milestone 1 tables; exercised by the integration suite when
 * DATA_MODE=postgres (see TEST_PLAN.md "Running against Postgres").
 */
export function createPostgresStore(databaseUrl: string): DataStore {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return buildStore(pool, pool);
}

function buildStore(q: Queryable, pool: pg.Pool): DataStore {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => {
    const r = await q.query(text, params);
    return (r.rows[0] as T) ?? null;
  };
  const many = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await q.query(text, params)).rows as T[];

  const patchSql = (patch: Record<string, unknown>, startAt = 1) => {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${k} = $${i + startAt}`).join(', ');
    return { sets, values: keys.map((k) => patch[k]), next: startAt + keys.length };
  };

  const store: DataStore = {
    mode: 'postgres',

    users: {
      findById: (id) => one<UserRecord>('select * from users where id = $1', [id]),
      findByPhone: (phone) => one<UserRecord>('select * from users where phone_e164 = $1', [phone]),
      async create(input) {
        return (await one<UserRecord>(
          'insert into users (phone_e164, display_name, preferred_language) values ($1,$2,$3) returning *',
          [input.phone_e164, input.display_name ?? null, input.preferred_language ?? 'en'],
        ))!;
      },
      async update(id, patch) {
        const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
        return (await one<UserRecord>(`update users set ${sets} where id = $1 returning *`, [id, ...values]))!;
      },
      search: (qs, limit) =>
        many<UserRecord>(
          `select * from users where id::text = $1 or phone_e164 like '%' || $1 || '%' or display_name ilike '%' || $1 || '%' limit $2`,
          [qs.trim(), limit],
        ),
      listRoles: (userId) => many<UserRoleRecord>('select * from user_roles where user_id = $1', [userId]),
      async grantRole(input) {
        return (await one<UserRoleRecord>(
          `insert into user_roles (user_id, role, granted_by) values ($1,$2,$3)
           on conflict (user_id, role) do update set status = 'ACTIVE' returning *`,
          [input.user_id, input.role, input.granted_by],
        ))!;
      },
      async setRoleStatus(userId, role, status) {
        await q.query('update user_roles set status = $3 where user_id = $1 and role = $2', [userId, role, status]);
      },
      getCustomerProfile: (id) => one('select * from customer_profiles where user_id = $1', [id]),
      async upsertCustomerProfile(p) {
        await q.query(
          `insert into customer_profiles (user_id, full_name, email, default_address_id, marketing_opt_in) values ($1,$2,$3,$4,$5)
           on conflict (user_id) do update set full_name = excluded.full_name, email = excluded.email,
             default_address_id = excluded.default_address_id, marketing_opt_in = excluded.marketing_opt_in`,
          [p.user_id, p.full_name, p.email, p.default_address_id, p.marketing_opt_in],
        );
        return p;
      },
      getProviderProfile: (id) => one('select * from provider_profiles where user_id = $1', [id]),
      async upsertProviderProfile(p) {
        await q.query(
          `insert into provider_profiles (user_id, business_name, bio, experience_years, service_radius_km, base_lat, base_lng,
             is_available, verification_status, reliability_score, rating_avg, rating_count, completed_jobs, strike_count, contractor_id, suspended_until)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           on conflict (user_id) do update set business_name = excluded.business_name, bio = excluded.bio,
             experience_years = excluded.experience_years, service_radius_km = excluded.service_radius_km,
             base_lat = excluded.base_lat, base_lng = excluded.base_lng, is_available = excluded.is_available,
             verification_status = excluded.verification_status, contractor_id = excluded.contractor_id,
             suspended_until = excluded.suspended_until`,
          [p.user_id, p.business_name, p.bio, p.experience_years, p.service_radius_km, p.base_lat, p.base_lng, p.is_available,
            p.verification_status, p.reliability_score, p.rating_avg, p.rating_count, p.completed_jobs, p.strike_count, p.contractor_id, p.suspended_until],
        );
        return p;
      },
      getTechnicianProfile: (id) => one('select * from technician_profiles where user_id = $1', [id]),
      async upsertTechnicianProfile(p) {
        await q.query(
          `insert into technician_profiles (user_id, contractor_id, full_name, verification_status, skills, active)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (user_id) do update set contractor_id = excluded.contractor_id, full_name = excluded.full_name,
             verification_status = excluded.verification_status, skills = excluded.skills, active = excluded.active`,
          [p.user_id, p.contractor_id, p.full_name, p.verification_status, p.skills, p.active],
        );
        return p;
      },
      listTechniciansFor: (contractorId) =>
        many('select * from technician_profiles where contractor_id = $1 and active order by full_name', [contractorId]),
      getContractorProfile: (id) => one('select * from contractor_profiles where user_id = $1', [id]),
      async upsertContractorProfile(p) {
        await q.query(
          `insert into contractor_profiles (user_id, business_name, verification_status, base_lat, base_lng, service_radius_km) values ($1,$2,$3,$4,$5,$6)
           on conflict (user_id) do update set business_name = excluded.business_name, verification_status = excluded.verification_status,
             base_lat = excluded.base_lat, base_lng = excluded.base_lng, service_radius_km = excluded.service_radius_km`,
          [p.user_id, p.business_name, p.verification_status, p.base_lat, p.base_lng, p.service_radius_km],
        );
        return p;
      },
      getVendorProfile: (id) => one('select * from vendor_profiles where user_id = $1', [id]),
      async upsertVendorProfile(p) {
        await q.query(
          `insert into vendor_profiles (user_id, shop_name, shop_address_id, delivery_radius_km, material_categories, delivery_available, verification_status)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (user_id) do update set shop_name = excluded.shop_name, shop_address_id = excluded.shop_address_id,
             delivery_radius_km = excluded.delivery_radius_km, material_categories = excluded.material_categories,
             delivery_available = excluded.delivery_available, verification_status = excluded.verification_status`,
          [p.user_id, p.shop_name, p.shop_address_id, p.delivery_radius_km, p.material_categories, p.delivery_available, p.verification_status],
        );
        return p;
      },
      async listProviderSkills(providerId) {
        const rows = await many<{ skill_id: string }>('select skill_id from provider_skills where provider_id = $1', [providerId]);
        return rows.map((r) => r.skill_id);
      },
      async setProviderSkills(providerId, skillIds) {
        await q.query('delete from provider_skills where provider_id = $1', [providerId]);
        if (skillIds.length) {
          await q.query(
            'insert into provider_skills (provider_id, skill_id) select $1, unnest($2::uuid[]) on conflict do nothing',
            [providerId, skillIds],
          );
        }
      },
      listConsents: (userId) => many<ConsentRecord>('select * from consents where user_id = $1 order by created_at', [userId]),
      async addConsent(c) {
        return (await one<ConsentRecord>(
          'insert into consents (user_id, consent_type, version, granted, granted_at, withdrawn_at, ip) values ($1,$2,$3,$4,$5,$6,$7) returning *',
          [c.user_id, c.consent_type, c.version, c.granted, c.granted_at, c.withdrawn_at, c.ip],
        ))!;
      },
    },

    auth: {
      async createChallenge(c) {
        return (await one<OtpChallengeRecord>(
          `insert into otp_challenges (phone_e164, purpose, code_hash, attempts, max_attempts, expires_at, consumed_at, request_ip)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [c.phone_e164, c.purpose, c.code_hash, c.attempts, c.max_attempts, c.expires_at, c.consumed_at, c.request_ip],
        ))!;
      },
      getChallenge: (id) => one('select * from otp_challenges where id = $1', [id]),
      async updateChallenge(id, patch) {
        const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
        return (await one<OtpChallengeRecord>(`update otp_challenges set ${sets} where id = $1 returning *`, [id, ...values]))!;
      },
      async countChallengesSince(phone, since) {
        const r = await one<{ n: string }>('select count(*)::text as n from otp_challenges where phone_e164 = $1 and created_at >= $2', [phone, since]);
        return Number(r?.n ?? 0);
      },
      async countChallengesByIpSince(ip, since) {
        const r = await one<{ n: string }>('select count(*)::text as n from otp_challenges where request_ip = $1 and created_at >= $2', [ip, since]);
        return Number(r?.n ?? 0);
      },
      latestChallenge: (phone) => one('select * from otp_challenges where phone_e164 = $1 order by created_at desc limit 1', [phone]),
      async createSession(s) {
        return (await one<SessionRecord>(
          `insert into sessions (user_id, refresh_token_hash, device_label, user_agent, ip, expires_at, revoked_at, rotated_from, last_used_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [s.user_id, s.refresh_token_hash, s.device_label, s.user_agent, s.ip, s.expires_at, s.revoked_at, s.rotated_from, s.last_used_at],
        ))!;
      },
      findSessionByHash: (hash) => one('select * from sessions where refresh_token_hash = $1', [hash]),
      async revokeSession(id) {
        await q.query('update sessions set revoked_at = now() where id = $1 and revoked_at is null', [id]);
      },
      async revokeAllSessions(userId) {
        const r = await q.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
        return r.rowCount ?? 0;
      },
      async touchSession(id) {
        await q.query('update sessions set last_used_at = now() where id = $1', [id]);
      },
    },

    addresses: {
      list: (userId) => many<AddressRecord>('select * from addresses where user_id = $1 and deleted_at is null order by created_at', [userId]),
      get: (id) => one('select * from addresses where id = $1', [id]),
      async create(a) {
        return (await one<AddressRecord>(
          `insert into addresses (user_id, label, line1, line2, landmark, society_name, gate_instructions, city, pincode, lat, lng, geohash, is_default, in_pilot_zone, deleted_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
          [a.user_id, a.label, a.line1, a.line2, a.landmark, a.society_name, a.gate_instructions, a.city, a.pincode, a.lat, a.lng, a.geohash, a.is_default, a.in_pilot_zone, a.deleted_at],
        ))!;
      },
      async update(id, patch) {
        const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
        return (await one<AddressRecord>(`update addresses set ${sets} where id = $1 returning *`, [id, ...values]))!;
      },
      async clearDefault(userId) {
        await q.query('update addresses set is_default = false where user_id = $1 and is_default', [userId]);
      },
    },

    categories: {
      listEnabled: () => many('select * from service_categories where is_enabled order by sort_order'),
      listSkills: (ids) => many('select * from service_skills where category_id = any($1::uuid[])', [ids]),
    },

    jobs: createPostgresJobsRepo(q),
    bids: createPostgresBidsRepo(q),
    kyc: createPostgresKycRepo(q),
    negotiation: createPostgresNegotiationRepo(q),
    execution: createPostgresExecutionRepo(q),
    materials: createPostgresMaterialsRepo(q),
    payments: createPostgresPaymentsRepo(q),

    audit: {
      async append(e) {
        return (await one<AuditLogRecord>(
          `insert into audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, reason, before, after, ip, request_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [e.actor_user_id, e.actor_role, e.action, e.entity_type, e.entity_id, e.reason, e.before ?? null, e.after ?? null, e.ip, e.request_id],
        ))!;
      },
      list: (f) =>
        many<AuditLogRecord>(
          `select * from audit_logs where ($1::text is null or entity_type = $1) and ($2::text is null or entity_id = $2)
             and ($3::uuid is null or actor_user_id = $3) order by created_at desc limit $4`,
          [f.entityType ?? null, f.entityId ?? null, f.actorUserId ?? null, f.limit],
        ),
    },

    notifications: {
      async create(n) {
        return (await one(
          'insert into notifications (user_id, type, title, body, data, channel, read_at, sent_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
          [n.user_id, n.type, n.title, n.body, n.data, n.channel, n.read_at, n.sent_at],
        ))!;
      },
      listForUser: (userId, limit) => many('select * from notifications where user_id = $1 order by created_at desc limit $2', [userId, limit]),
    },

    retention: {
      async schedule(e) {
        return (await one(
          'insert into retention_events (entity_type, entity_id, action, scheduled_for, executed_at, reason) values ($1,$2,$3,$4,$5,$6) returning *',
          [e.entity_type, e.entity_id, e.action, e.scheduled_for, e.executed_at, e.reason],
        ))!;
      },
    },

    idempotency: {
      get: (key, userId) => one('select * from idempotency_keys where key = $1 and user_id = $2', [key, userId]),
      async put(rec) {
        await q.query(
          'insert into idempotency_keys (key, user_id, route, status, body) values ($1,$2,$3,$4,$5) on conflict do nothing',
          [rec.key, rec.user_id, rec.route, rec.status, rec.body],
        );
      },
    },

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(buildStore(client, pool));
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    async health() {
      try {
        await q.query('select 1');
        return { ok: true, detail: 'postgres' };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    async close() {
      await pool.end();
    },
  };
  return store;
}
