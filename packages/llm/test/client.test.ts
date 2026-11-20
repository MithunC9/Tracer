import { Narrative } from '@tracer/schema';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  costOf,
  createLlmClient,
  LlmClient,
  LlmError,
  LlmOutputError,
  MemoryLruCache,
  MockProvider,
  narrateFinding,
  narrateSummary,
  priceFor,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../src/index.js';
import { disallowedNumbers } from '../src/numbers.js';
import { buildReport } from './fixtures/report.js';

const noSleep = () => Promise.resolve();

function factsFrom(i = 0) {
  const f = buildReport().findings[i]!;
  return {
    label: f.label,
    path: f.path,
    metrics: f.metrics,
    score: f.score,
    recipeTitle: f.recipe.title,
    topToolNames: f.tools.map((t) => t.name),
    allowedNumbers: f.allowedNumbers,
  };
}

/** Provider stub driven by a queue of behaviours. */
class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  calls: LlmRequest[] = [];
  constructor(
    private readonly script: Array<(req: LlmRequest) => LlmResponse | Promise<LlmResponse>>,
    readonly model = 'claude-sonnet-5-5',
  ) {}
  async generate(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(structuredClone(req));
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)]!;
    return step(req);
  }
}
const ok = (json: unknown, usage = { inputTokens: 1000, outputTokens: 200 }) => (): LlmResponse => ({
  text: JSON.stringify(json),
  json,
  usage,
  model: 'claude-sonnet-5-5',
});

describe('MockProvider', () => {
  it('is deterministic for the same input', async () => {
    const a = await narrateFinding(createLlmClient({ provider: 'mock' }), factsFrom(0));
    const b = await narrateFinding(createLlmClient({ provider: 'mock' }), factsFrom(0));
    expect(a).toEqual(b);
    expect(a.headline.length).toBeLessThanOrEqual(140);
    expect(a.body.length).toBeLessThanOrEqual(1200);
  });

  it('varies with the input and only uses allowed numbers', async () => {
    const client = createLlmClient({ provider: 'mock' });
    const outs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const facts = factsFrom(i);
      const n = await narrateFinding(client, facts);
      outs.push(n.body);
      const ignore = [facts.label, ...facts.path.flatMap((p) => [p.label, p.appKey]), facts.recipeTitle, ...facts.topToolNames];
      expect(disallowedNumbers(`${n.headline} ${n.body}`, facts.allowedNumbers, ignore)).toEqual([]);
      expect(n.body).not.toMatch(/supercharge|unlock|leverage|seamless/i);
    }
    expect(outs[0]).not.toEqual(outs[1]);
  });

  it('only mentions numbers that were provided', async () => {
    const facts = { ...factsFrom(0), allowedNumbers: [] };
    const n = await narrateFinding(createLlmClient({ provider: 'mock' }), facts);
    expect(disallowedNumbers(`${n.headline} ${n.body}`, [], [facts.label, ...facts.path.map((p) => p.label), ...facts.topToolNames, facts.recipeTitle])).toEqual([]);
  });

  it('writes a summary narrative', async () => {
    const n = await narrateSummary(createLlmClient(), {
      reclaimableHoursPerWeek: 1.1,
      daysObserved: 7,
      findingCount: 2,
      topFindingLabel: 'Stripe payout reconciliation',
      allowedNumbers: [1.1, 2, 7],
    });
    expect(n.headline + n.body).toMatch(/1\.1/);
    expect(disallowedNumbers(n.headline + ' ' + n.body, [1.1, 2, 7], ['Stripe payout reconciliation'])).toEqual([]);
  });

  it('hallucinate_number fault is caught by the narrate guard and repaired', async () => {
    const provider = new MockProvider({ faultMode: 'hallucinate_number', faultCount: 1 });
    const client = new LlmClient({ provider, sleep: noSleep });
    const facts = factsFrom(0);
    const n = await narrateFinding(client, facts);
    expect(provider.calls).toBe(2);
    expect(n.body).not.toMatch(/37\.5/);
  });

  it('persistent hallucination fails narration with LlmOutputError', async () => {
    const client = new LlmClient({ provider: new MockProvider({ faultMode: 'hallucinate_number' }), sleep: noSleep });
    await expect(narrateFinding(client, factsFrom(0))).rejects.toBeInstanceOf(LlmOutputError);
  });
});

describe('LlmClient cache', () => {
  it('cache hits avoid provider calls', async () => {
    const provider = new MockProvider();
    const client = new LlmClient({ provider });
    const a = await narrateFinding(client, factsFrom(0));
    const b = await narrateFinding(client, factsFrom(0));
    expect(a).toEqual(b);
    expect(provider.calls).toBe(1);
    expect(client.usage()).toMatchObject({ calls: 1, cacheHits: 1 });
  });

  it('key includes the prompt and schema', async () => {
    const provider = new ScriptedProvider([ok({ a: 'x' })]);
    const client = new LlmClient({ provider });
    const base = { system: 's', prompt: 'p', task: 't' };
    await client.generateStructured({ ...base, schema: z.object({ a: z.string() }) });
    await client.generateStructured({ ...base, prompt: 'p2', schema: z.object({ a: z.string() }) });
    await client.generateStructured({ ...base, schema: z.object({ a: z.string().max(5) }) });
    await client.generateStructured({ ...base, schema: z.object({ a: z.string() }) });
    expect(provider.calls.length).toBe(3);
  });

  it('a shared external cache is used across clients; null disables caching', async () => {
    const cache = new MemoryLruCache(10);
    const p1 = new MockProvider();
    const p2 = new MockProvider();
    await narrateFinding(new LlmClient({ provider: p1, cache }), factsFrom(1));
    await narrateFinding(new LlmClient({ provider: p2, cache }), factsFrom(1));
    expect(p2.calls).toBe(0);
    const p3 = new MockProvider();
    const c3 = new LlmClient({ provider: p3, cache: null });
    await narrateFinding(c3, factsFrom(1));
    await narrateFinding(c3, factsFrom(1));
    expect(p3.calls).toBe(2);
  });

  it('LRU evicts the least recently used entry', async () => {
    const c = new MemoryLruCache(2);
    const e = { data: 1, text: '', model: 'm', provider: 'p', createdAt: '' };
    await c.set('a', e);
    await c.set('b', e);
    await c.get('a');
    await c.set('c', e);
    expect(await c.get('b')).toBeUndefined();
    expect(await c.get('a')).toBeDefined();
  });
});

describe('LlmClient retries', () => {
  it('retries transient errors with backoff, then succeeds', async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const provider = new MockProvider({ faultMode: 'transient_error', faultCount: 2 });
    const client = new LlmClient({ provider, sleep, random: () => 0.5, retry: { baseDelayMs: 100, maxDelayMs: 1000 } });
    await narrateFinding(client, factsFrom(0));
    expect(provider.calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([75, 150]);
  });

  it('gives up after maxAttempts', async () => {
    const provider = new MockProvider({ faultMode: 'transient_error' });
    const client = new LlmClient({ provider, sleep: noSleep, retry: { maxAttempts: 3 } });
    await expect(narrateFinding(client, factsFrom(0))).rejects.toMatchObject({ code: 'rate_limited' });
    expect(provider.calls).toBe(3);
  });

  it('does not retry non-transient errors', async () => {
    const provider = new MockProvider({ faultMode: 'fatal_error' });
    const client = new LlmClient({ provider, sleep: noSleep });
    await expect(narrateFinding(client, factsFrom(0))).rejects.toBeInstanceOf(LlmError);
    expect(provider.calls).toBe(1);
  });

  it('honours retry-after and caps at maxDelayMs', async () => {
    const client = new LlmClient({ provider: new MockProvider(), random: () => 0, retry: { baseDelayMs: 100, maxDelayMs: 5000 } });
    expect(client.backoffMs(1)).toBe(50);
    expect(client.backoffMs(1, 2000)).toBe(2000);
    expect(client.backoffMs(10, 60_000)).toBe(5000);
  });

  it('treats raw status errors (e.g. 503) as transient', async () => {
    let n = 0;
    const provider = new ScriptedProvider([
      () => {
        n++;
        throw Object.assign(new Error('overloaded'), { status: 529 });
      },
      ok({ headline: 'h', body: 'b' }),
    ]);
    const client = new LlmClient({ provider, sleep: noSleep });
    const r = await client.generateStructured({ schema: Narrative, system: 's', prompt: 'p', task: 't' });
    expect(n).toBe(1);
    expect(r.data.headline).toBe('h');
  });
});

describe('LlmClient repair', () => {
  it('repairs bad JSON once, sending the error back', async () => {
    const provider = new MockProvider({ faultMode: 'bad_json', faultCount: 1 });
    const client = new LlmClient({ provider, sleep: noSleep });
    const n = await narrateFinding(client, factsFrom(0));
    expect(provider.calls).toBe(2);
    expect(n.headline.length).toBeGreaterThan(0);
  });

  it('repair message contains the issues and ends on a user turn', async () => {
    const provider = new ScriptedProvider([ok({ headline: 5 }), ok({ headline: 'fixed', body: 'ok' })]);
    const client = new LlmClient({ provider, sleep: noSleep });
    const r = await client.generateStructured({ schema: Narrative, system: 's', prompt: 'p', task: 't' });
    expect(r).toMatchObject({ repaired: true, calls: 2, data: { headline: 'fixed' } });
    const second = provider.calls[1]!;
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[2]!.content).toMatch(/headline/);
  });

  it('fails after a single repair', async () => {
    const provider = new MockProvider({ faultMode: 'schema_violation' });
    const client = new LlmClient({ provider, sleep: noSleep });
    await expect(narrateFinding(client, factsFrom(0))).rejects.toBeInstanceOf(LlmOutputError);
    expect(provider.calls).toBe(2);
  });

  it('parses fenced JSON from text when the provider gives no json', async () => {
    const provider = new ScriptedProvider([
      () => ({ text: 'Here:\n```json\n{"headline":"a","body":"b"}\n```', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' }),
    ]);
    const r = await new LlmClient({ provider }).generateStructured({ schema: Narrative, system: 's', prompt: 'p', task: 't' });
    expect(r.data).toEqual({ headline: 'a', body: 'b' });
  });
});

describe('cost accounting', () => {
  it('prices by model per million tokens', () => {
    const c = costOf('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000, cacheWriteTokens: 200_000 });
    // 2 + 1 + 0.05 + 0.5
    expect(c.known).toBe(true);
    expect(c.costUsd).toBeCloseTo(3.55, 10);
    expect(costOf('claude-opus-5-5', { inputTokens: 2000, outputTokens: 1000 }).costUsd).toBeCloseTo(0.008 + 0.02, 10);
  });

  it('resolves dated / platform-prefixed ids and flags unknown models', () => {
    expect(priceFor('anthropic.claude-haiku-5-5')).toEqual(priceFor('claude-haiku-5-5'));
    expect(priceFor('claude-sonnet-5-20260101')).toEqual(priceFor('claude-sonnet-5'));
    expect(costOf('gpt-x', { inputTokens: 1e6, outputTokens: 1e6 })).toEqual({ costUsd: 0, known: false });
  });

  it('usage() sums calls, tokens and cost; cache hits are free', async () => {
    const provider = new ScriptedProvider([
      ok({ headline: 'h', body: 'b' }, { inputTokens: 1000, outputTokens: 500 }),
      ok({ headline: 'h2', body: 'b' }, { inputTokens: 3000, outputTokens: 100 }),
    ]);
    const client = new LlmClient({ provider });
    const args = { schema: Narrative, system: 's', task: 't' };
    await client.generateStructured({ ...args, prompt: 'one' });
    await client.generateStructured({ ...args, prompt: 'two' });
    await client.generateStructured({ ...args, prompt: 'one' });
    const u = client.usage();
    expect(u).toMatchObject({ calls: 2, cacheHits: 1, inputTokens: 4000, outputTokens: 600, costUnknown: false });
    expect(u.costUsd).toBeCloseTo((4000 * 2 + 600 * 10) / 1e6, 12);
  });

  it('unknown model costs 0 and is flagged', async () => {
    const provider = new ScriptedProvider([() => ({ text: '{"headline":"h","body":"b"}', usage: { inputTokens: 10, outputTokens: 10 }, model: 'mystery-1' })]);
    const client = new LlmClient({ provider });
    await client.generateStructured({ schema: Narrative, system: 's', prompt: 'p', task: 't' });
    expect(client.usage()).toMatchObject({ costUsd: 0, costUnknown: true, unpricedModels: ['mystery-1'] });
  });

  it('mock costs nothing and is not flagged', async () => {
    const client = createLlmClient({ provider: 'mock' });
    await narrateFinding(client, factsFrom(0));
    expect(client.usage()).toMatchObject({ calls: 1, costUsd: 0, costUnknown: false });
    expect(client.usage().inputTokens).toBeGreaterThan(0);
  });
});

describe('createLlmClient', () => {
  it('defaults to mock and reads LLM_PROVIDER', () => {
    expect(createLlmClient({ env: {} }).providerName).toBe('mock');
    const c = createLlmClient({ env: { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'claude-haiku-5-5' } });
    expect(c.providerName).toBe('anthropic');
    expect(c.model).toBe('claude-haiku-5-5');
    expect(() => createLlmClient({ env: { LLM_PROVIDER: 'gpt' } })).toThrow(/Unknown LLM_PROVIDER/);
  });

  it('anthropic provider defaults to claude-sonnet-5-5 and never exposes the key', () => {
    const c = createLlmClient({ provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-ant-secret-value' } });
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(JSON.stringify(c.provider)).not.toContain('sk-ant-secret-value');
    expect(inspect(c.provider, { depth: 10 })).not.toContain('sk-ant-secret-value');
    expect(inspect(c, { depth: 10 })).not.toContain('sk-ant-secret-value');
  });
});
