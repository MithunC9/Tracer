import { APP_BY_KEY } from '@tracer/schema';

/** Join class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** "01", "02" ... used for finding and step numbers. */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Fixed-decimal number with a thin, consistent look. Never locale-dependent (SSR-safe). */
export function fmt(n: number, dp = 1): string {
  const s = n.toFixed(dp);
  const [int, frac] = s.split('.');
  const withSep = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${withSep}.${frac}` : withSep;
}

export const fmtInt = (n: number) => fmt(n, 0);

/** Display name for an AppKey. Unknown `other:foo-bar` becomes "Foo bar". */
export function appName(key: string): string {
  const def = APP_BY_KEY.get(key);
  if (def) return def.name;
  const slug = key.replace(/^other:/, '').replace(/[-_]+/g, ' ');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Wall-clock parts of an ISO timestamp in a given IANA zone. Defaults to UTC so
 * server and client render identically; pass the reader's zone when known.
 */
export function zonedParts(iso: string, timeZone = 'UTC') {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const month = Number(p.month) - 1;
  return {
    year: Number(p.year),
    month,
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: String(p.weekday),
    monthName: MON[month] ?? '',
  };
}

/** "Tue 18 Nov" */
export function fmtDay(iso: string, timeZone = 'UTC'): string {
  const p = zonedParts(iso, timeZone);
  return `${p.weekday} ${p.day} ${p.monthName}`;
}

/** "09:41" */
export function fmtTime(iso: string, timeZone = 'UTC'): string {
  const p = zonedParts(iso, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** "18 Nov 2026, 09:41" */
export function fmtDateTime(iso: string, timeZone = 'UTC'): string {
  const p = zonedParts(iso, timeZone);
  return `${p.day} ${p.monthName} ${p.year}, ${fmtTime(iso, timeZone)}`;
}

/** "18 Nov 2026" */
export function fmtDate(iso: string, timeZone = 'UTC'): string {
  const p = zonedParts(iso, timeZone);
  return `${p.day} ${p.monthName} ${p.year}`;
}

/** Day label for a day index counted from a start date. */
export function dayLabel(startIso: string, dayIndex: number, timeZone = 'UTC') {
  const d = new Date(new Date(startIso).getTime() + dayIndex * 86_400_000).toISOString();
  const p = zonedParts(d, timeZone);
  return { dow: p.weekday, day: p.day, month: p.monthName, weekend: p.weekday === 'Sat' || p.weekday === 'Sun', iso: d };
}

export { DOW };

/** Minutes to "1 h 05 min" / "14 min". */
export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`;
}

/* ---------- hand-ruled geometry ---------- */

/** Small deterministic PRNG (mulberry32) so "hand-drawn" wobble is identical on server and client. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A line from (x1,y1) to (x2,y2) that bows very slightly, like a line ruled by
 * hand against a straightedge. Endpoints are exact; only the middle drifts.
 */
export function ruledPath(x1: number, y1: number, x2: number, y2: number, seed = 1, wobble = 0.6): string {
  const r = rng(seed);
  const mx = (x1 + x2) / 2 + (r() - 0.5) * wobble;
  const my = (y1 + y2) / 2 + (r() - 0.5) * wobble * 1.4;
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(x1)} ${f(y1)} Q${f(mx)} ${f(my)} ${f(x2)} ${f(y2)}`;
}

/** A hand-drawn underline: a slightly uneven stroke that overshoots and lifts at the end. */
export function underlinePath(width: number, seed = 7): string {
  const r = rng(seed);
  const y = 6;
  const f = (n: number) => Math.round(n * 10) / 10;
  const c1x = width * 0.3;
  const c2x = width * 0.7;
  return `M${f(2 + r() * 2)} ${f(y + 1.5)} C${f(c1x)} ${f(y - 1 + r())} ${f(c2x)} ${f(y + 1.6 + r())} ${f(width - 2)} ${f(y - 1.4)}`;
}
