/**
 * Seeded, deterministic generator of ActivityEvents for a synthetic person, with planted
 * workflows + GroundTruth. Deliberately noisy: interruptions (Slack pings, email checks)
 * mid-workflow, alt-tab flicker, idle gaps (also mid-workflow), skipped / swapped / extra
 * steps, durations 5-45 min, one-off noise tasks, a paused stretch, excluded-app time.
 */
import { createHash } from 'node:crypto';
import type { ActivityEvent, GroundTruth } from '@tracer/schema';

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  }
  uuid(): string {
    const h = () => Math.floor(this.next() * 16).toString(16);
    const hx = (n: number) => Array.from({ length: n }, h).join('');
    return `${hx(8)}-${hx(4)}-4${hx(3)}-${this.pick(['8', '9', 'a', 'b'])}${hx(3)}-${hx(12)}`;
  }
}

export interface SynthApp {
  key: string;
  name: string;
  host: string | null;
}

const A = {
  stripe: { key: 'stripe', name: 'Google Chrome', host: 'dashboard.stripe.com' },
  sheets: { key: 'google_sheets', name: 'Google Chrome', host: 'docs.google.com' },
  docs: { key: 'google_docs', name: 'Google Chrome', host: 'docs.google.com' },
  qbo: { key: 'quickbooks', name: 'Google Chrome', host: 'qbo.intuit.com' },
  gmail: { key: 'gmail', name: 'Google Chrome', host: 'mail.google.com' },
  slack: { key: 'slack', name: 'Slack', host: null },
  pdf: { key: 'pdf_viewer', name: 'Preview', host: null },
  expensify: { key: 'expensify', name: 'Google Chrome', host: 'www.expensify.com' },
  excel: { key: 'excel', name: 'Microsoft Excel', host: null },
  outlook: { key: 'outlook', name: 'Microsoft Outlook', host: null },
  linkedin: { key: 'linkedin', name: 'Google Chrome', host: 'www.linkedin.com' },
  hubspot: { key: 'hubspot', name: 'Google Chrome', host: 'app.hubspot.com' },
  salesforce: { key: 'salesforce', name: 'Google Chrome', host: 'lightning.force.com' },
  gcal: { key: 'google_calendar', name: 'Google Chrome', host: 'calendar.google.com' },
  zendesk: { key: 'zendesk', name: 'Google Chrome', host: 'acme.zendesk.com' },
  jira: { key: 'jira', name: 'Google Chrome', host: 'acme.atlassian.net' },
  zoom: { key: 'zoom', name: 'zoom.us', host: null },
  news: { key: 'browser', name: 'Google Chrome', host: 'news.ycombinator.com' },
  youtube: { key: 'browser', name: 'Google Chrome', host: 'www.youtube.com' },
  wiki: { key: 'browser', name: 'Google Chrome', host: 'en.wikipedia.org' },
  search: { key: 'browser', name: 'Google Chrome', host: 'www.google.com' },
  notion: { key: 'notion', name: 'Notion', host: null },
  finder: { key: 'finder', name: 'Finder', host: null },
} satisfies Record<string, SynthApp>;

export interface StepSpec {
  app: SynthApp;
  titles: string[];
  digest: string[];
  minutes: [number, number];
  clipboard?: boolean;
  /** probability this step is skipped in an occurrence */
  skip?: number;
}

export interface WorkflowSpec {
  id: string;
  label: string;
  perWeek: number;
  steps: StepSpec[];
  /** preferred start hour (UTC) for scheduled workflows */
  hour?: number;
}

export interface PersonaSpec {
  name: string;
  description: string;
  workflows: WorkflowSpec[];
}

const MONTHS = ['October', 'November', 'December'];
const NAMES = ['Ana Ruiz', 'Ben Okafor', 'Chen Li', 'Dara Novak', 'Eli Moss', 'Fay Grant', 'Gus Patel', 'Hana Sato', 'Ivo Berg', 'Jo Kim'];
const VENDORS = ['Acme Supplies', 'Northwind', 'Globex', 'Initech', 'Umbrella Co', 'Hooli', 'Vandelay'];
const WORDS = (
  'apple bridge canyon delta ember falcon garden harbor island jungle kettle lantern meadow nectar orchid pepper quartz river ' +
  'saddle timber umbra velvet willow yonder zephyr amber basil cedar dune fjord glacier hazel indigo juniper kelp lotus maple ' +
  'nutmeg olive prairie quill raven sierra thistle tundra violet walnut yarrow alpine birch coral drift echo fern grove heron ' +
  'iris jasper koala lilac mango nova onyx pebble quince ridge spruce tulip vista wren'
).split(' ');
const TOPICS = [
  'quarterly planning', 'offsite agenda', 'hiring plan', 'brand refresh', 'office move', 'conference notes', 'vendor comparison',
  'pricing ideas', 'onboarding checklist', 'team retro', 'roadmap draft', 'partner proposal', 'holiday schedule', 'tax questions',
  'website copy', 'board memo', 'training plan', 'customer survey', 'budget questions', 'product feedback', 'security policy',
];

export const PERSONAS: PersonaSpec[] = [
  {
    name: 'synth-bookkeeper',
    description: 'Bookkeeper reconciling payouts, entering bills, approving expenses',
    workflows: [
      {
        id: 'payout-recon',
        label: 'Stripe payouts → Sheets → QuickBooks deposit',
        perWeek: 5,
        hour: 9,
        steps: [
          { app: A.stripe, titles: ['Payouts – Stripe', 'Payout {n} – Stripe'], digest: ['Payouts Balance transactions Export Paid out', 'Payout details fees net amount'], minutes: [3, 8], clipboard: true },
          { app: A.sheets, titles: ['Payout reconciliation {month} - Google Sheets'], digest: ['Payout reconciliation fees net deposit date'], minutes: [4, 12] },
          { app: A.qbo, titles: ['Bank deposit | QuickBooks', 'Record deposit | QuickBooks'], digest: ['Bank deposit Received from Stripe payout account'], minutes: [3, 9] },
        ],
      },
      {
        id: 'vendor-bills',
        label: 'Vendor invoice email → PDF → QuickBooks bill',
        perWeek: 9,
        steps: [
          { app: A.gmail, titles: ['Invoice {n} from {vendor} - Gmail', 'Your invoice from {vendor} - Gmail'], digest: ['Invoice attached amount due payment terms'], minutes: [1, 3] },
          { app: A.pdf, titles: ['invoice_{n}.pdf'], digest: ['Invoice number bill to amount due date'], minutes: [1, 3], clipboard: true },
          { app: A.qbo, titles: ['Create bill | QuickBooks', 'New bill | QuickBooks'], digest: ['Bill vendor terms bill date due date category amount'], minutes: [3, 8] },
          { app: A.gmail, titles: ['Re: Invoice {n} from {vendor} - Gmail'], digest: ['Reply thanks received will be paid'], minutes: [1, 3], skip: 0.3 },
        ],
      },
      {
        id: 'expense-approval',
        label: 'Review expense reports in Expensify, approve, notify in Slack',
        perWeek: 3,
        steps: [
          { app: A.expensify, titles: ['Review report {name} – Expensify', 'Reports – Expensify'], digest: ['Expense report receipts merchant category policy violations'], minutes: [5, 15] },
          { app: A.expensify, titles: ['Approve report – Expensify'], digest: ['Approve report final approver reimburse'], minutes: [1, 3] },
          { app: A.slack, titles: ['finance-approvals (Channel) - Acme - Slack'], digest: ['finance approvals expense reports approved this week reimbursement'], minutes: [1, 3] },
        ],
      },
      {
        id: 'cash-report',
        label: 'Weekly cash forecast in Excel, emailed via Outlook',
        perWeek: 3,
        hour: 15,
        steps: [
          { app: A.qbo, titles: ['Cash flow report | QuickBooks'], digest: ['Cash flow statement operating activities export'], minutes: [2, 6], clipboard: true },
          { app: A.excel, titles: ['Cash forecast {month}.xlsx'], digest: ['Cash forecast opening balance inflows outflows closing balance'], minutes: [8, 20] },
          { app: A.outlook, titles: ['Weekly cash update - Message (HTML)', 'New message - Weekly cash update'], digest: ['Weekly cash update forecast attached runway'], minutes: [3, 8] },
        ],
      },
    ],
  },
  {
    name: 'synth-sales-ops',
    description: 'Sales ops: lead entry, pipeline report, meeting scheduling',
    workflows: [
      {
        id: 'lead-entry',
        label: 'LinkedIn → HubSpot contact → intro email',
        perWeek: 12,
        steps: [
          { app: A.linkedin, titles: ['{name} | LinkedIn'], digest: ['Experience About Contact info Connect Message'], minutes: [1, 4], clipboard: true },
          { app: A.hubspot, titles: ['Create contact | HubSpot', 'Contacts | HubSpot'], digest: ['Create contact email first name last name lifecycle stage'], minutes: [2, 6] },
          { app: A.gmail, titles: ['New Message - Gmail', 'Compose intro - Gmail'], digest: ['To Subject Intro quick introduction Send'], minutes: [2, 6] },
        ],
      },
      {
        id: 'pipeline-report',
        label: 'Salesforce report export → Sheets → Docs summary',
        perWeek: 4,
        hour: 10,
        steps: [
          { app: A.salesforce, titles: ['Pipeline by stage | Reports | Salesforce'], digest: ['Report pipeline by stage opportunity amount close date Export'], minutes: [3, 7] },
          { app: A.finder, titles: ['Downloads'], digest: ['report csv downloads'], minutes: [0.3, 1], skip: 0.4 },
          { app: A.sheets, titles: ['Pipeline tracker {month} - Google Sheets'], digest: ['Pipeline tracker stage amount forecast commit'], minutes: [8, 18] },
          { app: A.docs, titles: ['Weekly pipeline summary - Google Docs'], digest: ['Weekly pipeline summary highlights risks forecast'], minutes: [5, 12] },
        ],
      },
      {
        id: 'meeting-sched',
        label: 'Meeting request email → calendar → reply',
        perWeek: 8,
        steps: [
          { app: A.gmail, titles: ['Meeting request: {name} - Gmail', 'Can we find time? - Gmail'], digest: ['meeting request availability next week'], minutes: [1, 3] },
          { app: A.gcal, titles: ['Google Calendar - Week of {month} {n}'], digest: ['Week busy free event create guests'], minutes: [2, 5] },
          { app: A.gmail, titles: ['Re: Meeting request: {name} - Gmail'], digest: ['Reply works for me invite sent'], minutes: [1, 4] },
        ],
      },
    ],
  },
  {
    name: 'synth-support-lead',
    description: 'Support lead: refunds, bug escalations, daily metrics',
    workflows: [
      {
        id: 'refunds',
        label: 'Zendesk refund ticket → Stripe refund → reply',
        perWeek: 12,
        steps: [
          { app: A.zendesk, titles: ['Ticket #{n} refund request – Zendesk'], digest: ['refund request order charged twice customer'], minutes: [1, 4] },
          { app: A.stripe, titles: ['Search: {name} – Stripe', 'Payments – Stripe'], digest: ['Search customers payments charge succeeded'], minutes: [1, 4] },
          { app: A.stripe, titles: ['Refund payment – Stripe'], digest: ['Refund payment amount reason requested by customer'], minutes: [1, 3] },
          { app: A.zendesk, titles: ['Ticket #{n} refund request – Zendesk'], digest: ['Public reply refund issued submit as solved'], minutes: [2, 5] },
        ],
      },
      {
        id: 'escalation',
        label: 'Zendesk bug report → Jira issue → Slack',
        perWeek: 6,
        steps: [
          { app: A.zendesk, titles: ['Ticket #{n} error when exporting – Zendesk', 'Ticket #{n} app crash – Zendesk'], digest: ['bug error steps to reproduce browser version'], minutes: [3, 8] },
          { app: A.jira, titles: ['Create issue - Jira', 'SUP-{n} bug - Jira'], digest: ['Create issue bug summary description priority component'], minutes: [4, 10] },
          { app: A.slack, titles: ['eng-escalations (Channel) - Acme - Slack'], digest: ['eng escalations new bug filed customer impact'], minutes: [1, 3] },
        ],
      },
      {
        id: 'daily-metrics',
        label: 'Zendesk stats export → Sheets → Slack post',
        perWeek: 5,
        hour: 9,
        steps: [
          { app: A.zendesk, titles: ['Explore dashboard – Zendesk'], digest: ['tickets solved first reply time satisfaction export csv'], minutes: [2, 5] },
          { app: A.sheets, titles: ['Support metrics {month} - Google Sheets'], digest: ['support metrics solved backlog csat'], minutes: [5, 12] },
          { app: A.slack, titles: ['support-team (Channel) - Acme - Slack'], digest: ['support team daily numbers backlog csat'], minutes: [1, 4] },
        ],
      },
    ],
  },
];

interface Ctx {
  rng: Rng;
  events: ActivityEvent[];
  seq: number;
}

const fill = (rng: Rng, s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? (k === 'n' ? String(rng.int(1000, 9999)) : k === 'name' ? rng.pick(NAMES) : k === 'vendor' ? rng.pick(VENDORS) : k === 'month' ? rng.pick(MONTHS) : k));

/** A fresh, rarely repeating topic for one-off noise. */
const topic = (rng: Rng) => `${rng.pick(TOPICS)} ${rng.pick(WORDS)} ${rng.pick(WORDS)}`;

function push(c: Ctx, t: number, body: Record<string, unknown>) {
  c.events.push({ id: c.rng.uuid(), ts: new Date(Math.round(t)).toISOString(), seq: c.seq++, schemaVersion: 1, redactions: {}, ...body } as ActivityEvent);
}

function focus(c: Ctx, t: number, app: SynthApp, title: string) {
  push(c, t, { kind: 'app_focus', app: { key: app.key, name: app.name }, windowTitle: title, urlHost: app.host });
}

function digest(c: Ctx, t: number, app: SynthApp, text: string) {
  const d = { headings: text.split(' ').slice(0, 3), labels: [], text };
  push(c, t, { kind: 'text_digest', app: { key: app.key, name: app.name }, digest: d, digestHash: createHash('sha256').update(text).digest('hex') });
  if (c.rng.chance(0.05)) (c.events[c.events.length - 1] as { redactions: Record<string, number> }).redactions = { email: 1 };
}

/** Dwell in a window for `secs`, emitting digests, maybe clipboard + flicker. Returns end time. */
function dwell(c: Ctx, t: number, app: SynthApp, title: string, text: string, secs: number, opts: { clipboard?: boolean; flicker?: boolean } = {}): number {
  const { rng } = c;
  focus(c, t, app, title);
  digest(c, t + 1500, app, text);
  const end = t + secs * 1000;
  let u = t + rng.range(60, 200) * 1000;
  while (u < end - 5000) {
    if (rng.chance(0.5)) digest(c, u, app, text + (rng.chance(0.5) ? ' more' : ''));
    u += rng.range(60, 240) * 1000;
  }
  if (opts.clipboard) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) push(c, t + rng.range(0.2, 0.95) * secs * 1000, { kind: 'clipboard_change', app: { key: app.key, name: app.name }, contentKind: 'text' });
    c.events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }
  if (opts.flicker && secs > 30) {
    const ft = t + rng.range(0.3, 0.7) * secs * 1000;
    const other = rng.pick([A.slack, A.gmail, A.finder]);
    focus(c, ft, other, other === A.slack ? 'general (Channel) - Acme - Slack' : 'Inbox - Gmail');
    focus(c, ft + rng.range(0.8, 2.2) * 1000, app, title);
  }
  return end;
}

function idle(c: Ctx, t: number, secs: number): number {
  // agent emits idle_start after 120 s without input
  push(c, t + 120_000, { kind: 'idle_start', idleThresholdSeconds: 120 });
  push(c, t + secs * 1000, { kind: 'idle_end' });
  return t + secs * 1000;
}

function interruption(c: Ctx, t: number): number {
  const { rng } = c;
  if (rng.chance(0.6)) {
    return dwell(c, t, A.slack, rng.pick(['general (Channel) - Acme - Slack', `${rng.pick(NAMES)} (DM) - Acme - Slack`, 'random (Channel) - Acme - Slack']), 'message thread reply emoji', rng.range(20, 150));
  }
  return dwell(c, t, A.gmail, rng.pick(['Inbox (12) - Gmail', 'Inbox (3) - Gmail', `${topic(rng)} - Gmail`]), 'Inbox primary promotions', rng.range(30, 180));
}

/** One occurrence of a planted workflow, with step variation and interruptions. */
function runWorkflow(c: Ctx, t0: number, wf: WorkflowSpec): number {
  const { rng } = c;
  const vars = { n: String(rng.int(1000, 9999)), name: rng.pick(NAMES), vendor: rng.pick(VENDORS), month: rng.pick(MONTHS) };
  let steps = wf.steps.filter((s, i) => i === 0 || !rng.chance(s.skip ?? 0.08));
  if (steps.length > 3 && rng.chance(0.1)) {
    const i = rng.int(1, steps.length - 2);
    steps = [...steps];
    [steps[i], steps[i + 1]] = [steps[i + 1]!, steps[i]!];
  }
  let t = t0;
  steps.forEach((s, i) => {
    const title = fill(rng, rng.pick(s.titles), vars);
    const text = rng.pick(s.digest);
    const secs = rng.range(s.minutes[0], s.minutes[1]) * 60;
    if (rng.chance(0.2) && secs > 120) {
      // interruption in the middle of the step, then return to it
      const half = secs * rng.range(0.3, 0.7);
      t = dwell(c, t, s.app, title, text, half, { clipboard: s.clipboard });
      t = interruption(c, t);
      t = dwell(c, t, s.app, title, text, secs - half, { flicker: rng.chance(0.15) });
    } else {
      t = dwell(c, t, s.app, title, text, secs, { clipboard: s.clipboard, flicker: rng.chance(0.15) });
    }
    if (i < steps.length - 1) {
      if (rng.chance(0.12)) t = dwell(c, t, A.search, `${topic(rng)} - Google Search`, topic(rng), rng.range(30, 120));
      if (rng.chance(0.2)) t = interruption(c, t);
      if (rng.chance(0.06)) t = idle(c, t, rng.range(150, 300));
    }
  });
  return t;
}

/** One-off / non-workflow activity. */
function noise(c: Ctx, t: number, maxSecs: number): number {
  const { rng } = c;
  const kind = rng.int(0, 7);
  const secs = Math.min(maxSecs, rng.range(3, 25) * 60);
  switch (kind) {
    case 0:
      return dwell(c, t, A.slack, rng.pick(['general (Channel) - Acme - Slack', `${rng.pick(NAMES)} (DM) - Acme - Slack`]), 'messages threads', secs * 0.5);
    case 1:
      return dwell(c, t, A.gmail, 'Inbox - Gmail', 'Inbox primary', secs * 0.5);
    case 2:
      return dwell(c, t, rng.pick([A.news, A.youtube, A.wiki]), topic(rng), topic(rng), secs);
    case 3: {
      const tp = topic(rng);
      let u = dwell(c, t, rng.pick([A.docs, A.notion]), tp, `${tp} ${rng.pick(WORDS)}`, secs * 0.7);
      if (rng.chance(0.5)) u = dwell(c, u, A.search, `${topic(rng)} - Google Search`, topic(rng), rng.range(30, 200));
      return u;
    }
    case 4:
      return dwell(c, t, A.zoom, 'Zoom Meeting', 'meeting participants', Math.min(maxSecs, rng.pick([15, 30, 45]) * 60));
    case 5: {
      // random multi-app one-off
      let u = t;
      const apps = rng.shuffle([A.sheets, A.docs, A.gmail, A.slack, A.wiki, A.notion]).slice(0, 3);
      for (const a of apps) u = dwell(c, u, a, topic(rng), topic(rng), rng.range(1, 6) * 60);
      return u;
    }
    case 6: {
      // excluded app (password manager) then back
      push(c, t, { kind: 'capture_state', state: 'excluded_app_active', reason: null });
      return dwell(c, t + rng.range(20, 90) * 1000, A.gmail, 'Inbox - Gmail', 'Inbox', 60);
    }
    default:
      return dwell(c, t, A.gcal, 'Google Calendar - Today', 'events today', rng.range(0.5, 2) * 60);
  }
}

export interface SynthResult {
  events: ActivityEvent[];
  groundTruth: GroundTruth;
}

export function synthesize(persona: PersonaSpec, seed: number, opts: { days?: number; startsAt?: string; weekend?: boolean } = {}): SynthResult {
  const rng = new Rng(seed);
  const c: Ctx = { rng, events: [], seq: 0 };
  const days = opts.days ?? 7;
  const start = Date.parse(opts.startsAt ?? '2026-11-02T00:00:00.000Z'); // a Monday
  const workdays = Array.from({ length: days }, (_, d) => d).filter((d) => opts.weekend === true || d % 7 < 5);
  const occurrences = new Map<string, { start: string; end: string }[]>(persona.workflows.map((w) => [w.id, []]));

  // assign occurrences to days
  const agenda = new Map<number, WorkflowSpec[]>(workdays.map((d) => [d, []]));
  const weeks = days / 7;
  for (const wf of persona.workflows) {
    const n = Math.max(3, Math.round(wf.perWeek * weeks));
    for (let i = 0; i < n; i++) {
      const d = n >= workdays.length && i < workdays.length ? workdays[i]! : rng.pick(workdays);
      agenda.get(d)!.push(wf);
    }
  }
  const pauseDay = rng.pick(workdays);

  for (const d of workdays) {
    const dayStart = start + d * 86_400_000;
    let t = dayStart + rng.range(8.5, 9.2) * 3_600_000;
    const dayEnd = dayStart + rng.range(17, 18) * 3_600_000;
    push(c, t - 5000, { kind: 'capture_state', state: 'started', reason: null });
    const list = rng.shuffle([...agenda.get(d)!]);
    // scheduled workflows first-ish
    list.sort((a, b) => (a.hour ?? 99) - (b.hour ?? 99));
    let lunch = false;
    let paused = d !== pauseDay;
    for (const wf of list) {
      t = noise(c, t, 20 * 60);
      if (rng.chance(0.35)) t = idle(c, t, rng.range(180, 1200));
      if (!lunch && t > dayStart + 12 * 3_600_000) {
        t = idle(c, t, rng.range(1800, 3600));
        lunch = true;
      }
      if (!paused && t > dayStart + 14 * 3_600_000) {
        push(c, t, { kind: 'capture_state', state: 'paused', reason: 'user' });
        t += 30 * 60_000;
        push(c, t, { kind: 'capture_state', state: 'resumed', reason: null });
        paused = true;
      }
      const s = t;
      t = runWorkflow(c, t, wf);
      occurrences.get(wf.id)!.push({ start: new Date(s).toISOString(), end: new Date(Math.round(t)).toISOString() });
    }
    while (t < dayEnd) t = noise(c, t, 25 * 60);
    push(c, t, { kind: 'idle_start', idleThresholdSeconds: 120 });
    push(c, t + 1000, { kind: 'capture_state', state: 'stopped', reason: 'end of day' });
  }
  c.events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.seq - b.seq);
  const gt: GroundTruth = {
    persona: `${persona.name}-s${seed}`,
    description: persona.description,
    startsAt: new Date(start).toISOString(),
    days,
    workflows: persona.workflows.map((w) => {
      const occ = occurrences.get(w.id)!;
      const mins = occ.reduce((a, o) => a + (Date.parse(o.end) - Date.parse(o.start)) / 60000, 0);
      return {
        id: w.id,
        label: w.label,
        path: w.steps.map((s) => ({ appKey: s.app.key, action: 'unknown' })),
        occurrences: occ,
        minutesPerWeek: Math.round((mins / days) * 7),
      };
    }),
    distractors: ['slack chatter', 'inbox checks', 'news / video browsing', 'one-off docs', 'meetings'],
  };
  return { events: c.events, groundTruth: gt };
}
