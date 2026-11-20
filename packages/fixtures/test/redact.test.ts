import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOSTILE_CORPUS } from '../src/hostile-corpus.js';
import { ibanValid, luhnValid, redact, truncateRedacted } from '../src/redact.js';

describe('reference redactor', () => {
  it('corpus has at least 60 cases', () => {
    expect(HOSTILE_CORPUS.length).toBeGreaterThanOrEqual(60);
  });

  for (const [i, c] of HOSTILE_CORPUS.entries()) {
    it(`corpus #${i} [${c.category}] ${JSON.stringify(c.input.slice(0, 40))}`, () => {
      const out = redact(c.input).text;
      for (const bad of c.mustNotContain) expect(out, `leaked ${bad}`).not.toContain(bad);
      for (const good of c.mustContain ?? []) expect(out, `lost ${good}`).toContain(good);
    });
  }

  it('committed data/hostile-corpus.json equals the TS corpus', () => {
    const json = JSON.parse(readFileSync(new URL('../data/hostile-corpus.json', import.meta.url), 'utf8'));
    expect(json).toEqual(JSON.parse(JSON.stringify(HOSTILE_CORPUS)));
  });

  it('counts redactions per kind', () => {
    const r = redact('mail a@b.co and c@d.io, card 4111 1111 1111 1111');
    expect(r.counts).toEqual({ email: 2, card_number: 1 });
    expect(r.text).toBe('mail [REDACTED:email] and [REDACTED:email], card [REDACTED:card_number]');
  });

  it('helpers', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(ibanValid('DE89370400440532013000')).toBe(true);
    expect(ibanValid('DE89370400440532013001')).toBe(false);
    expect(truncateRedacted('abc [REDACTED:email]', 10)).toBe('abc ');
  });

  it('is idempotent on its own output', () => {
    for (const c of HOSTILE_CORPUS) {
      const once = redact(c.input).text;
      expect(redact(once).text).toBe(once);
    }
  });
});
