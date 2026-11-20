import { describe, expect, it } from 'vitest';
import {
  ActivityEvent,
  APPS,
  appKeyForHost,
  automationPotential,
  buildOpenApi,
  confidence,
  DEFAULT_EXCLUSIONS,
  IngestBatch,
  isExcluded,
  reclaimableHours,
  routes,
  weeklyHours,
  CatalogEntry,
} from '../src/index.js';

const base = { id: '0190c6a0-0000-7000-8000-000000000001', ts: '2026-11-20T09:00:00.000Z', seq: 1, schemaVersion: 1 as const };

describe('events', () => {
  it('accepts a valid app_focus event and defaults redactions', () => {
    const e = ActivityEvent.parse({ ...base, kind: 'app_focus', app: { key: 'gmail', name: 'Gmail' }, windowTitle: 'Inbox', urlHost: 'mail.google.com' });
    expect(e.redactions).toEqual({});
  });
  it('rejects unknown kinds and screenshot-like payloads', () => {
    expect(ActivityEvent.safeParse({ ...base, kind: 'screenshot', png: 'x' }).success).toBe(false);
  });
  it('rejects clipboard events carrying content', () => {
    const r = ActivityEvent.safeParse({ ...base, kind: 'clipboard_change', app: { key: 'excel', name: 'Excel' }, contentKind: 'text', content: 'secret' });
    // zod strips unknown keys by default; assert content never survives parsing
    expect(r.success && 'content' in r.data).toBe(false);
  });
  it('caps batch size', () => {
    const ev = { ...base, kind: 'idle_end' as const };
    const big = { batchId: base.id, sentAt: base.ts, agentVersion: '0.1.0', platform: 'simulated', events: Array(1001).fill(ev) };
    expect(IngestBatch.safeParse(big).success).toBe(false);
  });
});

describe('apps & exclusions', () => {
  it('has unique keys', () => {
    expect(new Set(APPS.map((a) => a.key)).size).toBe(APPS.length);
  });
  it('resolves hosts incl. path-scoped google apps', () => {
    expect(appKeyForHost('docs.google.com', '/spreadsheets/d/abc')).toBe('google_sheets');
    expect(appKeyForHost('docs.google.com', '/document/d/abc')).toBe('google_docs');
    expect(appKeyForHost('www.figma.com')).toBe('figma');
    expect(appKeyForHost('eu1.app.hubspot.com')).toBe('hubspot');
  });
  it('excludes password managers, banks and private windows by default', () => {
    expect(isExcluded(DEFAULT_EXCLUSIONS, { appKey: 'password_manager' })).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, { appKey: 'browser', urlHost: 'secure.chase.com' })).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, { appKey: 'browser', isPrivateWindow: true })).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, { appKey: 'gmail', windowTitle: 'Inbox' })).toBe(false);
  });
});

describe('scoring formula', () => {
  it('is bounded and monotone in risk', () => {
    const hi = automationPotential({ repeatability: 1, ruleBasedShare: 1, integrationFeasibility: 1, risk: 0 });
    const risky = automationPotential({ repeatability: 1, ruleBasedShare: 1, integrationFeasibility: 1, risk: 1 });
    expect(hi).toBe(100);
    expect(risky).toBe(50);
  });
  it('computes weekly and reclaimable hours', () => {
    expect(weeklyHours(420, 7)).toBe(7);
    expect(reclaimableHours(7, 80)).toBe(3.9);
    expect(confidence({ occurrences: 10, daysSeen: 5, daysObserved: 7, cohesion: 1 })).toBe(1);
  });
});

describe('catalog contract', () => {
  it('CatalogEntry cannot carry commission fields', () => {
    const r = CatalogEntry.safeParse({
      id: 'x', name: 'X', vendor: 'X', category: 'script', summary: 's', capabilities: ['csv_transform'], integrations: [],
      platforms: ['macos'], pricingTier: 'free', priceNote: '', setupEffort: 'hour', skillLevel: 'some', reliabilityNotes: '',
      url: 'https://example.com', openSource: true, commissionRate: 0.3,
    });
    expect(r.success).toBe(false);
  });
});

describe('openapi', () => {
  it('emits an operation per route', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, unknown>> };
    const ops = Object.values(doc.paths).flatMap((p) => Object.keys(p));
    expect(ops.length).toBe(Object.keys(routes).length);
  });
});
