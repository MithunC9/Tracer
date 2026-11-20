import type { ErrorCode } from '@tracer/schema';

/**
 * Domain errors thrown by services. The HTTP layer maps them to the `ApiError` envelope;
 * services never know about status codes beyond this table.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    /** Extra response headers, e.g. Retry-After. */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  badRequest: (message: string, details?: unknown) => new AppError('bad_request', 400, message, details),
  unauthorized: (message = 'Authentication required') => new AppError('unauthorized', 401, message),
  forbidden: (message = 'Forbidden') => new AppError('forbidden', 403, message),
  notFound: (what = 'Resource') => new AppError('not_found', 404, `${what} not found`),
  conflict: (message: string, details?: unknown) => new AppError('conflict', 409, message, details),
  csrf: () => new AppError('csrf_failed', 403, 'CSRF token missing or invalid'),
  rateLimited: (retryAfterSeconds: number, message = 'Too many requests') =>
    new AppError('rate_limited', 429, message, { retryAfterSeconds }, { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) }),
  quotaExceeded: (message: string, retryAfterSeconds: number) =>
    new AppError('quota_exceeded', 429, message, { retryAfterSeconds }, { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) }),
  windowClosed: (message = 'Audit window is closed') => new AppError('audit_window_closed', 409, message),
};

/** Postgres SQLSTATE helpers. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  if (e && typeof e.code === 'string') return e.code;
  if (e?.cause && typeof e.cause.code === 'string') return e.cause.code;
  return undefined;
}
export const isUniqueViolation = (err: unknown) => pgCode(err) === '23505';
export const pgConstraint = (err: unknown): string | undefined => {
  const e = err as { constraint?: string; cause?: { constraint?: string } } | null;
  return e?.constraint ?? e?.cause?.constraint;
};
