import type { FastifyInstance } from 'fastify';
import { LogoutBody, RefreshBody, RequestOtpBody, VerifyOtpBody } from '@hyperlocal/core';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const otpLimit = { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } };

  app.post('/auth/request-otp', otpLimit, async (req, reply) => {
    const body = parse(RequestOtpBody, req.body);
    const res = await ctx.services.auth.requestOtp({ phoneE164: body.phone, ip: req.ip, requestId: req.id });
    return reply.code(200).send(res);
  });

  app.post('/auth/verify-otp', otpLimit, async (req, reply) => {
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
