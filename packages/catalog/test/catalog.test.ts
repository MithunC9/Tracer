import { describe, expect, it } from 'vitest';
import { APP_BY_KEY, CatalogEntry, ToolCategory } from '@tracer/schema';
import { CATALOG, CATALOG_BY_ID } from '../src/index.js';

const HYPE = /\b(supercharge|unlock|leverage|seamless(ly)?|revolutioni[sz]e|game[- ]changer)\b/i;

describe('catalog entries', () => {
  it('has at least 40 entries', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CATALOG.map((e) => [e.id, e] as const))('%s validates against the strict CatalogEntry schema', (_id, e) => {
    expect(CatalogEntry.safeParse(e).success).toBe(true);
  });

  it('ids are unique', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CATALOG_BY_ID.size).toBe(ids.length);
  });

  it('every category has entries', () => {
    for (const cat of ToolCategory.options) {
      expect(CATALOG.filter((e) => e.category === cat).length, cat).toBeGreaterThan(0);
    }
  });

  it('integrations use known AppKeys or "*"', () => {
    for (const e of CATALOG) {
      for (const k of e.integrations) expect(k === '*' || APP_BY_KEY.has(k), `${e.id}: ${k}`).toBe(true);
    }
  });

  it('native features name their host app first', () => {
    for (const e of CATALOG.filter((x) => x.category === 'native_feature')) {
      expect(APP_BY_KEY.has(e.integrations[0] ?? ''), e.id).toBe(true);
    }
  });

  it('capabilities and integrations are not duplicated within an entry', () => {
    for (const e of CATALOG) {
      expect(new Set(e.capabilities).size, e.id).toBe(e.capabilities.length);
      expect(new Set(e.integrations).size, e.id).toBe(e.integrations.length);
    }
  });

  it('AI assistants come from at least four vendors and are described evenly', () => {
    const ai = CATALOG.filter((e) => e.category === 'ai_assistant');
    expect(new Set(ai.map((e) => e.vendor)).size).toBeGreaterThanOrEqual(4);
    // Same capability set: no vendor gets a quiet advantage in ranking.
    const caps = ai.map((e) => [...e.capabilities].sort().join(','));
    expect(new Set(caps).size).toBe(1);
  });

  it('copy avoids hype words', () => {
    for (const e of CATALOG) expect(`${e.summary} ${e.priceNote} ${e.reliabilityNotes}`, e.id).not.toMatch(HYPE);
  });

  it('prices are notes, not over-precise figures', () => {
    // Allow "~$20/mo" style approximations; disallow cents like $19.99.
    for (const e of CATALOG) expect(e.priceNote, e.id).not.toMatch(/\$\d+\.\d\d/);
  });

  it('covers the platforms Windows and Linux users need', () => {
    for (const p of ['windows', 'linux'] as const) {
      expect(CATALOG.filter((e) => e.platforms.includes(p)).length, p).toBeGreaterThan(5);
    }
  });
});
