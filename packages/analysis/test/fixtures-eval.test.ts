import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActivityEvent, GroundTruth } from '@tracer/schema';
import { evaluatePersona, summarize, type PersonaEval } from '../src/index.js';

const DATA = resolve(import.meta.dirname, '../../fixtures/data');
const personas = existsSync(DATA)
  ? readdirSync(DATA).filter((d) => existsSync(join(DATA, d, 'events.json')) && existsSync(join(DATA, d, 'ground-truth.json')))
  : [];

// Runs only when the fixtures package is present in the checkout.
describe.skipIf(personas.length === 0)('real fixture personas', () => {
  it('meets recall >= 0.8 and precision >= 0.75 (micro-averaged)', async () => {
    const results: PersonaEval[] = [];
    for (const p of personas) {
      const events = (JSON.parse(readFileSync(join(DATA, p, 'events.json'), 'utf8')) as unknown[]).map((e) => ActivityEvent.parse(e));
      const gt = GroundTruth.parse(JSON.parse(readFileSync(join(DATA, p, 'ground-truth.json'), 'utf8')));
      results.push(await evaluatePersona(events, gt));
    }
    const s = summarize(results);
    expect(s.recall).toBeGreaterThanOrEqual(0.8);
    expect(s.precision).toBeGreaterThanOrEqual(0.75);
  });
});
