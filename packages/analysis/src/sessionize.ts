import { isExcluded, type ActivityEvent, type FocusSession } from '@tracer/schema';
import { inferAction } from './actions.js';
import { resolveAppKey } from './apps.js';
import { DEFAULT_CONFIG, type AnalysisConfig } from './config.js';
import { stableId, toIso, toMs } from './util.js';

/** Summary counters gathered while sessionizing; feed the report's window stats and limitations. */
export interface CaptureStats {
  eventsAnalyzed: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  /** Minutes between a `paused` capture_state and the next resume. */
  pausedMinutes: number;
  /** Minutes with an excluded app frontmost (agent reported `excluded_app_active`, or server-side exclusion). */
  excludedMinutes: number;
  /** Minutes cut as idle. */
  idleMinutes: number;
  /** Silences with no events and no idle signal longer than maxSilentGapSeconds (agent likely not running). */
  silentGaps: number;
  redactionsApplied: number;
  flickerCollapsed: number;
  /** [startMs, endMs] of user pauses (for days-observed accounting). */
  pausedRanges: Array<[number, number]>;
}

interface Target {
  rawKey: string;
  appKey: string;
  urlHost: string | null;
  title: string | null;
}

interface Span extends Target {
  start: number;
  end: number;
  eventIds: string[];
  digests: Map<string, string>;
  clipboard: number;
}

const sameWindow = (a: Target, b: Target) => a.appKey === b.appKey && a.title === b.title && a.urlHost === b.urlHost;

function sortEvents(events: readonly ActivityEvent[]): { e: ActivityEvent; t: number }[] {
  return events
    .map((e) => ({ e, t: toMs(e.ts) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.e.seq - b.e.seq || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
}

function digestString(d: { headings: string[]; labels: string[]; text: string }): string {
  return [d.headings.join(' '), d.labels.join(' '), d.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function sessionizeWithStats(events: readonly ActivityEvent[], partialCfg?: Partial<AnalysisConfig>): { sessions: FocusSession[]; stats: CaptureStats } {
  const cfg = { ...DEFAULT_CONFIG, ...(partialCfg ?? {}) };
  const sorted = sortEvents(events);
  const stats: CaptureStats = {
    eventsAnalyzed: events.length,
    firstEventAt: sorted.length ? toIso(sorted[0]!.t) : null,
    lastEventAt: sorted.length ? toIso(sorted[sorted.length - 1]!.t) : null,
    pausedMinutes: 0,
    excludedMinutes: 0,
    idleMinutes: 0,
    silentGaps: 0,
    redactionsApplied: 0,
    flickerCollapsed: 0,
    pausedRanges: [],
  };

  const raw: Span[] = [];
  let cur: Span | null = null;
  let last: Target | null = null;
  let idle = false;
  let idleSince = 0;
  let paused = false;
  let pausedSince = 0;
  let excluded = false;
  let excludedSince = 0;
  let lastT: number | null = null;

  const open = (tg: Target, t: number, eventId?: string) => {
    cur = { ...tg, start: t, end: t, eventIds: eventId ? [eventId] : [], digests: new Map(), clipboard: 0 };
  };
  const close = (t: number) => {
    if (!cur) return;
    const c: Span = cur;
    c.end = Math.max(c.start, t);
    if (c.end > c.start || c.eventIds.length > 1) raw.push(c);
    cur = null;
  };
  const canCapture = () => !idle && !paused && !excluded;
  const isServerExcluded = (tg: Target) =>
    cfg.exclusions ? isExcluded(cfg.exclusions, { appKey: tg.appKey, urlHost: tg.urlHost, windowTitle: tg.title }) : false;
  const endExcluded = (t: number) => {
    if (excluded) stats.excludedMinutes += (t - excludedSince) / 60000;
    excluded = false;
  };
  const endPaused = (t: number) => {
    if (paused && Number.isFinite(pausedSince)) {
      stats.pausedMinutes += (t - pausedSince) / 60000;
      stats.pausedRanges.push([pausedSince, t]);
    }
    paused = false;
  };

  for (const { e, t } of sorted) {
    for (const v of Object.values(e.redactions ?? {})) stats.redactionsApplied += v ?? 0;

    // Long silence with no idle signal: the agent was not running. Credit at most one idle threshold.
    if (lastT !== null && t - lastT > cfg.maxSilentGapSeconds * 1000) {
      stats.silentGaps++;
      if (cur) {
        const resume: Target = cur;
        close(lastT + cfg.idleThresholdSeconds * 1000);
        if (e.kind !== 'app_focus' && canCapture()) open(resume, t);
      }
    }
    lastT = t;

    switch (e.kind) {
      case 'app_focus': {
        close(t);
        const tg: Target = {
          rawKey: e.app.key,
          appKey: resolveAppKey(e.app.key, e.urlHost),
          urlHost: e.urlHost,
          title: e.windowTitle,
        };
        last = tg;
        // A focus change implies input and capture.
        if (idle) stats.idleMinutes += (t - idleSince) / 60000;
        idle = false;
        endPaused(t);
        endExcluded(t);
        if (isServerExcluded(tg)) {
          excluded = true;
          excludedSince = t;
        } else {
          open(tg, t, e.id);
        }
        break;
      }
      case 'idle_start': {
        if (idle) break;
        const lead = cfg.trimIdleLeadIn ? e.idleThresholdSeconds * 1000 : 0;
        const end = cur ? Math.max((cur as Span).start, t - lead) : t;
        if (cur) (cur as Span).eventIds.push(e.id);
        close(end);
        idle = true;
        idleSince = end;
        break;
      }
      case 'idle_end': {
        if (!idle) break;
        stats.idleMinutes += (t - idleSince) / 60000;
        idle = false;
        if (last && canCapture()) open(last, t, e.id);
        break;
      }
      case 'capture_state': {
        if (e.state === 'paused' || e.state === 'stopped' || e.state === 'auto_stopped') {
          close(t);
          if (!paused) {
            paused = true;
            pausedSince = t;
          }
          if (e.state !== 'paused') {
            // stopped is not a user pause; do not count it as paused minutes
            pausedSince = Number.POSITIVE_INFINITY;
          }
        } else if (e.state === 'excluded_app_active') {
          close(t);
          if (!excluded) {
            excluded = true;
            excludedSince = t;
          }
        } else {
          // started / resumed
          endPaused(t);
          if (!cur && last && canCapture()) open(last, t, e.id);
        }
        break;
      }
      case 'text_digest': {
        if (cur) {
          const c = cur as Span;
          const k = resolveAppKey(e.app.key, c.urlHost);
          if (k === c.appKey || e.app.key === c.rawKey) {
            c.eventIds.push(e.id);
            if (!c.digests.has(e.digestHash)) c.digests.set(e.digestHash, digestString(e.digest));
          }
        }
        break;
      }
      case 'clipboard_change': {
        if (cur) {
          const c = cur as Span;
          c.eventIds.push(e.id);
          c.clipboard++;
        }
        break;
      }
    }
  }
  if (lastT !== null) {
    close(lastT);
    endPaused(lastT);
    if (excluded) stats.excludedMinutes += (lastT - excludedSince) / 60000;
  }

  const collapsed = collapseFlicker(raw, cfg.flickerSeconds * 1000, stats);
  const merged = mergeSameWindow(collapsed);
  const sessions = toSessions(merged, cfg.maxSessionDigestChars);
  stats.pausedMinutes = Math.round(stats.pausedMinutes * 10) / 10;
  stats.excludedMinutes = Math.round(stats.excludedMinutes * 10) / 10;
  stats.idleMinutes = Math.round(stats.idleMinutes * 10) / 10;
  return { sessions, stats };
}

/** Sort, derive durations, cut idle/pauses/exclusions, collapse alt-tab flicker, merge, infer actions. */
export function sessionize(events: readonly ActivityEvent[], cfg?: Partial<AnalysisConfig>): FocusSession[] {
  return sessionizeWithStats(events, cfg).sessions;
}

const CONTIGUOUS_MS = 1000;

function absorb(into: Span, from: Span): void {
  into.end = Math.max(into.end, from.end);
  into.eventIds.push(...from.eventIds);
  for (const [k, v] of from.digests) if (!into.digests.has(k)) into.digests.set(k, v);
  into.clipboard += from.clipboard;
}

/**
 * A < flicker focus that returns to the window before it (A, b, A) is folded into A.
 * A < flicker focus that moves on elsewhere (A, b, C) is folded into A (passing through).
 */
export function collapseFlicker(spans: Span[], flickerMs: number, stats?: CaptureStats): Span[] {
  const out: Span[] = [];
  const isShort = (s: Span) => s.end - s.start < flickerMs;
  for (const s of spans) {
    const top = out[out.length - 1];
    const prev = out[out.length - 2];
    if (top && isShort(top) && prev && prev.end + CONTIGUOUS_MS >= top.start && top.end + CONTIGUOUS_MS >= s.start) {
      out.pop();
      absorb(prev, top);
      if (stats) stats.flickerCollapsed++;
      if (sameWindow(prev, s)) {
        absorb(prev, s);
        continue;
      }
    }
    out.push(s);
  }
  // trailing short span
  const top = out[out.length - 1];
  const prev = out[out.length - 2];
  if (top && prev && isShort(top) && prev.end + CONTIGUOUS_MS >= top.start) {
    out.pop();
    absorb(prev, top);
    if (stats) stats.flickerCollapsed++;
  }
  return out;
}

function mergeSameWindow(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const top = out[out.length - 1];
    if (top && sameWindow(top, s) && top.end + CONTIGUOUS_MS >= s.start) absorb(top, s);
    else out.push({ ...s, eventIds: [...s.eventIds], digests: new Map(s.digests) });
  }
  return out;
}

function toSessions(spans: Span[], maxDigest: number): FocusSession[] {
  const sessions: FocusSession[] = [];
  let prev: { appKey: string; clipboard: number; end: number } | null = null;
  for (const s of spans) {
    let digestText = '';
    for (const d of s.digests.values()) {
      if (digestText.length >= maxDigest) break;
      digestText = digestText ? `${digestText} ${d}` : d;
    }
    digestText = digestText.slice(0, maxDigest);
    const activeSeconds = Math.round((s.end - s.start) / 100) / 10;
    const clipboardFromPrevious = !!prev && prev.clipboard > 0 && prev.appKey !== s.appKey && s.start - prev.end < 5 * 60 * 1000;
    const action = inferAction({ appKey: s.appKey, title: s.title, digestText, activeSeconds, clipboardEvents: s.clipboard, clipboardFromPrevious });
    sessions.push({
      id: stableId('ses_', `${s.eventIds[0] ?? ''}|${s.start}`),
      appKey: s.appKey,
      urlHost: s.urlHost,
      windowTitle: s.title,
      start: toIso(s.start),
      end: toIso(s.end),
      activeSeconds,
      eventIds: s.eventIds,
      clipboardEvents: s.clipboard,
      digestText,
      action,
    });
    prev = { appKey: s.appKey, clipboard: s.clipboard, end: s.end };
  }
  return sessions;
}
