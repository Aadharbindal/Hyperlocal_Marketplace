import { createHmac, randomBytes } from 'node:crypto';
import {
  ADMIN_MFA_SESSION_HOURS,
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
  checkAppeal,
  checkKycReview,
  checkSuspension,
  countSlaBreaches,
  kycStatusAfter,
  maskPhone,
  mfaStillValid,
  otpauthUri,
  toBase32,
  verifyTotp,
  type DisputeQueueMove,
  type KycDecision,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type { DataStore, DisputeRecord, KycRecord, UserRecord } from '../../data/types';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { AppError, forbidden, notFound } from '../../lib/errors';

export interface AdminDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
}

function blocked(code: string, extra: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_ERROR', { details: { admin: [code], ...extra } });
}

/** Node's HMAC-SHA1, handed to the pure TOTP code in core. */
const hmacSha1 = (key: Uint8Array, message: Uint8Array) =>
  Uint8Array.from(createHmac('sha1', Buffer.from(key)).update(Buffer.from(message)).digest());

const MFA_MAX_FAILURES = 5;
const MFA_LOCK_MINUTES = 15;

export function adminService(d: AdminDeps) {
  const { env, store, adapters } = d;

  return {
    // ------------------------------------------------------------------ MFA
    /**
     * Enrolment. The secret is returned exactly once, here, so it can be scanned; after this
     * only its encrypted form exists and no endpoint will ever hand it back.
     */
    async startMfaEnrolment(user: UserRecord) {
      const existing = await store.admin.getMfa(user.id);
      if (existing?.enabled_at) blocked('MFA_ALREADY_ENROLLED');

      const secret = toBase32(new Uint8Array(randomBytes(20)));
      await store.admin.upsertMfa({
        user_id: user.id,
        secret_encrypted: encryptSecret(env.API_JWT_SECRET, secret),
        enabled_at: null,
        last_used_step: null,
        failed_attempts: 0,
        locked_until: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return {
        secret,
        otpauthUri: otpauthUri({ secretBase32: secret, account: maskPhone(user.phone_e164), issuer: env.BRAND_NAME }),
        digits: TOTP_DIGITS,
        periodSeconds: TOTP_STEP_SECONDS,
      };
    },

    /** Proves the authenticator was set up correctly before the factor is switched on. */
    async enableMfa(user: UserRecord, code: string) {
      const record = await store.admin.getMfa(user.id);
      if (!record) blocked('MFA_NOT_STARTED');
      if (record!.enabled_at) blocked('MFA_ALREADY_ENROLLED');

      const secret = decryptSecret(env.API_JWT_SECRET, record!.secret_encrypted);
      const check = verifyTotp(secret, code, hmacSha1, { lastUsedStep: record!.last_used_step });
      if (!check.ok) blocked(check.reason);

      await store.admin.updateMfa(user.id, { enabled_at: new Date(), last_used_step: check.step, failed_attempts: 0 });
      adapters.analytics.track('admin_mfa_enabled', { userId: user.id });
      return true;
    },

    /**
     * The check an admin does at the start of a shift. A wrong code is counted and five of them
     * lock the factor for a quarter of an hour; a correct code can never be replayed.
     */
    async verifyMfa(user: UserRecord, sessionId: string, code: string) {
      const record = await store.admin.getMfa(user.id);
      if (!record?.enabled_at) blocked('MFA_NOT_ENROLLED');
      if (record.locked_until && record.locked_until > new Date()) {
        blocked('MFA_LOCKED', { until: record.locked_until.toISOString() });
      }

      const secret = decryptSecret(env.API_JWT_SECRET, record.secret_encrypted);
      const check = verifyTotp(secret, code, hmacSha1, { lastUsedStep: record.last_used_step });
      if (!check.ok) {
        const failed = record.failed_attempts + 1;
        await store.admin.updateMfa(user.id, {
          failed_attempts: failed,
          locked_until: failed >= MFA_MAX_FAILURES ? new Date(Date.now() + MFA_LOCK_MINUTES * 60_000) : null,
        });
        adapters.monitoring.captureMessage('admin mfa failure', { userId: user.id, attempts: failed });
        blocked(check.reason, { attemptsLeft: Math.max(0, MFA_MAX_FAILURES - failed) });
      }

      await store.admin.updateMfa(user.id, { last_used_step: check.step, failed_attempts: 0, locked_until: null });
      await store.auth.markSessionMfa(sessionId, new Date());
      adapters.analytics.track('admin_mfa_verified', { userId: user.id });
      return true;
    },

    async mfaStatus(user: UserRecord, sessionId: string) {
      const record = await store.admin.getMfa(user.id);
      const session = await store.auth.getSession(sessionId);
      return {
        enrolled: !!record?.enabled_at,
        verifiedForSession: mfaStillValid(session?.mfa_verified_at ?? null),
        requiredForAdmin: env.ADMIN_MFA_REQUIRED,
        enabledAt: record?.enabled_at?.toISOString() ?? null,
      };
    },

    /**
     * The gate every console route goes through. In production an admin without a fresh second
     * factor simply cannot act; the requirement is a setting so local demos stay usable, and
     * `/ready` reports when it is off.
     */
    async requireFreshMfa(userId: string, sessionId: string) {
      if (!env.ADMIN_MFA_REQUIRED) return;
      const record = await store.admin.getMfa(userId);
      if (!record?.enabled_at) {
        throw new AppError('FORBIDDEN', { details: { reason: 'mfa_enrolment_required' } });
      }
      const session = await store.auth.getSession(sessionId);
      if (!mfaStillValid(session?.mfa_verified_at ?? null)) {
        throw new AppError('FORBIDDEN', { details: { reason: 'mfa_verification_required', withinHours: ADMIN_MFA_SESSION_HOURS } });
      }
    },

    // ------------------------------------------------------------------ KYC review
    async kycQueue(limit: number) {
      const records = await store.kyc.listByStatus(['SUBMITTED', 'UNDER_REVIEW'], limit);
      return Promise.all(records.map((r) => this.toKycItem(r, { withDocumentUrl: false })));
    },

    /**
     * A reviewer's view of one submission. Asking for the document itself is a separate,
     * logged act - the queue alone never hands out identity documents.
     */
    async toKycItem(record: KycRecord, opts: { withDocumentUrl: boolean }) {
      const user = await store.users.findById(record.user_id);
      const roles = user ? await store.users.listRoles(user.id) : [];
      let documentUrl: string | null = null;
      if (opts.withDocumentUrl) {
        // Five minutes, long enough to look at and too short to pass around.
        documentUrl = await adapters.storage.createSignedReadUrl(record.storage_key_encrypted, 300);
      }
      return {
        id: record.id,
        userId: record.user_id,
        userName: user?.display_name ?? 'Unnamed',
        // Even a reviewer sees a masked number in a list; the document is the identity check.
        userPhoneMasked: user ? maskPhone(user.phone_e164) : '',
        roles: roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role),
        documentType: record.document_type,
        documentLast4: record.doc_number_last4,
        status: record.status,
        documentUrl,
        rejectionReason: record.rejection_reason,
        submittedAt: record.created_at.toISOString(),
        reviewedAt: record.reviewed_at?.toISOString() ?? null,
      };
    },

    /** Opening a document is recorded against the reviewer, forever. */
    async openKycDocument(recordId: string, reviewerId: string, ip: string | null) {
      const record = await store.kyc.get(recordId);
      if (!record) throw notFound('kyc record');
      await store.admin.logKycAccess({
        kyc_record_id: record.id,
        viewed_by: reviewerId,
        purpose: 'verification_review',
        ip,
      });
      adapters.analytics.track('kyc_document_opened', { userId: reviewerId });
      return this.toKycItem(record, { withDocumentUrl: true });
    },

    async reviewKyc(recordId: string, reviewerId: string, decision: KycDecision, reason: string | undefined) {
      const record = await store.kyc.get(recordId);
      if (!record) throw notFound('kyc record');
      const problem = checkKycReview({ status: record.status, userId: record.user_id }, { decision, reason, reviewerId });
      if (problem) blocked(problem);

      const status = kycStatusAfter(decision);
      const updated = await store.kyc.update(record.id, {
        status,
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        rejection_reason: decision === 'APPROVE' ? null : (reason ?? null),
      });

      // Approving is what actually lets someone work, so it flips their profile too.
      if (decision === 'APPROVE' || decision === 'REJECT') {
        const provider = await store.users.getProviderProfile(record.user_id);
        if (provider) await store.users.upsertProviderProfile({ ...provider, verification_status: status });
        const technician = await store.users.getTechnicianProfile(record.user_id);
        if (technician) await store.users.upsertTechnicianProfile({ ...technician, verification_status: status });
        const vendor = await store.users.getVendorProfile(record.user_id);
        if (vendor) await store.users.upsertVendorProfile({ ...vendor, verification_status: status });
      }

      await store.notifications.create({
        user_id: record.user_id,
        type: 'kyc.reviewed',
        title: decision === 'APPROVE' ? 'You are verified' : 'We need something else',
        body: decision === 'APPROVE' ? 'You can start taking jobs now.' : (reason ?? 'Please check your documents and submit again.'),
        data: {},
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
      adapters.analytics.track('kyc_reviewed', { userId: reviewerId, decision });
      return updated;
    },

    // ------------------------------------------------------------------ people
    async userDetail(userId: string, viewerIsAdmin: boolean) {
      const user = await store.users.findById(userId);
      if (!user) throw notFound('user');
      const [roles, provider, strikes, settlements] = await Promise.all([
        store.users.listRoles(userId),
        store.users.getProviderProfile(userId),
        store.finance.listStrikes(userId),
        store.finance.listSettlementsForPayee(userId, 50),
      ]);
      return {
        id: user.id,
        displayName: user.display_name,
        // Support sees a masked number; only an admin sees the whole thing.
        phone: viewerIsAdmin ? user.phone_e164 : maskPhone(user.phone_e164),
        status: user.status,
        roles: roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role),
        suspendedReason: user.suspended_reason,
        verification: provider?.verification_status ?? null,
        reliabilityScore: provider?.reliability_score ?? null,
        ratingAvg: provider?.rating_avg ?? null,
        completedJobs: provider?.completed_jobs ?? 0,
        strikes: strikes.map((s) => ({ id: s.id, severity: s.severity, reason: s.reason, createdAt: s.created_at.toISOString() })),
        owedPaise: settlements.filter((s) => s.status !== 'PAID').reduce((t, s) => t + Number(s.amount_paise), 0),
        createdAt: user.created_at.toISOString(),
      };
    },

    /**
     * Suspension takes two people and a written reason: it stops someone earning, and the
     * money they have already earned stays theirs (DISPUTE_POLICY section 5).
     */
    async suspendUser(targetId: string, actorId: string, input: { reason: string; secondApproverId: string; untilIso?: string }) {
      const target = await store.users.findById(targetId);
      if (!target) throw notFound('user');
      const problem = checkSuspension({
        targetUserId: targetId,
        actorId,
        reason: input.reason,
        secondApproverId: input.secondApproverId,
      });
      if (problem) blocked(problem);

      const approver = await store.users.findById(input.secondApproverId);
      const approverRoles = approver ? await store.users.listRoles(approver.id) : [];
      const approverIsStaff = approverRoles.some((r) => (r.role === 'ADMIN' || r.role === 'SUPPORT') && r.status === 'ACTIVE');
      if (!approver || !approverIsStaff) blocked('SECOND_APPROVER_NOT_STAFF');

      // Both names go on the record. This is not bookkeeping: `users_suspension_needs_two`
      // refuses the update without them, because a suspension nobody is accountable for is
      // worse than none.
      const updated = await store.users.update(targetId, {
        status: 'SUSPENDED',
        suspended_reason: input.reason,
        suspended_by: actorId,
        suspension_approved_by: input.secondApproverId,
      });
      const provider = await store.users.getProviderProfile(targetId);
      if (provider) {
        await store.users.upsertProviderProfile({
          ...provider,
          is_available: false,
          suspended_until: input.untilIso ? new Date(input.untilIso) : null,
        });
      }
      await store.auth.revokeAllSessions(targetId);
      await store.notifications.create({
        user_id: targetId,
        type: 'account.suspended',
        title: 'Your account is paused',
        body: input.reason,
        data: {},
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
      adapters.analytics.track('user_suspended', { userId: actorId, targetId });
      return updated;
    },

    // ------------------------------------------------------------------ dispute queue
    async moveDispute(dispute: DisputeRecord, actorId: string, to: DisputeQueueMove, note?: string) {
      if (dispute.resolved_at) blocked('DISPUTE_CLOSED');
      return store.finance.updateDispute(dispute.id, {
        status: to,
        assigned_to: actorId,
        queue_note: note ?? dispute.queue_note ?? null,
      });
    },

    /**
     * An appeal: one per dispute, within a week, reviewed by someone who did not decide it the
     * first time (DISPUTE_POLICY section 6).
     */
    async appeal(dispute: DisputeRecord, userId: string, reason: string) {
      const problem = checkAppeal(
        {
          status: dispute.status,
          resolvedAt: dispute.resolved_at,
          reopenedCount: dispute.reopened_count,
          raisedBy: dispute.raised_by,
          againstUserId: dispute.against_user_id,
        },
        { userId, reason },
      );
      if (problem) blocked(problem);

      const reopened = await store.finance.updateDispute(dispute.id, {
        status: 'REOPENED',
        reopened_count: dispute.reopened_count + 1,
        queue_note: reason,
        // the original decider is cleared so the queue routes it to someone else
        assigned_to: null,
        resolved_at: null,
      });
      adapters.analytics.track('dispute_appealed', { userId, disputeId: dispute.id });
      return reopened;
    },

    // ------------------------------------------------------------------ payouts
    async retrySettlement(settlementId: string, actorId: string) {
      const settlement = await store.finance.getSettlement(settlementId);
      if (!settlement) throw notFound('settlement');
      if (settlement.status === 'PAID') blocked('ALREADY_PAID');
      const job = await store.jobs.get(settlement.job_id);
      if (job && (await store.finance.findOpenDispute(job.id))) blocked('DISPUTE_OPEN');
      // Back into the queue; the run re-checks every guard before it sends anything.
      const reset = await store.finance.updateSettlement(settlement.id, { status: 'PENDING', failure_reason: null });
      adapters.analytics.track('settlement_retried', { userId: actorId, settlementId });
      return reset;
    },

    // ------------------------------------------------------------------ reports
    /** The numbers an operator actually looks at, straight from the records. */
    async opsReport() {
      const jobsByStatus: Record<string, number> = {};
      let capturedPaise = 0;
      let refundedPaise = 0;
      let platformRevenuePaise = 0;

      const customers = await store.users.search('', 500).catch(() => []);
      const jobIds = new Set<string>();
      for (const user of customers) {
        for (const job of await store.jobs.listForCustomer(user.id, { limit: 200 })) {
          if (jobIds.has(job.id)) continue;
          jobIds.add(job.id);
          jobsByStatus[job.status] = (jobsByStatus[job.status] ?? 0) + 1;
          for (const e of await store.finance.listLedgerForJob(job.id)) {
            const amount = Number(e.amount_paise);
            if (e.entry_type === 'CUSTOMER_CHARGE') capturedPaise += amount;
            if (e.entry_type === 'REFUND') refundedPaise += -amount;
            if (e.entry_type === 'PLATFORM_REVENUE') platformRevenuePaise += -amount;
          }
        }
      }

      const [pending, initiated, paid, onHold, disputes, kyc] = await Promise.all([
        store.finance.listSettlementsByStatus('PENDING', 500),
        store.finance.listSettlementsByStatus('INITIATED', 500),
        store.finance.listSettlementsByStatus('PAID', 500),
        store.finance.listSettlementsByStatus('ON_HOLD', 500),
        store.finance.listDisputesByStatus(['OPEN', 'UNDER_REVIEW', 'AWAITING_PARTY', 'ESCALATED', 'REOPENED'], 500),
        store.kyc.listByStatus(['SUBMITTED', 'UNDER_REVIEW'], 500),
      ]);

      const live = ['OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING', 'PAYMENT_PENDING', 'CONFIRMED', 'PROVIDER_ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS'];
      return {
        generatedAt: new Date().toISOString(),
        jobsByStatus,
        liveJobs: live.reduce((t, s) => t + (jobsByStatus[s] ?? 0), 0),
        completedJobs: (jobsByStatus.COMPLETED ?? 0) + (jobsByStatus.SETTLED ?? 0),
        capturedPaise,
        refundedPaise,
        platformRevenuePaise,
        payoutsPendingPaise: [...pending, ...initiated, ...onHold].reduce((t, s) => t + Number(s.amount_paise), 0),
        payoutsPaidPaise: paid.reduce((t, s) => t + Number(s.amount_paise), 0),
        disputesOpen: disputes.length,
        disputesBreachingSla: countSlaBreaches(disputes.map((x) => ({ slaDueAt: x.sla_due_at, status: x.status }))),
        kycPending: kyc.length,
        providersVerified: 0,
        providersSuspended: 0,
      };
    },

    /** Guard used by every console route. */
    requireStaff(role: string | null) {
      if (role !== 'ADMIN' && role !== 'SUPPORT') throw forbidden('support only');
    },
  };
}

export type AdminService = ReturnType<typeof adminService>;
