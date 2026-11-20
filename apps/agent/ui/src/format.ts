import type { ActivityEvent, AgentStatus, RedactionKind } from './adapter';

export const SELF_OBSERVATION_LINE = 'Tracer only observes your own work, on this computer, with your consent.';

export const REDACTION_LABELS: Record<RedactionKind, string> = {
  card_number: 'Card numbers',
  ssn: 'Social security numbers',
  email: 'Email addresses',
  phone: 'Phone numbers',
  api_key: 'Keys and tokens',
  high_entropy_token: 'Random-looking tokens',
  password_field: 'Password fields',
  iban: 'Bank account numbers (IBAN)',
  url_path: 'Web address paths',
};

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function relative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function modeLabel(s: AgentStatus): string {
  switch (s.mode) {
    case 'capturing':
      return 'Observing';
    case 'paused':
      return 'Paused';
    case 'auto_stopped':
      return 'Finished. The audit window has ended and nothing more is recorded.';
    case 'stopped':
      return 'Stopped';
    default:
      return s.paired ? 'Waiting for the audit to start' : 'Not paired';
  }
}

export function dayLine(s: AgentStatus): string | null {
  if (s.dayNumber == null || s.totalDays == null) return null;
  return `Day ${s.dayNumber} of ${s.totalDays}`;
}

/** One-line plain description of exactly what an event contains. */
export function describe(e: ActivityEvent): { what: string; detail: string } {
  switch (e.kind) {
    case 'app_focus':
      return { what: e.app.name, detail: [e.windowTitle ?? '(no title)', e.urlHost].filter(Boolean).join(' · ') };
    case 'text_digest': {
      const n = e.digest.headings.length + e.digest.labels.length;
      return { what: `${e.app.name}: screen text`, detail: [...e.digest.headings, ...e.digest.labels, e.digest.text].filter(Boolean).join(' / ') || `(${n} items)` };
    }
    case 'clipboard_change':
      return { what: `${e.app.name}: copied something`, detail: `kind: ${e.contentKind}. Contents are never read.` };
    case 'idle_start':
      return { what: 'Away', detail: `no input for ${e.idleThresholdSeconds} s` };
    case 'idle_end':
      return { what: 'Back', detail: '' };
    case 'capture_state':
      if (e.state === 'excluded_app_active') return { what: 'Excluded window', detail: 'Nothing about it was recorded.' };
      return { what: `Capture ${e.state.replace('_', ' ')}`, detail: e.reason ?? '' };
  }
}

export function redactionTotal(r: Partial<Record<RedactionKind, number>>): number {
  return Object.values(r).reduce((a, b) => a + (b ?? 0), 0);
}
