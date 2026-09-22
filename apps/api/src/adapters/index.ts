import type { Logger } from 'pino';
import type { Env } from '../config/env';
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
 * Adapter factory. Live implementations are added per milestone; until then any non-mock
 * provider selection fails loudly instead of silently pretending to be live.
 */
export function createAdapters(env: Env, log: Logger): Adapters {
  const notImplemented = (name: string, provider: string): never => {
    throw new Error(`${name} provider "${provider}" is not implemented yet. Use "mock" or add an implementation in apps/api/src/adapters/${name}/.`);
  };

  return {
    sms: env.SMS_PROVIDER === 'mock' ? mockSms(env, log) : notImplemented('sms', env.SMS_PROVIDER),
    maps: env.MAPS_PROVIDER === 'mock' ? mockMaps(env) : notImplemented('maps', env.MAPS_PROVIDER),
    push: env.PUSH_PROVIDER === 'mock' ? mockPush(log) : notImplemented('push', env.PUSH_PROVIDER),
    monitoring:
      env.ERROR_MONITORING_PROVIDER === 'mock' ? mockMonitoring(log) : notImplemented('monitoring', env.ERROR_MONITORING_PROVIDER),
    analytics: env.ANALYTICS_PROVIDER === 'mock' ? mockAnalytics(log) : notImplemented('analytics', env.ANALYTICS_PROVIDER),
    storage: env.STORAGE_PROVIDER === 'mock' ? mockStorage(env) : notImplemented('storage', env.STORAGE_PROVIDER),
    payment: env.PAYMENT_PROVIDER === 'mock' ? mockPayment(env, log) : notImplemented('payment', env.PAYMENT_PROVIDER),
    telephony: env.TELEPHONY_PROVIDER === 'mock' ? mockTelephony() : notImplemented('telephony', env.TELEPHONY_PROVIDER),
  };
}

export type { Adapters } from './types';
