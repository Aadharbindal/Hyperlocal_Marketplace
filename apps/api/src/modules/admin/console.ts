import type { FastifyInstance } from 'fastify';
import { AppealBody, DisputeMoveBody, KycReviewBody, MfaCodeBody, SuspendUserBody } from '@hyperlocal/core';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

/**
 * The support console (Milestone 8). Everything here is staff-only, behind a second factor
 * that has not gone stale, and every mutation carries a reason into the audit log.
 */
export async function adminConsoleRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;
  const admin = services.admin;

  /** Staff, with a fresh second factor. */
  async function staff(req: Parameters<typeof requireAuth>[0]) {
    const auth = requireAuth(req);
    admin.requireStaff(auth.activeRole);
    await admin.requireFreshMfa(auth.userId, auth.sessionId);
    return auth;
  }

  // ---------------------------------------------------------------- MFA
  // Enrolment is not behind the factor - that is the point of enrolling.
  app.post('/admin/mfa/setup', async (req) => {
    const auth = requireAuth(req);
    admin.requireStaff(auth.activeRole);
    const setup = await admin.startMfaEnrolment(auth.user);
    await services.audit.record(req.auditCtx(), { action: 'admin.mfa.enrolment_started', entityType: 'user', entityId: auth.userId });
    return setup;
  });

  app.post('/admin/mfa/enable', async (req) => {
    const auth = requireAuth(req);
    admin.requireStaff(auth.activeRole);
    const { code } = parse(MfaCodeBody, req.body);
    await admin.enableMfa(auth.user, code);
    await services.audit.record(req.auditCtx(), { action: 'admin.mfa.enabled', entityType: 'user', entityId: auth.userId });
    return { enabled: true };
  });

  app.post('/admin/mfa/verify', async (req) => {
    const auth = requireAuth(req);
    admin.requireStaff(auth.activeRole);
    const { code } = parse(MfaCodeBody, req.body);
    await admin.verifyMfa(auth.user, auth.sessionId, code);
    return { verified: true };
  });

  app.get('/admin/mfa', async (req) => {
    const auth = requireAuth(req);
    admin.requireStaff(auth.activeRole);
    return admin.mfaStatus(auth.user, auth.sessionId);
  });

  // ---------------------------------------------------------------- KYC review
  app.get('/admin/kyc', async (req) => {
    await staff(req);
    const { limit } = parse(LimitQuery, req.query);
    return { items: await admin.kycQueue(limit) };
  });

  /** Asking for the document is its own act, and it is logged against the reviewer. */
  app.post('/admin/kyc/:id/open', async (req) => {
    const auth = await staff(req);
    const { id } = parse(IdParam, req.params);
    const item = await admin.openKycDocument(id, auth.userId, req.ip ?? null);
    await services.audit.record(req.auditCtx(), {
      action: 'admin.kyc.document_opened',
      entityType: 'kyc_record',
      entityId: id,
      reason: 'verification review',
    });
    return item;
  });

  app.post('/admin/kyc/:id/review', async (req) => {
    const auth = await staff(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(KycReviewBody, req.body);
    const updated = await admin.reviewKyc(id, auth.userId, body.decision, body.reason);
    await services.audit.record(req.auditCtx(), {
      action: `admin.kyc.${body.decision.toLowerCase()}`,
      entityType: 'kyc_record',
      entityId: id,
      reason: body.reason ?? null,
      // the document number is never in the audit trail, only the decision
      after: { status: updated.status, userId: updated.user_id },
    });
    return { id: updated.id, status: updated.status };
  });

  // ---------------------------------------------------------------- people
  app.get('/admin/users/:id', async (req) => {
    const auth = await staff(req);
    const { id } = parse(IdParam, req.params);
    const detail = await admin.userDetail(id, auth.roles.includes('ADMIN'));
    await services.audit.record(req.auditCtx(), { action: 'admin.user.viewed', entityType: 'user', entityId: id });
    return detail;
  });

  /** Two people, a written reason, and every session of theirs ends. */
  app.post('/admin/users/:id/suspend-approved', async (req) => {
    const auth = await staff(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(SuspendUserBody, req.body);
    const updated = await admin.suspendUser(id, auth.userId, body);
    await services.audit.record(req.auditCtx(), {
      action: 'admin.user.suspended',
      entityType: 'user',
      entityId: id,
      reason: body.reason,
      after: { approvedBy: body.secondApproverId, until: body.untilIso ?? null },
    });
    return { id: updated.id, status: updated.status };
  });

  // ---------------------------------------------------------------- dispute queue
  app.post('/admin/disputes/:id/move', async (req) => {
    const auth = await staff(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(DisputeMoveBody, req.body);
    const dispute = await store.finance.getDispute(id);
    if (!dispute) throw notFound('dispute');
    const moved = await admin.moveDispute(dispute, auth.userId, body.to, body.note);
    await services.audit.record(req.auditCtx(), {
      action: `admin.dispute.${body.to.toLowerCase()}`,
      entityType: 'dispute',
      entityId: id,
      reason: body.note ?? null,
    });
    return services.finance.toDisputeView(moved, auth.userId);
  });

  /** An appeal comes from a party, not from staff, so this one is not staff-gated. */
  app.post('/disputes/:id/appeal', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(AppealBody, req.body);
    const dispute = await store.finance.getDispute(id);
    if (!dispute) throw notFound('dispute');
    const reopened = await admin.appeal(dispute, auth.userId, body.reason);
    await services.audit.record(req.auditCtx(), {
      action: 'dispute.appealed',
      entityType: 'dispute',
      entityId: id,
      reason: body.reason,
    });
    return services.finance.toDisputeView(reopened, auth.userId);
  });

  // ---------------------------------------------------------------- payouts
  app.post('/admin/settlements/:id/retry', async (req) => {
    const auth = await staff(req);
    const { id } = parse(IdParam, req.params);
    const reset = await admin.retrySettlement(id, auth.userId);
    await services.audit.record(req.auditCtx(), {
      action: 'admin.settlement.retried',
      entityType: 'settlement',
      entityId: id,
      after: { attempts: reset.attempts },
    });
    return { id: reset.id, status: reset.status, attempts: reset.attempts };
  });

  // ---------------------------------------------------------------- reports
  app.get('/admin/reports/overview', async (req) => {
    await staff(req);
    return admin.opsReport();
  });
}
