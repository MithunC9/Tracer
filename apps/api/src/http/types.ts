import type { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { RouteName, Routes } from '@tracer/schema';
import type { Actor } from '../services/context.js';

type Out<T> = T extends z.ZodType ? z.output<T> : undefined;
type Field<N extends RouteName, K extends string> = Routes[N] extends { [P in K]: infer S } ? Out<S> : unknown;

export type RouteRequest<N extends RouteName> = FastifyRequest<{
  Params: Field<N, 'params'>;
  Querystring: Field<N, 'query'>;
  Body: Field<N, 'body'>;
}>;

/** What a handler returns: the response schema's input (the serializer validates it), a stream for binary, nothing for 204. */
export type RouteResult<N extends RouteName> = Routes[N]['response'] extends z.ZodType
  ? z.input<Routes[N]['response']>
  : Routes[N]['response'] extends 'binary'
    ? Readable
    : void;

export type Handler<N extends RouteName> = (req: RouteRequest<N>, reply: FastifyReply) => Promise<RouteResult<N>>;

/** One handler per contract route. The mapped type makes a missing handler a compile error. */
export type Handlers = { [N in RouteName]: Handler<N> };

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
