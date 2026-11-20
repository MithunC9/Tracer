import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { AuthMode } from '@tracer/schema';
import type { Container } from '../container.js';
import { errors } from '../lib/errors.js';
import { safeEqual } from '../lib/tokens.js';
import { deviceActor, userActor } from '../services/context.js';
import { COOKIE, CSRF_HEADER } from './cookies.js';

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) throw errors.unauthorized();
  const t = h.slice(7).trim();
  if (!t) throw errors.unauthorized();
  return t;
}

/**
 * Authentication hooks per contract auth mode. They run in `onRequest`, i.e. before the body is
 * read or parsed, so unauthenticated clients cannot make the server buffer or validate a 2 MB batch.
 */
export function authHooks(c: Container): Record<AuthMode, onRequestAsyncHookHandler | null> {
  return {
    public: null,
    user: async (req) => {
      const userId = await c.services.auth.verifyAccessToken(bearer(req));
      req.actor = userActor(userId, String(req.id));
    },
    device: async (req) => {
      const d = await c.services.devices.authenticate(bearer(req));
      req.actor = deviceActor(d.deviceId, d.userId, String(req.id));
    },
    /** Cookie-authenticated: double-submit CSRF check (header must equal the csrf cookie). */
    refresh: async (req) => {
      const header = req.headers[CSRF_HEADER];
      const cookie = req.cookies[COOKIE.csrf];
      if (typeof header !== 'string' || !header || !cookie || !safeEqual(header, cookie)) throw errors.csrf();
    },
  };
}
