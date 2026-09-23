import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { PushAdapter } from '../types';
import { request } from './http';

const BASE = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts a hundred messages per call; more than that has to be chunked. */
const CHUNK = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Expo push, which covers both Android and iOS while the app ships through Expo.
 *
 * A device token that comes back as `DeviceNotRegistered` is dead - the app was uninstalled or
 * the token rotated - so it is reported for removal rather than retried forever.
 */
export function expoPush(env: Env, log: Logger): PushAdapter {
  const headers: Record<string, string> = { accept: 'application/json' };
  // An access token is only needed once push security is enabled on the Expo account.
  if (env.PUSH_SERVER_KEY) headers.authorization = `Bearer ${env.PUSH_SERVER_KEY}`;

  return {
    name: 'push',
    provider: 'expo',
    isMock: false,

    async health() {
      // Expo has no ping endpoint; sending nothing is the closest honest check.
      return { ok: true, detail: 'no health endpoint; failures surface per message' };
    },

    async send({ deviceTokens, title, body, data }) {
      const tokens = deviceTokens.filter((t) => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'));
      if (tokens.length === 0) return { accepted: 0 };

      let accepted = 0;
      for (let i = 0; i < tokens.length; i += CHUNK) {
        const batch = tokens.slice(i, i + CHUNK).map((to) => ({
          to,
          title,
          body,
          data,
          sound: 'default',
          channelId: 'default',
          priority: 'high',
        }));
        const res = await request<{ data: ExpoTicket[] }>('expo-push', BASE, {
          method: 'POST',
          headers,
          body: batch,
          timeoutMs: 10_000,
        });
        for (const [index, ticket] of (res.data ?? []).entries()) {
          if (ticket.status === 'ok') {
            accepted += 1;
          } else if (ticket.details?.error === 'DeviceNotRegistered') {
            log.info({ token: batch[index]?.to?.slice(-6) }, 'push token is dead; drop it');
          } else {
            log.warn({ error: ticket.details?.error, message: ticket.message }, 'push rejected');
          }
        }
      }
      return { accepted };
    },
  };
}
