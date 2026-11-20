import { statSync } from 'node:fs';
import { ActionVerb, ActivityEvent, DEFAULT_EXCLUSIONS, GroundTruth, isExcluded, RawSample } from '@tracer/schema';
import { describe, expect, it } from 'vitest';
import { loadEvents, loadGroundTruth, loadRaw, PERSONAS, personaPaths } from '../src/index.js';
import { resolveApp } from '../src/resolve.js';

// FIXTURE_PERSONAS=a,b narrows the run while iterating on one persona
const LIST = (process.env.FIXTURE_PERSONAS?.split(',') ?? PERSONAS) as typeof PERSONAS;

describe.each(LIST)('%s data', (persona) => {
  const raw = loadRaw(persona);
  const events = loadEvents(persona);
  const gt = loadGroundTruth(persona);

  it('raw.jsonl: valid RawSamples, time-ordered, 3k-15k samples', () => {
    expect(raw.length).toBeGreaterThanOrEqual(3000);
    expect(raw.length).toBeLessThanOrEqual(15000);
    let prev = 0;
    for (const s of raw) {
      RawSample.parse(s);
      const t = Date.parse(s.t);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('events.json: every event passes ActivityEvent.parse; seq monotonic; ids unique; < 8MB', () => {
    expect(statSync(personaPaths(persona).events).size).toBeLessThan(8 * 1024 * 1024);
    const ids = new Set<string>();
    let prevSeq = -1;
    let prevTs = 0;
    for (const e of events) {
      const parsed = ActivityEvent.parse(e);
      expect(parsed).toEqual(e);
      expect(e.seq).toBeGreaterThan(prevSeq);
      prevSeq = e.seq;
      expect(Date.parse(e.ts)).toBeGreaterThanOrEqual(prevTs);
      prevTs = Date.parse(e.ts);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });

  it('events carry no full URLs, no excluded hosts and no private windows', () => {
    const text = JSON.stringify(events);
    // URLs in free text keep only scheme + host; path/query/credentials are redacted
    for (const m of text.matchAll(/https?:\/\/[^\s"]*/g)) {
      const rest = m[0].slice(m[0].indexOf('//') + 2).replace(/^\[REDACTED:api_key\]@/, '');
      expect(rest, m[0]).not.toMatch(/[/@]/);
    }
    for (const e of events) {
      if (e.kind !== 'app_focus') continue;
      expect(isExcluded(DEFAULT_EXCLUSIONS, { appKey: e.app.key, urlHost: e.urlHost })).toBe(false);
      if (e.urlHost) expect(e.urlHost).not.toContain('/');
    }
    const privateRaw = raw.filter((s) => s.type === 'focus' && s.private).length;
    expect(privateRaw).toBeGreaterThan(0);
    expect(events.filter((e) => e.kind === 'capture_state' && e.state === 'excluded_app_active').length).toBeGreaterThan(0);
  });

  it('has realistic texture: alt-tab flicker, idle gaps, clipboard, light weekend', () => {
    const focus = raw.filter((s) => s.type === 'focus');
    let flicker = 0;
    for (let i = 1; i < focus.length; i++) if (Date.parse(focus[i]!.t) - Date.parse(focus[i - 1]!.t) < 3000) flicker++;
    expect(flicker).toBeGreaterThan(10);
    expect(raw.filter((s) => s.type === 'idle_start').length).toBeGreaterThan(10);
    expect(raw.filter((s) => s.type === 'clipboard').length).toBeGreaterThan(20);
    expect(raw.some((s) => s.type === 'ax' && s.secureField)).toBe(true);
  });

  it('ground-truth.json: valid, 3-5 workflows, 3-15 occurrences of 5-45 min each', () => {
    GroundTruth.parse(gt);
    expect(gt.persona).toBe(persona);
    expect(gt.workflows.length).toBeGreaterThanOrEqual(3);
    expect(gt.workflows.length).toBeLessThanOrEqual(5);
    const start = Date.parse(gt.startsAt);
    const end = start + gt.days * 86400_000;
    const all: [number, number][] = [];
    for (const w of gt.workflows) {
      expect(w.occurrences.length).toBeGreaterThanOrEqual(3);
      expect(w.occurrences.length).toBeLessThanOrEqual(15);
      for (const step of w.path) expect(ActionVerb.options).toContain(step.action);
      const days = new Set<number>();
      let total = 0;
      for (const o of w.occurrences) {
        const a = Date.parse(o.start);
        const b = Date.parse(o.end);
        const min = (b - a) / 60_000;
        expect(min, `${w.id} duration`).toBeGreaterThanOrEqual(5);
        expect(min, `${w.id} duration`).toBeLessThanOrEqual(45);
        expect(a).toBeGreaterThanOrEqual(start);
        expect(b).toBeLessThanOrEqual(end);
        days.add(Math.floor((a - start) / 86400_000));
        all.push([a, b]);
        total += min;
      }
      expect(days.size, `${w.id} spread over days`).toBeGreaterThanOrEqual(2);
      expect(w.minutesPerWeek).toBeCloseTo(total, 0);
    }
    all.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < all.length; i++) expect(all[i]![0]).toBeGreaterThanOrEqual(all[i - 1]![1]);
  });

  it('ground-truth occurrences align with raw samples', () => {
    const focus = raw.filter((s): s is Extract<RawSample, { type: 'focus' }> => s.type === 'focus');
    const times = focus.map((f) => Date.parse(f.t));
    const keyAt = (t: number) => {
      let lo = 0;
      let hi = times.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid]! <= t) {
          idx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const f = focus[idx]!;
      return resolveApp(f.bundleId, f.appName, f.url).appKey;
    };
    for (const w of gt.workflows) {
      const pathKeys = new Set(w.path.map((p) => p.appKey));
      for (const o of w.occurrences) {
        const a = Date.parse(o.start);
        const b = Date.parse(o.end);
        // focused app at the start is the first step's app
        expect(keyAt(a), `${w.id} @ ${o.start}`).toBe(w.path[0]!.appKey);
        // every sample inside the occurrence lies on a sample boundary of raw.jsonl
        const inside = focus.filter((f) => Date.parse(f.t) >= a && Date.parse(f.t) < b);
        const keys = new Set(inside.map((f) => resolveApp(f.bundleId, f.appName, f.url).appKey));
        const covered = [...pathKeys].filter((k) => keys.has(k) || keyAt(a) === k);
        // allow one skipped step's app to be missing
        expect(covered.length, `${w.id} @ ${o.start} covers path apps`).toBeGreaterThanOrEqual(Math.max(1, pathKeys.size - 1));
      }
    }
  });
});
