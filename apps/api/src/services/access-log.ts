import type { Clock } from '../lib/clock.js';
import type { UnitOfWork } from '../repositories/index.js';
import type { Actor } from './context.js';

type ServiceMethod = (actor: Actor, ...args: never[]) => Promise<unknown>;

export interface AccessSpec<Args extends unknown[], R> {
  /** Verb in `noun.verb` form, e.g. `audit.read`. */
  action: string;
  /** Resource identifier, e.g. `audit:<id>`. Computed from the call arguments and result. */
  resource: (args: Args, result: R) => string;
}

export type AccessSpecs<S> = {
  [K in keyof S]?: S[K] extends (actor: Actor, ...args: infer A) => Promise<infer R> ? AccessSpec<A, R> : never;
};

/**
 * Access-log decorator. Wraps the listed service methods so that each successful call writes
 * one `access_log` row (actor, action, resource, requestId) in the SAME tenant transaction as
 * the operation: if the operation rolls back, so does its log entry, and an operation cannot
 * commit without being logged. Methods not listed are passed through untouched.
 *
 * This is the only place access-log rows are written for user data; services never call the
 * access-log repository ad hoc.
 */
export function withAccessLog<S extends object>(service: S, uow: UnitOfWork, clock: Clock, specs: AccessSpecs<S>): S {
  const wrapped = Object.create(service) as S;
  for (const [name, spec] of Object.entries(specs) as [keyof S & string, AccessSpec<unknown[], unknown>][]) {
    const original = service[name] as unknown as ServiceMethod;
    if (typeof original !== 'function') throw new Error(`withAccessLog: ${name} is not a method`);
    const fn = async (actor: Actor, ...args: unknown[]) =>
      uow.run(actor.userId, async (r) => {
        const result = await (original as (...a: unknown[]) => Promise<unknown>).call(service, actor, ...args);
        await r.accessLog.insert({
          actor: actor.kind,
          actorId: actor.id,
          action: spec.action,
          resource: spec.resource(args, result),
          requestId: actor.requestId,
          at: clock.now(),
        });
        return result;
      });
    Object.defineProperty(wrapped, name, { value: fn, enumerable: true });
  }
  return wrapped;
}
