import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Action, type UserRole } from '@hyperlocal/core';
import type { DataStore, UserRecord } from '../data/types';
import { AppError, forbidden } from '../lib/errors';
import type { TokenService } from '../modules/auth/tokens';
import type { AuditContext } from '../modules/audit/service';

export interface AuthContext {
  userId: string;
  sessionId: string;
  roles: UserRole[];
  /** Role the client is acting as (X-Active-Role header), validated against granted roles. */
  activeRole: UserRole;
  user: UserRecord;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    auditCtx(): AuditContext;
  }
}

/**
 * Populates `request.auth` when a bearer token is present. Route-level guards decide whether
 * anonymous access is allowed. Suspended users can authenticate (to see balances/history) but
 * `requireAction` blocks every mutating action for them.
 */
export function makeAuthenticate(tokens: TokenService, store: DataStore) {
  return async function authenticate(req: FastifyRequest): Promise<void> {
    req.auth = null;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const claims = await tokens.verifyAccess(header.slice(7));
    const user = await store.users.findById(claims.sub);
    if (!user || user.status === 'DELETED') throw new AppError('AUTH_INVALID_TOKEN');
    // Roles are re-read from the store so revocations take effect immediately.
    const roleRows = await store.users.listRoles(user.id);
    const roles = roleRows.filter((r) => r.status === 'ACTIVE').map((r) => r.role);
    const requested = req.headers['x-active-role'];
    const activeRole = (typeof requested === 'string' && roles.includes(requested as UserRole) ? requested : roles[0]) as UserRole | undefined;
    req.auth = { userId: user.id, sessionId: claims.sid, roles, activeRole: activeRole ?? 'CUSTOMER', user };
    void store.auth.touchSession(claims.sid);
  };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth;
}

/** Coarse RBAC check + suspension gate. Ownership checks live in the module. */
export function requireAction(action: Action, opts: { allowSuspended?: boolean } = {}) {
  return async function guard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const auth = requireAuth(req);
    if (auth.user.status === 'SUSPENDED' && !opts.allowSuspended) throw new AppError('AUTH_SUSPENDED');
    // Self-scoped actions (me.*) need only authentication: a freshly signed-up user has no roles yet.
    if (action.startsWith('me.')) return;
    if (!can(auth.roles, action)) throw forbidden(`requires one of the roles allowed for ${action}`);
  };
}

export function requireRole(...roles: UserRole[]) {
  return async function guard(req: FastifyRequest): Promise<void> {
    const auth = requireAuth(req);
    if (!roles.some((r) => auth.roles.includes(r))) throw forbidden();
  };
}
