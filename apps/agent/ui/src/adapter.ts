/**
 * The only bridge between the UI and the agent. In the Tauri app it calls the Rust
 * commands in src-tauri/src/commands.rs; in a plain browser (`vite dev`) it uses an
 * in-memory mock so the screens can be built and reviewed without a Mac.
 *
 * Shapes mirror tracer-core's serde output (camelCase; ActivityEvent exactly as sent).
 */

export type Mode = 'idle' | 'capturing' | 'paused' | 'stopped' | 'auto_stopped';

export type RedactionKind =
  | 'card_number'
  | 'ssn'
  | 'email'
  | 'phone'
  | 'api_key'
  | 'high_entropy_token'
  | 'password_field'
  | 'iban'
  | 'url_path';

export type RedactionCounts = Partial<Record<RedactionKind, number>>;

export interface Exclusions {
  apps: string[];
  domains: string[];
  titleKeywords: string[];
  privateBrowsing: true;
}

export interface AgentStatus {
  mode: Mode;
  platform: 'macos' | 'windows' | 'linux' | 'simulated';
  paired: boolean;
  captureFrom: string | null;
  captureUntil: string | null;
  dayNumber: number | null;
  totalDays: number | null;
  pendingEvents: number;
  eventsToday: number;
  eventsSentTotal: number;
  lastUploadAt: string | null;
  lastUploadError: string | null;
  stopReason: string | null;
  exclusions: Exclusions;
}

interface EventBase {
  id: string;
  ts: string;
  seq: number;
  schemaVersion: 1;
  redactions: RedactionCounts;
}
export interface AppRef {
  key: string;
  name: string;
}
export type ActivityEvent = EventBase &
  (
    | { kind: 'app_focus'; app: AppRef; windowTitle: string | null; urlHost: string | null }
    | { kind: 'idle_start'; idleThresholdSeconds: number }
    | { kind: 'idle_end' }
    | { kind: 'clipboard_change'; app: AppRef; contentKind: 'text' | 'image' | 'file' | 'other' }
    | { kind: 'text_digest'; app: AppRef; digest: { headings: string[]; labels: string[]; text: string }; digestHash: string }
    | {
        kind: 'capture_state';
        state: 'started' | 'paused' | 'resumed' | 'stopped' | 'auto_stopped' | 'excluded_app_active';
        reason: string | null;
      }
  );

export interface StoredEvent {
  status: 'pending' | 'sent' | 'rejected';
  batchId: string | null;
  event: ActivityEvent;
}

export interface TodayView {
  events: StoredEvent[];
  redactions: RedactionCounts;
  pending: number;
  sent: number;
}

export interface PairResult {
  deviceId: string;
}

export interface AgentAdapter {
  readonly kind: 'tauri' | 'mock';
  status(): Promise<AgentStatus>;
  pause(): Promise<AgentStatus>;
  resume(): Promise<AgentStatus>;
  today(): Promise<TodayView>;
  getExclusions(): Promise<Exclusions>;
  setExclusions(ex: Exclusions): Promise<Exclusions>;
  /** Deletes everything stored on this computer. Calls nothing server-side. */
  deleteEverything(): Promise<void>;
  pair(code: string, deviceName: string): Promise<PairResult>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

class TauriAdapter implements AgentAdapter {
  readonly kind = 'tauri' as const;
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  status() {
    return this.call<AgentStatus>('status');
  }
  pause() {
    return this.call<AgentStatus>('pause');
  }
  resume() {
    return this.call<AgentStatus>('resume');
  }
  today() {
    return this.call<TodayView>('today');
  }
  getExclusions() {
    return this.call<Exclusions>('get_exclusions');
  }
  setExclusions(exclusions: Exclusions) {
    return this.call<Exclusions>('set_exclusions', { exclusions });
  }
  deleteEverything() {
    return this.call<void>('delete_everything');
  }
  pair(code: string, deviceName: string) {
    return this.call<PairResult>('pair', { code, deviceName });
  }
}

// ---------------------------------------------------------------- mock

const DEFAULT_EXCLUSIONS: Exclusions = {
  apps: ['bank_portal', 'password_manager', 'health_portal'],
  domains: ['chase.com', 'bankofamerica.com', 'wellsfargo.com', 'mercury.com', 'my.1password.com', 'vault.bitwarden.com', 'mychart.org', 'patient.portal'],
  titleKeywords: ['incognito', 'private browsing', 'inprivate', 'password', 'bank', 'medical', 'therapy'],
  privateBrowsing: true,
};

function mockEvents(now: Date): StoredEvent[] {
  const day = new Date(now);
  day.setHours(9, 0, 0, 0);
  const at = (min: number) => new Date(day.getTime() + min * 60_000).toISOString();
  let seq = 4120;
  const base = (min: number, redactions: RedactionCounts = {}) => ({
    id: crypto.randomUUID(),
    ts: at(min),
    seq: seq++,
    schemaVersion: 1 as const,
    redactions,
  });
  const ev: ActivityEvent[] = [
    { ...base(0), kind: 'capture_state', state: 'started', reason: null },
    { ...base(1), kind: 'app_focus', app: { key: 'excel', name: 'Microsoft Excel' }, windowTitle: 'Q3 invoices.xlsx', urlHost: null },
    {
      ...base(2, { email: 1, card_number: 1 }),
      kind: 'text_digest',
      app: { key: 'excel', name: 'Microsoft Excel' },
      digest: { headings: ['Invoices'], labels: ['Customer', 'Amount'], text: 'Acme Corp [REDACTED:email] card [REDACTED:card_number] total 1,240.00' },
      digestHash: 'a'.repeat(64),
    },
    { ...base(3), kind: 'clipboard_change', app: { key: 'excel', name: 'Microsoft Excel' }, contentKind: 'text' },
    { ...base(4, { url_path: 1, email: 1 }), kind: 'app_focus', app: { key: 'gmail', name: 'Google Chrome' }, windowTitle: 'Inbox (3) - [REDACTED:email] - Gmail', urlHost: 'mail.google.com' },
    { ...base(9), kind: 'capture_state', state: 'excluded_app_active', reason: null },
    { ...base(14, { url_path: 1 }), kind: 'app_focus', app: { key: 'quickbooks', name: 'Google Chrome' }, windowTitle: 'Invoices - QuickBooks', urlHost: 'app.qbo.intuit.com' },
    { ...base(20), kind: 'idle_start', idleThresholdSeconds: 120 },
    { ...base(35), kind: 'idle_end' },
    { ...base(36), kind: 'app_focus', app: { key: 'slack', name: 'Slack' }, windowTitle: '#finance - Acme - Slack', urlHost: null },
  ];
  return ev.map((event, i) => ({ status: i < 7 ? 'sent' : 'pending', batchId: i < 7 ? crypto.randomUUID() : null, event }));
}

export class MockAdapter implements AgentAdapter {
  readonly kind = 'mock' as const;
  private mode: Mode = 'capturing';
  private paired = true;
  private exclusions: Exclusions = structuredClone(DEFAULT_EXCLUSIONS);
  private events: StoredEvent[];
  private readonly from: Date;

  constructor(now = new Date()) {
    this.events = mockEvents(now);
    this.from = new Date(now.getTime() - 2.4 * 86_400_000);
  }

  private snapshot(): AgentStatus {
    const until = new Date(this.from.getTime() + 7 * 86_400_000);
    const day = Math.min(7, Math.floor((Date.now() - this.from.getTime()) / 86_400_000) + 1);
    return {
      mode: this.mode,
      platform: 'simulated',
      paired: this.paired,
      captureFrom: this.paired ? this.from.toISOString() : null,
      captureUntil: this.paired ? until.toISOString() : null,
      dayNumber: this.paired ? day : null,
      totalDays: this.paired ? 7 : null,
      pendingEvents: this.events.filter((e) => e.status === 'pending').length,
      eventsToday: this.events.length,
      eventsSentTotal: 1834,
      lastUploadAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      lastUploadError: null,
      stopReason: this.mode === 'stopped' ? 'local data deleted' : null,
      exclusions: this.exclusions,
    };
  }
  async status() {
    return this.snapshot();
  }
  async pause() {
    if (this.mode === 'capturing') this.mode = 'paused';
    return this.snapshot();
  }
  async resume() {
    if (this.mode === 'paused') this.mode = 'capturing';
    return this.snapshot();
  }
  async today(): Promise<TodayView> {
    const redactions: RedactionCounts = {};
    for (const e of this.events)
      for (const [k, v] of Object.entries(e.event.redactions)) redactions[k as RedactionKind] = (redactions[k as RedactionKind] ?? 0) + (v ?? 0);
    return {
      events: structuredClone(this.events),
      redactions,
      pending: this.events.filter((e) => e.status === 'pending').length,
      sent: this.events.filter((e) => e.status === 'sent').length,
    };
  }
  async getExclusions() {
    return structuredClone(this.exclusions);
  }
  async setExclusions(ex: Exclusions) {
    this.exclusions = { ...structuredClone(ex), privateBrowsing: true };
    return structuredClone(this.exclusions);
  }
  async deleteEverything() {
    this.events = [];
    this.mode = 'stopped';
  }
  async pair(code: string, _deviceName: string) {
    if (!/^[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}$/i.test(code.trim())) throw new Error('That code does not look right. It has 8 characters, like ABCD-EFGH.');
    this.paired = true;
    this.mode = 'capturing';
    return { deviceId: crypto.randomUUID() };
  }
}

export function createAdapter(): AgentAdapter {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ ? new TauriAdapter() : new MockAdapter();
}
