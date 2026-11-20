import {
  DEFAULT_EXCLUSIONS,
  isExcluded,
  LIMITS,
  SCHEMA_VERSION,
  type ActivityEvent,
  type Exclusions,
  type RawSample,
  type RedactionCounts,
  type TextDigest,
} from '@tracer/schema';
import { eventId, sha256Hex } from './ids.js';
import { mergeCounts, redact, truncateRedacted } from './redact.js';
import { resolveApp, type Resolved } from './resolve.js';

/**
 * Normalization used for `digestHash`: NFC, whitespace collapsed, trimmed, then
 * JSON.stringify([headings, labels, text]). sha256 hex of that string.
 */
export function normalizeDigest(d: TextDigest): string {
  const n = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  return JSON.stringify([d.headings.map(n), d.labels.map(n), n(d.text)]);
}

export function digestHash(d: TextDigest): string {
  return sha256Hex(normalizeDigest(d));
}

function red(s: string, max: number, counts: RedactionCounts): string {
  const r = redact(s);
  mergeCounts(counts, r.counts);
  return truncateRedacted(r.text, max);
}

/**
 * Convert device-local RawSamples into ActivityEvents exactly as the agent pipeline does:
 * exclude -> resolve AppKey -> redact -> truncate -> hash -> assign id/seq.
 */
export function rawToEvents(persona: string, raw: readonly RawSample[], exclusions: Exclusions = DEFAULT_EXCLUSIONS): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  let seq = 0;
  const base = (ts: string, redactions: RedactionCounts = {}) => {
    seq += 1;
    return { id: eventId(persona, seq), ts, seq, schemaVersion: SCHEMA_VERSION, redactions };
  };

  let cur: (Resolved & { bundleId: string }) | null = null;
  let excluded = false;

  for (const s of raw) {
    if (out.length === 0) out.push({ ...base(s.t), kind: 'capture_state', state: 'started', reason: null });
    switch (s.type) {
      case 'focus': {
        const res = resolveApp(s.bundleId, s.appName, s.url);
        const ex = isExcluded(exclusions, {
          appKey: res.appKey,
          bundleId: s.bundleId,
          urlHost: res.urlHost,
          windowTitle: s.title,
          isPrivateWindow: s.private,
        });
        if (ex) {
          if (!excluded) out.push({ ...base(s.t), kind: 'capture_state', state: 'excluded_app_active', reason: s.private ? 'private_window' : 'exclusion_rule' });
          excluded = true;
          cur = null;
          break;
        }
        excluded = false;
        cur = { ...res, bundleId: s.bundleId };
        const counts: RedactionCounts = {};
        const name = red(res.name, 80, counts);
        const title = s.title === null ? null : red(s.title, LIMITS.maxWindowTitleChars, counts);
        out.push({ ...base(s.t, counts), kind: 'app_focus', app: { key: res.appKey, name }, windowTitle: title, urlHost: res.urlHost });
        break;
      }
      case 'ax': {
        if (excluded) break;
        const app = cur && cur.bundleId === s.bundleId ? cur : resolveApp(s.bundleId, s.appName, null);
        const counts: RedactionCounts = {};
        const digest: TextDigest = {
          headings: s.headings.slice(0, LIMITS.maxDigestItems).map((h) => red(h, LIMITS.maxDigestItemChars, counts)),
          labels: s.labels.slice(0, LIMITS.maxDigestItems).map((l) => red(l, LIMITS.maxDigestItemChars, counts)),
          text: s.secureField
            ? (counts.password_field = (counts.password_field ?? 0) + 1, '[REDACTED:password_field]')
            : red(s.text, LIMITS.maxDigestTextChars, counts),
        };
        out.push({
          ...base(s.t, counts),
          kind: 'text_digest',
          app: { key: app.appKey, name: red(app.name, 80, counts) },
          digest,
          digestHash: digestHash(digest),
        });
        break;
      }
      case 'clipboard': {
        if (excluded) break;
        const app = cur && cur.bundleId === s.bundleId ? cur : resolveApp(s.bundleId, s.appName, null);
        out.push({ ...base(s.t), kind: 'clipboard_change', app: { key: app.appKey, name: app.name.slice(0, 80) }, contentKind: s.contentKind });
        break;
      }
      case 'idle_start':
        out.push({ ...base(s.t), kind: 'idle_start', idleThresholdSeconds: s.thresholdSeconds });
        break;
      case 'idle_end':
        out.push({ ...base(s.t), kind: 'idle_end' });
        break;
    }
  }
  return out;
}
