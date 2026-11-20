import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatePersona, serializeCorpus } from '../src/generate.js';
import { HOSTILE_CORPUS_PATH, PERSONAS, personaPaths } from '../src/paths.js';
import { redact } from '../src/redact.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('determinism', () => {
  it('regenerating bookkeeper twice in-process is byte-identical and equals the committed files', () => {
    const a = generatePersona('bookkeeper');
    const b = generatePersona('bookkeeper');
    expect(sha(a.files.raw)).toBe(sha(b.files.raw));
    expect(sha(a.files.events)).toBe(sha(b.files.events));
    const p = personaPaths('bookkeeper');
    expect(sha(readFileSync(p.raw, 'utf8'))).toBe(sha(a.files.raw));
    expect(sha(readFileSync(p.events, 'utf8'))).toBe(sha(a.files.events));
    expect(sha(readFileSync(p.groundTruth, 'utf8'))).toBe(sha(a.files.groundTruth));
  });

  it('committed hostile-corpus.json is up to date', () => {
    expect(readFileSync(HOSTILE_CORPUS_PATH, 'utf8')).toBe(serializeCorpus());
  });
});

// FIXTURE_PERSONAS=a,b narrows the run while iterating on one persona
const LIST = (process.env.FIXTURE_PERSONAS?.split(',') ?? PERSONAS) as typeof PERSONAS;

describe.each(LIST)('%s privacy', (persona) => {
  const g = generatePersona(persona);
  const eventsText = readFileSync(personaPaths(persona).events, 'utf8');

  it('committed files match a fresh generation (run `pnpm generate` if this fails)', () => {
    expect(sha(eventsText)).toBe(sha(g.files.events));
    expect(sha(readFileSync(personaPaths(persona).raw, 'utf8'))).toBe(sha(g.files.raw));
    expect(sha(readFileSync(personaPaths(persona).groundTruth, 'utf8'))).toBe(sha(g.files.groundTruth));
  });

  it('plants secrets/PII of every kind in raw.jsonl', () => {
    expect(g.planted.length).toBeGreaterThan(20);
    const rawText = g.files.raw;
    for (const v of g.planted) expect(rawText).toContain(v);
    const kinds = new Set<string>();
    for (const v of g.planted) for (const k of Object.keys(redact(v).counts)) kinds.add(k);
    for (const k of ['email', 'phone', 'card_number']) expect(kinds).toContain(k);
  });

  it('no planted secret survives into events.json', () => {
    const leaked = g.planted.filter((v) => eventsText.includes(v));
    expect(leaked).toEqual([]);
  });

  it('every planted value is caught by the reference redactor on its own', () => {
    const contextual = new Set(g.plantedContextual);
    for (const v of g.planted.filter((x) => !contextual.has(x))) {
      const out = redact(v).text;
      expect(out, v).toContain('[REDACTED:');
      expect(out).not.toContain(v);
    }
  });

  it('redaction counts are recorded on events', () => {
    const total = g.events.reduce((s, e) => s + Object.values(e.redactions).reduce((a, b) => a + (b ?? 0), 0), 0);
    expect(total).toBeGreaterThan(50);
    expect(g.events.some((e) => (e.redactions.password_field ?? 0) > 0)).toBe(true);
  });
});
