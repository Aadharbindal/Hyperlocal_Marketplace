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

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  SMS_PROVIDER: Provider(['mock', 'msg91', 'twilio']),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  PAYMENT_PROVIDER: Provider(['mock', 'razorpay']),
  PAYMENT_KEY_ID: z.string().optional(),
  PAYMENT_KEY_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  /** Admin MFA is mandatory in production; it can be turned off for a local demo. */
  ADMIN_MFA_REQUIRED: z.coerce.boolean().default(false),
  MAPS_PROVIDER: Provider(['mock', 'google', 'mapbox']),
  MAPS_API_KEY: z.string().optional(),
  PUSH_PROVIDER: Provider(['mock', 'expo', 'fcm']),
  PUSH_SERVER_KEY: z.string().optional(),
  TELEPHONY_PROVIDER: Provider(['mock', 'exotel', 'knowlarity']),
  STORAGE_PROVIDER: Provider(['mock', 'supabase', 's3']),
  STORAGE_BUCKET: z.string().default('job-media'),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  ERROR_MONITORING_PROVIDER: Provider(['mock', 'sentry']),
  ERROR_MONITORING_DSN: z.string().optional(),
  ANALYTICS_PROVIDER: Provider(['mock', 'posthog']),
  ANALYTICS_KEY: z.string().optional(),
  ALLOW_MOCK_IN_PRODUCTION: z.coerce.boolean().default(false),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).default(5),
  OTP_DEMO_CODE: z.string().regex(/^\d{4,8}$/).default('123456'),

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
    if (env.DATA_MODE !== 'postgres') throw new Error('DATA_MODE must be postgres in production');
    // The console can see identity documents and move money; a second factor is not optional.
    if (!env.ADMIN_MFA_REQUIRED) throw new Error('ADMIN_MFA_REQUIRED must be true in production');
  }
  if (env.DATA_MODE === 'postgres' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DATA_MODE=postgres');
  }
  return env;
}
