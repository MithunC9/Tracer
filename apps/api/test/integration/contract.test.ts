import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, buildOpenApi, routes } from '@tracer/schema';
import { createHandlers } from '../../src/http/handlers.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const methodsByPath = (spec: { paths: Record<string, Record<string, unknown>> }) =>
  Object.entries(spec.paths)
    .flatMap(([p, ops]) => Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} ${p}`))
    .sort();

describe('contract', () => {
  it('has a handler for every route in the contract table, and nothing else', () => {
    const handlers = createHandlers(h.c);
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(routes).sort());
    for (const fn of Object.values(handlers)) expect(typeof fn).toBe('function');
  });

  it('serves an OpenAPI document whose paths and methods equal buildOpenApi()', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const served = res.json();
    expect(methodsByPath(served)).toEqual(methodsByPath(buildOpenApi() as never));
    // operationIds line up with route names
    const ids = Object.values(served.paths as Record<string, Record<string, { operationId?: string }>>)
      .flatMap((ops) => Object.values(ops).map((o) => o.operationId))
      .sort();
    expect(ids).toEqual(Object.keys(routes).sort());
  });

  it('every contract route is registered with Fastify', () => {
    for (const d of Object.values(routes)) {
      expect(h.app.hasRoute({ method: d.method, url: d.path }), `${d.method} ${d.path}`).toBe(true);
    }
  });

  it('answers unknown routes with the ApiError envelope and echoes x-request-id', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/nope', headers: { 'x-request-id': 'req-123' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toBe('req-123');
    const body = ApiError.parse(res.json());
    expect(body.error).toMatchObject({ code: 'not_found', requestId: 'req-123' });
  });

  it('mints a request id when the incoming one is unsafe', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'bad id\nwith newline' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns validation errors in the envelope with details', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('serves health, readiness, docs UI, metrics, smoke route', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok', checks: {} });
    const ready = await h.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks).toEqual({ database: 'ok', queue: 'ok' });
    expect((await h.app.inject({ method: 'GET', url: '/v1/_ok' })).json()).toEqual({ ok: true });
    expect((await h.app.inject({ method: 'GET', url: '/docs' })).statusCode).toBeLessThan(400);
    const m = await h.app.inject({ method: 'GET', url: '/metrics' });
    expect(m.statusCode).toBe(200);
    expect(m.body).toContain('http_request_duration_seconds');
  });

  it('sets security headers and strict CORS', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'http://localhost:3000' } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const evil = await h.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts bodyless POSTs that still declare a JSON content type, rejects malformed JSON', async () => {
    const empty = await h.app.inject({ method: 'POST', url: '/v1/devices/pairing-codes', headers: { 'content-type': 'application/json' } });
    expect(empty.statusCode).toBe(401); // reached auth, not a body-parse 400
    const bad = await h.app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"email":' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');
    const proto = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__":{"x":1},"email":"a@b.co","password":"x"}',
    });
    expect(proto.statusCode).toBe(400);
  });

  it('serves the @tracer/catalog entries from the CatalogSource port', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/catalog' });
    const { CATALOG } = await import('@tracer/catalog');
    expect(CATALOG.length).toBeGreaterThan(0);
    expect(res.json().items).toHaveLength(CATALOG.length);
  });
});
