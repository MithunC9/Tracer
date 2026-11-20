import type { CatalogEntry, Me } from '@tracer/schema';
import { errors } from '../lib/errors.js';
import type { UserRow } from '../repositories/identity.js';
import type { UnitOfWork } from '../repositories/index.js';
import type { Actor } from './context.js';
import { parseConstraints } from './pipeline.js';

const toMe = (u: UserRow): Me => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  createdAt: u.createdAt.toISOString(),
  plan: u.plan === 'monthly' ? 'monthly' : 'free',
  constraints: parseConstraints(u.constraints),
});

export class MeService {
  constructor(private readonly uow: UnitOfWork) {}

  get(actor: Actor): Promise<Me> {
    return this.uow.run(actor.userId, async (r) => {
      const u = await r.users.findById(actor.userId);
      if (!u) throw errors.notFound('Account');
      return toMe(u);
    });
  }

  update(actor: Actor, patch: { displayName?: string | undefined; constraints?: Me['constraints'] | undefined }): Promise<Me> {
    return this.uow.run(actor.userId, async (r) => {
      const u = await r.users.update(actor.userId, {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.constraints !== undefined ? { constraints: patch.constraints } : {}),
      });
      if (!u) throw errors.notFound('Account');
      return toMe(u);
    });
  }

  plan(actor: Actor): Promise<{ plan: 'free' | 'monthly'; note: string }> {
    return this.get(actor).then((m) => ({ plan: m.plan, note: 'Billing is not implemented; every account is on the free plan.' }));
  }
}

/** PORT: the vendor-neutral tool catalog. `@tracer/catalog` implements it later. */
export interface CatalogSource {
  list(): Promise<CatalogEntry[]>;
}
export const emptyCatalog: CatalogSource = { list: async () => [] };
