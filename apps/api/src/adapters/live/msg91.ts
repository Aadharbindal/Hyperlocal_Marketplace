import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { SmsAdapter } from '../types';
import { request, requireEnv } from './http';

const BASE = 'https://control.msg91.com/api/v5';

/**
 * MSG91 for transactional OTP SMS.
 *
 * Before this can send a single message in India, the business has to be registered on a DLT
 * platform (TRAI rules): entity registration, a sender header, and each template approved.
 * `SMS_TEMPLATE_ID` is that approved template's id. Nothing in code can shortcut it - an
 * unapproved template is simply rejected by the operator (KNOWN_LIMITATIONS).
 *
 * The template must contain a single `##OTP##` variable. We pass our own code rather than
 * letting MSG91 generate one, because the OTP is minted and hashed by the API.
 */
export function msg91Sms(env: Env, log: Logger): SmsAdapter {
  const creds = requireEnv('msg91 sms', {
    SMS_API_KEY: env.SMS_API_KEY,
    SMS_SENDER_ID: env.SMS_SENDER_ID,
    SMS_TEMPLATE_ID: env.SMS_TEMPLATE_ID,
  });

  return {
    name: 'sms',
    provider: 'msg91',
    isMock: false,

    async health() {
      try {
        // Balance is the cheapest authenticated read MSG91 offers.
        await request('msg91', `${BASE}/getBalance?type=4`, { headers: { authkey: creds.SMS_API_KEY }, timeoutMs: 5000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
      }
    },

    async sendOtp({ phoneE164, code, purpose }) {
      // MSG91 wants the number without a plus.
      const mobile = phoneE164.replace(/^\+/, '');
      const res = await request<{ type: string; message: string; request_id?: string }>('msg91', `${BASE}/otp`, {
        method: 'POST',
        headers: { authkey: creds.SMS_API_KEY },
        body: {
          template_id: creds.SMS_TEMPLATE_ID,
          mobile,
          otp: code,
          sender: creds.SMS_SENDER_ID,
          // the code lives for as long as the challenge does, and MSG91 counts in minutes
          otp_expiry: Math.max(1, Math.round(env.OTP_TTL_SECONDS / 60)),
        },
        timeoutMs: 8000,
      });

      if (res.type && res.type !== 'success') {
        throw new Error(`msg91 refused the message: ${res.message}`);
      }
      // The code itself is never logged - only that a message went out, and for what.
      log.info({ purpose, provider: 'msg91' }, 'otp sms sent');
      return { providerMessageId: res.request_id ?? 'msg91' };
    },
  };
}
