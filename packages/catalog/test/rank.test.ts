import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FitReason } from '@tracer/schema';
import type { CatalogEntry, ClusterRequirements, UserConstraints } from '@tracer/schema';
import { CATALOG, CATALOG_BY_ID, rankTools } from '../src/index.js';
import { constraintsArb, requirementsArb } from './arbitraries.js';

const C = (over: Partial<UserConstraints> = {}): UserConstraints => ({ platform: 'macos', budget: 'any', skill: 'some', preferOpenSource: false, ...over });
const R = (over: Partial<ClusterRequirements> = {}): ClusterRequirements => ({ capabilities: ['email_templates'], apps: [], trigger: 'manual', involvesJudgement: false, ...over });
const ids = (req: ClusterRequirements, c: UserConstraints, limit = 5) => rankTools(req, CATALOG, c, { limit }).map((t) => t.entryId);
const entry = (id: string) => CATALOG_BY_ID.get(id)!;

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('rankTools: sensibility', () => {
  it('Gmail reply-template workflow on a free budget: Gmail templates first, free text expanders near the top', () => {
    const top = ids(R({ capabilities: ['email_templates'], apps: ['gmail'] }), C({ budget: 'free_only', skill: 'none' }), 4);
    expect(top[0]).toBe('gmail-filters-templates');
    expect(top.some((id) => ['espanso', 'raycast-snippets'].includes(id))).toBe(true);
    for (const id of top) expect(entry(id).pricingTier).not.toBe('paid');
  });

  it('Windows users never get Apple Shortcuts, Hazel or other macOS-only tools', () => {
    fc.assert(
      fc.property(requirementsArb, constraintsArb, (req, c) => {
        const out = rankTools(req, CATALOG, { ...c, platform: 'windows' }, { limit: 100 });
        for (const t of out) {
          const p = entry(t.entryId).platforms;
          expect(p.includes('windows') || p.includes('web'), t.entryId).toBe(true);
        }
        expect(out.some((t) => t.entryId === 'apple-shortcuts')).toBe(false);
      }),
      { numRuns: 300, seed: 1 },
    );
    expect(ids(R({ capabilities: ['file_move', 'desktop_automation'] }), C({ platform: 'windows' }), 100)).not.toContain('apple-shortcuts');
  });

  it('free_only budget never returns paid tools', () => {
    fc.assert(
      fc.property(requirementsArb, constraintsArb, (req, c) => {
        for (const t of rankTools(req, CATALOG, { ...c, budget: 'free_only' }, { limit: 100 })) expect(t.pricingTier).not.toBe('paid');
      }),
      { numRuns: 300, seed: 2 },
    );
  });

  it('bank reconciliation in QuickBooks: QuickBooks bank rules first, Xero rules excluded', () => {
    const out = ids(R({ capabilities: ['bank_reconcile'], apps: ['quickbooks', 'bank_portal'] }), C(), 10);
    expect(out[0]).toBe('quickbooks-bank-rules');
    expect(out).not.toContain('xero-bank-rules');
  });

  it('native features of apps the workflow does not use are excluded', () => {
    const out = ids(R({ capabilities: ['trigger_email', 'email_parse'], apps: ['outlook'] }), C(), 100);
    expect(out).toContain('outlook-rules-quick-parts');
    expect(out).not.toContain('gmail-filters-templates');
  });

  it('CRM products only appear for CRM work', () => {
    expect(ids(R({ capabilities: ['email_templates'], apps: ['gmail'] }), C(), 100)).not.toContain('hubspot-free-crm');
    expect(ids(R({ capabilities: ['crm_sync'], apps: ['gmail', 'hubspot'] }), C(), 5)).toContain('hubspot-free-crm');
  });

  it('file sorting on a Mac ranks Hazel first', () => {
    expect(ids(R({ capabilities: ['trigger_file', 'file_move'], apps: ['finder'] }), C({ skill: 'none' }), 3)[0]).toBe('hazel');
  });

  it('CSV cleanup in Excel on Windows puts Power Query in the top 5', () => {
    expect(ids(R({ capabilities: ['csv_transform', 'spreadsheet_rw'], apps: ['excel'] }), C({ platform: 'windows' }))).toContain('excel-power-query');
  });

  it('meeting notes ranks meeting tools above general AI assistants', () => {
    const out = ids(R({ capabilities: ['meeting_notes', 'transcription'], apps: ['zoom'], involvesJudgement: true }), C(), 3);
    for (const id of out) expect(entry(id).category).toBe('meetings');
  });

  it('AI assistants get a penalty when no judgement is needed and a rule-based tool covers the job', () => {
    const req = R({ capabilities: ['csv_transform'], apps: [], involvesJudgement: false });
    const t = rankTools(req, CATALOG, C(), { limit: 100 }).find((x) => x.entryId === 'claude')!;
    const pen = t.reasons.find((r) => r.delta < 0 && r.factor === 'capability');
    expect(pen?.delta).toBe(-10);
    const withJudgement = rankTools({ ...req, involvesJudgement: true }, CATALOG, C(), { limit: 100 }).find((x) => x.entryId === 'claude')!;
    expect(withJudgement.fitScore).toBeGreaterThan(t.fitScore);
  });

  it('preferring open source lifts open-source tools', () => {
    const req = R({ capabilities: ['text_expansion'], apps: [] });
    const rankOf = (c: UserConstraints) => rankTools(req, CATALOG, c, { limit: 100 }).findIndex((t) => t.entryId === 'espanso');
    expect(rankOf(C({ preferOpenSource: true }))).toBeLessThanOrEqual(rankOf(C()));
    expect(rankOf(C({ preferOpenSource: true }))).toBe(0);
  });

  it('skill above the user level is penalised', () => {
    const req = R({ capabilities: ['trigger_schedule', 'code_automation'], apps: ['github'] });
    const gha = (c: UserConstraints) => rankTools(req, CATALOG, c, { limit: 100 }).find((t) => t.entryId === 'github-actions')!;
    expect(gha(C({ skill: 'technical' })).fitScore).toBeGreaterThan(gha(C({ skill: 'none' })).fitScore);
    expect(gha(C({ skill: 'none' })).reasons.find((r) => r.factor === 'skill')!.delta).toBeLessThan(0);
  });
});

describe('rankTools: properties', () => {
  it('pure and deterministic: frozen inputs, same output twice, reordered catalog gives same result', () => {
    fc.assert(
      fc.property(requirementsArb, constraintsArb, fc.integer({ min: 0, max: 1_000_000 }), (req, c, seed) => {
        const frozenReq = deepFreeze(structuredClone(req));
        const frozenC = deepFreeze(structuredClone(c));
        const a = rankTools(frozenReq, CATALOG, frozenC);
        const b = rankTools(frozenReq, CATALOG, frozenC);
        expect(a).toEqual(b);
        // shuffle deterministically
        const shuffled: CatalogEntry[] = [...CATALOG].sort((x, y) => ((hash(x.id) ^ seed) % 997) - ((hash(y.id) ^ seed) % 997));
        expect(rankTools(frozenReq, shuffled, frozenC)).toEqual(a);
      }),
      { numRuns: 200, seed: 3 },
    );
  });

  it('scores are 0..100, sorted, ranks 1..n, ties broken by id, reasons sum to score', () => {
    fc.assert(
      fc.property(requirementsArb, constraintsArb, fc.integer({ min: 1, max: 60 }), (req, c, limit) => {
        const out = rankTools(req, CATALOG, c, { limit });
        expect(out.length).toBeLessThanOrEqual(limit);
        out.forEach((t, i) => {
          expect(t.rank).toBe(i + 1);
          expect(t.fitScore).toBeGreaterThanOrEqual(0);
          expect(t.fitScore).toBeLessThanOrEqual(100);
          for (const r of t.reasons) FitReason.parse(r);
          const sum = Math.round(t.reasons.reduce((s, r) => s + r.delta, 0) * 10) / 10;
          if (sum >= 0) expect(t.fitScore).toBeCloseTo(sum, 5);
          const prev = out[i - 1];
          if (prev) {
            expect(prev.fitScore).toBeGreaterThanOrEqual(t.fitScore);
            if (prev.fitScore === t.fitScore) expect(prev.entryId < t.entryId).toBe(true);
          }
        });
      }),
      { numRuns: 300, seed: 4 },
    );
  });

  it('default limit is 5 and limit 0 returns nothing', () => {
    const req = R({ capabilities: ['spreadsheet_rw'] });
    expect(rankTools(req, CATALOG, C()).length).toBe(5);
    expect(rankTools(req, CATALOG, C(), { limit: 0 })).toEqual([]);
    expect(rankTools(req, [], C())).toEqual([]);
  });
});

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
