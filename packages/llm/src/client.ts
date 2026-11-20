import { z } from 'zod';
import { cacheKeyFor, MemoryLruCache, type LlmCache } from './cache.js';
import { costOf, PRICING, type ModelPrice } from './pricing.js';
import {
  isTransientError,
  LlmOutputError,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from './types.js';

export interface RetryOptions {
  /** Total attempts per provider call, including the first (default 4). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface LlmClientOptions {
  provider: LlmProvider;
  /** Pass `null` to disable caching. Default: in-memory LRU. */
  cache?: LlmCache | null;
  retry?: Partial<RetryOptions>;
  pricing?: Record<string, ModelPrice>;
  defaultMaxTokens?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Optional structured log hook. Never receives secrets; receives no prompt text. */
  onEvent?: (e: LlmEvent) => void;
}

export type LlmEvent =
  | { type: 'cache_hit'; task: string; key: string }
  | { type: 'call'; task: string; model: string; attempt: number; usage: LlmUsage; costUsd: number }
  | { type: 'retry'; task: string; attempt: number; delayMs: number; error: string }
  | { type: 'repair'; task: string; issues: string[] };

export interface GenerateStructuredArgs<T> {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Task tag (e.g. "finding_narrative"). */
  task: string;
  /** Extra cache-key namespace (e.g. a prompt version). The key always includes provider, model, system, prompt, schema. */
  cacheKey?: string;
  /** Skip the cache read (the result is still written). */
  bypassCache?: boolean;
  maxTokens?: number;
  temperature?: number;
  schemaName?: string;
}

export interface StructuredResult<T> {
  data: T;
  cached: boolean;
  model: string;
  /** Provider calls made for this result (0 on a cache hit; includes retries and the repair). */
  calls: number;
  repaired: boolean;
}

export interface UsageTotals {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** True when at least one call used a model missing from the pricing table (its cost counted as 0). */
  costUnknown: boolean;
  unpricedModels: string[];
}

const DEFAULT_RETRY: RetryOptions = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 8000 };

/** JSON Schema for a Zod type (draft 2020-12, output shape). */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>;
}

function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
}

/** Pull a JSON value out of model text: plain JSON, or the first {...} block (fenced or not). */
export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t)?.[1];
    const candidate = fenced ?? t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
    if (candidate) {
      try {
        return { ok: true, value: JSON.parse(candidate) };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: 'Output is not valid JSON.' };
  }
}

export class LlmClient {
  readonly provider: LlmProvider;
  private readonly cache: LlmCache | null;
  private readonly retry: RetryOptions;
  private readonly pricing: Record<string, ModelPrice>;
  private readonly defaultMaxTokens: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onEvent: ((e: LlmEvent) => void) | undefined;
  private totals: UsageTotals = LlmClient.emptyTotals();

  constructor(opts: LlmClientOptions) {
    this.provider = opts.provider;
    this.cache = opts.cache === undefined ? new MemoryLruCache() : opts.cache;
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
    if (this.retry.maxAttempts < 1) this.retry.maxAttempts = 1;
    this.pricing = opts.pricing ?? PRICING;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 4000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.onEvent = opts.onEvent;
  }

  private static emptyTotals(): UsageTotals {
    return {
      calls: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      costUnknown: false,
      unpricedModels: [],
    };
  }

  /** Running totals since construction (or the last reset). */
  usage(): UsageTotals {
    return { ...this.totals, unpricedModels: [...this.totals.unpricedModels] };
  }

  resetUsage(): void {
    this.totals = LlmClient.emptyTotals();
  }

  get providerName(): string {
    return this.provider.name;
  }

  get model(): string {
    return this.provider.model;
  }

  async generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<StructuredResult<T>> {
    const jsonSchema = jsonSchemaOf(args.schema);
    const key = cacheKeyFor({
      provider: this.provider.name,
      model: this.provider.model,
      system: args.system,
      prompt: args.prompt,
      schema: jsonSchema,
      namespace: args.cacheKey,
    });

    if (this.cache && !args.bypassCache) {
      const hit = await this.cache.get(key);
      if (hit) {
        const parsed = args.schema.safeParse(hit.data);
        if (parsed.success) {
          this.totals.cacheHits++;
          this.onEvent?.({ type: 'cache_hit', task: args.task, key });
          return { data: parsed.data, cached: true, model: hit.model, calls: 0, repaired: false };
        }
      }
    }

    const base: Omit<LlmRequest, 'messages'> = {
      system: args.system,
      maxTokens: args.maxTokens ?? this.defaultMaxTokens,
      jsonSchema,
      schemaName: args.schemaName ?? args.task,
      task: args.task,
    };
    if (args.temperature !== undefined) base.temperature = args.temperature;
    const messages: LlmMessage[] = [{ role: 'user', content: args.prompt }];

    let calls = 0;
    let repaired = false;
    for (let round = 0; round < 2; round++) {
      const { res, attempts } = await this.callWithRetry({ ...base, messages }, args.task);
      calls += attempts;
      const check = this.check(args.schema, res);
      if (check.ok) {
        if (this.cache) {
          await this.cache.set(key, {
            data: check.value,
            text: res.text,
            model: res.model,
            provider: this.provider.name,
            createdAt: new Date().toISOString(),
          });
        }
        return { data: check.value, cached: false, model: res.model, calls, repaired };
      }
      if (round === 1) {
        throw new LlmOutputError(
          `LLM output failed validation after repair (${args.task}): ${check.issues.join('; ')}`,
          check.issues,
          res.text,
        );
      }
      this.onEvent?.({ type: 'repair', task: args.task, issues: check.issues });
      repaired = true;
      messages.push(
        { role: 'assistant', content: res.text || '(empty)' },
        {
          role: 'user',
          content: `Your previous output was rejected:\n- ${check.issues.join('\n- ')}\nReturn only corrected JSON that matches the schema and follows every rule.`,
        },
      );
    }
    /* c8 ignore next */
    throw new Error('unreachable');
  }

  private check<T>(schema: z.ZodType<T>, res: LlmResponse): { ok: true; value: T } | { ok: false; issues: string[] } {
    let value: unknown = res.json;
    if (value === undefined) {
      const p = parseJsonLoose(res.text);
      if (!p.ok) return { ok: false, issues: [p.error] };
      value = p.value;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
    return { ok: true, value: parsed.data };
  }

  /** Delay before retry n (1-based): full jitter over exponential backoff, at least retry-after. */
  backoffMs(attempt: number, retryAfterMs?: number): number {
    const exp = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (attempt - 1));
    const jittered = exp / 2 + this.random() * (exp / 2);
    return Math.min(this.retry.maxDelayMs, Math.max(jittered, retryAfterMs ?? 0));
  }

  private async callWithRetry(req: LlmRequest, task: string): Promise<{ res: LlmResponse; attempts: number }> {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const res = await this.provider.generate(req);
        this.account(task, res, attempt);
        return { res, attempts: attempt };
      } catch (err) {
        this.totals.calls++;
        if (!isTransientError(err) || attempt >= this.retry.maxAttempts) throw err;
        const retryAfter = (err as { retryAfterMs?: number }).retryAfterMs;
        const delay = this.backoffMs(attempt, retryAfter);
        this.onEvent?.({ type: 'retry', task, attempt, delayMs: delay, error: err instanceof Error ? err.message : String(err) });
        await this.sleep(delay);
      }
    }
  }

  private account(task: string, res: LlmResponse, attempt: number): void {
    const t = this.totals;
    t.calls++;
    t.inputTokens += res.usage.inputTokens;
    t.outputTokens += res.usage.outputTokens;
    t.cacheReadTokens += res.usage.cacheReadTokens ?? 0;
    t.cacheWriteTokens += res.usage.cacheWriteTokens ?? 0;
    const { costUsd, known } = costOf(res.model, res.usage, this.pricing);
    t.costUsd += costUsd;
    if (!known) {
      t.costUnknown = true;
      if (!t.unpricedModels.includes(res.model)) t.unpricedModels.push(res.model);
    }
    this.onEvent?.({ type: 'call', task, model: res.model, attempt, usage: res.usage, costUsd });
  }
}
