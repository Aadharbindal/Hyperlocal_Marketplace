import type { Env } from '../../config/env';
import type { TelephonyAdapter } from '../types';
import { basicAuth, request, requireEnv } from './http';

/**
 * Exotel number masking, so a customer and a provider can speak without either learning the
 * other's number. The connection is made by Exotel: we hand them two numbers and they bridge
 * the call through a virtual one.
 *
 * Call recordings are deliberately **not** enabled here. Recording a conversation changes what
 * has to be disclosed and retained (PRIVACY_DATA_MAP), and that is a decision to take
 * explicitly rather than inherit from a default.
 */
export function exotelTelephony(env: Env): TelephonyAdapter {
  const creds = requireEnv('exotel telephony', {
    TELEPHONY_SID: env.TELEPHONY_SID,
    TELEPHONY_API_KEY: env.TELEPHONY_API_KEY,
    TELEPHONY_API_TOKEN: env.TELEPHONY_API_TOKEN,
    TELEPHONY_CALLER_ID: env.TELEPHONY_CALLER_ID,
  });
  const base = `https://${env.TELEPHONY_SUBDOMAIN}/v1/Accounts/${creds.TELEPHONY_SID}`;
  const headers = { authorization: basicAuth(creds.TELEPHONY_API_KEY, creds.TELEPHONY_API_TOKEN) };

  return {
    name: 'telephony',
    provider: 'exotel',
    isMock: false,

    async health() {
      try {
        await request('exotel', `${base}.json`, { headers, timeoutMs: 5000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
      }
    },

    async createMaskedCall({ fromE164, toE164, jobId }) {
      const res = await request<{ Call: { Sid: string; PhoneNumberSid: string } }>('exotel', `${base}/Calls/connect.json`, {
        method: 'POST',
        headers,
        // Exotel's connect API is form-encoded, not JSON.
        form: {
          From: fromE164,
          To: toE164,
          CallerId: creds.TELEPHONY_CALLER_ID,
          CallType: 'trans',
          // so a call can be tied back to the job it was about, without storing numbers
          CustomField: jobId,
        },
        timeoutMs: 10_000,
      });
      return { virtualNumber: creds.TELEPHONY_CALLER_ID, sessionId: res.Call.Sid };
    },
  };
}
