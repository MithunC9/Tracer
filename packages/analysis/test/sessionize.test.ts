import { describe, expect, it } from 'vitest';
import { ActivityEvent, DEFAULT_EXCLUSIONS, FocusSession } from '@tracer/schema';
import { inferAction, sessionize, sessionizeWithStats } from '../src/index.js';
import { timeline } from './helpers.js';

describe('sessionize', () => {
  it('derives durations from successive focus events and validates against the schema', () => {
    const t = timeline().focus(0, 'gmail', 'Inbox', 'mail.google.com').focus(60, 'slack', 'general').focus(100, 'gmail', 'Inbox', 'mail.google.com');
    const s = sessionize(t.events);
    // the last focus has no successor, so it has no measurable duration and is dropped
    expect(s.map((x) => [x.appKey, x.activeSeconds])).toEqual([
      ['gmail', 60],
      ['slack', 40],
    ]);
    for (const x of s) FocusSession.parse(x);
  });

  it('sorts by ts then seq regardless of input order', () => {
    const t = timeline().focus(0, 'gmail', 'Inbox').focus(60, 'slack', 'general').focus(100, 'excel', 'Book').focus(130, 'gmail', 'x');
    const a = sessionize(t.events);
    const b = sessionize([...t.events].reverse());
    expect(b).toEqual(a);
  });

  it('cuts on idle and trims the idle lead-in (idle_start is emitted after the threshold)', () => {
    const t = timeline().focus(0, 'excel', 'Book').idleStart(600, 120).idleEnd(1500).focus(1800, 'gmail', 'Inbox').focus(1900, 'slack', 'x');
    const { sessions, stats } = sessionizeWithStats(t.events);
    expect(sessions.map((s) => [s.appKey, s.activeSeconds])).toEqual([
      ['excel', 480],
      ['excel', 300],
      ['gmail', 100],
    ]);
    expect(stats.idleMinutes).toBe(17);
  });

  it('collapses <3s alt-tab flicker that returns to the previous window', () => {
    const t = timeline().focus(0, 'excel', 'Book').focus(100, 'slack', 'general').focus(101.5, 'excel', 'Book').focus(200, 'gmail', 'Inbox').focus(260, 'slack', 'z');
    const { sessions, stats } = sessionizeWithStats(t.events);
    expect(sessions.map((s) => [s.appKey, s.activeSeconds])).toEqual([
      ['excel', 200],
      ['gmail', 60],
    ]);
    expect(stats.flickerCollapsed).toBe(1);
    expect(sessions[0]!.eventIds).toHaveLength(3);
  });

  it('keeps a real (>=3s) visit to another window', () => {
    const t = timeline().focus(0, 'excel', 'Book').focus(100, 'slack', 'general').focus(110, 'excel', 'Book').focus(200, 'gmail', 'Inbox');
    expect(sessionize(t.events).map((s) => s.appKey)).toEqual(['excel', 'slack', 'excel']);
  });

  it('merges consecutive focus events on the same app + title', () => {
    const t = timeline().focus(0, 'excel', 'Book').focus(50, 'excel', 'Book').focus(90, 'excel', 'Other').focus(120, 'gmail', 'Inbox');
    expect(sessionize(t.events).map((s) => [s.windowTitle, s.activeSeconds])).toEqual([
      ['Book', 90],
      ['Other', 30],
    ]);
  });

  it('skips paused stretches and counts paused minutes', () => {
    const t = timeline().focus(0, 'excel', 'Book').capture(100, 'paused').capture(1900, 'resumed').focus(2000, 'gmail', 'Inbox').focus(2100, 'slack', 'x');
    const { sessions, stats } = sessionizeWithStats(t.events);
    expect(sessions.map((s) => [s.appKey, s.activeSeconds])).toEqual([
      ['excel', 100],
      ['excel', 100],
      ['gmail', 100],
    ]);
    expect(stats.pausedMinutes).toBe(30);
  });

  it('does not count time while an excluded app is frontmost', () => {
    const t = timeline().focus(0, 'excel', 'Book').capture(100, 'excluded_app_active').focus(400, 'gmail', 'Inbox').focus(500, 'slack', 'x');
    const { sessions, stats } = sessionizeWithStats(t.events);
    expect(sessions.map((s) => [s.appKey, s.activeSeconds])).toEqual([
      ['excel', 100],
      ['gmail', 100],
    ]);
    expect(stats.excludedMinutes).toBe(5);
  });

  it('applies server-side exclusions as a second line of defence', () => {
    const t = timeline().focus(0, 'excel', 'Book').focus(100, 'password_manager', 'Vault').focus(200, 'gmail', 'Inbox').focus(300, 'x', 'y');
    const s = sessionize(t.events, { exclusions: DEFAULT_EXCLUSIONS });
    expect(s.map((x) => x.appKey)).toEqual(['excel', 'gmail']);
  });

  it('caps silent gaps (agent not running) at one idle threshold', () => {
    const t = timeline().focus(0, 'excel', 'Book').focus(3 * 3600, 'gmail', 'Inbox').focus(3 * 3600 + 60, 'slack', 'x');
    const { sessions, stats } = sessionizeWithStats(t.events);
    expect(sessions[0]!.activeSeconds).toBe(120);
    expect(stats.silentGaps).toBe(1);
  });

  it('attaches digest text (deduped, capped) and clipboard counts; sums redactions', () => {
    const t = timeline()
      .focus(0, 'stripe', 'Payouts', 'dashboard.stripe.com')
      .digest(1, 'stripe', 'Payouts balance')
      .redact(2)
      .digest(30, 'stripe', 'Payouts balance')
      .clip(40, 'stripe')
      .clip(50, 'stripe')
      .focus(100, 'google_sheets', 'Recon')
      .digest(101, 'google_sheets', 'x'.repeat(2000))
      .focus(200, 'gmail', 'Inbox');
    const { sessions, stats } = sessionizeWithStats(t.events, { maxSessionDigestChars: 100 });
    expect(sessions[0]!.digestText).toBe('Payouts balance');
    expect(sessions[0]!.clipboardEvents).toBe(2);
    expect(sessions[0]!.action).toBe('copy');
    expect(sessions[1]!.digestText).toHaveLength(100);
    expect(sessions[1]!.action).toBe('paste');
    expect(stats.redactionsApplied).toBe(2);
  });

  it('resolves the generic browser to the site app or other:<host>', () => {
    const t = timeline().focus(0, 'browser', 'Payouts', 'dashboard.stripe.com').focus(60, 'browser', 'News', 'www.example.org').focus(120, 'gmail', 'x');
    expect(sessionize(t.events).map((s) => s.appKey)).toEqual(['stripe', 'other:example.org']);
  });

  it('every session parses and ids are stable across runs', () => {
    const t = timeline().focus(0, 'excel', 'Book').focus(60, 'gmail', 'Inbox').focus(120, 'slack', 'x');
    for (const e of t.events) ActivityEvent.parse(e);
    expect(sessionize(t.events).map((s) => s.id)).toEqual(sessionize(t.events).map((s) => s.id));
  });
});

describe('inferAction', () => {
  const base = { appKey: 'other:x', title: null as string | null, digestText: '', activeSeconds: 120, clipboardEvents: 0, clipboardFromPrevious: false };
  it.each([
    ['Export payments to CSV', 'export'],
    ['payments.csv', 'export'],
    ['Download statement', 'export'],
    ['Downloads folder', 'download'],
    ['Compose - Gmail', 'compose'],
    ['Reply to customer', 'compose'],
    ['New message', 'compose'],
    ['Import contacts', 'import'],
    ['Upload receipt', 'upload'],
    ['Approve report', 'approve'],
    ['Pay bill', 'approve'],
    ['Reconcile account', 'reconcile'],
    ['Pull request #12 review', 'review'],
    ['Search results for invoices', 'search'],
    ['Schedule a meeting', 'schedule'],
    ['Edit invoice', 'edit'],
  ])('title %s -> %s', (title, verb) => {
    expect(inferAction({ ...base, title })).toBe(verb);
  });
  it('copy when the clipboard changed; paste when the previous app copied', () => {
    expect(inferAction({ ...base, appKey: 'google_sheets', clipboardEvents: 1 })).toBe('copy');
    expect(inferAction({ ...base, appKey: 'google_sheets', clipboardFromPrevious: true })).toBe('paste');
  });
  it('title beats clipboard; very short visits are navigation; category default otherwise', () => {
    expect(inferAction({ ...base, title: 'Export CSV', clipboardEvents: 2 })).toBe('export');
    expect(inferAction({ ...base, activeSeconds: 5 })).toBe('navigate');
    expect(inferAction({ ...base, appKey: 'google_sheets' })).toBe('edit');
    expect(inferAction({ ...base, appKey: 'gmail' })).toBe('read');
  });
});
