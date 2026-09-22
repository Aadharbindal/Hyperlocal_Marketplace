import pino, { type Logger } from 'pino';
import type { Env } from '../config/env';

/**
 * Structured logger with redaction of personal data and secrets (SECURITY_CHECKLIST: no
 * phone numbers, OTP codes, tokens or document numbers in logs).
 */
export function createLogger(env: Env): Logger {
  const pretty = env.APP_ENV === 'local' || env.APP_ENV === 'test';
  return pino({
    level: env.APP_ENV === 'test' ? 'silent' : env.API_LOG_LEVEL,
    base: { service: 'api', env: env.APP_ENV },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.phone',
        '*.phone_e164',
        '*.phoneE164',
        '*.code',
        '*.otp',
        '*.accessToken',
        '*.refreshToken',
        '*.refresh_token_hash',
        '*.password',
        '*.token',
        '*.docNumber',
      ],
      censor: '[REDACTED]',
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } } }
      : {}),
  });
}
