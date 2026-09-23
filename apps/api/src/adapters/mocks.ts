import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import { sha256, newId } from '../lib/crypto';
import type {
  AnalyticsAdapter,
  MapsAdapter,
  MonitoringAdapter,
  PaymentAdapter,
  PushAdapter,
  SmsAdapter,
  StorageAdapter,
  TelephonyAdapter,
} from './types';

const ok = async () => ({ ok: true, detail: 'mock' });

/** Mock SMS: never sends anything. The demo code is fixed so QA can log in without a phone. */
export function mockSms(env: Env, log: Logger): SmsAdapter & { sent: Array<{ phoneE164: string; code: string }> } {
  const sent: Array<{ phoneE164: string; code: string }> = [];
  return {
    name: 'sms',
    provider: 'mock',
    isMock: true,
    health: ok,
    sent,
    async sendOtp({ phoneE164, code, purpose }) {
      sent.push({ phoneE164, code });
      if (sent.length > 200) sent.shift();
      // Deliberately printed (not via the redacting logger) so local developers can see the code.
      if (env.APP_ENV !== 'test') {
        log.warn({ purpose, mock: true }, `[MOCK sms] OTP for ${phoneE164.slice(0, 3)}***${phoneE164.slice(-2)} is ${code}`);
      }
      return { providerMessageId: `mock-${newId()}` };
    },
  };
}

/**
 * Mock maps: deterministic pseudo-geocode. Addresses hash to a point within ~2.5 km of the pilot
 * centre so radius logic is exercised realistically. PIN codes ending in 99 land outside the zone.
 */
export function mockMaps(env: Env): MapsAdapter {
  return {
    name: 'maps',
    provider: 'mock',
    isMock: true,
    health: ok,
    async geocode(a) {
      if (a.pincode.endsWith('99')) {
        return { lat: env.PILOT_CENTER_LAT + 0.09, lng: env.PILOT_CENTER_LNG + 0.09, formatted: `${a.line1}, ${a.city} ${a.pincode}`, confidence: 'MEDIUM' };
      }
      const h = sha256(`${a.line1}|${a.city}|${a.pincode}`);
      const dx = (parseInt(h.slice(0, 4), 16) / 0xffff - 0.5) * 0.04; // ~ +/- 2.2 km
      const dy = (parseInt(h.slice(4, 8), 16) / 0xffff - 0.5) * 0.04;
      return {
        lat: env.PILOT_CENTER_LAT + dy,
        lng: env.PILOT_CENTER_LNG + dx,
        formatted: `${a.line1}, ${a.city} ${a.pincode}`,
        confidence: 'MEDIUM',
      };
    },
    async reverseGeocode(p) {
      return { formatted: `Near ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}, ${env.PILOT_CITY}` };
    },
  };
}

export function mockPush(log: Logger): PushAdapter {
  return {
    name: 'push',
    provider: 'mock',
    isMock: true,
    health: ok,
    async send({ deviceTokens, title }) {
      log.info({ mock: true, count: deviceTokens.length, title }, '[MOCK push] notification');
      return { accepted: deviceTokens.length };
    },
  };
}

export function mockMonitoring(log: Logger): MonitoringAdapter {
  return {
    name: 'monitoring',
    provider: 'mock',
    isMock: true,
    health: ok,
    captureError(error, context) {
      log.error({ mock: true, err: error, ...context }, '[MOCK monitoring] captured error');
    },
    captureMessage(message, context) {
      log.warn({ mock: true, ...context }, `[MOCK monitoring] ${message}`);
    },
  };
}

export function mockAnalytics(log: Logger): AnalyticsAdapter & { events: Array<{ event: string; props: Record<string, unknown> }> } {
  const events: Array<{ event: string; props: Record<string, unknown> }> = [];
  return {
    name: 'analytics',
    provider: 'mock',
    isMock: true,
    health: ok,
    events,
    track(event, props) {
      events.push({ event, props });
      if (events.length > 500) events.shift();
      log.debug({ mock: true, event }, '[MOCK analytics]');
    },
  };
}

export function mockStorage(env: Env): StorageAdapter {
  return {
    name: 'storage',
    provider: 'mock',
    isMock: true,
    health: ok,
    async createUploadUrl({ key }) {
      return { url: `mock://storage/${env.STORAGE_BUCKET}/${key}`, method: 'PUT', expiresAt: new Date(Date.now() + 900_000) };
    },
    async createSignedReadUrl(key, ttlSeconds) {
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      const sig = createHmac('sha256', env.API_JWT_SECRET).update(`${key}:${exp}`).digest('hex').slice(0, 16);
      return `mock://storage/${env.STORAGE_BUCKET}/${key}?exp=${exp}&sig=${sig}`;
    },
    async delete() {
      /* no-op */
    },
  };
}

export function mockPayment(env: Env, log: Logger): PaymentAdapter {
  const secret = env.PAYMENT_WEBHOOK_SECRET ?? 'mock-webhook-secret';
  return {
    name: 'payment',
    provider: 'mock',
    isMock: true,
    health: ok,
    async createOrder({ amountPaise, receipt }) {
      log.info({ mock: true, amountPaise, receipt }, '[MOCK payment] order created');
      return { providerOrderId: `order_mock_${sha256(receipt).slice(0, 12)}` };
    },
    async capture() {
      return { ok: true };
    },
    async fetchPayment(providerOrderId) {
      // The mock gateway has no memory, so it answers "still pending" and reconciliation
      // leaves the payment where it is rather than inventing an outcome.
      log.info({ mock: true, providerOrderId }, '[MOCK payment] fetchPayment');
      return { status: 'PENDING' as const, providerPaymentId: null, amountPaise: null };
    },
    async refund({ idempotencyKey }) {
      return { providerRefundId: `rfnd_mock_${sha256(idempotencyKey).slice(0, 12)}` };
    },
    async registerPayee(input) {
      // Deterministic, and deliberately logs no bank details even in the mock.
      log.info({ mock: true, kind: input.kind, referenceId: input.referenceId }, '[MOCK payment] payee registered');
      return {
        contactId: `cont_mock_${sha256(input.referenceId).slice(0, 12)}`,
        fundAccountId: `fa_mock_${sha256(`${input.referenceId}:fa`).slice(0, 12)}`,
      };
    },
    async payout({ idempotencyKey, amountPaise, payeeRef }) {
      log.info({ mock: true, amountPaise, payeeRef }, '[MOCK payment] payout');
      return { transferId: `pout_mock_${sha256(idempotencyKey).slice(0, 12)}`, ok: true };
    },
    verifyWebhookSignature(rawBody, signature) {
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      return expected === signature;
    },
  };
}

export function mockTelephony(): TelephonyAdapter {
  return {
    name: 'telephony',
    provider: 'mock',
    isMock: true,
    health: ok,
    async createMaskedCall({ jobId }) {
      return { virtualNumber: '+911140000000', sessionId: `mock-call-${jobId.slice(0, 8)}` };
    },
  };
}
