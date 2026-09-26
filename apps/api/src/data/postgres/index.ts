import pg from 'pg';
import { conflict } from '../../lib/errors';
import { createPostgresBidsRepo, createPostgresKycRepo } from './bids';
import { createPostgresJobsRepo } from './jobs';
import { createPostgresExecutionRepo } from './execution';
import { createPostgresAdminRepo } from './admin';
import { createPostgresFinanceRepo } from './finance';
import { createPostgresGrowthRepo } from './growth';
import { createPostgresTrustRepo } from './trust';
import { createPostgresMaterialsRepo } from './materials';
import { createPostgresNegotiationRepo, createPostgresPaymentsRepo } from './negotiation';
import type {
  AddressRecord,
  AuditLogRecord,
  ConsentRecord,
  DataStore,
  DeviceTokenRecord,
  JobRescheduleRecord,
  MaskedCallRecord,
  ScheduleProposalRecord,
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
/**
 * `pg` hands back `bigint` and `numeric` as strings, because either can hold more than a JS
 * number safely. Neither can here: money is paise (a crore of rupees is 10^9 paise, eleven
 * digits clear of `Number.MAX_SAFE_INTEGER`), and the `numeric` columns are ratings, scores and
 * coordinates. The domain treats all of them as numbers, so they are parsed once, here, rather
 * than every caller remembering a `Number(...)` and one of them forgetting.
 */
function useNumericTypes() {
  const INT8 = 20;
  const NUMERIC = 1700;
  pg.types.setTypeParser(INT8, (v) => (v === null ? null : Number(v)));
  pg.types.setTypeParser(NUMERIC, (v) => (v === null ? null : Number(v)));
}

/**
 * The database enforces rules the service also enforces - a single winning assignment, one
 * active quote, a settlement that cannot be paid to nowhere - and it is the database that wins
 * the race when two requests arrive at once. When it refuses, that refusal is a *conflict*, the
 * same thing the in-memory store raises, and the caller must see it as one.
 *
 * Without this, a customer tapping "accept" twice gets "something went wrong on our side"
 * instead of "somebody already booked this".
 */
const CONSTRAINT_VIOLATION = new Set([
  '23505', // unique_violation - somebody got there first
  '23514', // check_violation - including the ones our triggers raise
  '23P01', // exclusion_violation
]);

function translateDbError(e: unknown): never {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err?.code && CONSTRAINT_VIOLATION.has(err.code)) {
    throw conflict({ reason: err.constraint ?? err.message ?? 'constraint_violation' });
  }
  throw e;
}

export function createPostgresStore(databaseUrl: string): DataStore {
  useNumericTypes();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const guarded: Queryable = { query: (text, params) => pool.query(text, params).catch(translateDbError) };
  return buildStore(guarded, pool);
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
      findByReferralCode: (code) => one<UserRecord>('select * from users where referral_code = $1', [code]),
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
             suspended_until = excluded.suspended_until,
             -- These move as work happens, so an upsert that ignored them would quietly throw
             -- away a rating or a strike the caller had just recomputed.
             reliability_score = excluded.reliability_score, rating_avg = excluded.rating_avg,
             rating_count = excluded.rating_count, completed_jobs = excluded.completed_jobs,
             strike_count = excluded.strike_count`,
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
          // The id is supplied, not generated here: the OTP hash is salted with it, so letting
          // the database invent its own would make every code fail to verify.
          `insert into otp_challenges (id, phone_e164, purpose, code_hash, attempts, max_attempts, expires_at, consumed_at, request_ip)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [c.id, c.phone_e164, c.purpose, c.code_hash, c.attempts, c.max_attempts, c.expires_at, c.consumed_at, c.request_ip],
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
          // The caller's id is honoured here too. Nothing depends on it today, but a record
          // whose id changes on the way into the database is a trap waiting to be stepped in.
          `insert into sessions (id, user_id, refresh_token_hash, device_label, user_agent, ip, expires_at, revoked_at, rotated_from, last_used_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [s.id, s.user_id, s.refresh_token_hash, s.device_label, s.user_agent, s.ip, s.expires_at, s.revoked_at, s.rotated_from, s.last_used_at],
        ))!;
      },
      getSession: (id) => one<SessionRecord>('select * from sessions where id = $1', [id]),
      markSessionMfa: (id, at) =>
        one<SessionRecord>('update sessions set mfa_verified_at = $2 where id = $1 returning *', [id, at]),
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
    finance: createPostgresFinanceRepo(q),
    admin: createPostgresAdminRepo(q),
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
      async countUnread(userId) {
        const r = await one<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [userId]);
        return r?.n ?? 0;
      },
      async markRead(userId, ids) {
        const res = ids
          ? await q.query('update notifications set read_at = now() where user_id = $1 and read_at is null and id = any($2::uuid[])', [userId, ids])
          : await q.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
        return res.rowCount ?? 0;
      },
    },

    growth: createPostgresGrowthRepo(q),
    trust: createPostgresTrustRepo(q),

    reach: {
      async upsertDevice(d) {
        // A token already on another account moves to this one: a handset that changed hands
        // must not keep notifying the person who sold it.
        return (await one<DeviceTokenRecord>(
          `insert into device_tokens (user_id, token, platform, device_label, app_version)
           values ($1,$2,$3,$4,$5)
           on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform,
             device_label = excluded.device_label, app_version = excluded.app_version,
             disabled_at = null, disabled_reason = null, last_seen_at = now()
           returning *`,
          [d.user_id, d.token, d.platform, d.device_label, d.app_version],
        ))!;
      },
      listDevices: (userId) =>
        many<DeviceTokenRecord>('select * from device_tokens where user_id = $1 and disabled_at is null order by last_seen_at desc', [userId]),
      async activeTokens(userId) {
        const rows = await many<{ token: string }>('select token from device_tokens where user_id = $1 and disabled_at is null', [userId]);
        return rows.map((r) => r.token);
      },
      async disableToken(token, reason) {
        await q.query('update device_tokens set disabled_at = now(), disabled_reason = $2 where token = $1', [token, reason]);
      },
      async removeDevice(userId, id) {
        await q.query(
          `update device_tokens set disabled_at = now(), disabled_reason = 'removed_by_user' where id = $1 and user_id = $2`,
          [id, userId],
        );
      },

      async createCall(c) {
        return (await one<MaskedCallRecord>(
          `insert into masked_calls (job_id, caller_id, callee_id, virtual_number, provider_session_id, status, failure_reason, duration_seconds)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [c.job_id, c.caller_id, c.callee_id, c.virtual_number, c.provider_session_id, c.status, c.failure_reason, c.duration_seconds],
        ))!;
      },
      async updateCall(id, patch) {
        const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
        return (await one<MaskedCallRecord>(`update masked_calls set ${sets} where id = $1 returning *`, [id, ...values]))!;
      },
      async countCallsSince(jobId, callerId, since) {
        const r = await one<{ n: number }>(
          'select count(*)::int as n from masked_calls where job_id = $1 and caller_id = $2 and created_at >= $3',
          [jobId, callerId, since],
        );
        return r?.n ?? 0;
      },

      async addReschedule(r) {
        return (await one<JobRescheduleRecord>(
          `insert into job_reschedules (job_id, requested_by, previous_start, previous_end, new_start, new_end, reason)
           values ($1,$2,$3,$4,$5,$6,$7) returning *`,
          [r.job_id, r.requested_by, r.previous_start, r.previous_end, r.new_start, r.new_end, r.reason],
        ))!;
      },
      listReschedules: (jobId) =>
        many<JobRescheduleRecord>('select * from job_reschedules where job_id = $1 order by created_at desc', [jobId]),

      async createProposal(p) {
        return (await one<ScheduleProposalRecord>(
          `insert into schedule_proposals (job_id, proposed_by, previous_start, new_start, new_end, reason, status,
             responded_at, decline_reason, expires_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [p.job_id, p.proposed_by, p.previous_start, p.new_start, p.new_end, p.reason, p.status,
            p.responded_at, p.decline_reason, p.expires_at],
        ))!;
      },
      getProposal: (id) => one<ScheduleProposalRecord>('select * from schedule_proposals where id = $1', [id]),
      async updateProposal(id, patch) {
        const { sets, values } = patchSql(patch as Record<string, unknown>, 2);
        return (await one<ScheduleProposalRecord>(`update schedule_proposals set ${sets} where id = $1 returning *`, [id, ...values]))!;
      },
      findOpenProposal: (jobId) =>
        one<ScheduleProposalRecord>(`select * from schedule_proposals where job_id = $1 and status = 'PENDING'`, [jobId]),
      listExpiredProposals: (at, limit) =>
        many<ScheduleProposalRecord>(
          `select * from schedule_proposals where status = 'PENDING' and expires_at <= $1 order by expires_at asc limit $2`,
          [at, limit],
        ),
    },

    retention: {
      async schedule(e) {
        return (await one(
          'insert into retention_events (entity_type, entity_id, action, scheduled_for, executed_at, reason) values ($1,$2,$3,$4,$5,$6) returning *',
          [e.entity_type, e.entity_id, e.action, e.scheduled_for, e.executed_at, e.reason],
        ))!;
      },
      listDue: (at, limit) =>
        many('select * from retention_events where executed_at is null and scheduled_for <= $1 order by scheduled_for limit $2', [at, limit]),
      async markExecuted(id, at) {
        return (await one('update retention_events set executed_at = $2 where id = $1 returning *', [id, at]))!;
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
        // The work inside a transaction needs the same translation: a constraint the database
        // refuses there is still a conflict, not a server fault.
        const result = await fn(buildStore({ query: (t, p2) => client.query(t, p2).catch(translateDbError) }, pool));
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
  // Not part of DataStore: the integration suite needs a way to reset the schema between files,
  // and a test reaching for raw SQL is honest about what it is doing.
  (store as unknown as { query: (sql: string) => Promise<unknown> }).query = (sql: string) => q.query(sql);
  return store;
}
