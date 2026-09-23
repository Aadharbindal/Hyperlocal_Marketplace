import type { FastifyInstance } from 'fastify';
import { ReasonBody, maskPhone, type AuditLogView } from '@hyperlocal/core';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import { toUserView } from '../auth/service';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * Foundation admin routes. Every mutation requires a reason and is audited
 * (PRODUCT_SPEC section 8). Two-person approval for high-risk actions lands in M8.
 */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;

  app.get('/admin/users', { preHandler: requireAction('admin.user.search') }, async (req) => {
    const auth = requireAuth(req);
    const { q } = parse(z.object({ q: z.string().min(2).max(60) }), req.query);
    const users = await store.users.search(q, 25);
    const items = await Promise.all(
      users.map(async (u) => {
        const view = toUserView(u, await store.users.listRoles(u.id));
        // SUPPORT sees masked numbers only; ADMIN sees full for identity checks.
        return { ...view, phone: auth.roles.includes('ADMIN') ? u.phone_e164 : maskPhone(u.phone_e164), suspendedReason: u.suspended_reason };
      }),
    );
    await services.audit.record(req.auditCtx(), { action: 'admin.user.searched', entityType: 'user', after: { q } });
    return { items };
  });

  /**
   * Retired. This was the M1 route, where one admin could suspend somebody on their own. M8
   * made suspension a two-person action and `users_suspension_needs_two` enforces it in SQL, so
   * this route cannot succeed against a real database - it only ever "worked" in memory mode.
   * It answers rather than 404s so anyone still calling it is told where to go.
   */
  app.post('/admin/users/:id/suspend', { preHandler: requireAction('admin.user.suspend') }, async (req) => {
    requireAuth(req);
    throw new AppError('VALIDATION_ERROR', {
      details: { admin: ['USE_TWO_PERSON_SUSPENSION'], use: 'POST /admin/users/:id/suspend-approved' },
    });
  });

  app.post('/admin/users/:id/reactivate', { preHandler: requireAction('admin.user.reactivate') }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const { reason } = parse(ReasonBody, req.body ?? {});
    const target = await store.users.findById(id);
    if (!target) throw notFound('user');
    await store.users.update(id, { status: 'ACTIVE', suspended_reason: null });
    await services.audit.record(req.auditCtx(), { action: 'admin.user.reactivated', entityType: 'user', entityId: id, reason, before: { status: target.status }, after: { status: 'ACTIVE' } });
    return { ok: true };
  });

  app.get('/admin/audit-logs', { preHandler: requireAction('admin.audit.read') }, async (req) => {
    const q = parse(
      z.object({ entityType: z.string().optional(), entityId: z.string().optional(), actorUserId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
      req.query,
    );
    const rows = await store.audit.list(q);
    const items: AuditLogView[] = rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      actorRole: r.actor_role,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      reason: r.reason,
      before: r.before,
      after: r.after,
      requestId: r.request_id,
      createdAt: r.created_at.toISOString(),
    }));
    return { items };
  });
}
