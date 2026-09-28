import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import { CATEGORY_SEED, SKILL_SEED } from '../catalog';
import { MIN_SAMPLE } from '../postgres/price-guide';
import { createMemoryBidsRepo, createMemoryKycRepo } from './bids';
import { createMemoryCluster } from './cluster';
import { createMemoryReports } from './reports';
import { createMemoryJobsRepo } from './jobs';
import { memoryRedispatchRepo } from './redispatch';
import { memoryArrivalRepo } from './arrival';
import { memoryServicePlansRepo } from './service-plans';
import { createMemoryExecutionRepo } from './execution';
import { createMemoryAdminRepo } from './admin';
import { createMemoryFinanceRepo } from './finance';
import { createMemoryGrowthRepo } from './growth';
import { createMemoryTrustRepo } from './trust';
import { createMemoryMaterialsRepo } from './materials';
import { createMemoryNegotiationRepo, createMemoryPaymentsRepo } from './negotiation';
import type {
  AddressRecord,
  AuditLogRecord,
  ConsentRecord,
  EmergencyContactRecord,
  ContractorProfileRecord,
  CustomerProfileRecord,
  DataStore,
  DeviceTokenRecord,
  IdempotencyRecord,
  JobRescheduleRecord,
  MaskedCallRecord,
  ScheduleProposalRecord,
  NotificationRecord,
  OtpChallengeRecord,
  ProviderProfileRecord,
  TechnicianProfileRecord,
  RetentionEventRecord,
  SchedulerRunRecord,
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
  const technicianProfiles = new Map<string, TechnicianProfileRecord>();
  const contractorProfiles = new Map<string, ContractorProfileRecord>();
  const vendorProfiles = new Map<string, VendorProfileRecord>();
  const addresses = new Map<string, AddressRecord>();
  const providerSkills = new Map<string, string[]>();
  const consents: ConsentRecord[] = [];
  const emergencyContacts: EmergencyContactRecord[] = [];
  const audit: AuditLogRecord[] = [];
  const notifications: NotificationRecord[] = [];
  const devices: DeviceTokenRecord[] = [];
  const calls = new Map<string, MaskedCallRecord>();
  const reschedules: JobRescheduleRecord[] = [];
  const proposals = new Map<string, ScheduleProposalRecord>();
  const retention: RetentionEventRecord[] = [];
  const idem = new Map<string, IdempotencyRecord>();
  const jobsRepo = createMemoryJobsRepo();
  const bidsRepo = createMemoryBidsRepo();
  const redispatchRepo = memoryRedispatchRepo();
  const arrivalRepo = memoryArrivalRepo(() => jobsRepo);
  const servicePlansRepo = memoryServicePlansRepo();

  /**
   * mirrors jobs_clear_arrival_ping (0019).
   *
   * The migration deletes somebody's last known position the moment their job stops being
   * EN_ROUTE, and it does that in the database precisely so no application path can forget. The
   * memory store has to forget in the same places, or a test proving the position disappears
   * would pass here and mean nothing.
   */
  const jobsUpdate = jobsRepo.update.bind(jobsRepo);
  jobsRepo.update = async (id, patch) => {
    const before = await jobsRepo.get(id);
    const after = await jobsUpdate(id, patch);
    if (before && before.status !== after.status && after.status !== 'EN_ROUTE') {
      await arrivalRepo.clear(id);
    }
    return after;
  };
  const kycRepo = createMemoryKycRepo();
  const negotiationRepo = createMemoryNegotiationRepo();
  const executionRepo = createMemoryExecutionRepo();
  const materialsRepo = createMemoryMaterialsRepo();
  const financeRepo = createMemoryFinanceRepo();
  const adminRepo = createMemoryAdminRepo();
  const paymentsRepo = createMemoryPaymentsRepo();
  const cluster = createMemoryCluster();
  const schedulerRuns = new Map<string, SchedulerRunRecord>();
  const reports = createMemoryReports({
    jobs: () => jobsRepo._all(),
    ledger: () => financeRepo._ledger(),
    settlements: () => financeRepo._settlements(),
    disputes: () => financeRepo._disputes(),
    kyc: () => kycRepo._all(),
    providerProfiles: () => [...providerProfiles.values()],
    users: () => [...users.values()],
  });

  // Serialise "transactions" with a simple promise chain so concurrent acceptances cannot interleave.
  let chain: Promise<unknown> = Promise.resolve();

  const now = () => new Date();

  const store: DataStore = {
    mode: 'memory',

    users: {
      async findById(id) {
        return users.get(id) ?? null;
      },
      async findByReferralCode(code) {
        for (const u of users.values()) if (u.referral_code === code) return u;
        return null;
      },
      async findByPhone(phone) {
        for (const u of users.values()) if (u.phone_e164 === phone) return u;
        return null;
      },
      async findByEmail(email) {
        // Lower-cased on both sides and skipping deleted rows, mirroring the partial unique index
        // `users_email_unique` in 0016 exactly.
        const needle = email.trim().toLowerCase();
        for (const u of users.values()) if (u.email && !u.deleted_at && u.email.toLowerCase() === needle) return u;
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
          email: null,
          email_verified_at: null,
          preferred_language: input.preferred_language ?? 'en',
          status: 'ACTIVE',
          suspended_reason: null,
          suspended_by: null,
          suspension_approved_by: null,
          push_job_updates: true,
          push_offers: true,
          push_marketing: false,
          referral_code: null,
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
        // mirrors users_suspension_needs_two: nobody suspends alone
        if (next.status === 'SUSPENDED' && u.status !== 'SUSPENDED' && (!next.suspended_by || !next.suspension_approved_by)) {
          throw new Error('a suspension must record who asked for it and who approved it');
        }
        if (next.email !== null && next.email !== undefined) {
          // mirrors users_email_shape
          if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(next.email)) throw new Error('users_email_shape');
          // mirrors the partial unique index users_email_unique
          const needle = next.email.toLowerCase();
          for (const other of users.values()) {
            if (other.id !== id && other.email && !other.deleted_at && other.email.toLowerCase() === needle) {
              throw conflict({ field: 'email' });
            }
          }
        }
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
      async getTechnicianProfile(id) {
        return technicianProfiles.get(id) ?? null;
      },
      async upsertTechnicianProfile(p) {
        technicianProfiles.set(p.user_id, p);
        return p;
      },
      async listTechniciansFor(contractorId) {
        return [...technicianProfiles.values()].filter((t) => t.contractor_id === contractorId && t.active);
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
      async listProviderSkills(providerId) {
        return providerSkills.get(providerId) ?? [];
      },
      async setProviderSkills(providerId, skillIds) {
        providerSkills.set(providerId, [...new Set(skillIds)]);
      },
      async listConsents(userId) {
        return consents.filter((c) => c.user_id === userId);
      },
      async addConsent(c) {
        const rec: ConsentRecord = { ...c, id: newId(), created_at: now() };
        consents.push(rec);
        return rec;
      },

      async listEmergencyContacts(userId) {
        return emergencyContacts.filter((c) => c.user_id === userId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      },
      async addEmergencyContact(c) {
        // mirrors emergency_contacts_cap_check.
        //
        // Thrown as a conflict with the trigger's own words, not as a bare Error, because that is
        // what the Postgres path produces: `translateDbError` turns a check_violation into
        // `conflict({ reason: <the trigger's message> })`. The first version raised a plain Error
        // here, the route matched on `err.message`, and the result was a 422 in memory mode and a
        // 409 in Postgres - caught only by running the suite against a real database.
        if (emergencyContacts.filter((x) => x.user_id === c.user_id).length >= 3) {
          throw conflict({ reason: 'emergency contact limit reached' });
        }
        // mirrors emergency_contacts_unique
        if (emergencyContacts.some((x) => x.user_id === c.user_id && x.phone_e164 === c.phone_e164)) throw conflict({ field: 'phone' });
        const rec: EmergencyContactRecord = { ...c, id: newId(), created_at: now(), updated_at: now() };
        emergencyContacts.push(rec);
        return rec;
      },
      async removeEmergencyContact(userId, id) {
        const i = emergencyContacts.findIndex((c) => c.id === id && c.user_id === userId);
        if (i >= 0) emergencyContacts.splice(i, 1);
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
      async getSession(id) {
        return sessions.get(id) ?? null;
      },
      async markSessionMfa(id, at) {
        const s = sessions.get(id);
        if (!s) return null;
        const next = { ...s, mfa_verified_at: at };
        sessions.set(id, next);
        return next;
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

      /**
       * Mirrors `postgres/price-guide.ts`, including the part that matters: real prices win once
       * there are enough of them, and `basis` never lets an estimate pass as a measurement.
       * The inter-quartile range rather than min-max, so one emergency call-out at midnight
       * cannot make the whole number useless.
       */
      async priceGuides() {
        const quotes = negotiationRepo._quotes?.() ?? [];
        const done: readonly string[] = ['COMPLETED', 'SETTLED'];
        const paidBySkill = new Map<string, number[]>();
        for (const job of jobsRepo._all()) {
          if (job.deleted_at || !done.includes(job.status) || !job.active_quote_id) continue;
          const quote = quotes.find((qt) => qt.id === job.active_quote_id);
          if (!quote) continue;
          for (const skillId of job.skill_ids ?? []) {
            const list = paidBySkill.get(skillId) ?? [];
            list.push(Number(quote.labour_paise));
            paidBySkill.set(skillId, list);
          }
        }

        const quartile = (sorted: number[], p: number) => {
          const pos = (sorted.length - 1) * p;
          const lo = Math.floor(pos);
          const hi = Math.ceil(pos);
          return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
        };

        const out = [];
        for (const skill of SKILL_SEED) {
          const paid = (paidBySkill.get(skill.id) ?? []).sort((a, b) => a - b);
          if (paid.length >= MIN_SAMPLE) {
            out.push({
              skillId: skill.id,
              minPaise: Math.round(quartile(paid, 0.25)),
              maxPaise: Math.round(quartile(paid, 0.75)),
              basis: 'ACTUAL' as const,
              sampleSize: paid.length,
            });
          } else if (skill.typical_min_paise !== null && skill.typical_max_paise !== null) {
            out.push({
              skillId: skill.id,
              minPaise: skill.typical_min_paise,
              maxPaise: skill.typical_max_paise,
              basis: 'ESTIMATE' as const,
              sampleSize: paid.length,
            });
          }
        }
        return out;
      },
    },

    jobs: jobsRepo,
    bids: bidsRepo,
    redispatch: redispatchRepo,
    arrival: arrivalRepo,
    servicePlans: servicePlansRepo,
    kyc: kycRepo,
    negotiation: negotiationRepo,
    execution: executionRepo,
    materials: materialsRepo,
    finance: financeRepo,
    admin: adminRepo,
    payments: paymentsRepo,

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
      async countUnread(userId) {
        return notifications.filter((n) => n.user_id === userId && !n.read_at).length;
      },
      async markRead(userId, ids) {
        let n = 0;
        for (let i = 0; i < notifications.length; i++) {
          const row = notifications[i]!;
          if (row.user_id !== userId || row.read_at) continue;
          if (ids && !ids.includes(row.id)) continue;
          notifications[i] = { ...row, read_at: now() };
          n++;
        }
        return n;
      },
    },

    reach: {
      async upsertDevice(d) {
        // mirrors device_tokens_token_idx: one row per token, whoever it belongs to now
        const existing = devices.find((x) => x.token === d.token);
        if (existing) {
          const next: DeviceTokenRecord = {
            ...existing,
            ...d,
            disabled_at: null,
            disabled_reason: null,
            last_seen_at: now(),
            updated_at: now(),
          };
          devices[devices.indexOf(existing)] = next;
          return next;
        }
        const rec: DeviceTokenRecord = {
          ...d,
          id: newId(),
          disabled_at: null,
          disabled_reason: null,
          last_seen_at: now(),
          created_at: now(),
          updated_at: now(),
        } as DeviceTokenRecord;
        devices.push(rec);
        return rec;
      },
      async listDevices(userId) {
        return devices
          .filter((d) => d.user_id === userId && !d.disabled_at)
          .sort((a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime());
      },
      async activeTokens(userId) {
        return devices.filter((d) => d.user_id === userId && !d.disabled_at).map((d) => d.token);
      },
      async disableToken(token, reason) {
        const i = devices.findIndex((d) => d.token === token);
        if (i >= 0) devices[i] = { ...devices[i]!, disabled_at: now(), disabled_reason: reason, updated_at: now() };
      },
      async removeDevice(userId, id) {
        const i = devices.findIndex((d) => d.id === id && d.user_id === userId);
        if (i >= 0) devices[i] = { ...devices[i]!, disabled_at: now(), disabled_reason: 'removed_by_user', updated_at: now() };
      },

      async createCall(c) {
        const rec: MaskedCallRecord = { ...c, id: newId(), created_at: now(), updated_at: now() } as MaskedCallRecord;
        calls.set(rec.id, rec);
        return rec;
      },
      async updateCall(id, patch) {
        const c = calls.get(id);
        if (!c) throw new Error('call not found');
        const next = { ...c, ...patch, updated_at: now() };
        calls.set(id, next);
        return next;
      },
      async countCallsSince(jobId, callerId, since) {
        return [...calls.values()].filter((c) => c.job_id === jobId && c.caller_id === callerId && c.created_at >= since).length;
      },

      async addReschedule(r) {
        const rec: JobRescheduleRecord = { ...r, id: newId(), created_at: now() } as JobRescheduleRecord;
        reschedules.push(Object.freeze(rec));
        return rec;
      },
      async listReschedules(jobId) {
        return reschedules.filter((r) => r.job_id === jobId).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      },

      async createProposal(p) {
        // mirrors schedule_proposals_one_open_idx
        if ([...proposals.values()].some((x) => x.job_id === p.job_id && x.status === 'PENDING')) {
          throw conflict({ reason: 'proposal_already_open' });
        }
        const rec: ScheduleProposalRecord = { ...p, id: newId(), created_at: now(), updated_at: now() } as ScheduleProposalRecord;
        proposals.set(rec.id, rec);
        return rec;
      },
      async getProposal(id) {
        return proposals.get(id) ?? null;
      },
      async updateProposal(id, patch) {
        const p = proposals.get(id);
        if (!p) throw new Error('proposal not found');
        const next = { ...p, ...patch, updated_at: now() };
        proposals.set(id, next);
        return next;
      },
      async findOpenProposal(jobId) {
        return [...proposals.values()].find((p) => p.job_id === jobId && p.status === 'PENDING') ?? null;
      },
      async listExpiredProposals(at, limit) {
        return [...proposals.values()]
          .filter((p) => p.status === 'PENDING' && p.expires_at <= at)
          .sort((a, b) => a.expires_at.getTime() - b.expires_at.getTime())
          .slice(0, limit);
      },
    },

    growth: createMemoryGrowthRepo(),
    trust: createMemoryTrustRepo(),

    retention: {
      async schedule(e) {
        const rec: RetentionEventRecord = { ...e, id: newId(), created_at: now() };
        retention.push(rec);
        return rec;
      },
      async listDue(at, limit) {
        return retention
          .filter((r) => !r.executed_at && r.scheduled_for <= at)
          .sort((a, b) => a.scheduled_for.getTime() - b.scheduled_for.getTime())
          .slice(0, limit);
      },
      async markExecuted(id, at) {
        const idx = retention.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error('retention event not found');
        const next = { ...retention[idx]!, executed_at: at };
        retention[idx] = next;
        return next;
      },
    },

    reports,
    cluster,

    scheduler: {
      // The same shape the SQL table has, so the scheduler cannot behave differently here.
      async loadRuns() {
        return [...schedulerRuns.values()].map((r) => ({ ...r }));
      },
      async recordRun(rec) {
        schedulerRuns.set(rec.task, { ...rec });
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
