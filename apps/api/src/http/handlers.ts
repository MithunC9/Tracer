import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../container.js';
import { AppError, errors } from '../lib/errors.js';
import type { IssuedSession } from '../services/auth.js';
import type { Actor } from '../services/context.js';
import { COOKIE } from './cookies.js';
import type { Handlers } from './types.js';

const actorOf = (req: FastifyRequest): Actor => {
  if (!req.actor) throw errors.unauthorized();
  return req.actor;
};

/**
 * Route handlers, keyed by contract route name. Handlers only translate HTTP <-> service calls
 * (actor, input, cookies, status); all rules live in services.
 */
export function createHandlers(c: Container): Handlers {
  const s = c.services;
  const secure = c.config.COOKIE_SECURE;

  const setSessionCookies = (reply: FastifyReply, issued: IssuedSession) => {
    const base = { httpOnly: true, sameSite: 'strict' as const, secure, path: COOKIE.path };
    const maxAge = Math.floor((issued.refreshExpiresAt.getTime() - c.clock.now().getTime()) / 1000);
    reply.setCookie(COOKIE.refresh, issued.refreshToken, { ...base, maxAge });
    reply.setCookie(COOKIE.csrf, issued.session.csrfToken, { ...base, maxAge });
    reply.header('cache-control', 'no-store');
    return issued.session;
  };
  const clearSessionCookies = (reply: FastifyReply) => {
    const base = { httpOnly: true, sameSite: 'strict' as const, secure, path: COOKIE.path };
    reply.clearCookie(COOKIE.refresh, base);
    reply.clearCookie(COOKIE.csrf, base);
  };

  return {
    healthz: async () => ({ status: 'ok', checks: {} }),
    readyz: async () => {
      const checks: Record<string, string> = {};
      try {
        await c.db.query('select 1');
        checks.database = 'ok';
      } catch {
        checks.database = 'down';
      }
      checks.queue = (await c.queue.healthy()) ? 'ok' : 'down';
      if (Object.values(checks).some((v) => v !== 'ok')) throw new AppError('internal', 503, 'Not ready', { checks });
      return { status: 'ok', checks };
    },

    signup: async (req, reply) => setSessionCookies(reply, await s.auth.signup(req.body)),
    login: async (req, reply) => setSessionCookies(reply, await s.auth.login(req.body)),
    refresh: async (req, reply) => {
      try {
        return setSessionCookies(reply, await s.auth.refresh(req.cookies[COOKIE.refresh]));
      } catch (err) {
        clearSessionCookies(reply);
        throw err;
      }
    },
    logout: async (req, reply) => {
      await s.auth.logout(req.cookies[COOKIE.refresh]);
      clearSessionCookies(reply);
      reply.status(204);
    },

    getMe: async (req) => s.me.get(actorOf(req)),
    updateMe: async (req) => s.me.update(actorOf(req), req.body),
    exportMe: async (req, reply) => {
      const { filename, stream } = await s.privacy.exportZip(actorOf(req));
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="${filename}"`);
      reply.header('cache-control', 'no-store');
      return stream;
    },
    deleteMe: async (req, reply) => {
      const receipt = await s.privacy.deleteAccount(actorOf(req));
      clearSessionCookies(reply);
      return receipt;
    },
    accessLog: async (req) => s.privacy.accessLog(actorOf(req), req.query),
    capturedSummary: async (req) => s.privacy.captured(actorOf(req)),
    getExclusions: async (req) => s.privacy.getExclusions(actorOf(req)),
    putExclusions: async (req) => s.privacy.putExclusions(actorOf(req), req.body),

    createPairingCode: async (req, reply) => {
      reply.status(201).header('cache-control', 'no-store');
      return s.devices.createPairingCode(actorOf(req));
    },
    pairDevice: async (req, reply) => {
      reply.status(201).header('cache-control', 'no-store');
      return s.devices.pair(req.body, String(req.id));
    },
    listDevices: async (req) => s.devices.list(actorOf(req)),
    revokeDevice: async (req, reply) => {
      await s.devices.revoke(actorOf(req), req.params.id);
      reply.status(204);
    },

    agentConfig: async (req) => s.audits.agentConfig(actorOf(req)),
    ingest: async (req, reply) => {
      reply.status(202);
      return s.ingest.ingest(actorOf(req), req.body);
    },

    createAudit: async (req, reply) => {
      reply.status(201);
      return s.audits.create(actorOf(req), req.body);
    },
    listAudits: async (req) => s.audits.list(actorOf(req)),
    getAudit: async (req) => s.audits.get(actorOf(req), req.params.id),
    pauseAudit: async (req) => s.audits.pause(actorOf(req), req.params.id),
    resumeAudit: async (req) => s.audits.resume(actorOf(req), req.params.id),
    finishAudit: async (req, reply) => {
      reply.status(202);
      return s.audits.finish(actorOf(req), req.params.id);
    },
    auditStatus: async (req) => s.audits.status(actorOf(req), req.params.id),
    auditPipeline: async (req) => s.pipeline.latest(actorOf(req), req.params.id),
    rerunPipeline: async (req, reply) => {
      reply.status(202);
      return s.pipeline.rerun(actorOf(req), req.params.id);
    },
    getReport: async (req) => s.pipeline.report(actorOf(req), req.params.id),

    listCatalog: async () => ({ items: await s.catalog.list() }),
    getPlan: async (req) => s.me.plan(actorOf(req)),
    _ok: async () => ({ ok: true as const }),
  };
}
