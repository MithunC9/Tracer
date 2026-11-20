import { createHash } from 'node:crypto';

/**
 * Pluggable response cache. Values are JSON-serialisable. The API supplies a
 * Postgres-backed implementation; the default is an in-memory LRU.
 */
export interface LlmCache {
  get(key: string): Promise<CachedEntry | undefined>;
  set(key: string, value: CachedEntry): Promise<void>;
}

export interface CachedEntry {
  /** The validated structured value. */
  data: unknown;
  /** Raw model text that produced it. */
  text: string;
  model: string;
  provider: string;
  createdAt: string;
}

export class MemoryLruCache implements LlmCache {
  private readonly map = new Map<string, CachedEntry>();
  constructor(private readonly maxEntries = 500) {}

  async get(key: string): Promise<CachedEntry | undefined> {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  async set(key: string, value: CachedEntry): Promise<void> {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** JSON.stringify with sorted object keys, so equal schemas hash equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function cacheKeyFor(parts: {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  schema: unknown;
  namespace?: string | undefined;
}): string {
  return sha256(
    stableStringify([parts.provider, parts.model, parts.system, parts.prompt, parts.schema, parts.namespace ?? null]),
  );
}
