import type { ActivityEvent } from '@tracer/schema';

/** Tiny event builder for hand-written timelines. Times are seconds from T0. */
export const T0 = Date.parse('2026-11-02T09:00:00.000Z');

export function timeline() {
  const events: ActivityEvent[] = [];
  let seq = 0;
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, '0')}`;
  const ts = (s: number) => new Date(T0 + s * 1000).toISOString();
  const base = (s: number) => ({ id: id(), ts: ts(s), seq: seq++, schemaVersion: 1 as const, redactions: {} });
  const b = {
    events,
    focus(s: number, key: string, title: string | null, host: string | null = null) {
      events.push({ ...base(s), kind: 'app_focus', app: { key, name: key }, windowTitle: title, urlHost: host });
      return b;
    },
    digest(s: number, key: string, text: string, hash = text) {
      const h = Buffer.from(hash).toString('hex').padEnd(64, '0').slice(0, 64);
      events.push({ ...base(s), kind: 'text_digest', app: { key, name: key }, digest: { headings: [], labels: [], text }, digestHash: h });
      return b;
    },
    clip(s: number, key: string) {
      events.push({ ...base(s), kind: 'clipboard_change', app: { key, name: key }, contentKind: 'text' });
      return b;
    },
    idleStart(s: number, threshold = 120) {
      events.push({ ...base(s), kind: 'idle_start', idleThresholdSeconds: threshold });
      return b;
    },
    idleEnd(s: number) {
      events.push({ ...base(s), kind: 'idle_end' });
      return b;
    },
    capture(s: number, state: 'started' | 'paused' | 'resumed' | 'stopped' | 'auto_stopped' | 'excluded_app_active') {
      events.push({ ...base(s), kind: 'capture_state', state, reason: null });
      return b;
    },
    redact(n: number) {
      (events[events.length - 1] as { redactions: Record<string, number> }).redactions = { email: n };
      return b;
    },
  };
  return b;
}
