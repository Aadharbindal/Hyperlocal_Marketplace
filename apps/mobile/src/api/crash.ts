import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { API_URL } from './client';

/**
 * Crash reporting for the app.
 *
 * The server has had a Sentry adapter since the live-adapters work; the app has had
 * `console.error`, which reaches exactly nobody. A crash on somebody's phone in another city is
 * the one failure we can never reproduce and never hear about, so it is the one most worth
 * sending somewhere.
 *
 * **Deliberately written by hand rather than with the Sentry SDK.** The SDK is a native module
 * that hooks the JS engine, the network layer and the navigation stack, and it would arrive in
 * the middle of an SDK upgrade we have not yet run on a device. The envelope endpoint is a
 * documented HTTP API; this posts to it, in about sixty lines, with no native code and nothing
 * to break at startup. If richer reporting is wanted later, the SDK can replace this file
 * without anything else changing.
 *
 * What is **never** sent: the report carries an error, a stack and a screen name. No user id, no
 * phone number, no job details, no request bodies. A crash report is a debugging tool, not a
 * reason to ship somebody's personal data to a third party.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const RELEASE = Constants.expoConfig?.version ?? 'dev';

interface ParsedDsn {
  url: string;
  key: string;
}

/** A Sentry DSN is `https://<key>@<host>/<projectId>`; the envelope endpoint is derived from it. */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace(/^\//, '');
    if (!parsed.username || !projectId) return null;
    return { url: `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`, key: parsed.username };
  } catch {
    return null;
  }
}

const target = DSN ? parseDsn(DSN) : null;

/** Anything that looks personal is stripped before a stack leaves the device. */
const PERSONAL = /(\+91\d{10}|\b\d{10}\b|[\w.-]+@[\w.-]+|Bearer\s+\S+)/g;

function scrub(text: string): string {
  return text.replace(PERSONAL, '[redacted]');
}

export interface CrashContext {
  /** Where it happened, in the words a developer would use - not what the person was doing. */
  screen?: string;
  fatal?: boolean;
}

export async function reportCrash(error: unknown, context: CrashContext = {}): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));

  // Without a DSN this is a no-op that still logs, so local development is unchanged and a
  // missing key never becomes a second crash on top of the first.
  if (!target) {
    console.error('[crash]', context.screen ?? 'app', err.message);
    return;
  }

  const event = {
    event_id: Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: context.fatal === false ? 'error' : 'fatal',
    release: RELEASE,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    tags: { os: Platform.OS, screen: context.screen ?? 'unknown' },
    // The API host, so a crash can be tied to an environment - never a full request URL, which
    // would carry ids and query strings.
    extra: { api: API_URL },
    exception: {
      values: [{ type: err.name, value: scrub(err.message), stacktrace: { frames: framesFrom(err) } }],
    },
  };

  const envelope =
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }) +
    '\n' +
    JSON.stringify({ type: 'event' }) +
    '\n' +
    JSON.stringify(event);

  try {
    await fetch(target.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=hyperlocal-mobile/1.0`,
      },
      body: envelope,
    });
  } catch {
    // A crash reporter that throws is a crash reporter that makes things worse. There is
    // nowhere useful left to send this, so it stops here.
  }
}

/** The top frames only. A full stack is mostly framework noise and carries file paths. */
function framesFrom(err: Error): Array<{ filename: string; function: string }> {
  return (err.stack ?? '')
    .split('\n')
    .slice(1, 16)
    .map((line) => {
      const match = /at\s+(.+?)\s+\((.+?)\)/.exec(line.trim());
      return { function: match?.[1] ?? 'anonymous', filename: scrub(match?.[2] ?? line.trim()) };
    });
}

/**
 * Catches the errors a React error boundary never sees: a rejected promise nobody awaited, and
 * anything thrown outside the render tree. Mounted once, at the root.
 */
export function installGlobalCrashHandlers(): void {
  const globalScope = globalThis as typeof globalThis & {
    ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
  };

  const previous = globalScope.ErrorUtils?.getGlobalHandler();
  globalScope.ErrorUtils?.setGlobalHandler((error, isFatal) => {
    void reportCrash(error, { screen: 'global', fatal: isFatal });
    // The default handler still runs: it is what shows the red screen in development and ends
    // the process in production, and swallowing it would hide the crash from the person too.
    previous?.(error, isFatal);
  });
}
