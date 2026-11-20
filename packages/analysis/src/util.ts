import { createHash } from 'node:crypto';

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Deterministic JSON: object keys sorted, undefined dropped, non-finite numbers -> null. */
export function stableStringify(value: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) {
      parts.push('null');
    } else if (typeof v === 'number') {
      parts.push(Number.isFinite(v) ? JSON.stringify(v) : 'null');
    } else if (typeof v === 'string' || typeof v === 'boolean') {
      parts.push(JSON.stringify(v));
    } else if (Array.isArray(v)) {
      parts.push('[');
      v.forEach((x, i) => {
        if (i) parts.push(',');
        walk(x);
      });
      parts.push(']');
    } else if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined && typeof o[k] !== 'function')
        .sort();
      parts.push('{');
      keys.forEach((k, i) => {
        if (i) parts.push(',');
        parts.push(JSON.stringify(k), ':');
        walk(o[k]);
      });
      parts.push('}');
    } else {
      parts.push('null');
    }
  };
  walk(value);
  return parts.join('');
}

export const hashOf = (value: unknown): string => sha256Hex(stableStringify(value));

/** Short stable id: prefix + first n hex chars of sha256. */
export const stableId = (prefix: string, seed: string, n = 12): string => `${prefix}${sha256Hex(seed).slice(0, n)}`;

/** 32-bit FNV-1a; fast non-cryptographic hash for feature hashing. */
export function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const toMs = (iso: string): number => Date.parse(iso);
export const toIso = (ms: number): string => new Date(ms).toISOString();

export const DAY_MS = 24 * 60 * 60 * 1000;

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
