import type { CachedEntry, LlmCache } from '@tracer/llm';
import type { Clock } from '../lib/clock.js';
import { aad, decryptJson, encryptJson } from '../lib/crypto.js';
import type { UnitOfWork } from '../repositories/index.js';
import type { KeyService } from '../services/context.js';

/**
 * `LlmCache` on the `llm_cache` table: one row per (user, cache key), value encrypted with the
 * user's data key (AAD binds it to the row), RLS-scoped like every tenant table, deleted with
 * the account. Cache failures never fail a stage: a read error is a miss, a write error is ignored.
 */
export class PgLlmCache implements LlmCache {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly keys: KeyService,
    private readonly clock: Clock,
    private readonly userId: string,
  ) {}

  async get(key: string): Promise<CachedEntry | undefined> {
    try {
      return await this.uow.run(this.userId, async (r) => {
        const enc = await r.pipeline.getLlmCache(key);
        if (!enc) return undefined;
        return decryptJson<CachedEntry>(await this.keys.get(r), enc, aad.llmCache(this.userId, key));
      });
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachedEntry): Promise<void> {
    try {
      await this.uow.run(this.userId, async (r) => {
        const dek = await this.keys.get(r);
        await r.pipeline.putLlmCache(key, encryptJson(dek, value, aad.llmCache(this.userId, key)), this.clock.now());
      });
    } catch {
      /* best effort */
    }
  }
}
