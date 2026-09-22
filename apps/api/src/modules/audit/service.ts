import type { UserRole } from '@hyperlocal/core';
import type { DataStore } from '../../data/types';

export interface AuditContext {
  actorUserId: string | null;
  actorRole: UserRole | null;
  ip: string | null;
  requestId: string | null;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit log writer. Every admin/support action and every security event goes here. */
export function auditService(store: DataStore) {
  return {
    async record(ctx: AuditContext, input: AuditInput) {
      return store.audit.append({
        actor_user_id: ctx.actorUserId,
        actor_role: ctx.actorRole,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        reason: input.reason ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        ip: ctx.ip,
        request_id: ctx.requestId,
      });
    },
  };
}
export type AuditService = ReturnType<typeof auditService>;
