import { z } from 'zod';
import { PRODUCT } from './config.js';
import { ApiError } from './common.js';
import { routes, type RouteDef } from './routes.js';

/**
 * Builds an OpenAPI 3.1 document from the route contract. The running API also serves
 * a spec via @fastify/swagger; contract tests assert the two agree on paths/methods.
 */
export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const toSchema = (s: z.ZodType, io: 'input' | 'output') =>
    z.toJSONSchema(s, { io, target: 'draft-2020-12', unrepresentable: 'any' });

  for (const [name, d] of Object.entries(routes) as [string, RouteDef][]) {
    const oaPath = d.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      operationId: name,
      summary: d.summary,
      tags: d.tags,
      security:
        d.auth === 'public' ? [] : d.auth === 'refresh' ? [{ refreshCookie: [] }] : [{ [d.auth === 'device' ? 'deviceToken' : 'bearer']: [] }],
    };
    const parameters: unknown[] = [];
    if (d.params)
      for (const [k, v] of Object.entries(d.params.shape))
        parameters.push({ name: k, in: 'path', required: true, schema: toSchema(v as z.ZodType, 'input') });
    if (d.query)
      for (const [k, v] of Object.entries(d.query.shape))
        parameters.push({ name: k, in: 'query', required: !(v as z.ZodType).safeParse(undefined).success, schema: toSchema(v as z.ZodType, 'input') });
    if (parameters.length) op.parameters = parameters;
    if (d.body) op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(d.body, 'input') } } };
    const status = String(d.successStatus ?? (d.response === null ? 204 : 200));
    const responses: Record<string, unknown> = {};
    if (d.response === null) responses[status] = { description: 'No content' };
    else if (d.response === 'binary')
      responses[status] = { description: 'File', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } };
    else responses[status] = { description: 'OK', content: { 'application/json': { schema: toSchema(d.response, 'output') } } };
    responses.default = { description: 'Error', content: { 'application/json': { schema: toSchema(ApiError, 'output') } } };
    op.responses = responses;
    (paths[oaPath] ??= {})[d.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: `${PRODUCT.name} API`, version: '0.1.0', description: PRODUCT.selfObservationRule },
    servers: [{ url: 'http://localhost:4000' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        deviceToken: { type: 'http', scheme: 'bearer', description: 'Device token issued by pairing' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'tracer_rt' },
      },
    },
    paths,
  };
}
