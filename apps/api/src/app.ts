import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { Language } from '@hyperlocal/core';
import { createAdapters, type Adapters } from './adapters';
import { loadEnv, type Env } from './config/env';
import { createDataStore, type DataStore } from './data';
import { seedDemo } from './data/seed';
import { newId } from './lib/crypto';
import { AppError } from './lib/errors';
import { createLogger } from './lib/logger';
import { adminRoutes } from './modules/admin/routes';
import { addressRoutes } from './modules/addresses/routes';
import { authRoutes } from './modules/auth/routes';
import { authService, type AuthService } from './modules/auth/service';
import { tokenService } from './modules/auth/tokens';
import { auditService, type AuditService } from './modules/audit/service';
import { categoryRoutes } from './modules/categories/routes';
import { executionRoutes } from './modules/execution/routes';
import { financeRoutes } from './modules/finance/routes';
import { financeService, type FinanceService } from './modules/finance/service';
import { executionService, type ExecutionService } from './modules/execution/service';
import { jobRoutes } from './modules/jobs/routes';
import { materialRoutes } from './modules/materials/routes';
import { materialsService, type MaterialsService } from './modules/materials/service';
import { jobService, type JobService } from './modules/jobs/service';
import { negotiationRoutes } from './modules/negotiation/routes';
import { negotiationService, type NegotiationService } from './modules/negotiation/service';
import { providerRoutes } from './modules/provider/routes';
import { providerService, type ProviderService } from './modules/provider/service';
import { userRoutes } from './modules/users/routes';
import { makeAuthenticate } from './plugins/auth';

export interface AppContext {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  services: {
    auth: AuthService;
    audit: AuditService;
    jobs: JobService;
    provider: ProviderService;
    negotiation: NegotiationService;
    execution: ExecutionService;
    materials: MaterialsService;
    finance: FinanceService;
  };
}

export interface BuildOptions {
  envOverrides?: Partial<Record<keyof Env, string>>;
  store?: DataStore;
  seed?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

const IDEMPOTENT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function buildApp(opts: BuildOptions = {}) {
  const env = loadEnv(opts.envOverrides);
  const logger = createLogger(env);
  const store = opts.store ?? createDataStore(env);
  const adapters = createAdapters(env, logger);
  const tokens = tokenService(env);
  const audit = auditService(store);
  const auth = authService({ env, store, adapters, audit, tokens });
  const jobs = jobService({ env, store, adapters });
  const provider = providerService({ env, store, adapters });
  const finance = financeService({ env, store, adapters, jobs });
  // Capture, settlement and refunds live in one place: the other modules hand the money
  // moment over rather than touching payments themselves.
  const execution = executionService({
    env,
    store,
    adapters,
    jobs,
    onJobCompleted: (job, ctx) => finance.captureForJob(job, ctx).then(() => undefined),
  });
  const materials = materialsService({
    env,
    store,
    adapters,
    jobs,
    onOrderConfirmed: (order) => finance.captureMaterialOrder(order).then(() => undefined),
  });
  // A material authorization belongs to the material order, not to the booking, so the
  // webhook hands it straight back to the leg that owns it.
  const negotiation = negotiationService({
    env,
    store,
    adapters,
    jobs,
    onSideLegSettled: async (payment) => {
      if (payment.purpose === 'MATERIAL' && payment.status === 'AUTHORIZED') {
        await materials.onMaterialAuthorized(payment.idempotency_key.replace(/^mat_/, ''));
      }
    },
  });
  const ctx: AppContext = { env, store, adapters, services: { auth, audit, jobs, provider, negotiation, execution, materials, finance } };

  if (opts.seed ?? (env.DATA_MODE === 'memory' && env.APP_ENV !== 'test')) {
    await seedDemo(store, env);
  }

  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => newId(),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Several routes take no body at all (submit, accept, logout). A client that still sends
  // `content-type: application/json` with an empty body would otherwise get an opaque 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
    if (!body || body.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch {
      done(new AppError('VALIDATION_ERROR', { details: { body: 'invalid_json' } }), undefined);
    }
  });

  await app.register(cors, { origin: env.API_CORS_ORIGINS.split(',').map((s) => s.trim()) });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
    errorResponseBuilder: (req) => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.', requestId: req.id } }),
  });

  app.decorateRequest('auth', null);
  app.decorateRequest('auditCtx', function (this: { auth: { userId: string; activeRole: import('@hyperlocal/core').UserRole } | null; ip: string; id: string }) {
    return { actorUserId: this.auth?.userId ?? null, actorRole: this.auth?.activeRole ?? null, ip: this.ip, requestId: this.id };
  });

  const authenticate = makeAuthenticate(tokens, store);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    await authenticate(req);
  });

  // Idempotency: cached replay of the first response for the same user + key (API_REFERENCE.md).
  app.addHook('preHandler', async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || !IDEMPOTENT_METHODS.has(req.method) || !req.auth) return;
    const hit = await store.idempotency.get(key, req.auth.userId);
    if (hit) {
      if (hit.route !== `${req.method} ${req.routeOptions.url}`) throw new AppError('IDEMPOTENCY_KEY_REUSED');
      reply.header('idempotent-replayed', 'true');
      return reply.code(hit.status).send(hit.body);
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || !IDEMPOTENT_METHODS.has(req.method) || !req.auth) return payload;
    if (reply.getHeader('idempotent-replayed')) return payload;
    if (reply.statusCode < 500) {
      let body: unknown = payload;
      if (typeof payload === 'string') {
        try {
          body = JSON.parse(payload);
        } catch {
          body = payload;
        }
      }
      await store.idempotency.put({ key, user_id: req.auth.userId, route: `${req.method} ${req.routeOptions.url}`, status: reply.statusCode, body, created_at: new Date() });
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const lang: Language = req.auth?.user.preferred_language ?? (req.headers['accept-language']?.toString().startsWith('hi') ? 'hi' : 'en');
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err, requestId: req.id }, 'app error');
      return reply.code(err.status).send(err.toBody(req.id, lang));
    }
    const fastifyErr = err as { statusCode?: number; validation?: unknown; code?: string };
    if (fastifyErr.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: new AppError('RATE_LIMITED').userMessage(lang), requestId: req.id } });
    }
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      return reply.code(fastifyErr.statusCode).send({ error: { code: 'VALIDATION_ERROR', message: new AppError('VALIDATION_ERROR').userMessage(lang), requestId: req.id } });
    }
    req.log.error({ err, requestId: req.id }, 'unhandled error');
    adapters.monitoring.captureError(err, { requestId: req.id, url: req.url });
    return reply.code(500).send(new AppError('INTERNAL').toBody(req.id, lang));
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send(new AppError('NOT_FOUND').toBody(req.id, 'en')));

  app.get('/health', async () => ({ ok: true, service: 'api', env: env.APP_ENV }));
  app.get('/ready', async (_req, reply) => {
    const db = await store.health();
    const adapterStatus = await Promise.all(
      Object.values(adapters).map(async (a) => ({ name: a.name, provider: a.provider, isMock: a.isMock, ...(await a.health()) })),
    );
    const ok = db.ok && adapterStatus.every((a) => a.ok);
    return reply.code(ok ? 200 : 503).send({
      ok,
      env: env.APP_ENV,
      dataMode: store.mode,
      db,
      adapters: adapterStatus,
      mockedAdapters: adapterStatus.filter((a) => a.isMock).map((a) => a.name),
    });
  });

  await app.register(async (scope) => {
    await authRoutes(scope, ctx);
    await userRoutes(scope, ctx);
    await addressRoutes(scope, ctx);
    await categoryRoutes(scope, ctx);
    await jobRoutes(scope, ctx);
    await providerRoutes(scope, ctx);
    await negotiationRoutes(scope, ctx);
    await executionRoutes(scope, ctx);
    await materialRoutes(scope, ctx);
    await financeRoutes(scope, ctx);
    await adminRoutes(scope, ctx);
  });

  app.addHook('onClose', async () => {
    await store.close();
  });

  app.decorate('ctx', ctx);
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
