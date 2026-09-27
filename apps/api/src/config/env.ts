import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env from repo root (one level up from apps/api) or from cwd.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const Provider = <T extends readonly [string, ...string[]]>(opts: T) => z.enum(opts).default(opts[0]);

const EnvSchema = z.object({
  APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
  BRAND_NAME: z.string().default('Hyperlocal Marketplace'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_JWT_SECRET: z.string().min(32, 'API_JWT_SECRET must be at least 32 characters'),
  API_JWT_ISSUER: z.string().default('hyperlocal-api'),
  API_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  API_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(30 * 24 * 3600),
  API_CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  API_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATA_MODE: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().optional(),

  /**
   * Connection pool, per node.
   *
   * The number that matters is not this one but this one times the number of nodes, plus one
   * more per node for the LISTEN connection the event bus holds open permanently. That total has
   * to stay comfortably under the server's `max_connections`, and on a managed Postgres it is
   * usually far lower than people expect - a small instance often allows around 100, shared with
   * backups, migrations and whatever is connected from a laptop.
   *
   * Ten per node is chosen to be obviously safe for a pilot at four nodes rather than to be
   * optimal. It is worth raising only alongside a measurement showing requests waiting on the
   * pool, because a pool larger than the database can serve moves the queue rather than
   * shortening it.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(10),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Fail fast rather than piling up requests behind an exhausted pool. */
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).default(5_000),
  /**
   * A ceiling on any single statement. Without it one pathological query holds a connection
   * until somebody notices, and with a small pool that is an outage rather than a slow page.
   */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  SMS_PROVIDER: Provider(['mock', 'msg91', 'twilio']),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  /** The DLT-approved template the OTP is sent through. Without it the operator rejects the SMS. */
  SMS_TEMPLATE_ID: z.string().optional(),
  PAYMENT_PROVIDER: Provider(['mock', 'razorpay']),
  PAYMENT_KEY_ID: z.string().optional(),
  PAYMENT_KEY_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  /** RazorpayX: the account payouts are sent *from*, not anyone's bank account. */
  PAYOUT_ACCOUNT_NUMBER: z.string().optional(),
  PAYOUT_MODE: z.enum(['IMPS', 'NEFT', 'UPI', 'RTGS']).default('IMPS'),
  /** Admin MFA is mandatory in production; it can be turned off for a local demo. */
  ADMIN_MFA_REQUIRED: z.coerce.boolean().default(false),
  /** The background worker. Off in tests, which drive it explicitly instead. */
  SCHEDULER_ENABLED: z.coerce.boolean().default(true),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  /** Oldest app build the API will still talk to. Older ones are told to update (426). */
  MIN_APP_VERSION: z.string().default('0.0.0'),
  /**
   * Read-only mode for a migration or an incident. Reads keep working; anything that would
   * change state answers 503 with a plain message (INCIDENT_RESPONSE.md).
   */
  MAINTENANCE_MODE: z.coerce.boolean().default(false),
  MAINTENANCE_MESSAGE: z.string().default('We are doing some maintenance. Please try again in a few minutes.'),
  MAPS_PROVIDER: Provider(['mock', 'google', 'mapbox']),
  MAPS_API_KEY: z.string().optional(),
  PUSH_PROVIDER: Provider(['mock', 'expo', 'fcm']),
  PUSH_SERVER_KEY: z.string().optional(),
  TELEPHONY_PROVIDER: Provider(['mock', 'exotel', 'knowlarity']),
  /**
   * `local` really stores the bytes on this machine's disk and is the default, because the mock
   * that preceded it made the evidence chain untestable: it issued a URL nobody could PUT to, so
   * completion photos - the evidence disputes and warranty claims rest on - did not exist.
   * A local disk is not shared between nodes and does not survive the container, so production
   * refuses to boot on it (below).
   */
  STORAGE_PROVIDER: Provider(['local', 'mock', 'supabase', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.data/storage'),
  STORAGE_BUCKET: z.string().default('job-media'),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  TELEPHONY_SID: z.string().optional(),
  TELEPHONY_API_KEY: z.string().optional(),
  TELEPHONY_API_TOKEN: z.string().optional(),
  TELEPHONY_CALLER_ID: z.string().optional(),
  TELEPHONY_SUBDOMAIN: z.string().default('api.exotel.com'),
  ERROR_MONITORING_PROVIDER: Provider(['mock', 'sentry']),
  ERROR_MONITORING_DSN: z.string().optional(),
  ANALYTICS_PROVIDER: Provider(['mock', 'posthog']),
  ANALYTICS_KEY: z.string().optional(),
  ANALYTICS_HOST: z.string().default('https://app.posthog.com'),
  ALLOW_MOCK_IN_PRODUCTION: z.coerce.boolean().default(false),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).default(5),
  OTP_DEMO_CODE: z.string().regex(/^\d{4,8}$/).default('123456'),

  /**
   * Where this API is reachable from a phone. Only used to build absolute URLs for locally
   * stored files, so on a device it has to be the LAN address rather than localhost.
   */
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),

  PILOT_CITY: z.string().default('Delhi'),
  PILOT_CENTER_LAT: z.coerce.number().default(28.6139),
  PILOT_CENTER_LNG: z.coerce.number().default(77.209),
  PILOT_RADIUS_KM: z.coerce.number().default(3),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const raw = { ...process.env, ...overrides } as Record<string, string | undefined>;
  if (!raw.API_JWT_SECRET && (raw.APP_ENV ?? 'local') !== 'production') {
    // Safe default for local/test only; production must set a real secret.
    raw.API_JWT_SECRET = 'local-dev-secret-not-for-production-use-0000';
  }
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const env = parsed.data;
  if (env.APP_ENV === 'production' && !env.ALLOW_MOCK_IN_PRODUCTION) {
    const mocked = (['SMS_PROVIDER', 'PAYMENT_PROVIDER'] as const).filter((k) => env[k] === 'mock');
    if (mocked.length) throw new Error(`Refusing to start in production with mock adapters: ${mocked.join(', ')}`);
    // Local disk is real storage, which is why it is not on the list above - but it is one
    // machine's disk: not shared between nodes, gone when the container is replaced, and in
    // nobody's backup. Losing a completion photo means losing the evidence for a dispute.
    if (env.STORAGE_PROVIDER === 'local' || env.STORAGE_PROVIDER === 'mock') {
      throw new Error(`Refusing to start in production with STORAGE_PROVIDER=${env.STORAGE_PROVIDER}: job evidence needs durable, shared storage`);
    }
    if (env.DATA_MODE !== 'postgres') throw new Error('DATA_MODE must be postgres in production');
    // The console can see identity documents and move money; a second factor is not optional.
    if (!env.ADMIN_MFA_REQUIRED) throw new Error('ADMIN_MFA_REQUIRED must be true in production');
  }
  if (env.DATA_MODE === 'postgres' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DATA_MODE=postgres');
  }
  return env;
}
