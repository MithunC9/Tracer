import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import type { ApiError, ErrorCode } from '@tracer/schema';
import { AppError } from '../lib/errors.js';

const body = (code: ErrorCode, message: string, requestId: string, details?: unknown): ApiError => ({
  error: { code, message, requestId, ...(details !== undefined ? { details } : {}) },
});

/**
 * Single mapping from any thrown error to the `ApiError` envelope. Stack traces never leave
 * the process; unknown errors become a generic 500 (with the message only outside production).
 */
export function errorHandler(production: boolean) {
  return (err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const rid = String(req.id);
    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({ path: v.instancePath, message: v.message }));
      return reply.status(400).send(body('validation_failed', 'Request validation failed', rid, { context: err.validationContext, issues }));
    }
    if (err instanceof AppError) {
      if (err.headers) reply.headers(err.headers);
      if (err.status >= 500) req.log.error({ err }, 'request failed');
      return reply.status(err.status).send(body(err.code, err.message, rid, err.details));
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err, cause: err.cause }, 'response did not match the contract');
      return reply.status(500).send(body('internal', 'Internal server error', rid));
    }
    const status = err.statusCode ?? 500;
    if (status === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(body('payload_too_large', 'Request body too large', rid));
    }
    if (status === 429) return reply.status(429).send(body('rate_limited', 'Too many requests', rid));
    if (status >= 400 && status < 500) {
      return reply.status(status).send(body(status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : 'bad_request', err.message, rid));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body('internal', production ? 'Internal server error' : `Internal server error: ${err.message}`, rid));
  };
}

export function notFoundHandler(req: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send(body('not_found', `Route ${req.method} ${req.url.split('?')[0]} not found`, String(req.id)));
}
