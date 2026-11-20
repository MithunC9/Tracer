import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { LlmClient, type LlmClientOptions } from './client.js';
import { MockProvider, type MockProviderOptions } from './mock.js';
import type { LlmProvider } from './types.js';

export * from './types.js';
export * from './cache.js';
export * from './pricing.js';
export * from './numbers.js';
export * from './allowed.js';
export * from './prompts.js';
export * from './client.js';
export * from './mock.js';
export * from './anthropic.js';
export * from './narrate.js';
export * from './validate.js';

export type ProviderKind = 'mock' | 'anthropic';

export interface CreateLlmClientOptions extends Omit<LlmClientOptions, 'provider'> {
  /** Defaults to env LLM_PROVIDER, then "mock". */
  provider?: ProviderKind | LlmProvider;
  anthropic?: AnthropicProviderOptions;
  mock?: MockProviderOptions;
  env?: Record<string, string | undefined>;
}

export function createLlmClient(opts: CreateLlmClientOptions = {}): LlmClient {
  const env = opts.env ?? process.env;
  const { provider: p, anthropic, mock, env: _env, ...clientOpts } = opts;
  let provider: LlmProvider;
  if (p && typeof p === 'object') {
    provider = p;
  } else {
    const kind = (p ?? env.LLM_PROVIDER?.trim() ?? 'mock') || 'mock';
    if (kind === 'anthropic') provider = new AnthropicProvider({ env, ...anthropic });
    else if (kind === 'mock') provider = new MockProvider(mock);
    else throw new Error(`Unknown LLM_PROVIDER "${kind}" (expected "mock" or "anthropic")`);
  }
  return new LlmClient({ ...clientOpts, provider });
}
