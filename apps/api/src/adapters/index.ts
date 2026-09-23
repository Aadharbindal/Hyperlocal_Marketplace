import type { Logger } from 'pino';
import type { Env } from '../config/env';
import { exotelTelephony } from './live/exotel';
import { expoPush } from './live/expo-push';
import { googleMaps } from './live/google-maps';
import { msg91Sms } from './live/msg91';
import { posthogAnalytics, sentryMonitoring } from './live/observability';
import { razorpayPayment } from './live/razorpay';
import { supabaseStorage } from './live/supabase-storage';
import {
  mockAnalytics,
  mockMaps,
  mockMonitoring,
  mockPayment,
  mockPush,
  mockSms,
  mockStorage,
  mockTelephony,
} from './mocks';
import type { Adapters } from './types';

/**
 * Adapter factory. Every external dependency has a mock and, where it has been written, a live
 * implementation behind the same interface - so going live is a credentials change, not a code
 * change.
 *
 * A provider that has no implementation fails loudly at boot rather than silently pretending to
 * work, and `GET /ready` reports which adapters are still mocked so nobody mistakes one for the
 * other.
 */
export function createAdapters(env: Env, log: Logger): Adapters {
  const notImplemented = (name: string, provider: string): never => {
    throw new Error(
      `${name} provider "${provider}" is not implemented. Use "mock", or add it in apps/api/src/adapters/live/.`,
    );
  };

  return {
    sms:
      env.SMS_PROVIDER === 'mock'
        ? mockSms(env, log)
        : env.SMS_PROVIDER === 'msg91'
          ? msg91Sms(env, log)
          : notImplemented('sms', env.SMS_PROVIDER),

    maps:
      env.MAPS_PROVIDER === 'mock'
        ? mockMaps(env)
        : env.MAPS_PROVIDER === 'google'
          ? googleMaps(env)
          : notImplemented('maps', env.MAPS_PROVIDER),

    push:
      env.PUSH_PROVIDER === 'mock'
        ? mockPush(log)
        : env.PUSH_PROVIDER === 'expo'
          ? expoPush(env, log)
          : notImplemented('push', env.PUSH_PROVIDER),

    monitoring:
      env.ERROR_MONITORING_PROVIDER === 'mock'
        ? mockMonitoring(log)
        : env.ERROR_MONITORING_PROVIDER === 'sentry'
          ? sentryMonitoring(env, log)
          : notImplemented('monitoring', env.ERROR_MONITORING_PROVIDER),

    analytics:
      env.ANALYTICS_PROVIDER === 'mock'
        ? mockAnalytics(log)
        : env.ANALYTICS_PROVIDER === 'posthog'
          ? posthogAnalytics(env, log)
          : notImplemented('analytics', env.ANALYTICS_PROVIDER),

    storage:
      env.STORAGE_PROVIDER === 'mock'
        ? mockStorage(env)
        : env.STORAGE_PROVIDER === 'supabase'
          ? supabaseStorage(env)
          : notImplemented('storage', env.STORAGE_PROVIDER),

    payment:
      env.PAYMENT_PROVIDER === 'mock'
        ? mockPayment(env, log)
        : env.PAYMENT_PROVIDER === 'razorpay'
          ? razorpayPayment(env, log)
          : notImplemented('payment', env.PAYMENT_PROVIDER),

    telephony:
      env.TELEPHONY_PROVIDER === 'mock'
        ? mockTelephony()
        : env.TELEPHONY_PROVIDER === 'exotel'
          ? exotelTelephony(env)
          : notImplemented('telephony', env.TELEPHONY_PROVIDER),
  };
}

export type { Adapters } from './types';
