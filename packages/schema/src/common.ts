import { z } from 'zod';

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** ISO-8601 timestamp with offset, e.g. 2026-11-20T09:15:00.000Z */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Platform = z.enum(['macos', 'windows', 'linux', 'simulated']);
export type Platform = z.infer<typeof Platform>;

/** Standard error envelope for every non-2xx API response. */
export const ApiError = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ApiError' });
export type ApiError = z.infer<typeof ApiError>;

export const ErrorCode = z.enum([
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'quota_exceeded',
  'csrf_failed',
  'audit_window_closed',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
