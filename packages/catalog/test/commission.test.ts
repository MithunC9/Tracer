import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AFFILIATE_DISCLOSURE, CatalogEntry, RankedTool } from '@tracer/schema';
import { AFFILIATES, CATALOG, attachAffiliates, rankTools, recommendTools } from '../src/index.js';
import { affiliatesArb, constraintsArb, requirementsArb } from './arbitraries.js';

/**
 * Commission independence. Honest ranking is a hard product requirement: affiliate data
 * may decorate a result but can never change which tools appear, their order, or their scores.
 */

const strip = (xs: readonly { entryId: string; rank: number; fitScore: number; reasons: unknown }[]) =>
  xs.map(({ entryId, rank, fitScore, reasons }) => ({ entryId, rank, fitScore, reasons }));

describe('commission independence', () => {
  it('(a) ranked ids, ranks, fit scores and reasons are identical with any affiliate registry', () => {
    fc.assert(
      fc.property(requirementsArb, constraintsArb, affiliatesArb, affiliatesArb, fc.integer({ min: 1, max: 15 }), (req, c, regA, regB, limit) => {
        const baseline = strip(rankTools(req, CATALOG, c, { limit }));
        const withA = strip(recommendTools(req, c, { limit, affiliates: regA }));
        const withB = strip(recommendTools(req, c, { limit, affiliates: regB }));
        const withNone = strip(recommendTools(req, c, { limit, affiliates: [] }));
        const withDefault = strip(recommendTools(req, c, { limit }));
        expect(withA).toEqual(baseline);
        expect(withB).toEqual(baseline);
        expect(withNone).toEqual(baseline);
        expect(withDefault).toEqual(baseline);
      }),
      { numRuns: 400, seed: 20261120 },
    );
  });

  it('(a2) a registry offering 100% commission on the worst-fit tool does not lift it', () => {
    const req = { capabilities: ['email_templates' as const], apps: ['gmail'], trigger: 'manual' as const, involvesJudgement: false };
    const c = { platform: 'macos' as const, budget: 'any' as const, skill: 'none' as const, preferOpenSource: false };
    const all = rankTools(req, CATALOG, c, { limit: 100 });
    const last = all[all.length - 1]!;
    const greedy = CATALOG.map((e) => ({ entryId: e.id, url: 'https://partners.example.com/x', programName: 'P', commissionRate: e.id === last.entryId ? 1 : 0 }));
    const out = recommendTools(req, c, { limit: 100, affiliates: greedy });
    expect(out.map((t) => t.entryId)).toEqual(all.map((t) => t.entryId));
    expect(out[out.length - 1]!.entryId).toBe(last.entryId);
  });

  it('(b) rank.ts does not import the affiliate registry or mention commission', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/rank.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/commission/i);
    // The only allowed mention is omitting the output field: Omit<RankedTool, 'affiliate'>.
    expect(src.replace("Omit<RankedTool, 'affiliate'>", '')).not.toMatch(/affiliate/i);
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.every((p) => p === '@tracer/schema')).toBe(true);
  });

  it('(c) rankTools has arity 3: no parameter slot for commission input', () => {
    expect(rankTools.length).toBe(3);
  });

  it('CatalogEntry stays strict: commission fields are rejected', () => {
    const r = CatalogEntry.safeParse({ ...CATALOG[0], commissionRate: 0.3 });
    expect(r.success).toBe(false);
  });

  it('attachAffiliates never reorders, only adds url + fixed disclosure, never the rate', () => {
    fc.assert(
      fc.property(requirementsArb, constraintsArb, affiliatesArb, (req, c, reg) => {
        const ranked = rankTools(req, CATALOG, c, { limit: 10 });
        const out = attachAffiliates(ranked, reg);
        expect(out.length).toBe(ranked.length);
        out.forEach((t, i) => {
          const { affiliate, ...rest } = t;
          expect(rest).toEqual(ranked[i]);
          if (affiliate) {
            expect(Object.keys(affiliate).sort()).toEqual(['disclosure', 'url']);
            expect(affiliate.disclosure).toBe(AFFILIATE_DISCLOSURE);
            expect(reg.find((a) => a.entryId === t.entryId)?.url).toBe(affiliate.url);
          } else {
            expect(reg.some((a) => a.entryId === t.entryId)).toBe(false);
          }
          expect(JSON.stringify(t)).not.toMatch(/commissionRate|programName/);
          RankedTool.parse(t);
        });
      }),
      { numRuns: 200, seed: 7 },
    );
  });

  it('the shipped registry references real entries and is marked as placeholder', () => {
    const ids = new Set(CATALOG.map((e) => e.id));
    for (const a of AFFILIATES) {
      expect(ids.has(a.entryId)).toBe(true);
      expect(a.programName).toMatch(/PLACEHOLDER/);
      expect(new URL(a.url).hostname.endsWith('example.com')).toBe(true);
    }
  });
});
