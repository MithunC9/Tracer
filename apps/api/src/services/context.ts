import type { Clock } from '../lib/clock.js';
import type { KeyRing } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import type { Repos } from '../repositories/index.js';

/** Who is acting, on whose data, under which request. Passed as the first argument of every service call. */
export interface Actor {
  kind: 'user' | 'device' | 'system';
  /** user id, device id, or a worker name */
  id: string | null;
  /** The tenant whose data is touched. */
  userId: string;
  requestId: string | null;
}

export const userActor = (userId: string, requestId: string | null): Actor => ({ kind: 'user', id: userId, userId, requestId });
export const deviceActor = (deviceId: string, userId: string, requestId: string | null): Actor => ({
  kind: 'device',
  id: deviceId,
  userId,
  requestId,
});
export const systemActor = (userId: string, worker: string): Actor => ({ kind: 'system', id: worker, userId, requestId: null });

/**
 * Per-user data keys. Unwrapped DEKs are cached briefly in memory so a burst of ingest batches
 * does one unwrap, not one per batch. `forget` is called on account deletion.
 */
export class KeyService {
  private readonly cache = new Map<string, { dek: Buffer; until: number }>();

  constructor(
    private readonly ring: KeyRing,
    private readonly clock: Clock,
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 10_000,
  ) {}

  /** Creates and stores a DEK for a brand-new user. */
  async create(r: Repos): Promise<Buffer> {
    const { dek, wrapped } = this.ring.newDek(r.userId);
    await r.keys.insert(r.userId, wrapped);
    this.put(r.userId, dek);
    return dek;
  }

  async get(r: Repos): Promise<Buffer> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(r.userId);
    if (hit && hit.until > now) return hit.dek;
    const row = await r.keys.get(r.userId);
    if (!row) throw errors.notFound('Account');
    const dek = this.ring.unwrapDek(r.userId, row.wrappedDek);
    this.put(r.userId, dek);
    return dek;
  }

  forget(userId: string) {
    const hit = this.cache.get(userId);
    hit?.dek.fill(0);
    this.cache.delete(userId);
  }

  subkey(purpose: string) {
    return this.ring.subkey(purpose);
  }

  private put(userId: string, dek: Buffer) {
    if (this.cache.size >= this.maxEntries) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(userId, { dek, until: this.clock.now().getTime() + this.ttlMs });
  }
}
