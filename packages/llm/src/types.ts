/**
 * Provider-agnostic LLM contract. Providers know nothing about caching, retries,
 * Zod or cost: that lives in LlmClient. A provider turns one request into one response
 * (or throws an LlmError).
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  /** Stable system prompt. Providers that support prompt caching cache it. */
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /**
   * Sampling temperature. Advisory: providers may ignore it (the Anthropic API
   * version used by @anthropic-ai/sdk 1.x rejects sampling parameters).
   */
  temperature?: number;
  /** When present the provider must return JSON matching this schema (best effort; the client validates). */
  jsonSchema?: object;
  schemaName?: string;
  /** Task tag, e.g. "finding_narrative". Used by MockProvider and for logging; never sent to an API. */
  task?: string;
}

export interface LlmUsage {
  /** Uncached input tokens (Anthropic: `input_tokens`, which excludes cache reads/writes). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LlmResponse {
  text: string;
  /** Parsed JSON when the request had a jsonSchema and the text parsed. */
  json?: unknown;
  usage: LlmUsage;
  /** Model that actually served the request (may differ from the requested one after a fallback). */
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  /** Default model this provider sends requests to. Part of the cache key. */
  readonly model: string;
  generate(req: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorCode =
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'connection'
  | 'bad_request'
  | 'auth'
  | 'refusal'
  | 'invalid_output'
  | 'unknown';

/** Errors thrown by providers and the client. `transient` drives the retry loop. */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly transient: boolean;
  readonly status: number | undefined;
  /** Server-suggested delay before retrying (from `retry-after`). */
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    opts: { code: LlmErrorCode; transient?: boolean; status?: number; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'LlmError';
    this.code = opts.code;
    this.transient = opts.transient ?? false;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** Thrown when the model output still fails parsing/validation after the repair retry. */
export class LlmOutputError extends LlmError {
  readonly issues: string[];
  readonly lastText: string;
  constructor(message: string, issues: string[], lastText: string) {
    super(message, { code: 'invalid_output' });
    this.name = 'LlmOutputError';
    this.issues = issues;
    this.lastText = lastText;
  }
}

/** HTTP statuses we treat as transient. */
export function isTransientStatus(status: number | undefined): boolean {
  return status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof LlmError) return err.transient;
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; name?: unknown; code?: unknown };
    if (typeof e.status === 'number') return isTransientStatus(e.status);
    const name = typeof e.name === 'string' ? e.name : '';
    if (/timeout|connection/i.test(name)) return true;
    if (typeof e.code === 'string' && /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|UND_ERR)/.test(e.code)) return true;
  }
  return false;
}
