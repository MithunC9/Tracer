import type { ActionVerb, AppCategory, CapabilityTag, ClusterRequirements, PathStep, TaskEpisode } from '@tracer/schema';
import { appCategory, appDef } from './apps.js';
import { toMs } from './util.js';

const BY_ACTION: Partial<Record<ActionVerb, CapabilityTag[]>> = {
  export: ['csv_transform'],
  import: ['csv_transform'],
  download: ['file_move'],
  upload: ['file_move'],
  copy: ['data_lookup'],
  paste: ['data_lookup'],
  compose: ['llm_draft'],
  review: ['llm_summarize'],
  approve: ['approval_step'],
  schedule: ['calendar_booking'],
  reconcile: ['bank_reconcile'],
  search: ['data_lookup'],
};

const BY_CATEGORY: Partial<Record<AppCategory, CapabilityTag[]>> = {
  email: ['email_parse'],
  spreadsheet: ['spreadsheet_rw'],
  crm: ['crm_sync'],
  accounting: ['invoice_create'],
  payments: ['data_lookup'],
  banking: ['bank_reconcile'],
  calendar: ['calendar_booking'],
  meetings: ['meeting_notes'],
  chat: ['chat_notify'],
  project_management: ['task_create'],
  docs: ['doc_generation'],
  files: ['file_move'],
  support: ['llm_classify'],
  ecommerce: ['data_lookup'],
  marketing: ['scheduling_social'],
  coding: ['code_automation'],
  terminal: ['code_automation'],
  ai_assistant: ['llm_draft'],
  notes: ['doc_generation'],
};

/** Order-preserving unique. */
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Circular standard deviation of minutes-of-day, in minutes. */
export function timeOfDaySpreadMinutes(startsIso: readonly string[]): number {
  if (startsIso.length < 2) return Number.POSITIVE_INFINITY;
  let sx = 0;
  let sy = 0;
  for (const iso of startsIso) {
    const d = new Date(toMs(iso));
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    const a = (m / 1440) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const R = Math.min(1, Math.sqrt(sx * sx + sy * sy) / startsIso.length);
  if (R <= 0) return Number.POSITIVE_INFINITY;
  return (Math.sqrt(-2 * Math.log(R)) * 1440) / (2 * Math.PI);
}

/**
 * Trigger guess: `schedule` when it happens about once per day it is seen and starts at a
 * similar time of day (spread <= 75 min); `event` when it starts by reading an inbox, a
 * ticket queue or chat (something arrives); otherwise `manual`.
 */
export function guessTrigger(path: readonly PathStep[], members: readonly TaskEpisode[]): ClusterRequirements['trigger'] {
  const days = new Set(members.map((m) => m.dayIndex)).size;
  if (days >= 3 && members.length <= Math.ceil(days * 1.5) && timeOfDaySpreadMinutes(members.map((m) => m.start)) <= 75) return 'schedule';
  const first = path[0];
  if (first && ['email', 'support', 'chat'].includes(appCategory(first.appKey)) && ['read', 'copy', 'review'].includes(first.action)) return 'event';
  return 'manual';
}

export function deriveRequirements(path: readonly PathStep[], members: readonly TaskEpisode[]): ClusterRequirements {
  const apps = uniq(path.map((s) => s.appKey));
  const caps: CapabilityTag[] = [];
  for (const s of path) caps.push(...(BY_ACTION[s.action] ?? []));
  for (const a of apps) {
    const cat = appCategory(a);
    caps.push(...(BY_CATEGORY[cat] ?? []));
    if (cat === 'email' && path.some((s) => s.appKey === a && s.action === 'compose')) caps.push('email_send', 'email_templates');
    if (cat === 'spreadsheet' && path.some((s) => s.action === 'export' || s.action === 'import')) caps.push('csv_transform');
    const def = appDef(a);
    if (!def || (!def.automation.api && !def.automation.noCode)) {
      caps.push(def && def.hosts.length === 0 ? 'desktop_automation' : 'browser_automation');
    }
  }
  const trigger = guessTrigger(path, members);
  if (trigger === 'schedule') caps.unshift('trigger_schedule');
  if (trigger === 'event') caps.unshift(appCategory(path[0]!.appKey) === 'email' ? 'trigger_email' : 'trigger_webhook');
  const judgement = path.filter((s) => s.action === 'compose' || s.action === 'review' || s.action === 'approve').length;
  const capabilities = uniq(caps);
  return {
    capabilities: capabilities.length ? capabilities : ['browser_automation'],
    apps,
    trigger,
    involvesJudgement: path.length > 0 && judgement / path.length >= 0.4,
  };
}
