import { t, type ErrorCode, type Language } from '@hyperlocal/core';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  AUTH_INVALID_TOKEN: 401,
  AUTH_SUSPENDED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  OTP_RATE_LIMITED: 429,
  OTP_EXPIRED: 422,
  OTP_INVALID: 422,
  OTP_LOCKED: 422,
  OTP_CONSUMED: 422,
  ROLE_NOT_SELF_SERVICE: 422,
  REASON_REQUIRED: 422,
  JOB_INVALID_TRANSITION: 422,
  IDEMPOTENCY_KEY_REUSED: 409,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, options: { message?: string; details?: unknown; cause?: unknown } = {}) {
    super(options.message ?? t(`error.${code}` as never));
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    if (options.cause) this.cause = options.cause;
  }

  /** Localised message for the client. */
  userMessage(lang: Language): string {
    return t(`error.${this.code}` as never, lang);
  }

  toBody(requestId: string | undefined, lang: Language) {
    return {
      error: {
        code: this.code,
        message: this.userMessage(lang),
        details: this.details,
        requestId,
      },
    };
  }
}

export const notFound = (what = 'resource') => new AppError('NOT_FOUND', { details: { resource: what } });
export const forbidden = (why?: string) => new AppError('FORBIDDEN', { details: why ? { reason: why } : undefined });
export const conflict = (details?: unknown) => new AppError('CONFLICT', { details });
