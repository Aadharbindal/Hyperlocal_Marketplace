import type { FastifyInstance } from 'fastify';
import { LogoutBody, RefreshBody, RequestOtpBody, VerifyOtpBody } from '@hyperlocal/core';
import { sharedLimit } from '../../lib/shared-limit';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  /**
   * Counted in the database rather than in this process.
   *
   * The framework limiter keeps its count in a Map, which is exactly right for one node and
   * twice as generous as it reads on two. The OTP limits underneath this - per phone and per IP,
   * in `otp_challenges` - were always shared and are the control that actually stops an attack;
   * this one is the cheap gate in front of them, and it should not be the looser of the two.
   */
  const requestLimit = sharedLimit(ctx.store, {
    name: 'otp.request',
    max: 30,
    windowSeconds: 3600,
    key: (req) => {
      const body = req.body as { phone?: unknown } | null;
      return typeof body?.phone === 'string' ? body.phone : req.ip;
    },
  });

  // Keyed by challenge, because guessing a code is an attack on one challenge at a time and the
  // attempt counter on the row is what finally stops it.
  const verifyLimit = sharedLimit(ctx.store, {
    name: 'otp.verify',
    max: 30,
    windowSeconds: 3600,
    key: (req) => {
      const body = req.body as { challengeId?: unknown } | null;
      return typeof body?.challengeId === 'string' ? body.challengeId : req.ip;
    },
  });

  app.post('/auth/request-otp', { preHandler: requestLimit }, async (req, reply) => {
    const body = parse(RequestOtpBody, req.body);
    const res = await ctx.services.auth.requestOtp({ phoneE164: body.phone, ip: req.ip, requestId: req.id });
    return reply.code(200).send(res);
  });

  app.post('/auth/verify-otp', { preHandler: verifyLimit }, async (req, reply) => {
    const body = parse(VerifyOtpBody, req.body);
    const res = await ctx.services.auth.verifyOtp({
      challengeId: body.challengeId,
      code: body.code,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      deviceLabel: body.deviceLabel ?? null,
      requestId: req.id,
    });
    return reply.code(200).send(res);
  });

  app.post('/auth/refresh', async (req, reply) => {
    const body = parse(RefreshBody, req.body);
    const res = await ctx.services.auth.refresh({ refreshToken: body.refreshToken, ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
    return reply.send(res);
  });

  app.post('/auth/logout', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(LogoutBody, req.body ?? {});
    await ctx.services.auth.logout({ userId: auth.userId, sessionId: auth.sessionId, refreshToken: body.refreshToken, all: body.all });
    await ctx.services.audit.record(req.auditCtx(), { action: body.all ? 'session.revoked_all' : 'session.revoked', entityType: 'user', entityId: auth.userId });
    return reply.send({ ok: true });
  });
}
