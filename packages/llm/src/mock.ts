import { sha256 } from './cache.js';
import { fmt, isAllowed } from './numbers.js';
import { parseFacts, parseTask, TASKS } from './prompts.js';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types.js';

export type MockFaultMode = 'hallucinate_number' | 'bad_json' | 'schema_violation' | 'transient_error' | 'fatal_error';

export interface MockProviderOptions {
  model?: string;
  faultMode?: MockFaultMode;
  /** How many calls the fault applies to before the mock behaves (default: every call). */
  faultCount?: number;
}

/** Shape the mock expects inside <facts> for the finding task. */
interface FindingFactsLike {
  label?: string;
  path?: { label?: string; appKey?: string }[];
  metrics?: { occurrences?: number; daysSeen?: number; avgMinutes?: number; weeklyHours?: number; totalMinutes?: number };
  score?: {
    inputs?: { daysObserved?: number; riskFlags?: string[] };
    outputs?: { automationPotential?: number; confidence?: number; confidenceLabel?: string; reclaimableHoursPerWeek?: number };
  };
  recipeTitle?: string;
  topToolNames?: string[];
  allowedNumbers?: number[];
}

interface SummaryFactsLike {
  reclaimableHoursPerWeek?: number;
  daysObserved?: number;
  findingCount?: number;
  topFindingLabel?: string | null;
  topFindingHoursPerWeek?: number;
  allowedNumbers?: number[];
}

/** mulberry32 seeded from a hex digest: deterministic, tiny, good enough for picking variants. */
function rng(seedHex: string): () => number {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length] as T;

const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

/** Fit sentences into a char budget, dropping from the end. */
function fit(sentences: string[], max: number): string {
  const out: string[] = [];
  for (const s of sentences) {
    const next = [...out, s].join(' ');
    if (next.length > max) break;
    out.push(s);
  }
  return out.join(' ');
}

/**
 * Deterministic offline provider. Writes varied-but-stable prose from the facts in the
 * prompt (variants chosen by a hash of the input) and only uses numbers from the
 * facts' allowedNumbers. Fault modes exist for tests.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model: string;
  private readonly faultMode: MockFaultMode | undefined;
  private faultsLeft: number;
  /** Number of generate() calls received (for tests). */
  calls = 0;

  constructor(opts: MockProviderOptions = {}) {
    this.model = opts.model ?? 'mock-1';
    this.faultMode = opts.faultMode;
    this.faultsLeft = opts.faultCount ?? Number.POSITIVE_INFINITY;
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    const prompt = req.messages.find((m) => m.role === 'user')?.content ?? '';
    const inputText = `${req.system}\n${req.messages.map((m) => `${m.role}:${m.content}`).join('\n')}`;
    const seed = sha256(`${req.system}\n${prompt}`);
    const task = req.task ?? parseTask(prompt);
    const facts = parseFacts(prompt);

    let fault: MockFaultMode | undefined;
    if (this.faultMode && this.faultsLeft > 0) {
      this.faultsLeft--;
      fault = this.faultMode;
    }
    if (fault === 'transient_error') {
      throw new LlmError('mock: simulated 429 rate limit', { code: 'rate_limited', transient: true, status: 429 });
    }
    if (fault === 'fatal_error') {
      throw new LlmError('mock: simulated 400 bad request', { code: 'bad_request', status: 400 });
    }

    let value: unknown;
    if (task === TASKS.finding) value = this.findingNarrative((facts ?? {}) as FindingFactsLike, seed);
    else if (task === TASKS.summary) value = this.summaryNarrative((facts ?? {}) as SummaryFactsLike, seed);
    else value = req.jsonSchema ? exampleFromSchema(req.jsonSchema) : { text: 'mock response' };

    if (fault === 'hallucinate_number' && value && typeof value === 'object' && 'body' in value) {
      const allowed = ((facts as { allowedNumbers?: number[] } | undefined)?.allowedNumbers ?? []) as number[];
      const bogus = [37.5, 913, 4242, 61.7].find((n) => !isAllowed({ value: n, kind: 'number' }, allowed)) ?? 98765;
      const v = value as { headline: string; body: string };
      v.body = `${v.body} That adds up to ${fmt(bogus)} hours a month.`.slice(0, 1200);
    }
    if (fault === 'schema_violation') value = { headline: 42 };

    let text = req.jsonSchema || task ? JSON.stringify(value) : String((value as { text?: string }).text ?? '');
    if (fault === 'bad_json') text = text.slice(0, Math.max(1, Math.floor(text.length / 2)));

    const res: LlmResponse = {
      text,
      usage: { inputTokens: approxTokens(inputText), outputTokens: approxTokens(text) },
      model: this.model,
    };
    if (fault !== 'bad_json' && (req.jsonSchema || task)) res.json = value;
    return res;
  }

  private findingNarrative(f: FindingFactsLike, seed: string): { headline: string; body: string } {
    const r = rng(seed);
    const allowed = f.allowedNumbers ?? [];
    const n = (v: number | undefined): string | undefined =>
      v !== undefined && isAllowed({ value: v, kind: 'number' }, allowed) ? fmt(v) : undefined;

    const label = f.label?.trim() || 'This workflow';
    const o = f.score?.outputs ?? {};
    const m = f.metrics ?? {};
    const R = n(o.reclaimableHoursPerWeek);
    const W = n(m.weeklyHours);
    const occ = n(m.occurrences);
    const daysSeen = n(m.daysSeen);
    const daysObs = n(f.score?.inputs?.daysObserved);

    const headlines: string[] = [];
    if (R) headlines.push(`${label}: about ${R} h/week you could get back`, `Automate "${label}" and win back ${R} h a week`);
    if (W) headlines.push(`${label} takes ${W} hours of your week`);
    if (occ && daysSeen) headlines.push(`${label}, ${occ} times on ${daysSeen} days`);
    headlines.push(`${label} repeats often enough to automate`);
    let headline = pick(r, headlines);
    if (headline.length > 140) headline = R ? `One routine worth ${R} h/week` : 'One routine worth automating';

    const steps = (f.path ?? []).map((s) => s.label ?? s.appKey ?? '').filter(Boolean);
    const shown = steps.slice(0, 5);
    const more = steps.length > shown.length ? ', and so on' : '';
    const pathSentence = shown.length
      ? pick(r, [
          `The routine: ${shown.join(', then ')}${more}.`,
          `Each time: ${shown.join(' → ')}${more}.`,
          `It runs the same way each time: ${shown.join(', ')}${more}.`,
        ])
      : 'The steps were the same each time.';

    const freq =
      occ && daysSeen && daysObs
        ? pick(r, [
            `It happened ${occ} times across ${daysSeen} of ${daysObs} observed days.`,
            `We saw it ${occ} times, on ${daysSeen} of the ${daysObs} days.`,
          ])
        : occ
          ? `We saw it ${occ} times.`
          : 'It came up repeatedly during the audit.';

    const avg = n(m.avgMinutes);
    const time =
      avg && W
        ? pick(r, [`A typical run takes ${avg} minutes, which is ${W} hours a week.`, `Each run is about ${avg} minutes; over a week that is ${W} hours.`])
        : W
          ? `It costs ${W} hours a week.`
          : undefined;

    const AP = n(o.automationPotential);
    const conf = o.confidence !== undefined ? n(Math.round(o.confidence * 100)) : undefined;
    const label3 = o.confidenceLabel ?? 'medium';
    const scoreSentence = AP
      ? pick(r, [
          `Automation potential scores ${AP}${conf ? `, and confidence that this is a real routine is ${conf}%` : ''}.`,
          `It scores ${AP} for automation potential${label3 !== 'high' ? `; confidence is ${label3}` : ''}.`,
        ])
      : undefined;

    const recipe = f.recipeTitle ? pick(r, [`The recipe "${f.recipeTitle}" covers the repeatable part.`, `Start with the recipe "${f.recipeTitle}".`]) : undefined;
    const tools = f.topToolNames?.length
      ? f.topToolNames.length === 1
        ? `${f.topToolNames[0]} fits it.`
        : pick(r, [`Tools that fit: ${f.topToolNames.slice(0, 3).join(', ')}.`, `${f.topToolNames[0]} is the closest fit; ${f.topToolNames.slice(1, 3).join(' and ')} also ${f.topToolNames.length === 2 ? 'works' : 'work'}.`])
      : undefined;
    const risky = (f.score?.inputs?.riskFlags ?? []).length > 0;
    const keep = risky
      ? 'Keep a person on the steps that move money or touch personal data.'
      : pick(r, ['Keep the final check manual.', 'Leave the judgement calls to yourself.']);
    const reclaim = R ? `Expect roughly ${R} h/week back once it runs.` : undefined;
    const lowConf = label3 === 'low' ? 'Confidence is low, so watch it for another week first.' : undefined;

    const body = fit(
      [pathSentence, freq, time, scoreSentence, recipe, tools, reclaim, keep, lowConf].filter((s): s is string => !!s),
      1200,
    );
    return { headline, body };
  }

  private summaryNarrative(s: SummaryFactsLike, seed: string): { headline: string; body: string } {
    const r = rng(seed);
    const allowed = s.allowedNumbers ?? [];
    const n = (v: number | undefined): string | undefined =>
      v !== undefined && isAllowed({ value: v, kind: 'number' }, allowed) ? fmt(v) : undefined;
    const R = n(s.reclaimableHoursPerWeek);
    const days = n(s.daysObserved);
    const count = s.findingCount ?? 0;
    const cnt = n(count);
    const top = s.topFindingLabel ?? undefined;

    if (count === 0) {
      return {
        headline: 'No repeated workflow was big enough to report',
        body: fit(
          [
            days ? `Tracer watched ${days} days of your work.` : 'Tracer watched your work for the audit window.',
            'Nothing repeated often enough to be worth automating yet.',
            'A longer window may show more.',
          ],
          1200,
        ),
      };
    }
    const wf = count === 1 ? 'workflow' : 'workflows';
    const headline = R
      ? pick(r, [`About ${R} hours a week look automatable`, `${R} h/week of repeat work you could hand off`, `You could get back ${R} hours a week`])
      : 'Some of your repeat work could be automated';
    const topHours = n(s.topFindingHoursPerWeek);
    const body = fit(
      [
        days && cnt ? `Over ${days} days, Tracer found ${cnt} repeated ${wf}.` : `Tracer found repeated ${wf} in your week.`,
        top ? (topHours ? `The biggest is "${top}", at ${topHours} h/week.` : `The biggest is "${top}".`) : undefined,
        pick(r, [
          'Figures are estimates from observed time, after a haircut for review and exceptions.',
          'These are estimates from the time we observed, discounted because automation never takes all of it.',
        ]),
        'Each finding has a recipe you can follow yourself.',
      ].filter((x): x is string => !!x),
      1200,
    );
    return { headline, body };
  }
}

/** Minimal value satisfying a JSON schema (for unknown tasks). */
function exampleFromSchema(schema: object): unknown {
  const s = schema as { type?: string | string[]; properties?: Record<string, object>; enum?: unknown[]; const?: unknown };
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) out[k] = exampleFromSchema(v);
      return out;
    }
    case 'array':
      return [];
    case 'string':
      return 'mock';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}
