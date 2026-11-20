import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_BY_KEY, Recipe } from '@tracer/schema';
import type { ActionVerb, CapabilityTag, RiskTag } from '@tracer/schema';
import { RISK_CHECKPOINTS, TEMPLATES, recipeFor, selectTemplate, type RecipeInput } from '../src/index.js';
import { recipeInputArb } from './arbitraries.js';

const HYPE = /\b(supercharge|unlock|leverage|seamless(ly)?|revolutioni[sz]e|game[- ]changer|effortless(ly)?)\b/i;

const input = (
  path: [string, ActionVerb, string][],
  caps: CapabilityTag[],
  opts: { label?: string; risk?: RiskTag[]; judgement?: boolean; apps?: string[] } = {},
): RecipeInput => ({
  label: opts.label ?? 'Workflow',
  canonicalPath: path.map(([appKey, action, label]) => ({ appKey, action, label })),
  requirements: {
    capabilities: caps,
    apps: opts.apps ?? [...new Set(path.map((p) => p[0]))],
    trigger: 'manual',
    involvesJudgement: opts.judgement ?? false,
  },
  riskFlags: opts.risk ?? [],
});

const CASES: [string, RecipeInput][] = [
  ['csv-export-clean-import', input([['stripe', 'export', 'Export payouts CSV'], ['excel', 'edit', 'Clean columns'], ['quickbooks', 'import', 'Import to QuickBooks']], ['csv_transform', 'spreadsheet_rw'], { risk: ['money'] })],
  ['email-triage-filters', input([['gmail', 'read', 'Read inbox'], ['gmail', 'review', 'Label mail']], ['trigger_email', 'email_parse'])],
  ['invoice-generation', input([['google_sheets', 'read', 'Check hours'], ['quickbooks', 'compose', 'Create invoice'], ['gmail', 'compose', 'Send invoice']], ['invoice_create', 'spreadsheet_rw'], { risk: ['money', 'pii'] })],
  ['meeting-scheduling-link', input([['gmail', 'compose', 'Propose times'], ['google_calendar', 'schedule', 'Create event']], ['calendar_booking', 'email_send'])],
  ['crm-entry-from-email', input([['gmail', 'copy', 'Copy contact'], ['linkedin', 'copy', 'Copy title'], ['hubspot', 'paste', 'Create contact']], ['crm_sync', 'email_parse'], { risk: ['pii'] })],
  ['weekly-report-assembly', input([['salesforce', 'export', 'Export pipeline'], ['google_sheets', 'edit', 'Update numbers'], ['gmail', 'compose', 'Send report']], ['trigger_schedule', 'spreadsheet_rw', 'data_lookup'], { label: 'Weekly pipeline report' })],
  ['receipt-capture', input([['gmail', 'download', 'Download receipt'], ['xero', 'upload', 'Attach receipt']], ['expense_capture', 'ocr'], { risk: ['money'] })],
  ['support-reply-templates', input([['zendesk', 'read', 'Read ticket'], ['zendesk', 'compose', 'Type reply']], ['email_templates'], { risk: ['pii'] })],
  ['file-rename-move', input([['finder', 'navigate', 'Open Downloads'], ['finder', 'edit', 'Rename PDF'], ['google_drive', 'upload', 'Move to Drive']], ['file_move', 'trigger_file'])],
  ['copy-paste-connector', input([['asana', 'copy', 'Copy task'], ['notion', 'paste', 'Paste into tracker']], ['task_create'])],
  ['social-posting-schedule', input([['google_docs', 'compose', 'Draft post'], ['linkedin', 'compose', 'Publish post']], ['scheduling_social'])],
  ['bank-reconciliation-rules', input([['bank_portal', 'export', 'Download statement'], ['quickbooks', 'reconcile', 'Match transactions']], ['bank_reconcile'], { risk: ['money', 'irreversible'] })],
  ['meeting-notes-summary', input([['zoom', 'read', 'Call'], ['notion', 'compose', 'Write notes']], ['meeting_notes', 'llm_summarize'], { judgement: true })],
  ['document-from-template', input([['hubspot', 'copy', 'Copy deal details'], ['google_docs', 'paste', 'Fill proposal']], ['doc_generation'])],
  ['browser-form-fill', input([['google_sheets', 'copy', 'Copy row'], ['browser', 'paste', 'Fill portal form']], ['browser_automation'])],
];

describe('recipe templates', () => {
  it('library has at least 12 templates with unique ids', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it.each(CASES)('matches %s', (expected, inp) => {
    expect(selectTemplate(inp).id).toBe(expected);
    expect(recipeFor(inp).templateId).toBe(expected);
  });

  it('every template is reachable by at least one case', () => {
    const hit = new Set(CASES.map(([id]) => id));
    for (const t of TEMPLATES) expect(hit.has(t.id), t.id).toBe(true);
  });

  it('falls back to the generic template when nothing matches', () => {
    const r = recipeFor(input([['figma', 'edit', 'Adjust frames'], ['canva', 'export', 'Export image']], ['approval_step']));
    expect(r.templateId).toBe('generic');
    expect(r.steps.length).toBeGreaterThan(2);
  });

  it('uses app display names and app-specific steps', () => {
    const outlook = recipeFor(input([['outlook', 'read', 'Read'], ['outlook', 'review', 'File']], ['trigger_email', 'email_parse']));
    expect(outlook.title).toContain('Outlook');
    expect(outlook.steps.some((s) => s.instruction.includes('Rules'))).toBe(true);
    const xero = recipeFor(input([['xero', 'reconcile', 'Reconcile']], ['bank_reconcile']));
    expect(xero.steps.every((s) => !s.instruction.includes('QuickBooks'))).toBe(true);
    const csv = recipeFor(CASES[0]![1]);
    expect(csv.title).toContain('Stripe Dashboard');
    expect(csv.title).toContain('QuickBooks Online');
  });

  it('keepHumanFor covers money, pii and irreversible risks', () => {
    const bank = recipeFor(CASES.find(([id]) => id === 'bank-reconciliation-rules')![1]);
    expect(bank.keepHumanFor).toContain(RISK_CHECKPOINTS.money);
    expect(bank.keepHumanFor).toContain(RISK_CHECKPOINTS.irreversible);
    const inv = recipeFor(CASES.find(([id]) => id === 'invoice-generation')![1]);
    expect(inv.keepHumanFor).toContain('Approve each invoice before it is sent');
    expect(inv.keepHumanFor).toContain(RISK_CHECKPOINTS.pii);
  });

  it('AI-drafted work gets a human review checkpoint', () => {
    const r = recipeFor(CASES.find(([id]) => id === 'meeting-notes-summary')![1]);
    expect(r.keepHumanFor.some((h) => /AI/.test(h))).toBe(true);
  });

  it('every case produces a valid, plainly worded recipe with numbered steps', () => {
    for (const [, inp] of CASES) {
      const r = recipeFor(inp);
      expect(Recipe.safeParse(r).success).toBe(true);
      r.steps.forEach((s, i) => expect(s.n).toBe(i + 1));
      const text = [r.title, ...r.prerequisites, ...r.steps.flatMap((s) => [s.instruction, s.note ?? '']), ...r.keepHumanFor].join(' ');
      expect(text, r.templateId).not.toMatch(HYPE);
      expect(text).not.toMatch(/undefined|null|\[object/);
      for (const s of r.steps) if (s.appKey) expect(APP_BY_KEY.has(s.appKey) || s.appKey.startsWith('other:'), s.appKey).toBe(true);
    }
  });

  it('fuzz: any input yields a recipe that validates and is deterministic', () => {
    fc.assert(
      fc.property(recipeInputArb, (inp) => {
        const r = recipeFor(inp);
        expect(Recipe.safeParse(r).success).toBe(true);
        expect(recipeFor(inp)).toEqual(r);
        for (const flag of inp.riskFlags) expect(r.keepHumanFor).toContain(RISK_CHECKPOINTS[flag]);
      }),
      { numRuns: 500, seed: 11 },
    );
  });
});
