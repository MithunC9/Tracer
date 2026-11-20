import { LIMITS, type FocusSession, type PathStep, type TaskEpisode } from '@tracer/schema';
import { stepLabel } from './actions.js';
import { appName } from './apps.js';
import { DEFAULT_CONFIG, type AnalysisConfig } from './config.js';
import { addScaled, cosine, hashEmbed } from './text.js';
import { DAY_MS, stableId, toIso, toMs } from './util.js';

export type Embedder = (text: string) => number[];

export interface SegmentOptions extends Partial<AnalysisConfig> {
  /** Audit start; dayIndex counts 24h periods from here. Default: UTC midnight of the first session. */
  auditStartsAt?: string;
}

interface S {
  s: FocusSession;
  i: number;
  start: number;
  end: number;
  vec: number[];
  day: number;
}

interface Ep {
  items: S[];
  apps: Set<string>;
  windows: Set<string>;
  centroid: number[];
  start: number;
  lastEnd: number;
  /** End of the last session in this episode that copied something (-inf if none). */
  lastCopyEnd: number;
  day: number;
}

const windowKey = (s: FocusSession) => `${s.appKey}\u0000${s.windowTitle ?? ''}`;

/** Text used to embed one session: the window title counts double, then the digest. */
export const sessionText = (s: FocusSession) => `${s.windowTitle ?? ''} ${s.windowTitle ?? ''} ${s.digestText.slice(0, 400)}`;

/** Text used to embed one episode: distinct titles, then digests (capped). */
export function episodeText(sessions: readonly FocusSession[]): string {
  const titles = [...new Set(sessions.map((s) => s.windowTitle ?? '').filter(Boolean))];
  const digests = [...new Set(sessions.map((s) => s.digestText).filter(Boolean))];
  return `${titles.join(' ')} ${digests.join(' ')}`.slice(0, LIMITS.maxDigestTextChars);
}

/** Habitual app hand-offs (A -> B within 2 minutes) recurring across days. */
export function habitTransitions(items: readonly { appKey: string; start: number; end: number; day: number; seconds: number }[], cfg: AnalysisConfig): Set<string> {
  const count = new Map<string, number>();
  const days = new Map<string, Set<number>>();
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  let total = 0;
  let prev: (typeof items)[number] | null = null;
  for (const it of items) {
    if (it.seconds < cfg.minStepSeconds) continue;
    if (prev && prev.appKey !== it.appKey && it.start - prev.end <= 120_000) {
      const k = `${prev.appKey}>${it.appKey}`;
      count.set(k, (count.get(k) ?? 0) + 1);
      if (!days.has(k)) days.set(k, new Set());
      days.get(k)!.add(it.day);
      out.set(prev.appKey, (out.get(prev.appKey) ?? 0) + 1);
      inn.set(it.appKey, (inn.get(it.appKey) ?? 0) + 1);
      total++;
    }
    prev = it;
  }
  const habits = new Set<string>();
  for (const [k, c] of count) {
    const [from, to] = k.split('>') as [string, string];
    const share = c / (out.get(from) ?? 1);
    // lift: hub apps everyone switches to (chat, email) do not count as a specific hand-off
    const lift = share / ((inn.get(to) ?? 1) / Math.max(1, total));
    if (c >= cfg.habitMinCount && (days.get(k)?.size ?? 0) >= cfg.habitMinDays && share >= cfg.habitMinShare && lift >= 2) habits.add(k);
  }
  return habits;
}

/**
 * Group focus sessions into task episodes.
 *
 * A new episode starts on: a gap > episodeGapSeconds, a new day, the episode exceeding
 * maxEpisodeSeconds, or a topic shift. A session continues the running episode when it is
 * in an app the episode already uses (unless it is a clearly different document in the same
 * app), follows a clipboard copy, is textually similar to the episode, is a habitual hand-off
 * (A -> B seen repeatedly across days), or is too short to judge. A short foreign run
 * followed by a return to the task (Slack ping, email check) is an interruption: it is
 * removed from the episode and does not count toward its time or path.
 */
export function segmentTasks(sessions: readonly FocusSession[], opts: SegmentOptions = {}, embed: Embedder = (t) => hashEmbed(t)): TaskEpisode[] {
  const cfg: AnalysisConfig = { ...DEFAULT_CONFIG, ...opts };
  if (!sessions.length) return [];
  const sorted = [...sessions].sort((a, b) => toMs(a.start) - toMs(b.start) || (a.id < b.id ? -1 : 1));
  const first = toMs(sorted[0]!.start);
  const auditStart = opts.auditStartsAt ? toMs(opts.auditStartsAt) : Math.floor(first / DAY_MS) * DAY_MS;
  const dayOf = (t: number) => Math.max(0, Math.floor((t - auditStart) / DAY_MS));

  const cache = new Map<string, number[]>();
  const vecOf = (text: string) => {
    let v = cache.get(text);
    if (!v) {
      v = embed(text);
      cache.set(text, v);
    }
    return v;
  };
  const items: S[] = sorted.map((s, i) => {
    const start = toMs(s.start);
    return { s, i, start, end: toMs(s.end), vec: vecOf(sessionText(s)), day: dayOf(start) };
  });
  const habits = habitTransitions(
    items.map((x) => ({ appKey: x.s.appKey, start: x.start, end: x.end, day: x.day, seconds: x.s.activeSeconds })),
    cfg,
  );

  const episodes: Ep[] = [];
  let cur: Ep | null = null;
  const startEp = (x: S): Ep => {
    const ep: Ep = { items: [], apps: new Set(), windows: new Set(), centroid: new Array<number>(x.vec.length).fill(0), start: x.start, lastEnd: x.end, lastCopyEnd: Number.NEGATIVE_INFINITY, day: x.day };
    episodes.push(ep);
    add(ep, x);
    return ep;
  };
  const add = (ep: Ep, x: S) => {
    ep.items.push(x);
    ep.apps.add(x.s.appKey);
    ep.windows.add(windowKey(x.s));
    addScaled(ep.centroid, x.vec, Math.log(2 + Math.min(x.s.activeSeconds, 1800) / 30));
    ep.lastEnd = Math.max(ep.lastEnd, x.end);
    if (x.s.clipboardEvents > 0) ep.lastCopyEnd = x.end;
  };
  /**
   * Does session y continue episode ep (whose last kept session is prev)?
   * 'continue' / 'split' (a clear new instance or different document) / 'unknown'.
   */
  const judge = (ep: Ep, prev: S, y: S, allowClipboard: boolean): 'continue' | 'split' | 'unknown' => {
    const simC = cosine(y.vec, ep.centroid);
    if (ep.apps.has(y.s.appKey)) {
      const newWindow = !ep.windows.has(windowKey(y.s));
      const first = ep.items.find((z) => z.s.activeSeconds >= cfg.minStepSeconds) ?? ep.items[0]!;
      // Back in the first step's app with a new document after visiting other apps (same action, or unrelated text): a new task has started.
      const restart =
        newWindow &&
        ep.apps.size >= 2 &&
        y.s.appKey === first.s.appKey &&
        prev.s.appKey !== y.s.appKey &&
        y.s.activeSeconds >= cfg.minStepSeconds &&
        (y.s.action === first.s.action || cosine(y.vec, first.vec) < cfg.topicContinueSimilarity);
      const differentDoc =
        newWindow &&
        y.s.appKey === prev.s.appKey &&
        cosine(y.vec, prev.vec) < cfg.sameAppSplitSimilarity &&
        y.s.activeSeconds >= 60 &&
        prev.s.clipboardEvents === 0;
      return restart || differentDoc ? 'split' : 'continue';
    }
    if (simC >= cfg.topicContinueSimilarity) return 'continue';
    if (habits.has(`${prev.s.appKey}>${y.s.appKey}`)) return 'continue';
    // something was copied in this task moments ago: carrying data to the next app
    if (allowClipboard && y.start - ep.lastCopyEnd < 5 * 60_000) return 'continue';
    return 'unknown';
  };
  /** A short foreign run starting at i, after which the task visibly continues: index of the continuation, or -1. */
  const interruptionEnd = (ep: Ep, prev: S, i: number): number => {
    let dur = 0;
    for (let k = i; k < items.length && k <= i + cfg.interruptionMaxSessions; k++) {
      const y = items[k]!;
      if (k > i) {
        if (y.start - items[k - 1]!.end > cfg.episodeGapSeconds * 1000) return -1;
        if (y.s.activeSeconds >= cfg.minStepSeconds && judge(ep, prev, y, true) === 'continue') return k;
      }
      // copying data is task work, not an interruption
      if (y.s.clipboardEvents > 0) return -1;
      dur += y.s.activeSeconds;
      if (dur > cfg.interruptionMaxSeconds) return -1;
    }
    return -1;
  };

  for (let i = 0; i < items.length; i++) {
    const x = items[i]!;
    if (!cur) {
      cur = startEp(x);
      continue;
    }
    const prev = cur.items[cur.items.length - 1]!;
    const gap = x.start - cur.lastEnd;
    if (gap > cfg.episodeGapSeconds * 1000 || x.day !== cur.day || x.end - cur.start > cfg.maxEpisodeSeconds * 1000) {
      cur = startEp(x);
      continue;
    }
    const j = judge(cur, prev, x, false);
    if (j === 'continue') {
      add(cur, x);
      continue;
    }
    if (j === 'split') {
      cur = startEp(x);
      continue;
    }
    const k = interruptionEnd(cur, prev, i);
    if (k > i) {
      // drop the interruption run; resume at the continuation
      i = k - 1;
      continue;
    }
    if (judge(cur, prev, x, true) === 'continue') add(cur, x);
    else if (x.s.activeSeconds < cfg.minStepSeconds) continue; // too short to judge: passing through
    else cur = startEp(x);
  }


  const out: TaskEpisode[] = [];
  for (const ep of episodes) {
    const active = ep.items.reduce((a, x) => a + x.s.activeSeconds, 0);
    if (active < cfg.minEpisodeSeconds) continue;
    const ss = ep.items.map((x) => x.s);
    const path = buildPath(ss, cfg.minStepSeconds);
    out.push({
      id: stableId('ep_', ss[0]!.id),
      sessionIds: ss.map((s) => s.id),
      start: toIso(ep.start),
      end: toIso(Math.max(...ep.items.map((x) => x.end))),
      activeSeconds: Math.round(active * 10) / 10,
      path,
      embedding: embed(episodeText(ss)).map((v) => Math.round(v * 1e5) / 1e5),
      dayIndex: ep.day,
    });
  }
  return out;
}

const MAX_EPISODE_PATH = 24;

/** Path = (app, action) steps of sessions >= minStepSeconds, consecutive duplicates collapsed. */
export function buildPath(sessions: readonly FocusSession[], minStepSeconds: number): PathStep[] {
  let use = sessions.filter((s) => s.activeSeconds >= minStepSeconds);
  if (!use.length) use = [[...sessions].sort((a, b) => b.activeSeconds - a.activeSeconds)[0]!];
  const steps: { appKey: string; action: PathStep['action']; title: string | null; secs: number }[] = [];
  for (const s of use) {
    const top = steps[steps.length - 1];
    if (top && top.appKey === s.appKey && top.action === s.action) {
      if (s.activeSeconds > top.secs) top.title = s.windowTitle;
      top.secs += s.activeSeconds;
    } else {
      steps.push({ appKey: s.appKey, action: s.action, title: s.windowTitle, secs: s.activeSeconds });
    }
  }
  return steps.slice(0, MAX_EPISODE_PATH).map((st) => ({ appKey: st.appKey, action: st.action, label: stepLabel(st.action, appName(st.appKey), st.title) }));
}
