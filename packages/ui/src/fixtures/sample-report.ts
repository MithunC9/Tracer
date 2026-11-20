/**
 * A hand-written sample AuditReport for the /design page and component tests.
 *
 * Persona: Mara runs operations for a five-person online ceramics shop. She ran a
 * 7-day audit. Workflows, times and narratives are written by hand; every derived
 * number (weekly hours, scores, confidence, totals) is computed with the same
 * functions the pipeline uses, so the fixture can never drift from the formula.
 */
import {
  AFFILIATE_DISCLOSURE,
  automationPotential,
  confidence,
  confidenceLabel,
  reclaimableHours,
  round,
  SCORING,
  weeklyHours,
  type AuditReport,
  type CalcStep,
  type Finding,
  type PathStep,
  type Recipe,
  type RankedTool,
  type RiskTag,
} from '@tracer/schema';

const START = Date.parse('2026-11-16T00:00:00.000Z'); // Monday
const DAYS = 7;

type Occ = [day: number, time: string, minutes: number];

function evidence(prefix: string, occ: Occ[]) {
  return occ.map(([day, time, minutes], i) => {
    const [h, m] = time.split(':').map(Number) as [number, number];
    const start = START + day * 86_400_000 + (h * 60 + m) * 60_000;
    return {
      episodeId: `ep_${prefix}_${String(i + 1).padStart(2, '0')}`,
      start: new Date(start).toISOString(),
      end: new Date(start + minutes * 60_000).toISOString(),
      minutes,
      dayIndex: day,
    };
  });
}

interface Draft {
  id: string;
  label: string;
  path: PathStep[];
  occ: Occ[];
  repeatability: number;
  ruleBasedShare: number;
  integrationFeasibility: number;
  risk: number;
  riskFlags: RiskTag[];
  cohesion: number;
  recipe: Recipe;
  tools: RankedTool[];
  diy: Finding['diyOption'];
  why: (n: Numbers) => string;
  headline: (n: Numbers) => string;
  body: (n: Numbers) => string;
}

interface Numbers {
  occurrences: number;
  daysSeen: number;
  avgMinutes: number;
  weeklyHours: number;
  ap: number;
  reclaim: number;
}

function build(d: Draft, rank: number): Finding {
  const ev = evidence(d.id.slice(3, 9), d.occ);
  const totalMinutes = ev.reduce((a, e) => a + e.minutes, 0);
  const occurrences = ev.length;
  const daysSeen = new Set(ev.map((e) => e.dayIndex)).size;
  const avgMinutes = round(totalMinutes / occurrences, 1);
  const wh = weeklyHours(totalMinutes, DAYS);
  const ap = automationPotential(d);
  const conf = confidence({ occurrences, daysSeen, daysObserved: DAYS, cohesion: d.cohesion });
  const reclaim = reclaimableHours(wh, ap);
  const n: Numbers = { occurrences, daysSeen, avgMinutes, weeklyHours: wh, ap, reclaim };
  return {
    id: d.id,
    rank,
    label: d.label,
    path: d.path,
    metrics: { occurrences, daysSeen, totalMinutes, avgMinutes, weeklyHours: wh },
    score: {
      formulaVersion: SCORING.version,
      inputs: {
        weeklyHours: wh,
        repeatability: d.repeatability,
        ruleBasedShare: d.ruleBasedShare,
        integrationFeasibility: d.integrationFeasibility,
        risk: d.risk,
        riskFlags: d.riskFlags,
        occurrences,
        daysSeen,
        daysObserved: DAYS,
        cohesion: d.cohesion,
      },
      outputs: {
        automationPotential: ap,
        confidence: conf,
        confidenceLabel: confidenceLabel(conf),
        reclaimableHoursPerWeek: reclaim,
        why: d.why(n),
      },
    },
    evidence: ev,
    recipe: d.recipe,
    tools: d.tools,
    diyOption: d.diy,
    narrative: { headline: d.headline(n), body: d.body(n) },
    allowedNumbers: [occurrences, daysSeen, avgMinutes, wh, ap, reclaim, totalMinutes, DAYS],
  };
}

const zapier = (rank: number, fit: number, reasons: RankedTool['reasons']): RankedTool => ({
  entryId: 'zapier',
  name: 'Zapier',
  vendor: 'Zapier Inc.',
  rank,
  fitScore: fit,
  reasons,
  pricingTier: 'freemium',
  priceNote: 'Free for 100 tasks/month; paid from $20/month',
  setupEffort: 'hour',
  url: 'https://zapier.com',
  affiliate: { url: 'https://zapier.com/?utm_source=tracer&ref=tracer-audit', disclosure: AFFILIATE_DISCLOSURE },
});

const n8n = (rank: number, fit: number, reasons: RankedTool['reasons']): RankedTool => ({
  entryId: 'n8n',
  name: 'n8n',
  vendor: 'n8n GmbH',
  rank,
  fitScore: fit,
  reasons,
  pricingTier: 'free',
  priceNote: 'Free to self-host; cloud from $24/month',
  setupEffort: 'afternoon',
  url: 'https://n8n.io',
  affiliate: null,
});

const drafts: Draft[] = [
  {
    id: 'wf_3a9c41e07b',
    label: 'Reconcile Stripe payouts in QuickBooks',
    path: [
      { appKey: 'stripe', action: 'export', label: 'Export payouts CSV in Stripe' },
      { appKey: 'excel', action: 'edit', label: 'Match fees and refunds in Excel' },
      { appKey: 'quickbooks', action: 'reconcile', label: 'Reconcile deposits in QuickBooks' },
    ],
    occ: [
      [0, '09:12', 44],
      [1, '09:05', 39],
      [2, '09:20', 47],
      [3, '09:08', 36],
      [4, '09:31', 41],
      [5, '10:40', 12],
    ],
    repeatability: 0.92,
    ruleBasedShare: 0.85,
    integrationFeasibility: 0.9,
    risk: 0.4,
    riskFlags: ['money'],
    cohesion: 0.88,
    why: () => 'Same three apps in the same order every morning, and most steps are matching numbers. Money is involved, so the score is halved for risk weight.',
    headline: (n) => `Your mornings start with ${n.avgMinutes} minutes of matching Stripe payouts by hand`,
    body: (n) =>
      `You exported payouts from Stripe, cleaned the CSV in Excel and reconciled deposits in QuickBooks on ${n.daysSeen} of 7 days. The steps barely changed. Fees and refunds were matched by eye each time.\n\nThis is the workflow with the most time to win back: about ${n.reclaim} hours a week. A sync tool can post payouts with fees split out; you keep the final reconcile click.`,
    recipe: {
      templateId: 'payout-sync',
      title: 'Post Stripe payouts to QuickBooks automatically',
      prerequisites: ['Admin access to Stripe and QuickBooks Online', 'A clearing account in QuickBooks for Stripe'],
      steps: [
        { n: 1, instruction: 'In QuickBooks, create a bank account called "Stripe clearing".', appKey: 'quickbooks', note: null },
        { n: 2, instruction: 'Connect Stripe to your automation tool and trigger on "payout paid".', appKey: 'stripe', note: 'Payouts arrive once a day.' },
        { n: 3, instruction: 'For each payout, create a deposit in Stripe clearing with gross sales, fees and refunds as separate lines.', appKey: 'quickbooks', note: 'Fees go to "Merchant fees".' },
        { n: 4, instruction: 'Once a week, open QuickBooks and reconcile the clearing account against your bank feed.', appKey: 'quickbooks', note: 'About 5 minutes.' },
      ],
      estSetupMinutes: 60,
      difficulty: 'moderate',
      keepHumanFor: ['Approving the weekly reconcile', 'Disputes and chargebacks'],
    },
    tools: [
      zapier(1, 86, [
        { factor: 'capability', delta: 30, note: 'Stripe trigger and QuickBooks deposit action' },
        { factor: 'integration', delta: 24, note: 'Native connectors for both apps' },
        { factor: 'skill', delta: 12, note: 'No code needed' },
        { factor: 'budget', delta: -4, note: 'Needs a paid plan for multi-step zaps' },
      ]),
      n8n(2, 74, [
        { factor: 'capability', delta: 28, note: 'Stripe and QuickBooks nodes' },
        { factor: 'open_source', delta: 8, note: 'Self-hostable; data stays with you' },
        { factor: 'effort', delta: -10, note: 'Hosting takes an afternoon' },
      ]),
    ],
    diy: { label: 'QuickBooks bank rules plus a saved Excel macro for the CSV', estSetupMinutes: 45, cost: 'free' },
  },
  {
    id: 'wf_b71d0c9f24',
    label: 'Copy Shopify orders into the packing sheet',
    path: [
      { appKey: 'shopify', action: 'copy', label: 'Copy order details in Shopify' },
      { appKey: 'google_sheets', action: 'paste', label: 'Paste into Packing sheet' },
    ],
    occ: [
      [0, '10:15', 13],
      [0, '15:40', 11],
      [1, '10:02', 12],
      [1, '15:55', 14],
      [2, '10:30', 12],
      [2, '16:10', 10],
      [3, '10:11', 13],
      [3, '15:45', 12],
      [4, '10:20', 14],
      [4, '15:30', 11],
      [5, '11:05', 10],
    ],
    repeatability: 0.88,
    ruleBasedShare: 0.9,
    integrationFeasibility: 0.95,
    risk: 0.1,
    riskFlags: ['pii'],
    cohesion: 0.91,
    why: () => 'A straight copy from one app to another, twice a day. Both apps have open APIs. Customer addresses are personal data, so a small risk weight applies.',
    headline: (n) => `Twice a day you retype orders into a sheet that could fill itself`,
    body: (n) =>
      `On ${n.daysSeen} days you copied new Shopify orders into the packing sheet, ${n.occurrences} times in all. Each pass took ${n.avgMinutes} minutes on average.\n\nThe sheet only needs order number, items and shipping address. A new-order trigger can append a row the moment an order lands.`,
    recipe: {
      templateId: 'order-to-sheet',
      title: 'Append each new Shopify order to the packing sheet',
      prerequisites: ['Shopify staff account with order access', 'The packing sheet in Google Drive'],
      steps: [
        { n: 1, instruction: 'Add a header row to the sheet: Order, Date, Items, Name, Address, Packed.', appKey: 'google_sheets', note: null },
        { n: 2, instruction: 'Trigger on "new paid order" in Shopify.', appKey: 'shopify', note: null },
        { n: 3, instruction: 'Append one row per order. Leave "Packed" empty for you to tick.', appKey: 'google_sheets', note: 'One row per order, not per item.' },
      ],
      estSetupMinutes: 30,
      difficulty: 'easy',
      keepHumanFor: ['Ticking orders as packed', 'Gift notes that need a hand-written card'],
    },
    tools: [
      zapier(1, 91, [
        { factor: 'capability', delta: 32, note: 'New order trigger, append row action' },
        { factor: 'integration', delta: 26, note: 'Shopify and Sheets both native' },
        { factor: 'effort', delta: 8, note: 'Under an hour' },
      ]),
      {
        entryId: 'shopify-flow',
        name: 'Shopify Flow',
        vendor: 'Shopify',
        rank: 2,
        fitScore: 78,
        reasons: [
          { factor: 'budget', delta: 14, note: 'Included in your plan' },
          { factor: 'capability', delta: 22, note: 'Can send order data to a sheet via connector' },
          { factor: 'integration', delta: -6, note: 'Sheets step needs a third-party connector' },
        ],
        pricingTier: 'included',
        priceNote: 'Included with Shopify',
        setupEffort: 'hour',
        url: 'https://apps.shopify.com/flow',
        affiliate: null,
      },
    ],
    diy: { label: 'A Google Apps Script that pulls new orders every 15 minutes', estSetupMinutes: 40, cost: 'free' },
  },
  {
    id: 'wf_5e28f6a1c3',
    label: 'Answer “where is my order” emails',
    path: [
      { appKey: 'gmail', action: 'read', label: 'Read customer email' },
      { appKey: 'shopify', action: 'search', label: 'Look up order status' },
      { appKey: 'gmail', action: 'compose', label: 'Reply with tracking link' },
    ],
    occ: [
      [0, '11:02', 6],
      [0, '13:47', 8],
      [0, '16:30', 7],
      [1, '11:20', 7],
      [1, '14:05', 6],
      [1, '17:12', 9],
      [2, '11:40', 6],
      [2, '14:22', 8],
      [2, '16:58', 7],
      [3, '10:55', 7],
      [3, '13:30', 6],
      [3, '17:01', 8],
      [4, '11:15', 7],
      [4, '14:40', 7],
      [4, '16:20', 6],
      [5, '12:10', 9],
      [6, '18:05', 8],
      [6, '18:30', 7],
    ],
    repeatability: 0.74,
    ruleBasedShare: 0.55,
    integrationFeasibility: 0.8,
    risk: 0.2,
    riskFlags: ['pii'],
    cohesion: 0.72,
    why: () => 'Frequent and short. The lookup is mechanical, but each reply needs a little judgement about tone and delays.',
    headline: (n) => `${n.occurrences} order-status replies, each one a lookup you could skip`,
    body: (n) =>
      `Customers asked where their order was ${n.occurrences} times this week, including on the weekend. Each reply took ${n.avgMinutes} minutes: find the order, copy the tracking link, write a line.\n\nA tracking page link in your shipping email would prevent many of these. For the rest, a reply template with the order looked up for you keeps the human tone and drops the lookup.`,
    recipe: {
      templateId: 'wismo-template',
      title: 'Answer order-status emails with a filled-in template',
      prerequisites: ['Gmail templates turned on', 'Tracking numbers stored on Shopify orders'],
      steps: [
        { n: 1, instruction: 'Add a "Track your order" link to the Shopify shipping confirmation email.', appKey: 'shopify', note: 'This alone cuts the volume.' },
        { n: 2, instruction: 'Save a Gmail template: thanks, current status, tracking link, a line about delays.', appKey: 'gmail', note: null },
        { n: 3, instruction: 'Label incoming "where is my order" emails with a Gmail filter on common phrases.', appKey: 'gmail', note: null },
        { n: 4, instruction: 'Reply from the label with the template; paste the tracking link from the order.', appKey: 'gmail', note: 'Edit the tone when the order is late.' },
      ],
      estSetupMinutes: 25,
      difficulty: 'easy',
      keepHumanFor: ['Late or lost parcels', 'Upset customers'],
    },
    tools: [
      {
        entryId: 'gorgias',
        name: 'Gorgias',
        vendor: 'Gorgias',
        rank: 1,
        fitScore: 72,
        reasons: [
          { factor: 'capability', delta: 26, note: 'Shows Shopify order next to the email' },
          { factor: 'integration', delta: 20, note: 'Native Shopify and Gmail' },
          { factor: 'budget', delta: -12, note: 'Paid only, from $10/month' },
        ],
        pricingTier: 'paid',
        priceNote: 'From $10/month',
        setupEffort: 'hour',
        url: 'https://www.gorgias.com',
        affiliate: { url: 'https://www.gorgias.com/?ref=tracer', disclosure: AFFILIATE_DISCLOSURE },
      },
      zapier(2, 58, [
        { factor: 'capability', delta: 18, note: 'Can draft a reply with order status' },
        { factor: 'skill', delta: -6, note: 'Matching emails to orders needs care' },
      ]),
    ],
    diy: { label: 'A Gmail filter, a saved template and a tracking link in the shipping email', estSetupMinutes: 25, cost: 'free' },
  },
  {
    id: 'wf_c04e9b2d81',
    label: 'Check stock levels against the sheet',
    path: [
      { appKey: 'shopify', action: 'read', label: 'Read inventory in Shopify' },
      { appKey: 'google_sheets', action: 'edit', label: 'Update Stock sheet' },
    ],
    occ: [
      [0, '17:20', 9],
      [1, '17:35', 10],
      [2, '17:28', 8],
      [3, '17:40', 9],
      [4, '17:15', 9],
    ],
    repeatability: 0.8,
    ruleBasedShare: 0.7,
    integrationFeasibility: 0.85,
    risk: 0,
    riskFlags: [],
    cohesion: 0.84,
    why: () => 'Same check at the end of each workday. Reading numbers from one app into another is mechanical; deciding what to reorder is not.',
    headline: () => 'The end-of-day stock check is a report nobody needs to type',
    body: (n) =>
      `Every weekday around half past five you read inventory in Shopify and updated the stock sheet: ${n.occurrences} times, ${n.avgMinutes} minutes each. A scheduled export can write those numbers for you. You still decide what to reorder.`,
    recipe: {
      templateId: 'stock-export',
      title: 'Write Shopify stock levels to the sheet every evening',
      prerequisites: ['Shopify staff account with inventory access'],
      steps: [
        { n: 1, instruction: 'Schedule a daily trigger at 17:00.', appKey: null, note: null },
        { n: 2, instruction: 'Fetch inventory levels for all active products.', appKey: 'shopify', note: null },
        { n: 3, instruction: 'Overwrite the "Today" column in the stock sheet and highlight anything below its reorder point.', appKey: 'google_sheets', note: 'Keep yesterday’s column for comparison.' },
      ],
      estSetupMinutes: 35,
      difficulty: 'easy',
      keepHumanFor: ['Deciding what to reorder'],
    },
    tools: [
      n8n(1, 80, [
        { factor: 'capability', delta: 26, note: 'Schedule, Shopify and Sheets nodes' },
        { factor: 'budget', delta: 12, note: 'Free when self-hosted' },
      ]),
    ],
    diy: { label: 'A Google Sheets import from a Shopify inventory export link', estSetupMinutes: 20, cost: 'free' },
  },
  {
    id: 'wf_9f1a7d3e65',
    label: 'Chase unpaid wholesale invoices',
    path: [
      { appKey: 'quickbooks', action: 'review', label: 'Check overdue invoices' },
      { appKey: 'gmail', action: 'compose', label: 'Write reminder email' },
    ],
    occ: [
      [1, '14:30', 17],
      [3, '15:10', 15],
      [4, '11:45', 16],
    ],
    repeatability: 0.7,
    ruleBasedShare: 0.6,
    integrationFeasibility: 0.85,
    risk: 0.3,
    riskFlags: ['money'],
    cohesion: 0.69,
    why: () => 'Seen three times, so confidence is lower. QuickBooks can send reminders itself; the wording to long-standing stockists is a judgement call.',
    headline: () => 'Invoice reminders: QuickBooks can send the first one for you',
    body: (n) =>
      `Three times this week you checked overdue wholesale invoices and wrote reminders by hand, ${n.avgMinutes} minutes each. QuickBooks has built-in reminders. Turn them on for the first nudge and write only the second one yourself.`,
    recipe: {
      templateId: 'qb-reminders',
      title: 'Turn on automatic invoice reminders in QuickBooks',
      prerequisites: ['QuickBooks Online admin access'],
      steps: [
        { n: 1, instruction: 'Open Settings, then Sales, then Reminders, and turn on automatic reminders.', appKey: 'quickbooks', note: null },
        { n: 2, instruction: 'Set the first reminder to 3 days after the due date, in your own words.', appKey: 'quickbooks', note: 'Keep it short and friendly.' },
        { n: 3, instruction: 'Leave the second reminder off. You write that one.', appKey: null, note: null },
      ],
      estSetupMinutes: 15,
      difficulty: 'easy',
      keepHumanFor: ['Second reminders to long-standing stockists', 'Payment plans'],
    },
    tools: [],
    diy: { label: 'QuickBooks automatic reminders (already in your plan)', estSetupMinutes: 15, cost: 'free' },
  },
];

const built = drafts.map((d) => build(d, 1));
// Rank by reclaimable hours, as the pipeline does.
const findings: Finding[] = [...built]
  .sort((a, b) => b.score.outputs.reclaimableHoursPerWeek - a.score.outputs.reclaimableHoursPerWeek)
  .map((f, i) => ({ ...f, rank: i + 1 }));

const total = round(
  findings.reduce((a, f) => a + f.score.outputs.reclaimableHoursPerWeek, 0),
  1,
);

const calculation: CalcStep[] = [
  ...findings.map((f, i) => ({
    label: `Finding ${String(i + 1).padStart(2, '0')}: ${f.label}`,
    expression: `${f.metrics.weeklyHours} h × ${(f.score.outputs.automationPotential / 100).toFixed(2)} × ${SCORING.captureRate}`,
    value: f.score.outputs.reclaimableHoursPerWeek,
    unit: 'h/wk',
  })),
  { label: 'Reclaimable per week', expression: `sum of ${findings.length} findings`, value: total, unit: 'h/wk' },
];

const top = findings[0]!;
const observed = round(
  findings.reduce((a, f) => a + f.metrics.totalMinutes, 0) / 60,
  1,
);

export const sampleReport: AuditReport = {
  reportVersion: 1,
  auditId: '6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b',
  generatedAt: '2026-11-23T07:14:09.000Z',
  window: {
    startsAt: new Date(START).toISOString(),
    endsAt: new Date(START + DAYS * 86_400_000).toISOString(),
    daysPlanned: 7,
    daysObserved: DAYS,
    activeHoursObserved: 31.6,
    eventsAnalyzed: 18_442,
    pausedMinutes: 95,
    excludedApps: 3,
    excludedDomains: 7,
    redactionsApplied: 214,
  },
  summary: {
    reclaimableHoursPerWeek: total,
    calculation,
    topFindingId: top.id,
    narrative: {
      headline: `About ${total} hours a week of your work is copying, matching and retyping`,
      body: `Over 7 days Tracer found ${findings.length} workflows you repeated at least three times. Together they took ${observed} hours. The biggest one: ${top.label.charAt(0).toLowerCase() + top.label.slice(1)}. None of the fixes need new staff, and every one keeps you in charge of the decisions.`,
    },
    allowedNumbers: [total, findings.length, observed, 7, 3],
  },
  findings,
  methodology: [
    {
      title: 'What counts as a workflow',
      body: 'A sequence of apps and actions that recurred at least three times with a similar path. One-off tasks are not reported.',
    },
    {
      title: 'Weekly hours',
      body: 'Total minutes divided by calendar weeks observed. Seven days observed is one week, weekends included.',
    },
    {
      title: 'Reclaimable hours',
      body: `Weekly hours × automation potential × ${SCORING.captureRate}. The 0.7 is a deliberate haircut: automation never removes all of the time.`,
    },
    {
      title: 'Confidence',
      body: 'Rises with more occurrences, more distinct days and more consistent paths. Low confidence means: check this one yourself.',
    },
  ],
  limitations: [
    'Only work on this Mac was observed. Phone and paper work are invisible to Tracer.',
    'Paused time (95 minutes) and excluded apps are not in any number.',
    'One week is a sample. Month-end tasks will not show up in a 7-day audit.',
  ],
  generation: {
    provider: 'mock',
    model: 'deterministic-narrator-v1',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    cacheHits: 0,
    validator: { passed: true, checkedNumbers: 41 },
  },
};
