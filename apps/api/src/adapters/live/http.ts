/**
 * The small amount of HTTP plumbing every live adapter needs.
 *
 * Deliberately dependency-free: Node 20+ has `fetch`, and a payment integration is not a good
 * place to take on a supply chain we do not control. Every call has a timeout, because an
 * external service that hangs must never hang a booking.
 */

export class AdapterHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} responded ${status}: ${body.slice(0, 300)}`);
    this.name = 'AdapterHttpError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Form-encoded instead of JSON, which some Indian providers still expect. */
  form?: Record<string, string>;
}

export async function request<T>(provider: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    let body: string | undefined;
    if (opts.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new AdapterHttpError(provider, res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    if (e instanceof AdapterHttpError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AdapterHttpError(provider, 504, `no answer within ${opts.timeoutMs ?? 10_000}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export function basicAuth(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
}

/**
 * A live adapter refuses to be constructed without its credentials rather than failing later,
 * in the middle of somebody's booking.
 */
export function requireEnv<T extends Record<string, string | undefined>>(adapter: string, values: T): { [K in keyof T]: string } {
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`${adapter} adapter needs ${missing.join(', ')} to be set. Set them, or use the "mock" provider.`);
  }
  return values as { [K in keyof T]: string };
}
