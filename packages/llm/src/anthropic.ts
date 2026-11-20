import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1'];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** The slice of the SDK client we use, so tests can stub it. */
export interface AnthropicLike {
  messages: { create: (body: any, options?: any) => Promise<any> };
  beta: { messages: { create: (body: any, options?: any) => Promise<any> } };
}

export interface AnthropicProviderOptions {
  /** Defaults to env ANTHROPIC_API_KEY. If unset, the SDK resolves other credentials (auth token, `ant` profile). */
  apiKey?: string;
  /** Defaults to env ANTHROPIC_MODEL, then DEFAULT_ANTHROPIC_MODEL. */
  model?: string;
  /** Per-request timeout, ms (default 60s). */
  timeoutMs?: number;
  /** output_config.effort. Narration is short, so default "low". `null` omits it (older models). */
  effort?: Effort | null;
  /** Use the server-side refusal fallback where the model supports it (default true). */
  refusalFallback?: boolean;
  /** Pre-built SDK client (tests, custom base URL). */
  client?: AnthropicLike;
  /** Custom fetch passed to the SDK (tests). */
  fetch?: typeof fetch;
  baseURL?: string;
  env?: Record<string, string | undefined>;
}

/** Keywords the structured-output schema compiler rejects; Zod re-validates them client-side. */
const UNSUPPORTED_KEYS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

/** Make a JSON schema acceptable to Anthropic structured outputs. */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYS.has(k)) continue;
    out[k] = k === 'properties' || k === '$defs' || k === 'definitions' ? mapValues(v, sanitizeSchema) : sanitizeSchema(v);
  }
  if (out.type === 'object' || (out.properties && typeof out.properties === 'object')) {
    out.additionalProperties = false;
    if (!out.required && out.properties) out.required = Object.keys(out.properties as object);
  }
  return out;
}

function mapValues(v: unknown, f: (x: unknown) => unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, f(x)]));
}

function retryAfterMs(headers: unknown): number | undefined {
  const h = headers as { get?: (k: string) => string | null } | undefined;
  const raw = h?.get?.('retry-after-ms') ?? null;
  if (raw && Number.isFinite(Number(raw))) return Number(raw);
  const s = h?.get?.('retry-after') ?? null;
  if (s && Number.isFinite(Number(s))) return Number(s) * 1000;
  return undefined;
}

/** Map SDK errors to LlmError without leaking request details (headers carry the key). */
export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError('Anthropic request timed out', { code: 'timeout', transient: true });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmError('Anthropic connection error', { code: 'connection', transient: true });
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const opts: ConstructorParameters<typeof LlmError>[1] = { code: 'unknown' };
    if (status !== undefined) opts.status = status;
    const ra = retryAfterMs(err.headers);
    if (ra !== undefined) opts.retryAfterMs = ra;
    if (status === 429) Object.assign(opts, { code: 'rate_limited', transient: true });
    else if (status === 408) Object.assign(opts, { code: 'timeout', transient: true });
    else if (status === 409) Object.assign(opts, { code: 'server_error', transient: true });
    else if (status !== undefined && status >= 500) Object.assign(opts, { code: 'server_error', transient: true });
    else if (status === 401 || status === 403) opts.code = 'auth';
    else if (status === 400 || status === 404 || status === 422) opts.code = 'bad_request';
    return new LlmError(`Anthropic API error ${status ?? ''}: ${err.message}`.trim(), opts);
  }
  return new LlmError(err instanceof Error ? err.message : String(err), { code: 'unknown' });
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: AnthropicLike;
  private readonly timeoutMs: number;
  private readonly effort: Effort | null;
  private readonly refusalFallback: boolean;

  constructor(opts: AnthropicProviderOptions = {}) {
    const env = opts.env ?? process.env;
    this.model = opts.model ?? (env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.effort = opts.effort === undefined ? 'low' : opts.effort;
    this.refusalFallback = opts.refusalFallback ?? true;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? (env.ANTHROPIC_API_KEY?.trim() || undefined);
      // The key goes straight to the SDK and is not stored on this object (never logged or serialised).
      this.client = new Anthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
        timeout: this.timeoutMs,
        // LlmClient owns retries (backoff + jitter + accounting); don't compound them.
        maxRetries: 0,
      }) as unknown as AnthropicLike;
    }
  }

  private useFallback(): boolean {
    return this.refusalFallback && FALLBACK_MODELS.includes(this.model);
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    // temperature is intentionally not sent: API version 2026-10-21 (SDK 1.x) rejects sampling params.
    const outputConfig: Record<string, unknown> = {};
    if (this.effort) outputConfig.effort = this.effort;
    if (req.jsonSchema) outputConfig.format = { type: 'json_schema', schema: sanitizeSchema(req.jsonSchema) };

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens,
      // Stable system prompt first, marked for prompt caching.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (Object.keys(outputConfig).length) body.output_config = outputConfig;

    let msg: any;
    try {
      const options = { timeout: this.timeoutMs, maxRetries: 0 };
      if (this.useFallback()) {
        msg = await this.client.beta.messages.create({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' }, options);
      } else {
        msg = await this.client.messages.create(body, options);
      }
    } catch (err) {
      throw toLlmError(err);
    }

    if (msg?.stop_reason === 'refusal') {
      const cat = msg.stop_details?.category ? ` (${msg.stop_details.category})` : '';
      throw new LlmError(`Anthropic model declined the request${cat}`, { code: 'refusal' });
    }

    const text = (msg?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
    const u = msg?.usage ?? {};
    const res: LlmResponse = {
      text,
      model: typeof msg?.model === 'string' ? msg.model : this.model,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
    if (req.jsonSchema && msg?.stop_reason !== 'max_tokens') {
      try {
        res.json = JSON.parse(text);
      } catch {
        /* client handles invalid JSON with a repair retry */
      }
    }
    return res;
  }
}
