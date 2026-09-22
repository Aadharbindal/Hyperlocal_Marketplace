import { checkChallengeUsable, generateOtpCode, maskPhone, type UserRole, type UserView } from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type { DataStore, UserRecord, UserRoleRecord } from '../../data/types';
import { hmacOtp, newId, newOpaqueToken, safeEqualHex, secureRandomInt, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import type { AuditService } from '../audit/service';

export interface AuthDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  audit: AuditService;
  tokens: { signAccess(c: { sub: string; roles: UserRole[]; sid: string }): Promise<string> };
}

export function toUserView(u: UserRecord, roles: UserRoleRecord[]): UserView {
  return {
    id: u.id,
    phoneMasked: maskPhone(u.phone_e164),
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    preferredLanguage: u.preferred_language,
    status: u.status,
    roles: roles.filter((r) => r.status !== 'REVOKED').map((r) => ({ role: r.role, status: r.status })),
    createdAt: u.created_at.toISOString(),
  };
}

export function authService(d: AuthDeps) {
  const { env, store, adapters, audit } = d;
  const RESEND_COOLDOWN_SECONDS = 60;

  async function issueSession(user: UserRecord, meta: { ip: string | null; userAgent: string | null; deviceLabel: string | null; rotatedFrom?: string | null }) {
    const roles = await store.users.listRoles(user.id);
    const activeRoles = roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role);
    const refreshToken = newOpaqueToken();
    const session = await store.auth.createSession({
      id: newId(),
      user_id: user.id,
      refresh_token_hash: sha256(refreshToken),
      device_label: meta.deviceLabel,
      user_agent: meta.userAgent,
      ip: meta.ip,
      expires_at: new Date(Date.now() + env.API_REFRESH_TOKEN_TTL_SECONDS * 1000),
      revoked_at: null,
      rotated_from: meta.rotatedFrom ?? null,
      last_used_at: null,
    });
    const accessToken = await d.tokens.signAccess({ sub: user.id, roles: activeRoles, sid: session.id });
    return {
      accessToken,
      refreshToken,
      expiresIn: env.API_ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer' as const,
      user: toUserView(user, roles),
    };
  }

  return {
    async requestOtp(input: { phoneE164: string; ip: string | null; requestId: string | null }) {
      const hourAgo = new Date(Date.now() - 3600_000);
      const [byPhone, byIp] = await Promise.all([
        store.auth.countChallengesSince(input.phoneE164, hourAgo),
        input.ip ? store.auth.countChallengesByIpSince(input.ip, hourAgo) : Promise.resolve(0),
      ]);
      if (byPhone >= env.OTP_REQUESTS_PER_HOUR || byIp >= env.OTP_REQUESTS_PER_HOUR * 4) {
        await audit.record(
          { actorUserId: null, actorRole: null, ip: input.ip, requestId: input.requestId },
          { action: 'otp.rate_limited', entityType: 'phone', entityId: maskPhone(input.phoneE164) },
        );
        throw new AppError('OTP_RATE_LIMITED');
      }
      const latest = await store.auth.latestChallenge(input.phoneE164);
      if (latest && !latest.consumed_at && Date.now() - latest.created_at.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
        const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - latest.created_at.getTime())) / 1000);
        throw new AppError('OTP_RATE_LIMITED', { details: { resendAfterSeconds: wait } });
      }

      // A suspended user may still log in (read-only view of balances/history) - blocked per action, not at OTP.
      const code = adapters.sms.isMock && env.APP_ENV !== 'production' ? env.OTP_DEMO_CODE.padStart(env.OTP_LENGTH, '0').slice(-env.OTP_LENGTH) : generateOtpCode(env.OTP_LENGTH, secureRandomInt);
      const id = newId();
      await store.auth.createChallenge({
        id,
        phone_e164: input.phoneE164,
        purpose: 'LOGIN',
        code_hash: hmacOtp(env.API_JWT_SECRET, id, code),
        attempts: 0,
        max_attempts: env.OTP_MAX_ATTEMPTS,
        expires_at: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
        consumed_at: null,
        request_ip: input.ip,
      });
      await adapters.sms.sendOtp({ phoneE164: input.phoneE164, code, purpose: 'LOGIN', ttlSeconds: env.OTP_TTL_SECONDS });
      return {
        challengeId: id,
        expiresInSeconds: env.OTP_TTL_SECONDS,
        resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
        ...(adapters.sms.isMock && env.APP_ENV !== 'production' ? { demoCode: code } : {}),
      };
    },

    async verifyOtp(input: { challengeId: string; code: string; ip: string | null; userAgent: string | null; deviceLabel: string | null; requestId: string | null }) {
      const c = await store.auth.getChallenge(input.challengeId);
      if (!c) throw new AppError('OTP_INVALID');
      const usable = checkChallengeUsable({ attempts: c.attempts, maxAttempts: c.max_attempts, expiresAt: c.expires_at, consumedAt: c.consumed_at });
      if (usable === 'CONSUMED') throw new AppError('OTP_CONSUMED');
      if (usable === 'EXPIRED') throw new AppError('OTP_EXPIRED');
      if (usable === 'LOCKED') throw new AppError('OTP_LOCKED');

      const ok = safeEqualHex(c.code_hash, hmacOtp(env.API_JWT_SECRET, c.id, input.code));
      if (!ok) {
        const updated = await store.auth.updateChallenge(c.id, { attempts: c.attempts + 1 });
        const remaining = Math.max(0, updated.max_attempts - updated.attempts);
        if (remaining === 0) {
          await audit.record(
            { actorUserId: null, actorRole: null, ip: input.ip, requestId: input.requestId },
            { action: 'otp.locked', entityType: 'otp_challenge', entityId: c.id },
          );
          throw new AppError('OTP_LOCKED');
        }
        throw new AppError('OTP_INVALID', { details: { attemptsRemaining: remaining } });
      }

      return store.transaction(async (tx) => {
        await tx.auth.updateChallenge(c.id, { consumed_at: new Date() });
        let user = await tx.users.findByPhone(c.phone_e164);
        let isNewUser = false;
        if (!user) {
          user = await tx.users.create({ phone_e164: c.phone_e164 });
          isNewUser = true;
          await tx.audit.append({
            actor_user_id: user.id, actor_role: null, action: 'user.created', entity_type: 'user', entity_id: user.id,
            reason: null, before: null, after: null, ip: input.ip, request_id: input.requestId,
          });
          adapters.analytics.track('signup_completed', { userId: user.id });
        }
        if (user.status === 'DELETED') throw new AppError('AUTH_SUSPENDED');
        user = await tx.users.update(user.id, { phone_verified_at: user.phone_verified_at ?? new Date(), last_login_at: new Date() });
        const session = await issueSessionWith(tx, user, { ip: input.ip, userAgent: input.userAgent, deviceLabel: input.deviceLabel });
        return { ...session, isNewUser };
      });
    },

    async refresh(input: { refreshToken: string; ip: string | null; userAgent: string | null }) {
      const s = await store.auth.findSessionByHash(sha256(input.refreshToken));
      if (!s || s.revoked_at || s.expires_at < new Date()) throw new AppError('AUTH_INVALID_TOKEN');
      const user = await store.users.findById(s.user_id);
      if (!user || user.status === 'DELETED') throw new AppError('AUTH_INVALID_TOKEN');
      // Rotate: old refresh token is single-use.
      await store.auth.revokeSession(s.id);
      return issueSession(user, { ip: input.ip, userAgent: input.userAgent, deviceLabel: s.device_label, rotatedFrom: s.id });
    },

    async logout(input: { userId: string; refreshToken?: string; all?: boolean; sessionId: string }) {
      if (input.all) {
        await store.auth.revokeAllSessions(input.userId);
        return;
      }
      if (input.refreshToken) {
        const s = await store.auth.findSessionByHash(sha256(input.refreshToken));
        if (s && s.user_id === input.userId) await store.auth.revokeSession(s.id);
      }
      await store.auth.revokeSession(input.sessionId);
    },

    issueSession,
  };

  async function issueSessionWith(tx: DataStore, user: UserRecord, meta: { ip: string | null; userAgent: string | null; deviceLabel: string | null }) {
    // Same as issueSession but bound to the transaction store.
    const roles = await tx.users.listRoles(user.id);
    const activeRoles = roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role);
    const refreshToken = newOpaqueToken();
    const session = await tx.auth.createSession({
      id: newId(),
      user_id: user.id,
      refresh_token_hash: sha256(refreshToken),
      device_label: meta.deviceLabel,
      user_agent: meta.userAgent,
      ip: meta.ip,
      expires_at: new Date(Date.now() + env.API_REFRESH_TOKEN_TTL_SECONDS * 1000),
      revoked_at: null,
      rotated_from: null,
      last_used_at: null,
    });
    const accessToken = await d.tokens.signAccess({ sub: user.id, roles: activeRoles, sid: session.id });
    return { accessToken, refreshToken, expiresIn: env.API_ACCESS_TOKEN_TTL_SECONDS, tokenType: 'Bearer' as const, user: toUserView(user, roles) };
  }
}
export type AuthService = ReturnType<typeof authService>;
