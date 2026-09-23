import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { PaymentAdapter, PayoutRegistrationInput } from '../types';
import { AdapterHttpError, basicAuth, request, requireEnv } from './http';

const BASE = 'https://api.razorpay.com/v1';

interface RazorpayOrder {
  id: string;
  amount: number;
  status: 'created' | 'attempted' | 'paid';
}

interface RazorpayPayment {
  id: string;
  amount: number;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
}

/**
 * Razorpay, verified against their published API (Orders, Capture, Refunds, RazorpayX Payouts).
 *
 * Two things worth knowing before this is switched on:
 *
 * 1. **Payouts need a fund account.** RazorpayX will not pay a person, it pays a
 *    `fund_account_id` that has to be created from a Contact plus their bank details. The
 *    settlement layer therefore refuses to pay anyone who has not added a payout account -
 *    see `payout_accounts` and `POST /me/payout-account`.
 * 2. **Holding customer money is a regulated question.** This adapter authorizes, captures and
 *    refunds against Razorpay; whether the platform may hold funds between those steps, or must
 *    use Razorpay Route's split settlement instead, is a decision for payments counsel and may
 *    change the settlement layer (KNOWN_LIMITATIONS).
 */
export function razorpayPayment(env: Env, log: Logger): PaymentAdapter {
  const creds = requireEnv('razorpay payment', {
    PAYMENT_KEY_ID: env.PAYMENT_KEY_ID,
    PAYMENT_KEY_SECRET: env.PAYMENT_KEY_SECRET,
    PAYMENT_WEBHOOK_SECRET: env.PAYMENT_WEBHOOK_SECRET,
  });
  const auth = basicAuth(creds.PAYMENT_KEY_ID, creds.PAYMENT_KEY_SECRET);
  const headers = { authorization: auth };

  return {
    name: 'payment',
    provider: 'razorpay',
    isMock: false,

    async health() {
      try {
        // Cheapest authenticated call there is: one order, just to prove the key works.
        await request(`razorpay`, `${BASE}/orders?count=1`, { headers, timeoutMs: 5000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
      }
    },

    async createOrder({ amountPaise, currency, receipt, notes }) {
      const order = await request<RazorpayOrder>('razorpay', `${BASE}/orders`, {
        method: 'POST',
        headers,
        // Razorpay takes the amount in the smallest unit, which is what we store anyway.
        body: { amount: amountPaise, currency, receipt: receipt.slice(0, 40), notes },
      });
      return { providerOrderId: order.id };
    },

    async capture({ providerPaymentId, amountPaise }) {
      await request<RazorpayPayment>('razorpay', `${BASE}/payments/${providerPaymentId}/capture`, {
        method: 'POST',
        headers,
        // Both fields are mandatory, and the amount must equal what was authorized.
        body: { amount: amountPaise, currency: 'INR' },
      });
      return { ok: true };
    },

    /**
     * The gateway's own view, used when a webhook never arrives. An order can have several
     * payment attempts; the one that matters is whichever reached authorized or captured.
     */
    async fetchPayment(providerOrderId) {
      const res = await request<{ items: RazorpayPayment[] }>('razorpay', `${BASE}/orders/${providerOrderId}/payments`, {
        headers,
      });
      const payments = res.items ?? [];
      const settled = payments.find((p) => p.status === 'captured') ?? payments.find((p) => p.status === 'authorized');
      if (settled) {
        return {
          status: settled.status === 'captured' ? ('CAPTURED' as const) : ('AUTHORIZED' as const),
          providerPaymentId: settled.id,
          amountPaise: settled.amount,
        };
      }
      const failed = payments.find((p) => p.status === 'failed');
      if (failed && payments.every((p) => p.status === 'failed')) {
        return { status: 'FAILED' as const, providerPaymentId: failed.id, amountPaise: failed.amount };
      }
      return { status: 'PENDING' as const, providerPaymentId: null, amountPaise: null };
    },

    async refund({ providerPaymentId, amountPaise, idempotencyKey }) {
      const refund = await request<{ id: string }>('razorpay', `${BASE}/payments/${providerPaymentId}/refund`, {
        method: 'POST',
        headers,
        // Razorpay treats `receipt` as the idempotency handle for refunds: the same receipt
        // twice is refused rather than refunding twice.
        body: { amount: amountPaise, speed: 'optimum', receipt: idempotencyKey.slice(0, 40) },
      });
      return { providerRefundId: refund.id };
    },

    /**
     * RazorpayX. `payeeRef` is the payee's `fund_account_id`, not a user id - the settlement
     * layer resolves it from `payout_accounts` and refuses to settle without one.
     */
    async registerPayee(input) {
      return registerRazorpayPayee(env, input);
    },

    async payout({ amountPaise, payeeRef, idempotencyKey }) {
      const x = requireEnv('razorpayx payout', {
        PAYOUT_ACCOUNT_NUMBER: env.PAYOUT_ACCOUNT_NUMBER,
      });
      try {
        const res = await request<{ id: string; status: string }>('razorpayx', `${BASE}/payouts`, {
          method: 'POST',
          headers: { ...headers, 'X-Payout-Idempotency': idempotencyKey },
          body: {
            account_number: x.PAYOUT_ACCOUNT_NUMBER,
            fund_account_id: payeeRef,
            amount: amountPaise,
            currency: 'INR',
            mode: env.PAYOUT_MODE,
            purpose: 'payout',
            queue_if_low_balance: true,
            reference_id: idempotencyKey.slice(0, 40),
          },
          timeoutMs: 15_000,
        });
        // "queued" and "processing" are not failures; the payout is on its way.
        const ok = ['queued', 'pending', 'processing', 'processed'].includes(res.status);
        return { transferId: res.id, ok, failureReason: ok ? undefined : res.status };
      } catch (e) {
        if (e instanceof AdapterHttpError) {
          log.error({ status: e.status }, 'razorpayx payout refused');
          return { transferId: '', ok: false, failureReason: `gateway_${e.status}` };
        }
        throw e;
      }
    },

    /**
     * HMAC-SHA256 of the **raw** body with the webhook secret, compared in constant time.
     * The body must not be parsed before this runs.
     */
    verifyWebhookSignature(rawBody, signature) {
      const expected = createHmac('sha256', creds.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature ?? '', 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

/**
 * Registering a payee with RazorpayX so they can be paid: a Contact, then a Fund Account for
 * their bank details or UPI id. It runs when a provider adds their bank details, not when money
 * moves, but it is reached through the payment adapter so the service never has to know which
 * payout rail it is talking to.
 */
export interface PayoutRegistration {
  contactId: string;
  fundAccountId: string;
}

export async function registerRazorpayPayee(env: Env, input: PayoutRegistrationInput): Promise<PayoutRegistration> {
  const creds = requireEnv('razorpayx payee', {
    PAYMENT_KEY_ID: env.PAYMENT_KEY_ID,
    PAYMENT_KEY_SECRET: env.PAYMENT_KEY_SECRET,
  });
  const headers = { authorization: basicAuth(creds.PAYMENT_KEY_ID, creds.PAYMENT_KEY_SECRET) };

  const contact = await request<{ id: string }>('razorpayx', `${BASE}/contacts`, {
    method: 'POST',
    headers,
    body: {
      name: input.name,
      contact: input.phoneE164.replace('+91', ''),
      type: 'vendor',
      reference_id: input.referenceId,
    },
  });

  const fundAccount = await request<{ id: string }>('razorpayx', `${BASE}/fund_accounts`, {
    method: 'POST',
    headers,
    body:
      input.kind === 'BANK'
        ? {
            contact_id: contact.id,
            account_type: 'bank_account',
            bank_account: { name: input.name, ifsc: input.ifsc, account_number: input.accountNumber },
          }
        : { contact_id: contact.id, account_type: 'vpa', vpa: { address: input.vpa } },
  });

  return { contactId: contact.id, fundAccountId: fundAccount.id };
}
