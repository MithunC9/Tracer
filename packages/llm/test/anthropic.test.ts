import { Narrative } from '@tracer/schema';
import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  LlmClient,
  LlmError,
  narrateFinding,
  sanitizeSchema,
  jsonSchemaOf,
  validateReport,
} from '../src/index.js';
import { buildReport } from './fixtures/report.js';

const KEY = 'sk-ant-test-key-do-not-log';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function message(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
    ...extra,
  };
}

function stubFetch(responses: Array<() => Response | Promise<Response>>, captured: Captured[]): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    captured.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? '{}')) });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return r();
  }) as typeof fetch;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const req = {
  system: 'You write prose.',
  messages: [{ role: 'user' as const, content: 'Task: x' }],
  maxTokens: 1000,
  temperature: 0.3,
  jsonSchema: jsonSchemaOf(Narrative),
};

describe('AnthropicProvider (stubbed fetch through the real SDK)', () => {
  it('sends structured output, cached system prompt, fallback beta; maps usage', async () => {
    const cap: Captured[] = [];
    const p = new AnthropicProvider({
      apiKey: KEY,
      fetch: stubFetch([json(200, message('{"headline":"h","body":"b"}'))], cap),
      env: {},
    });
    const res = await p.generate(req);
    expect(res).toEqual({
      text: '{"headline":"h","body":"b"}',
      json: { headline: 'h', body: 'b' },
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 1200, outputTokens: 150, cacheReadTokens: 800, cacheWriteTokens: 0 },
    });
    const { body, headers, url } = cap[0]!;
    expect(url).toMatch(/\/v1\/messages/);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBeUndefined();
    expect(body.system).toEqual([{ type: 'text', text: 'You write prose.', cache_control: { type: 'ephemeral' } }]);
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    const schema = body.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$schema).toBeUndefined();
    expect(JSON.stringify(schema)).not.toMatch(/maxLength/);
    expect(body.fallbacks).toBe('default');
    expect(body.tool_choice).toBeUndefined();
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('uses the plain endpoint for models without server-side fallback', async () => {
    const cap: Captured[] = [];
    const p = new AnthropicProvider({ apiKey: KEY, model: 'claude-haiku-5-5', fetch: stubFetch([json(200, message('{}'))], cap), env: {} });
    await p.generate(req);
    expect(cap[0]!.body.fallbacks).toBeUndefined();
    expect(cap[0]!.headers['anthropic-beta']).toBeUndefined();
    expect(cap[0]!.body.model).toBe('claude-haiku-5-5');
  });

  it('reads ANTHROPIC_MODEL and ANTHROPIC_API_KEY from env', async () => {
    const cap: Captured[] = [];
    const p = new AnthropicProvider({
      env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: 'claude-opus-5-5' },
      fetch: stubFetch([json(200, message('{}'))], cap),
    });
    expect(p.model).toBe('claude-opus-5-5');
    await p.generate(req);
    expect(cap[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('maps 429 to a transient error with retry-after', async () => {
    const cap: Captured[] = [];
    const p = new AnthropicProvider({
      apiKey: KEY,
      fetch: stubFetch([json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, { 'retry-after': '3' })], cap),
      env: {},
    });
    const err = await p.generate(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: 'rate_limited', transient: true, status: 429, retryAfterMs: 3000 });
    expect(String(err.message)).not.toContain(KEY);
    expect(cap.length).toBe(1); // SDK retries disabled; LlmClient owns them
  });

  it('maps 529/500 to transient and 400 to non-transient', async () => {
    const mk = (status: number) =>
      new AnthropicProvider({
        apiKey: KEY,
        fetch: stubFetch([json(status, { type: 'error', error: { type: 'x', message: 'x' } })], []),
        env: {},
      });
    await expect(mk(529).generate(req)).rejects.toMatchObject({ transient: true, code: 'server_error' });
    await expect(mk(500).generate(req)).rejects.toMatchObject({ transient: true });
    await expect(mk(400).generate(req)).rejects.toMatchObject({ transient: false, code: 'bad_request' });
    await expect(mk(401).generate(req)).rejects.toMatchObject({ transient: false, code: 'auth' });
  });

  it('times out as a transient error', async () => {
    const hang: typeof fetch = ((_u: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as typeof fetch;
    const p = new AnthropicProvider({ apiKey: KEY, fetch: hang, timeoutMs: 50, env: {} });
    await expect(p.generate(req)).rejects.toMatchObject({ code: 'timeout', transient: true });
  });

  it('a refusal is a non-transient error', async () => {
    const p = new AnthropicProvider({
      apiKey: KEY,
      fetch: stubFetch([json(200, message('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }))], []),
      env: {},
    });
    await expect(p.generate(req)).rejects.toMatchObject({ code: 'refusal', transient: false });
  });

  it('LlmClient retries a 529 then narrates; output passes the validator', async () => {
    const report = buildReport();
    const f = report.findings[0]!;
    const good = { headline: `${f.label}: ${f.score.outputs.reclaimableHoursPerWeek} h/week`, body: `It ran ${f.metrics.occurrences} times.` };
    const cap: Captured[] = [];
    const provider = new AnthropicProvider({
      apiKey: KEY,
      fetch: stubFetch([json(529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), json(200, message(JSON.stringify(good)))], cap),
      env: {},
    });
    const client = new LlmClient({ provider, sleep: () => Promise.resolve() });
    const n = await narrateFinding(client, {
      label: f.label,
      path: f.path,
      metrics: f.metrics,
      score: f.score,
      recipeTitle: f.recipe.title,
      topToolNames: f.tools.map((t) => t.name),
      allowedNumbers: f.allowedNumbers,
    });
    expect(n).toEqual(good);
    expect(cap.length).toBe(2);
    expect(cap[1]!.body.messages[0].content).toContain('<facts>');
    const u = client.usage();
    expect(u).toMatchObject({ calls: 2, inputTokens: 1200, outputTokens: 150, cacheReadTokens: 800 });
    expect(u.costUsd).toBeCloseTo((1200 * 2 + 150 * 10 + 800 * 0.1) / 1e6, 12);
    f.narrative = n;
    expect(validateReport(report).passed).toBe(true);
  });
});

describe('sanitizeSchema', () => {
  it('strips unsupported keywords and closes objects', () => {
    const s = sanitizeSchema({
      $schema: 'x',
      type: 'object',
      properties: { a: { type: 'string', maxLength: 3, pattern: 'x' }, n: { type: 'number', minimum: 0 }, o: { type: 'object', properties: {} } },
    }) as any;
    expect(s).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, n: { type: 'number' }, o: { type: 'object', properties: {}, additionalProperties: false, required: [] } },
      additionalProperties: false,
      required: ['a', 'n', 'o'],
    });
  });
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('AnthropicProvider (live)', () => {
  it('narrates a finding with the real API and passes the validator', { timeout: 120_000 }, async () => {
    const report = buildReport();
    const f = report.findings[0]!;
    const client = new LlmClient({ provider: new AnthropicProvider() });
    f.narrative = await narrateFinding(client, {
      label: f.label,
      path: f.path,
      metrics: f.metrics,
      score: f.score,
      recipeTitle: f.recipe.title,
      topToolNames: f.tools.map((t) => t.name),
      allowedNumbers: f.allowedNumbers,
    });
    const r = validateReport(report);
    expect(r.errors).toEqual([]);
    expect(client.usage().calls).toBeGreaterThan(0);
  });
});
