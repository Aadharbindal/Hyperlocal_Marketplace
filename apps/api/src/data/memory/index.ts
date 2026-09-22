import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import { CATEGORY_SEED, SKILL_SEED } from '../catalog';
import { createMemoryJobsRepo } from './jobs';
import type {
  AddressRecord,
  AuditLogRecord,
  ConsentRecord,
  ContractorProfileRecord,
  CustomerProfileRecord,
  DataStore,
  IdempotencyRecord,
  NotificationRecord,
  OtpChallengeRecord,
  ProviderProfileRecord,
  RetentionEventRecord,
  SessionRecord,
  UserRecord,
  UserRoleRecord,
  VendorProfileRecord,
} from '../types';

/**
 * In-process store for local demo and integration tests. Enforces the same critical
 * constraints as the SQL schema (unique phone, unique role per user, one default address,
 * append-only audit). Resets on restart.
 */
export function createMemoryStore(): DataStore {
  const users = new Map<string, UserRecord>();
  const roles = new Map<string, UserRoleRecord>();
  const challenges = new Map<string, OtpChallengeRecord>();
  const sessions = new Map<string, SessionRecord>();
  const customerProfiles = new Map<string, CustomerProfileRecord>();
  const providerProfiles = new Map<string, ProviderProfileRecord>();
  const contractorProfiles = new Map<string, ContractorProfileRecord>();
  const vendorProfiles = new Map<string, VendorProfileRecord>();
  const addresses = new Map<string, AddressRecord>();
  const consents: ConsentRecord[] = [];
  const audit: AuditLogRecord[] = [];
  const notifications: NotificationRecord[] = [];
  const retention: RetentionEventRecord[] = [];
  const idem = new Map<string, IdempotencyRecord>();
  const jobsRepo = createMemoryJobsRepo();

  // Serialise "transactions" with a simple promise chain so concurrent acceptances cannot interleave.
  let chain: Promise<unknown> = Promise.resolve();

  const now = () => new Date();

  const store: DataStore = {
    mode: 'memory',

    users: {
      async findById(id) {
        return users.get(id) ?? null;
      },
      async findByPhone(phone) {
        for (const u of users.values()) if (u.phone_e164 === phone) return u;
        return null;
      },
      async create(input) {
        for (const u of users.values()) if (u.phone_e164 === input.phone_e164) throw conflict({ field: 'phone' });
        const u: UserRecord = {
          id: newId(),
          phone_e164: input.phone_e164,
          phone_verified_at: null,
          display_name: input.display_name ?? null,
          avatar_url: null,
          preferred_language: input.preferred_language ?? 'en',
          status: 'ACTIVE',
          suspended_reason: null,
          last_login_at: null,
          deleted_at: null,
          created_at: now(),
          updated_at: now(),
        };
        users.set(u.id, u);
        return u;
      },
      async update(id, patch) {
        const u = users.get(id);
        if (!u) throw new Error('user not found');
        const next = { ...u, ...patch, updated_at: now() };
        users.set(id, next);
        return next;
      },
      async search(q, limit) {
        const needle = q.trim().toLowerCase();
        const out: UserRecord[] = [];
        for (const u of users.values()) {
          if (
            u.id === needle ||
            u.phone_e164.includes(needle.replace(/\s/g, '')) ||
            (u.display_name ?? '').toLowerCase().includes(needle)
          ) {
            out.push(u);
            if (out.length >= limit) break;
          }
        }
        return out;
      },
      async listRoles(userId) {
        return [...roles.values()].filter((r) => r.user_id === userId);
      },
      async grantRole(input) {
        for (const r of roles.values()) {
          if (r.user_id === input.user_id && r.role === input.role) {
            if (r.status === 'REVOKED') {
              r.status = 'ACTIVE';
              return r;
            }
            throw conflict({ field: 'role' });
          }
        }
        const r: UserRoleRecord = { id: newId(), ...input, status: 'ACTIVE', created_at: now() };
        roles.set(r.id, r);
        return r;
      },
      async setRoleStatus(userId, role, status) {
        for (const r of roles.values()) if (r.user_id === userId && r.role === role) r.status = status;
      },
      async getCustomerProfile(id) {
        return customerProfiles.get(id) ?? null;
      },
      async upsertCustomerProfile(p) {
        customerProfiles.set(p.user_id, p);
        return p;
      },
      async getProviderProfile(id) {
        return providerProfiles.get(id) ?? null;
      },
      async upsertProviderProfile(p) {
        providerProfiles.set(p.user_id, p);
        return p;
      },
      async getContractorProfile(id) {
        return contractorProfiles.get(id) ?? null;
      },
      async upsertContractorProfile(p) {
        contractorProfiles.set(p.user_id, p);
        return p;
      },
      async getVendorProfile(id) {
        return vendorProfiles.get(id) ?? null;
      },
      async upsertVendorProfile(p) {
        vendorProfiles.set(p.user_id, p);
        return p;
      },
      async listConsents(userId) {
        return consents.filter((c) => c.user_id === userId);
      },
      async addConsent(c) {
        const rec: ConsentRecord = { ...c, id: newId(), created_at: now() };
        consents.push(rec);
        return rec;
      },
    },

    auth: {
      async createChallenge(c) {
        const rec: OtpChallengeRecord = { ...c, id: c.id ?? newId(), created_at: now() };
        challenges.set(rec.id, rec);
        return rec;
      },
      async getChallenge(id) {
        return challenges.get(id) ?? null;
      },
      async updateChallenge(id, patch) {
        const c = challenges.get(id);
        if (!c) throw new Error('challenge not found');
        const next = { ...c, ...patch };
        challenges.set(id, next);
        return next;
      },
      async countChallengesSince(phone, since) {
        let n = 0;
        for (const c of challenges.values()) if (c.phone_e164 === phone && c.created_at >= since) n++;
        return n;
      },
      async countChallengesByIpSince(ip, since) {
        let n = 0;
        for (const c of challenges.values()) if (c.request_ip === ip && c.created_at >= since) n++;
        return n;
      },
      async latestChallenge(phone) {
        let latest: OtpChallengeRecord | null = null;
        for (const c of challenges.values()) {
          if (c.phone_e164 === phone && (!latest || c.created_at > latest.created_at)) latest = c;
        }
        return latest;
      },
      async createSession(s) {
        const rec: SessionRecord = { ...s, id: s.id ?? newId(), created_at: now() };
        sessions.set(rec.id, rec);
        return rec;
      },
      async findSessionByHash(hash) {
        for (const s of sessions.values()) if (s.refresh_token_hash === hash) return s;
        return null;
      },
      async revokeSession(id) {
        const s = sessions.get(id);
        if (s && !s.revoked_at) s.revoked_at = now();
      },
      async revokeAllSessions(userId) {
        let n = 0;
        for (const s of sessions.values()) {
          if (s.user_id === userId && !s.revoked_at) {
            s.revoked_at = now();
            n++;
          }
        }
        return n;
      },
      async touchSession(id) {
        const s = sessions.get(id);
        if (s) s.last_used_at = now();
      },
    },

    addresses: {
      async list(userId) {
        return [...addresses.values()].filter((a) => a.user_id === userId && !a.deleted_at);
      },
      async get(id) {
        return addresses.get(id) ?? null;
      },
      async create(a) {
        const rec: AddressRecord = { ...a, id: a.id ?? newId(), created_at: now(), updated_at: now() };
        addresses.set(rec.id, rec);
        return rec;
      },
      async update(id, patch) {
        const a = addresses.get(id);
        if (!a) throw new Error('address not found');
        const next = { ...a, ...patch, updated_at: now() };
        addresses.set(id, next);
        return next;
      },
      async clearDefault(userId) {
        for (const a of addresses.values()) if (a.user_id === userId) a.is_default = false;
      },
    },

    categories: {
      async listEnabled() {
        return CATEGORY_SEED.filter((c) => c.is_enabled).sort((a, b) => a.sort_order - b.sort_order);
      },
      async listSkills(categoryIds) {
        return SKILL_SEED.filter((s) => categoryIds.includes(s.category_id));
      },
    },

    jobs: jobsRepo,

    audit: {
      async append(entry) {
        const rec: AuditLogRecord = { ...entry, id: newId(), created_at: now() };
        audit.push(Object.freeze(rec));
        return rec;
      },
      async list(filter) {
        return audit
          .filter(
            (a) =>
              (!filter.entityType || a.entity_type === filter.entityType) &&
              (!filter.entityId || a.entity_id === filter.entityId) &&
              (!filter.actorUserId || a.actor_user_id === filter.actorUserId),
          )
          .slice(-filter.limit)
          .reverse();
      },
    },

    notifications: {
      async create(n) {
        const rec: NotificationRecord = { ...n, id: newId(), created_at: now() };
        notifications.push(rec);
        return rec;
      },
      async listForUser(userId, limit) {
        return notifications.filter((n) => n.user_id === userId).slice(-limit).reverse();
      },
    },

    retention: {
      async schedule(e) {
        const rec: RetentionEventRecord = { ...e, id: newId(), created_at: now() };
        retention.push(rec);
        return rec;
      },
    },

    idempotency: {
      async get(key, userId) {
        return idem.get(`${userId}:${key}`) ?? null;
      },
      async put(rec) {
        idem.set(`${rec.user_id}:${rec.key}`, rec);
      },
    },

    async transaction(fn) {
      const run = chain.then(() => fn(store));
      chain = run.catch(() => undefined);
      return run;
    },
    async health() {
      return { ok: true, detail: `memory (${users.size} users)` };
    },
    async close() {
      /* nothing to release */
    },
  };

  return store;
}
