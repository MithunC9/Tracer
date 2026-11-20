import { DEFAULT_EXCLUSIONS, isExcluded, type ActionVerb, type GroundTruth, type RawSample } from '@tracer/schema';
import { Rng } from './prng.js';
import { resolveApp } from './resolve.js';
import { Sim, type Ax, type DwellOpts, type Screen } from './sim.js';

export interface AppId {
  bundleId: string;
  appName: string;
}

/** Native apps used across personas (real bundle ids; unknown ones resolve to `other:<slug>`). */
export const NATIVE = {
  slack: { bundleId: 'com.tinyspeck.slackmacgap', appName: 'Slack' },
  zoom: { bundleId: 'us.zoom.xos', appName: 'zoom.us' },
  vscode: { bundleId: 'com.microsoft.VSCode', appName: 'Code' },
  figma: { bundleId: 'com.figma.Desktop', appName: 'Figma' },
  iterm: { bundleId: 'com.googlecode.iterm2', appName: 'iTerm2' },
  terminal: { bundleId: 'com.apple.Terminal', appName: 'Terminal' },
  finder: { bundleId: 'com.apple.finder', appName: 'Finder' },
  preview: { bundleId: 'com.apple.Preview', appName: 'Preview' },
  excel: { bundleId: 'com.microsoft.Excel', appName: 'Microsoft Excel' },
  word: { bundleId: 'com.microsoft.Word', appName: 'Microsoft Word' },
  notes: { bundleId: 'com.apple.Notes', appName: 'Notes' },
  notion: { bundleId: 'notion.id', appName: 'Notion' },
  linear: { bundleId: 'com.linear', appName: 'Linear' },
  onepassword: { bundleId: 'com.1password.1password', appName: '1Password' },
  spotify: { bundleId: 'com.spotify.client', appName: 'Spotify' },
  toggl: { bundleId: 'com.toggl.daneel', appName: 'Toggl Track' },
  claude: { bundleId: 'com.anthropic.claudefordesktop', appName: 'Claude' },
  calendar: { bundleId: 'com.apple.iCal', appName: 'Calendar' },
  messages: { bundleId: 'com.apple.MobileSMS', appName: 'Messages' },
  outlook: { bundleId: 'com.microsoft.Outlook', appName: 'Microsoft Outlook' },
} as const satisfies Record<string, AppId>;

export const BROWSERS = {
  chrome: { bundleId: 'com.google.Chrome', appName: 'Google Chrome' },
  arc: { bundleId: 'company.thebrowser.Browser', appName: 'Arc' },
  safari: { bundleId: 'com.apple.Safari', appName: 'Safari' },
} as const satisfies Record<string, AppId>;

export interface Ctx {
  sim: Sim;
  r: Rng;
  browser: AppId;
  me: { name: string; email: string; domain: string };
  day: number;
}

export const web = (c: Ctx, url: string, title: string, ax?: Ax[], priv = false): Screen => ({
  ...c.browser,
  title,
  url,
  ax,
  private: priv,
});

export const nat = (app: AppId, title: string | null, ax?: Ax[]): Screen => ({ ...app, title, url: null, ax });

export const axd = (headings: string[], labels: string[], text: string, secure = false): Ax => ({ headings, labels, text, secure });

// ------------------------------------------------------------------ workflows

export interface StepCtx extends Ctx {
  occ: number;
  /** Per-occurrence variables (client, amounts, ...). */
  v: Record<string, string>;
}

export interface WfStep {
  appKey: string;
  action: ActionVerb;
  label: string;
  minutes: [number, number];
  screens: (c: StepCtx) => Screen[];
  clips?: number;
  clipKind?: 'text' | 'image' | 'file' | 'other';
  /** Probability this step is skipped in an occurrence. */
  skipP?: number;
  axEvery?: [number, number];
}

export interface WorkflowDef {
  id: string;
  label: string;
  steps: WfStep[];
  /** Swap steps [i, i+1] with probability p. */
  swap?: [number, number];
  /** Probability of an interruption between steps. */
  interruptP?: number;
  vars?: (c: Ctx, occ: number) => Record<string, string>;
}

export type Filler = (c: Ctx, budgetSec: number) => void;

export interface DayPlan {
  /** Local hours */
  start: number;
  end: number;
  lunch?: [at: number, minutes: number];
}

export interface Meeting {
  day: number;
  at: number;
  minutes: number;
  title: string;
  /** Workflow ids that tend to follow this meeting (informational). */
  note?: string;
}

export interface PersonaDef {
  id: string;
  description: string;
  /** Local UTC offset in hours during the audit week (no DST change in it). */
  tzOffsetHours: number;
  browser: AppId;
  me: { name: string; email: string; domain: string };
  workflows: WorkflowDef[];
  /** workflow id -> [dayIndex, localHour] occurrences */
  schedule: Record<string, Array<[number, number]>>;
  meetings: Meeting[];
  days: (DayPlan | null)[];
  fillers: Array<[Filler, number]>;
  /** Short (<2 min) interruptions used inside workflows. */
  interrupts: Filler[];
  /** Flicker targets (alt-tab) for this persona. */
  flicker: (c: Ctx) => Screen[];
  meetingScreen: (c: Ctx, title: string) => Screen;
  distractors: string[];
}

export const AUDIT_MONDAY_UTC = Date.UTC(2026, 10, 2); // 2026-11-02T00:00:00Z
export const AUDIT_DAYS = 7;

/** Audit start = local midnight Monday 2026-11-02 expressed in UTC. */
export function auditStartMs(p: PersonaDef): number {
  return AUDIT_MONDAY_UTC - p.tzOffsetHours * 3600_000;
}

function assertStepScreen(wf: WorkflowDef, step: WfStep, s: Screen): void {
  const res = resolveApp(s.bundleId, s.appName, s.url);
  if (res.appKey !== step.appKey) throw new Error(`${wf.id}/${step.label}: screen resolves to ${res.appKey}, expected ${step.appKey}`);
  if (isExcluded(DEFAULT_EXCLUSIONS, { appKey: res.appKey, bundleId: s.bundleId, urlHost: res.urlHost, windowTitle: s.title, isPrivateWindow: s.private }))
    throw new Error(`${wf.id}/${step.label}: workflow screen would be excluded: ${s.title}`);
}

export interface Occurrence {
  start: number;
  end: number;
}

export function runWorkflow(p: PersonaDef, c: Ctx, wf: WorkflowDef, occ: number): Occurrence {
  const r = c.r;
  const v = wf.vars?.(c, occ) ?? {};
  const sc: StepCtx = { ...c, occ, v };
  let steps = [...wf.steps];
  if (wf.swap && r.chance(wf.swap[1])) {
    const i = wf.swap[0];
    [steps[i], steps[i + 1]] = [steps[i + 1]!, steps[i]!];
  }
  steps = steps.filter((s, i) => i === 0 || !s.skipP || !r.chance(s.skipP));
  const start = c.sim.t;
  const flicker = p.flicker(c);
  steps.forEach((step, i) => {
    if (i > 0 && r.chance(wf.interruptP ?? 0.2)) r.pick(p.interrupts)(c, r.int(20, 110));
    const screens = step.screens(sc);
    const total = r.float(step.minutes[0], step.minutes[1]) * 60;
    const weights = screens.map(() => r.float(0.6, 1.4));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const clips = step.clips ?? 0;
    screens.forEach((s, k) => {
      assertStepScreen(wf, step, s);
      const o: DwellOpts = {
        axEvery: step.axEvery ?? [12, 45],
        clips: k === screens.length - 1 ? clips : 0,
        clipKind: step.clipKind ?? 'text',
        flicker,
        flickerP: 0.07,
      };
      c.sim.dwell(s, (total * weights[k]!) / wsum, o);
    });
  });
  return { start, end: c.sim.t };
}

// ------------------------------------------------------------------ persona runner

export interface PersonaRun {
  raw: RawSample[];
  groundTruth: GroundTruth;
  planted: string[];
  plantedContextual: string[];
}

export function runPersona(p: PersonaDef): PersonaRun {
  const r = new Rng(`tracer-fixtures:${p.id}:v1`);
  const startMs = auditStartMs(p);
  const sim = new Sim(r, startMs);
  const occurrences = new Map<string, Occurrence[]>(p.workflows.map((w) => [w.id, []]));
  const occCount = new Map<string, number>();
  const H = 3600_000;

  for (let day = 0; day < AUDIT_DAYS; day++) {
    const plan = p.days[day];
    if (!plan) continue;
    const dayMs = startMs + day * 86400_000;
    const at = (h: number) => dayMs + h * H;
    const c: Ctx = { sim, r, browser: p.browser, me: p.me, day };

    type Anchor = { at: number; run: () => void };
    const anchors: Anchor[] = [];
    for (const wf of p.workflows) {
      for (const [d, h] of p.schedule[wf.id] ?? []) {
        if (d !== day) continue;
        anchors.push({
          at: at(h) + r.int(-12, 12) * 60_000,
          run: () => {
            const n = occCount.get(wf.id) ?? 0;
            occCount.set(wf.id, n + 1);
            occurrences.get(wf.id)!.push(runWorkflow(p, c, wf, n));
          },
        });
      }
    }
    for (const m of p.meetings.filter((m) => m.day === day)) {
      anchors.push({
        at: at(m.at),
        run: () => {
          const len = m.minutes * 60 + r.int(-60, 240);
          sim.dwell(p.meetingScreen(c, m.title), len, { axEvery: [90, 300], flicker: p.flicker(c), flickerP: 0.05 });
        },
      });
    }
    if (plan.lunch) {
      const [lh, lm] = plan.lunch;
      anchors.push({ at: at(lh) + r.int(-10, 10) * 60_000, run: () => sim.idle(lm * 60 + r.int(-300, 600)) });
    }
    anchors.sort((a, b) => a.at - b.at);

    sim.startDay(at(plan.start) + r.int(-10, 10) * 60_000);
    // the day always opens with a quick check (mail/calendar), never with an idle gap
    p.interrupts[0]!(c, r.int(60, 180));
    const fill = (until: number) => {
      let guard = 0;
      while (until - sim.t > 60_000 && guard++ < 500) {
        const budget = (until - sim.t) / 1000;
        const before = sim.t;
        const f = budget < 240 ? r.pick(p.interrupts) : r.weighted(p.fillers);
        f(c, budget);
        if (sim.t > until + 5 * 60_000) break;
        if (sim.t === before) sim.adv(Math.min(budget, 30));
      }
    };
    for (const a of anchors) {
      fill(a.at);
      a.run();
    }
    fill(at(plan.end) + r.int(-15, 15) * 60_000);
    sim.endDay();
  }

  const groundTruth: GroundTruth = {
    persona: p.id,
    description: p.description,
    startsAt: new Date(startMs).toISOString(),
    days: AUDIT_DAYS,
    workflows: p.workflows.map((wf) => {
      const occ = occurrences.get(wf.id)!;
      const minutes = occ.reduce((s, o) => s + (o.end - o.start) / 60_000, 0);
      return {
        id: wf.id,
        label: wf.label,
        path: wf.steps.map((s) => ({ appKey: s.appKey, action: s.action })),
        occurrences: occ.map((o) => ({ start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString() })),
        minutesPerWeek: Math.round((minutes / (AUDIT_DAYS / 7)) * 10) / 10,
      };
    }),
    distractors: p.distractors,
  };
  return { raw: sim.samples, groundTruth, planted: [...sim.planted].sort(), plantedContextual: [...sim.plantedContextual].sort() };
}
