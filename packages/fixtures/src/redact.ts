import { redactionPlaceholder, type RedactionCounts, type RedactionKind } from '@tracer/schema';

/**
 * REFERENCE redactor. The Rust agent has its own implementation; both must pass
 * `data/hostile-corpus.json`. Design: every detector scans the ORIGINAL string and
 * proposes spans; spans are accepted in priority order (earlier detector wins on
 * overlap), then replaced right-to-left with `[REDACTED:<kind>]`.
 */

export interface RedactResult {
  text: string;
  counts: RedactionCounts;
}

interface Span {
  start: number;
  end: number;
  kind: RedactionKind;
}

type Detector = (s: string) => Span[];

// ---------------------------------------------------------------- helpers

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** ISO 13616 IBAN lengths per country (subset covering EU/EEA, UK, CH and common others). */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AT: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22,
  IL: 23, IS: 26, IT: 27, KW: 30, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15,
  PL: 28, PT: 25, QA: 29, RO: 24, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TR: 26,
};

export function ibanMod97(iban: string): number {
  const re = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem;
}

export function ibanValid(compact: string): boolean {
  const cc = compact.slice(0, 2);
  const len = IBAN_LENGTHS[cc];
  return len !== undefined && compact.length === len && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact) && ibanMod97(compact) === 1;
}

function shannon(s: string): number {
  const f = new Map<string, number>();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function regexSpans(re: RegExp, kind: RedactionKind, s: string, group = 0, accept?: (m: RegExpExecArray) => boolean): Span[] {
  const out: Span[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(s))) {
    if (m[0].length === 0) {
      g.lastIndex++;
      continue;
    }
    if (accept && !accept(m)) continue;
    const text = m[group];
    if (text === undefined) continue;
    const start = group === 0 ? m.index : m.index + m[0].indexOf(text);
    out.push({ start, end: start + text.length, kind });
  }
  return out;
}

// ---------------------------------------------------------------- detectors

/** Path/query/fragment of absolute URLs. Host is kept. */
/** user:password@ credentials embedded in URLs. */
const urlCreds: Detector = (s) => regexSpans(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/@]+)@/i, 'api_key', s, 1);

const urlPath: Detector = (s) =>
  regexSpans(/\bhttps?:\/\/(?:[^\s/@]+@)?[A-Za-z0-9.-]+(?::\d{1,5})?(\/[^\s"'<>`]*[^\s"'<>`.,;:!?)\]}])/i, 'url_path', s, 1, (m) => (m[1] ?? '').length > 1);

const API_KEY_PATTERNS: RegExp[] = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/, // Stripe
  /\bwhsec_[A-Za-z0-9]{16,}/, // Stripe webhook secret
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/, // Slack
  /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/, // Slack webhook
  /\bsk-ant-[A-Za-z0-9_-]{20,}/, // Anthropic
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/, // OpenAI
  /\bAIza[0-9A-Za-z_-]{35}/, // Google API key
  /\bglpat-[A-Za-z0-9_-]{20,}/, // GitLab
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, // SendGrid
  /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}/, // Shopify
  /\bnpm_[A-Za-z0-9]{36}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/,
];

const apiKey: Detector = (s) => {
  const out = API_KEY_PATTERNS.flatMap((re) => regexSpans(re, 'api_key', s));
  // key=value assignments: value is a secret whatever it looks like
  out.push(
    ...regexSpans(
      /\b(?:api[_-]?key|api[_-]?secret|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|secret|token)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{8,})/i,
      'api_key',
      s,
      1,
    ),
  );
  return out;
};

const passwordAssign: Detector = (s) =>
  regexSpans(/\b(?:password|passwd|pwd|passcode)\b["']?\s*[:=]\s*["']?([^\s"']{4,})/i, 'password_field', s, 1);

const email: Detector = (s) =>
  regexSpans(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/, 'email', s);

const iban: Detector = (s) => {
  const out: Span[] = [];
  const re = /\b([A-Z]{2})(\d{2})(?:[ ]?[A-Z0-9]){8,34}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const len = IBAN_LENGTHS[m[1]!];
    if (!len) {
      re.lastIndex = m.index + 1;
      continue;
    }
    // walk forward collecting exactly `len` alphanumerics (spaces allowed between)
    let compact = '';
    let end = m.index;
    for (let i = m.index; i < s.length && compact.length < len; i++) {
      const ch = s[i]!;
      if (/[A-Z0-9]/.test(ch)) {
        compact += ch;
        end = i + 1;
      } else if (ch === ' ' && compact.length > 0) continue;
      else break;
    }
    const nextCh = s[end];
    if (compact.length === len && !(nextCh && /[A-Za-z0-9]/.test(nextCh)) && ibanValid(compact)) {
      out.push({ start: m.index, end, kind: 'iban' });
      re.lastIndex = end;
    } else {
      re.lastIndex = m.index + 1;
    }
  }
  return out;
};

/** Digit runs separated by single spaces/dashes; any window of whole groups with 13-19 digits passing Luhn. */
const card: Detector = (s) => {
  const out: Span[] = [];
  const re = /(?<![\d.,])\d+(?:[ -]\d+)*(?![\d])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const groups: { start: number; end: number; d: string }[] = [];
    const gre = /\d+/g;
    let g: RegExpExecArray | null;
    while ((g = gre.exec(m[0]))) groups.push({ start: m.index + g.index, end: m.index + g.index + g[0].length, d: g[0] });
    let i = 0;
    while (i < groups.length) {
      let found = -1;
      // longest window starting at i
      for (let j = groups.length - 1; j >= i; j--) {
        const digits = groups.slice(i, j + 1).map((x) => x.d).join('');
        if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        out.push({ start: groups[i]!.start, end: groups[found]!.end, kind: 'card_number' });
        i = found + 1;
      } else i++;
    }
  }
  return out;
};

function ssnPartsValid(a: string, g: string, n: string): boolean {
  const area = Number(a);
  return area !== 0 && area !== 666 && area < 900 && g !== '00' && n !== '0000';
}

const ssn: Detector = (s) => [
  ...regexSpans(/(?<![\d-])(\d{3})([- .])(\d{2})\2(\d{4})(?![\d-])/, 'ssn', s, 0, (m) => ssnPartsValid(m[1]!, m[3]!, m[4]!)),
  // bare 9 digits only with an SSN/TIN keyword in front
  ...regexSpans(
    /\b(?:SSN|SS#|social security(?: number| no\.?)?|TIN|taxpayer id(?:entification)?(?: number)?)\s*[:#]?\s*(\d{9})(?!\d)/i,
    'ssn',
    s,
    1,
    (m) => ssnPartsValid(m[1]!.slice(0, 3), m[1]!.slice(3, 5), m[1]!.slice(5)),
  ),
];

function digitCount(x: string): number {
  return x.replace(/\D/g, '').length;
}

const phone: Detector = (s) => [
  // international, must start with +
  ...regexSpans(/(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,5}\)?){1,6}(?![\w])/, 'phone', s, 0, (m) => {
    const n = digitCount(m[0]);
    return n >= 8 && n <= 15;
  }),
  // NANP: (415) 555-0132, 415-555-0132, 415.555.0132, 1-800-555-0199
  ...regexSpans(/(?<![\w+-])(?:1[ .-])?(?:\(\d{3}\)[ ]?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-])/, 'phone', s),
];

/** Long opaque tokens: base64/base62/hex secrets that no prefix rule caught. */
const highEntropy: Detector = (s) =>
  regexSpans(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{24,}={0,2}(?![A-Za-z0-9+/=_-])/, 'high_entropy_token', s, 0, (m) => {
    const t = m[0];
    if (!/\d/.test(t) || !/[A-Za-z]/.test(t)) return false;
    // slugs / UUIDs / file-ish identifiers: every dash/underscore segment is short
    const segs = t.split(/[-_]/);
    if (segs.length > 1 && segs.every((x) => x.length <= 12)) return false;
    // paths like a/b/c with short segments
    if (t.includes('/') && t.split('/').every((x) => x.length <= 16)) return false;
    const core = t.replace(/=+$/, '');
    return shannon(core) >= (/^[a-f0-9]+$/i.test(core) ? 3.0 : 3.5);
  });

/** Priority order: first wins on overlap. */
const DETECTORS: Detector[] = [urlCreds, urlPath, apiKey, passwordAssign, email, iban, card, ssn, phone, highEntropy];

export function redact(input: string): RedactResult {
  const accepted: Span[] = [];
  for (const det of DETECTORS) {
    for (const sp of det(input)) {
      if (sp.end <= sp.start) continue;
      if (accepted.some((a) => sp.start < a.end && a.start < sp.end)) continue;
      accepted.push(sp);
    }
  }
  accepted.sort((a, b) => b.start - a.start);
  let text = input;
  const counts: RedactionCounts = {};
  for (const sp of accepted) {
    text = text.slice(0, sp.start) + redactionPlaceholder(sp.kind) + text.slice(sp.end);
    counts[sp.kind] = (counts[sp.kind] ?? 0) + 1;
  }
  return { text, counts };
}

export function mergeCounts(into: RedactionCounts, add: RedactionCounts): RedactionCounts {
  for (const [k, v] of Object.entries(add) as [RedactionKind, number][]) into[k] = (into[k] ?? 0) + v;
  return into;
}

/** Truncate after redaction without leaving half a placeholder at the end. */
export function truncateRedacted(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const open = cut.lastIndexOf('[');
  if (open >= 0 && cut.indexOf(']', open) === -1) {
    const tail = cut.slice(open);
    if ('[REDACTED:'.startsWith(tail) || tail.startsWith('[REDACTED:')) cut = cut.slice(0, open);
  }
  return cut;
}
