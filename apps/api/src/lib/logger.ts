// Aliased: the esbuild bundle's banner already injects a `createRequire` at module scope, and
// two declarations of the same name is a syntax error in the bundled output rather than a
// compile error here - the kind of break that only appears in the artefact that ships.
import { createRequire as nodeCreateRequire } from 'node:module';
import pino, { type Logger } from 'pino';
import type { Env } from '../config/env';

/**
 * Whether the pretty printer is actually installed.
 *
 * `pino-pretty` is a devDependency, and pino resolves a transport target by name at runtime - so
 * asking for it when it is absent does not degrade, it throws while the logger is being built,
 * before anything has a logger to report it with. In a production image, where dev dependencies
 * are omitted and `APP_ENV` defaults to `local`, that is a container that exits at boot with a
 * stack trace about a log formatter. Checking is cheaper than the incident.
 */
function prettyAvailable(): boolean {
  try {
    nodeCreateRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Structured logger with redaction of personal data and secrets (SECURITY_CHECKLIST: no
 * phone numbers, OTP codes, tokens or document numbers in logs).
 */
export function createLogger(env: Env): Logger {
  const pretty = (env.APP_ENV === 'local' || env.APP_ENV === 'test') && prettyAvailable();
  return pino({
    level: env.APP_ENV === 'test' ? 'silent' : env.API_LOG_LEVEL,
    base: { service: 'api', env: env.APP_ENV },
    redact: {
      paths: [
        'req.headers.authorization',
        '*.access_token',
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
        // Bank details pass through on one route only, and must not survive anywhere else.
        '*.accountNumber',
        '*.account_number',
        '*.ifsc',
        '*.vpa',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      // The live stream carries its token in the query string, so the path is kept and the
      // token is stripped rather than losing the URL from the logs entirely.
      req(request: { method?: string; url?: string; headers?: Record<string, unknown> }) {
        const url = typeof request.url === 'string' ? request.url.replace(/access_token=[^&]*/, 'access_token=[REDACTED]') : request.url;
        return { method: request.method, url, headers: request.headers };
      },
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } } }
      : {}),
  });
}
