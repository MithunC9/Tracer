import type { ActionVerb, AppCategory } from '@tracer/schema';
import { appCategory } from './apps.js';

/**
 * Coarse action inference from redacted window title / digest text / clipboard signals.
 * Order of evidence: window title keywords > clipboard activity > digest keywords >
 * very short visit (navigate) > the app category's typical action.
 */
const RULES: ReadonlyArray<readonly [ActionVerb, RegExp]> = [
  ['reconcile', /\breconcil|\bmatch(ing)? transactions|\bbank feed|\bbank rec\b|\bcategori[sz]e transactions/],
  ['approve', /\bapprov|\bsign[- ]?off\b|\bpay (bill|now|invoice)|\bauthori[sz]e payment|\bsubmit payment|\bsend payment/],
  ['export', /\bexport|\.csv\b|\bcsv\b|\bdownload (csv|report|statement)/],
  ['import', /\bimport|\bbulk upload|\bupload (csv|file|statement)/],
  ['upload', /\bupload|\battach file/],
  ['download', /\bdownload/],
  ['compose', /\bcompose|\breply\b|\bnew (message|email|post|mail)|\bdraft|\bforward\b|\bwrite\b|\bnew conversation/],
  ['schedule', /\bschedul|\bbook (a )?(meeting|call)|\bnew event|\bcalendar invite|\bavailability|\breschedul/],
  ['review', /\breview|\bpull request|\bproofread|\binspect|\bqa\b|\baudit\b/],
  ['search', /\bsearch|\bresults for\b|\bfind\b|\blook ?up\b/],
  ['edit', /\bedit|\bupdate|\bnew (invoice|record|contact|deal|ticket|row|entry)|\bcreate (invoice|record|contact|deal|ticket)|\bdata entry|\bfill/],
  ['read', /\binbox\b|\bunread\b|\bnotifications?\b|\bfeed\b|\bthread\b/],
];

const CATEGORY_DEFAULT: Partial<Record<AppCategory, ActionVerb>> = {
  email: 'read',
  chat: 'read',
  spreadsheet: 'edit',
  docs: 'edit',
  crm: 'edit',
  accounting: 'edit',
  calendar: 'schedule',
  meetings: 'read',
  design: 'edit',
  coding: 'edit',
  terminal: 'edit',
  files: 'navigate',
  support: 'read',
  payments: 'read',
  ecommerce: 'edit',
  marketing: 'edit',
  notes: 'edit',
  ai_assistant: 'compose',
  project_management: 'edit',
  banking: 'read',
};

/** Categories where a clipboard hand-off from another app reads as "paste". */
const PASTE_TARGETS = new Set<AppCategory>(['spreadsheet', 'docs', 'crm', 'accounting', 'email', 'support', 'project_management', 'notes', 'ecommerce', 'payments', 'marketing']);

export interface ActionSignals {
  appKey: string;
  title: string | null;
  digestText: string;
  activeSeconds: number;
  /** Clipboard changes during this session (something was copied here). */
  clipboardEvents: number;
  /** The immediately preceding session, in another app, copied something. */
  clipboardFromPrevious: boolean;
}

export function matchVerb(text: string): ActionVerb | null {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [verb, re] of RULES) if (re.test(t)) return verb;
  return null;
}

export function inferAction(s: ActionSignals): ActionVerb {
  const fromTitle = matchVerb(s.title ?? '');
  if (fromTitle) return fromTitle;
  const cat = appCategory(s.appKey);
  if (s.clipboardEvents > 0) return 'copy';
  if (s.clipboardFromPrevious && PASTE_TARGETS.has(cat)) return 'paste';
  const fromDigest = matchVerb(s.digestText);
  if (fromDigest) return fromDigest;
  if (s.activeSeconds < 15) return 'navigate';
  return CATEGORY_DEFAULT[cat] ?? 'read';
}

/** Verbs that a rule can do without judgement. */
export const DETERMINISTIC_VERBS: ReadonlySet<ActionVerb> = new Set(['copy', 'paste', 'export', 'import', 'upload', 'download', 'navigate']);
/** Verbs that need a person's judgement. */
export const JUDGEMENT_VERBS: ReadonlySet<ActionVerb> = new Set(['compose', 'review', 'approve', 'edit']);

/** 1 = rule-based, 0 = judgement, 0.5 = could go either way (read, search, schedule, reconcile, unknown). */
export function ruleWeight(v: ActionVerb): number {
  if (DETERMINISTIC_VERBS.has(v)) return 1;
  if (JUDGEMENT_VERBS.has(v)) return 0;
  return 0.5;
}

const VERB_LABEL: Record<ActionVerb, string> = {
  read: 'Read',
  compose: 'Write',
  edit: 'Edit',
  search: 'Search',
  export: 'Export',
  import: 'Import',
  copy: 'Copy from',
  paste: 'Paste into',
  upload: 'Upload to',
  download: 'Download from',
  review: 'Review',
  approve: 'Approve',
  schedule: 'Schedule',
  reconcile: 'Reconcile',
  navigate: 'Open',
  unknown: 'Use',
};

/** "Export CSV in Stripe Dashboard", "Paste into Google Sheets". */
export function stepLabel(verb: ActionVerb, app: string, title: string | null): string {
  const csv = verb === 'export' || verb === 'import' ? (/\bcsv\b|\.csv\b/i.test(title ?? '') ? ' CSV' : '') : '';
  const base = VERB_LABEL[verb];
  const sep = base.endsWith(' from') || base.endsWith(' into') || base.endsWith(' to') ? ' ' : ' in ';
  const label = verb === 'navigate' || verb === 'unknown' ? `${base} ${app}` : `${base}${csv}${sep}${app}`;
  return label.slice(0, 120);
}
