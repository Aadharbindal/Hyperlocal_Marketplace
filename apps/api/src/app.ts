import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { categoryForNotification, isSafePushPreview, isUnsupportedVersion, mayPush, type Language } from '@hyperlocal/core';
import { createAdapters, type Adapters } from './adapters';
import { loadEnv, type Env } from './config/env';
import { createDataStore, type DataStore } from './data';
import type { NotificationRecord } from './data/types';
import { seedDemo } from './data/seed';
import { newId } from './lib/crypto';
import { AppError } from './lib/errors';
import { createLogger } from './lib/logger';
import { adminConsoleRoutes } from './modules/admin/console';
import { adminRoutes } from './modules/admin/routes';
import { adminService, type AdminService } from './modules/admin/service';
import { addressRoutes } from './modules/addresses/routes';
import { authRoutes } from './modules/auth/routes';
import { authService, type AuthService } from './modules/auth/service';
import { tokenService } from './modules/auth/tokens';
import { auditService, type AuditService } from './modules/audit/service';
import { categoryRoutes } from './modules/categories/routes';
import { eventRoutes } from './modules/events/routes';
import { eventsService, type EventsService } from './modules/events/service';
import { executionRoutes } from './modules/execution/routes';
import { financeRoutes } from './modules/finance/routes';
import { contractorRoutes } from './modules/contractor/routes';
import { technicianRoutes } from './modules/technician/routes';
import { trustRoutes } from './modules/trust/routes';
import { warrantyRoutes } from './modules/warranty/routes';
import { warrantyService, type WarrantyService } from './modules/warranty/service';
import { growthRoutes } from './modules/growth/routes';
import { growthService, type GrowthService } from './modules/growth/service';
import { schedulerService, type SchedulerService } from './modules/scheduler/service';
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
    growth: GrowthService;
    warranty: WarrantyService;
    admin: AdminService;
    events: EventsService;
    scheduler: SchedulerService;
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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const IDEMPOTENT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function buildApp(opts: BuildOptions = {}) {
  const env = loadEnv(opts.envOverrides);
  const logger = createLogger(env);
  const store = opts.store ?? createDataStore(env);
  const adapters = createAdapters(env, logger);
  const tokens = tokenService(env);
  const audit = auditService(store);
  const auth = authService({ env, store, adapters, audit, tokens });
  const events = eventsService();

  // Every in-app notification is also a nudge on the live stream, and - if the person has a
  // device registered and has not asked us not to - a push. Wrapping the repository here keeps
  // all three in one place: an event never carries data, only "this changed", so the client
  // re-reads the endpoint it already trusts and a missed message cannot put a wrong number on
  // screen.
  const createNotification = store.notifications.create.bind(store.notifications);
  store.notifications.create = async (n) => {
    const record = await createNotification(n);
    const jobId = (n.data as { jobId?: string } | undefined)?.jobId;
    events.publish([record.user_id], { kind: 'notification', jobId, at: new Date().toISOString() });
    void deliverPush(record).catch((e) => {
      // A push that fails must never fail the thing that caused it. The in-app notification is
      // already written; the person will see it when they open the app.
      logger.warn({ err: e, notificationId: record.id }, 'push delivery failed');
    });
    return record;
  };

  /**
   * Sends the notification to the person's phone, if there is one and if they agreed to it.
   *
   * The body is checked before it leaves: a push preview is read by whoever is holding the
   * phone, so an amount, an address or a phone number in it would be a leak to someone who
   * never signed in. When the body is not safe to show, the title goes out alone and the
   * detail waits behind the lock screen.
   */
  async function deliverPush(record: NotificationRecord) {
    const category = categoryForNotification(record.type);
    const user = await store.users.findById(record.user_id);
    if (!user) return;
    if (!mayPush(category, { jobUpdates: user.push_job_updates, offers: user.push_offers, marketing: user.push_marketing })) return;

    const deviceTokens = await store.reach.activeTokens(record.user_id);
    if (deviceTokens.length === 0) return;

    const body = isSafePushPreview(record.body) ? record.body : 'Open the app to see the details.';
    const result = await adapters.push.send({
      deviceTokens,
      title: record.title,
      body,
      data: { notificationId: record.id, type: record.type, ...(record.data as Record<string, unknown>) },
    });
    if (result.accepted === 0 && deviceTokens.length > 0) {
      logger.info({ userId: record.user_id, devices: deviceTokens.length }, 'push accepted by nobody');
    }
  }

  const jobs = jobService({
    env,
    store,
    adapters,
    onTransition: (job) => {
      events.publish([job.customer_id, job.confirmed_provider_id], {
        kind: 'job.updated',
        jobId: job.id,
        at: new Date().toISOString(),
      });
    },
  });
  const provider = providerService({ env, store, adapters });
  const finance = financeService({ env, store, adapters, jobs });
  const adminSvc = adminService({ env, store, adapters });
  const growth = growthService({ env, store, adapters });
  const warranty = warrantyService({ env, store, adapters, jobs });
  // Capture, settlement and refunds live in one place: the other modules hand the money
  // moment over rather than touching payments themselves.
  const execution = executionService({
    env,
    store,
    adapters,
    jobs,
    onJobCompleted: async (job, ctx) => {
      await finance.captureForJob(job, ctx);
      // The receipt is issued the moment the money is taken, not when somebody asks for it:
      // a customer should already have their bill when they go looking.
      await growth.issueInvoice(job);
      // And a referral pays out on completed work, which is now.
      await growth.onJobCompleted(job);
    },
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
  // The background worker is built last: it drives the other services rather than the reverse.
  const scheduler = schedulerService({ env, store, adapters, jobs, finance, negotiation, warranty });
  const ctx: AppContext = {
    env,
    store,
    adapters,
    services: { auth, audit, jobs, provider, negotiation, execution, materials, finance, growth, warranty, admin: adminSvc, events, scheduler },
  };

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

    // An app too old for the current contracts is told to update, rather than being left to
    // fail on a shape it no longer understands.
    const appVersion = req.headers['x-app-version'];
    if (isUnsupportedVersion(typeof appVersion === 'string' ? appVersion : undefined, env.MIN_APP_VERSION)) {
      return reply.code(426).send({
        error: {
          code: 'UPGRADE_REQUIRED',
          message: 'Please update the app to continue.',
          details: { minimumVersion: env.MIN_APP_VERSION },
          requestId: req.id,
        },
      });
    }

    // Read-only mode: reads keep working, anything that would change state waits.
    if (env.MAINTENANCE_MODE && !SAFE_METHODS.has(req.method)) {
      return reply.code(503).send({
        error: { code: 'MAINTENANCE', message: env.MAINTENANCE_MESSAGE, requestId: req.id },
      });
    }

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
      maintenanceMode: env.MAINTENANCE_MODE,
      minAppVersion: env.MIN_APP_VERSION,
      scheduler: env.SCHEDULER_ENABLED ? scheduler.status() : 'disabled',
      liveStreams: events.stats(),
      // An operator should be able to see at a glance that the console's second factor is off.
      adminMfaRequired: env.ADMIN_MFA_REQUIRED,
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
    await growthRoutes(scope, ctx);
    await contractorRoutes(scope, ctx);
    await warrantyRoutes(scope, ctx);
    await trustRoutes(scope, ctx);
    await technicianRoutes(scope, ctx);
    await eventRoutes(scope, ctx);
    await adminRoutes(scope, ctx);
    await adminConsoleRoutes(scope, ctx);
  });

  // The background worker and the stream's keep-alive. Both are plain timers in this process:
  // a single pilot node needs no queue, and the work is idempotent so a restart loses nothing.
  const timers: NodeJS.Timeout[] = [];
  if (env.SCHEDULER_ENABLED && env.APP_ENV !== 'test') {
    const tick = setInterval(() => {
      void scheduler.runDue().then((results) => {
        const worked = results.filter((r) => r.handled > 0 || r.error);
        if (worked.length) app.log.info({ tasks: worked }, 'scheduled work');
      });
    }, env.SCHEDULER_TICK_SECONDS * 1000);
    tick.unref();
    timers.push(tick);

    const keepAlive = setInterval(() => events.heartbeat(), 25_000);
    keepAlive.unref();
    timers.push(keepAlive);
  }

  app.addHook('onClose', async () => {
    for (const t of timers) clearInterval(t);
    events.closeAll();
    await store.close();
  });

  app.decorate('ctx', ctx);
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
