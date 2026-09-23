import type { LatLng } from '@hyperlocal/core';

/**
 * Every external dependency is an adapter with a `mock` implementation. `isMock` is surfaced by
 * GET /ready so nobody mistakes a mocked integration for a live one (PRODUCT_SPEC section 2).
 */
export interface AdapterMeta {
  readonly name: string;
  readonly provider: string;
  readonly isMock: boolean;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export interface SmsAdapter extends AdapterMeta {
  sendOtp(input: { phoneE164: string; code: string; purpose: 'LOGIN' | 'START_JOB'; ttlSeconds: number }): Promise<{ providerMessageId: string }>;
}

export interface GeocodeResult extends LatLng {
  formatted: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface MapsAdapter extends AdapterMeta {
  geocode(address: { line1: string; line2?: string; city: string; pincode: string }): Promise<GeocodeResult>;
  reverseGeocode(point: LatLng): Promise<{ formatted: string; pincode?: string }>;
}

export interface PushAdapter extends AdapterMeta {
  send(input: { deviceTokens: string[]; title: string; body: string; data?: Record<string, unknown> }): Promise<{ accepted: number }>;
}

export interface MonitoringAdapter extends AdapterMeta {
  captureError(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, context?: Record<string, unknown>): void;
}

export interface AnalyticsAdapter extends AdapterMeta {
  track(event: string, props: { userId?: string; [k: string]: unknown }): void;
}

export interface StorageAdapter extends AdapterMeta {
  /** Returns a short-lived upload target. Mock returns a local PUT endpoint. */
  createUploadUrl(input: { key: string; mime: string; maxBytes: number }): Promise<{ url: string; method: 'PUT' | 'POST'; expiresAt: Date }>;
  createSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface PaymentAdapter extends AdapterMeta {
  createOrder(input: { amountPaise: number; currency: 'INR'; receipt: string; notes?: Record<string, string> }): Promise<{ providerOrderId: string }>;
  capture(input: { providerPaymentId: string; amountPaise: number }): Promise<{ ok: boolean }>;
  refund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
  /** Money out to a provider or vendor. Separate from refunds: a payout is not a reversal. */
  payout(input: { amountPaise: number; payeeRef: string; idempotencyKey: string }): Promise<{ transferId: string; ok: boolean; failureReason?: string }>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export interface TelephonyAdapter extends AdapterMeta {
  createMaskedCall(input: { fromE164: string; toE164: string; jobId: string }): Promise<{ virtualNumber: string; sessionId: string }>;
}

export interface Adapters {
  sms: SmsAdapter;
  maps: MapsAdapter;
  push: PushAdapter;
  monitoring: MonitoringAdapter;
  analytics: AnalyticsAdapter;
  storage: StorageAdapter;
  payment: PaymentAdapter;
  telephony: TelephonyAdapter;
}
