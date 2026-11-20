import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildOpenApi, LIMITS, PRODUCT, routes, type RouteDef, type RouteName } from '@tracer/schema';
import type { Container } from '../container.js';
import { errors } from '../lib/errors.js';
import { safeEqual } from '../lib/tokens.js';
import { loggerOptions } from '../observability/logger.js';
import { authHooks } from './auth.js';
import { CSRF_HEADER } from './cookies.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { createHandlers } from './handlers.js';
import type { Handlers } from './types.js';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
/** Routes behind the per-IP auth limiter. */
const AUTH_LIMITED: ReadonlySet<RouteName> = new Set(['signup', 'login', 'refresh', 'logout', 'pairDevice']);
const DEFAULT_BODY_LIMIT = 256 * 1024;

export async function buildApp(c: Container, opts: { handlers?: Partial<Handlers> } = {}): Promise<FastifyInstance> {
  const production = c.config.NODE_ENV === 'production';
  const app = Fastify({
    logger: loggerOptions(c.config.LOG_LEVEL),
    bodyLimit: DEFAULT_BODY_LIMIT,
    trustProxy: production,
    // Honour an incoming x-request-id if it looks sane, otherwise mint one.
    requestIdHeader: false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID_RE.test(h) ? h : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler(production));
  app.setNotFoundHandler(notFoundHandler);
  app.decorateRequest('actor', null);

  // Bodyless POSTs (pause, finish, pairing-codes...) are often sent with a JSON content type;
  // treat an empty body as "no body" instead of a 400. Non-empty bodies keep Fastify's
  // prototype-poisoning-safe parser.
  const defaultJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body === '' || body === undefined) return done(null, undefined);
    defaultJson(req, body as string, done);
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    c.metrics.httpDuration.observe(
      { method: req.method, route: req.routeOptions.url ?? 'unmatched', status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });

  await app.register(helmet, {
    // JSON API: nothing may be framed or executed. /docs sets its own CSP (staticCSP below).
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: production ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: [c.config.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', CSRF_HEADER, 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after', 'content-disposition'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => errors.rateLimited(ctx.ttl / 1000),
  });

  const contract = buildOpenApi() as { components: Record<string, unknown> };
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: `${PRODUCT.name} API`, version: '0.1.0', description: PRODUCT.selfObservationRule },
      components: contract.components,
    },
    transform: jsonSchemaTransform,
  });
  if (c.config.DOCS_ENABLED) await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });

  // --- Contract routes: iterate the route table so server and contract cannot drift.
  const handlers = { ...createHandlers(c), ...opts.handlers } as Handlers;
  const hooks = authHooks(c);
  for (const [name, def] of Object.entries(routes) as [RouteName, RouteDef][]) {
    const handler = handlers[name];
    if (!handler) throw new Error(`No handler for contract route ${name}`);
    const status = def.successStatus ?? (def.response === null ? 204 : 200);
    const hook = hooks[def.auth];
    app.route({
      method: def.method,
      url: def.path,
      bodyLimit: name === 'ingest' ? LIMITS.maxBatchBytes : DEFAULT_BODY_LIMIT,
      schema: {
        operationId: name,
        summary: def.summary,
        tags: def.tags,
        security:
          def.auth === 'public' ? [] : def.auth === 'refresh' ? [{ refreshCookie: [] }] : [{ [def.auth === 'device' ? 'deviceToken' : 'bearer']: [] }],
        ...(def.params ? { params: def.params } : {}),
        ...(def.query ? { querystring: def.query } : {}),
        ...(def.body ? { body: def.body } : {}),
        ...(def.response && def.response !== 'binary' ? { response: { [status]: def.response } } : {}),
      },
      ...(hook ? { onRequest: hook } : {}),
      ...(AUTH_LIMITED.has(name) ? { config: { rateLimit: { max: c.config.AUTH_RATE_PER_MIN, timeWindow: 60_000 } } } : {}),
      // Contract success status is the default; a handler may still override it.
      handler: (async (req: never, reply: { code(n: number): unknown }) => {
        reply.code(status);
        return (handler as (r: never, p: unknown) => Promise<unknown>)(req, reply);
      }) as never,
    });
  }

  app.get('/metrics', { schema: { hide: true } }, async (req, reply) => {
    if (c.config.METRICS_TOKEN) {
      const h = req.headers.authorization ?? '';
      if (!safeEqual(h, `Bearer ${c.config.METRICS_TOKEN}`)) throw errors.unauthorized();
    }
    reply.header('content-type', c.metrics.registry.contentType);
    return c.metrics.registry.metrics();
  });

  return app;
}
