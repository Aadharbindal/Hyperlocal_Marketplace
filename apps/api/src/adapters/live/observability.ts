import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { AnalyticsAdapter, MonitoringAdapter } from '../types';
import { requireEnv } from './http';

/**
 * Sentry over its envelope endpoint, without the SDK.
 *
 * The SDK brings instrumentation we do not want in a payments service - it patches http, and
 * it captures request bodies by default. Posting an envelope ourselves keeps the blast radius
 * to one function and lets us decide exactly what leaves the building: a message, a level, and
 * whatever context we chose to attach. Never a request body, never a phone number.
 */
export function sentryMonitoring(env: Env, log: Logger): MonitoringAdapter {
  const creds = requireEnv('sentry monitoring', { ERROR_MONITORING_DSN: env.ERROR_MONITORING_DSN });
  // A DSN is https://<key>@<host>/<projectId>
  const dsn = new URL(creds.ERROR_MONITORING_DSN);
  const projectId = dsn.pathname.replace(/^\//, '');
  const endpoint = `${dsn.protocol}//${dsn.host}/api/${projectId}/envelope/`;
  const headers = {
    'content-type': 'application/x-sentry-envelope',
    'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.username}, sentry_client=hyperlocal/1.0`,
  };

  /** Fire and forget: monitoring must never delay or fail the request it is reporting on. */
  function send(level: 'error' | 'warning', message: string, context?: Record<string, unknown>, stack?: string) {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const item = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'node',
      level,
      environment: env.APP_ENV,
      server_name: 'api',
      message: { formatted: message },
      extra: context ?? {},
      ...(stack ? { exception: { values: [{ type: 'Error', value: message, stacktrace: { frames: [] } }] } } : {}),
    };
    const envelope = `${JSON.stringify({ event_id: eventId })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(item)}\n`;

    void fetch(endpoint, { method: 'POST', headers, body: envelope }).catch((e) => {
      log.warn({ err: e }, 'could not reach sentry');
    });
  }

  return {
    name: 'monitoring',
    provider: 'sentry',
    isMock: false,
    async health() {
      return { ok: true, detail: 'events are sent fire-and-forget; delivery is not blocking' };
    },
    captureError(error, context) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error, ...context }, message);
      send('error', message, context, error instanceof Error ? error.stack : undefined);
    },
    captureMessage(message, context) {
      log.warn({ ...context }, message);
      send('warning', message, context);
    },
  };
}

/**
 * PostHog over its capture endpoint.
 *
 * Product analytics on a marketplace that handles money is a privacy decision as much as a
 * product one: events carry a user id and the shape of what happened, never an amount, a phone
 * number, an address or anything from a job description. The privacy map has to stay true.
 */
export function posthogAnalytics(env: Env, log: Logger): AnalyticsAdapter {
  const creds = requireEnv('posthog analytics', { ANALYTICS_KEY: env.ANALYTICS_KEY });
  const endpoint = `${env.ANALYTICS_HOST.replace(/\/$/, '')}/capture/`;

  /** Anything that could identify a person or a sum of money is dropped before it leaves. */
  const FORBIDDEN = /phone|email|address|otp|code|token|secret|name|description|amount|paise|price/i;

  return {
    name: 'analytics',
    provider: 'posthog',
    isMock: false,
    async health() {
      return { ok: true, detail: 'events are sent fire-and-forget; delivery is not blocking' };
    },
    track(event, props) {
      const { userId, ...rest } = props;
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (FORBIDDEN.test(key)) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
      }
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: creds.ANALYTICS_KEY,
          event,
          // A user id is a uuid, not a person: it cannot be reversed into a phone number.
          distinct_id: userId ?? 'anonymous',
          properties: { ...safe, environment: env.APP_ENV },
          timestamp: new Date().toISOString(),
        }),
      }).catch((e) => log.debug({ err: e }, 'could not reach posthog'));
    },
  };
}
