/**
 * Number extraction from narrative prose, shared by the narrate guard and the
 * report validator so both apply exactly the same rules.
 *
 * Rules (see DECISIONS.md, packages/llm):
 *  - Digits: integers, decimals, thousands separators ("1,200"), leading-dot decimals (".5").
 *  - Suffixes glued to a number do not hide it: "3.5h", "12hrs", "2x", "3rd" (ordinal), "5k" (x1000).
 *  - "%" (optionally spaced) marks a percentage; "72%" matches an allowed 72 or 0.72.
 *  - Digits glued to a preceding letter are identifiers, not quantities ("Q3", "B2B", "S3").
 *  - Number words zero, two..nineteen, tens, dozen, hundred, thousand are numbers too.
 *    "one" is ignored (pronoun use: "one of the steps"); ordinal words (first, second) are ignored.
 *  - Sign is ignored ("-3" is 3). Ranges "3-5" yield 3 and 5.
 *  - Matching is exact numeric equality (trailing zeros allowed: "3.50" == 3.5). No rounding:
 *    "3.9" does NOT match an allowed 3.94. Write numbers exactly as given.
 */

export type NumberKind = 'number' | 'percent' | 'ordinal' | 'word';

export interface ExtractedNumber {
  raw: string;
  value: number;
  kind: NumberKind;
  index: number;
}

const WORDS: Record<string, number> = {
  zero: 0,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  dozen: 12,
  hundred: 100,
  thousand: 1000,
};

export const NUMBER_WORDS: readonly string[] = Object.keys(WORDS);

const DIGITS_RE = /(?<![\p{L}\p{N}_.])(?:(\d{1,3}(?:,\d{3}(?!\d))+|\d+)(?:\.(\d+))?|\.(\d+))/gu;
const WORD_RE = new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'gi');
const ORDINAL_RE = /^(st|nd|rd|th)(?![\p{L}])/iu;
const K_RE = /^k(?![\p{L}])/iu;
const PERCENT_RE = /^\s?%/;

/** Replace each ignore phrase (case-insensitive) with spaces, preserving indices. */
export function maskPhrases(text: string, phrases: readonly string[]): string {
  let out = text;
  const sorted = [...new Set(phrases.filter((p) => p.trim().length > 0))].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, (m) => ' '.repeat(m.length));
  }
  return out;
}

/**
 * Extract every numeric token from prose.
 * @param ignorePhrases names that may legitimately contain digits (tool names, labels).
 */
export function extractNumbers(text: string, ignorePhrases: readonly string[] = []): ExtractedNumber[] {
  const t = maskPhrases(text, ignorePhrases);
  const out: ExtractedNumber[] = [];

  for (const m of t.matchAll(DIGITS_RE)) {
    const index = m.index ?? 0;
    let raw = m[0];
    let value: number;
    if (m[3] !== undefined) value = Number(`0.${m[3]}`);
    else value = Number(`${(m[1] ?? '').replace(/,/g, '')}${m[2] !== undefined ? `.${m[2]}` : ''}`);
    let kind: NumberKind = 'number';
    const rest = t.slice(index + raw.length);
    const pct = PERCENT_RE.exec(rest);
    const ord = ORDINAL_RE.exec(rest);
    if (pct) {
      kind = 'percent';
      raw += pct[0];
    } else if (ord && m[2] === undefined && m[3] === undefined) {
      kind = 'ordinal';
      raw += ord[0];
    } else if (K_RE.test(rest)) {
      value *= 1000;
      raw += rest[0];
    }
    out.push({ raw, value, kind, index });
  }

  for (const m of t.matchAll(WORD_RE)) {
    const w = (m[1] ?? '').toLowerCase();
    const v = WORDS[w];
    if (v === undefined) continue;
    out.push({ raw: m[0], value: v, kind: 'word', index: m.index ?? 0 });
  }

  return out.sort((a, b) => a.index - b.index);
}

const EPS = 1e-9;

/** Exact numeric match against the allowed list. Percentages may also match a 0..1 fraction. */
export function isAllowed(n: Pick<ExtractedNumber, 'value' | 'kind'>, allowed: readonly number[]): boolean {
  for (const a of allowed) {
    if (Math.abs(a - n.value) < EPS) return true;
    if (n.kind === 'percent' && Math.abs(a * 100 - n.value) < 1e-6) return true;
  }
  return false;
}

/** Numbers in `text` that are not in `allowed`. */
export function disallowedNumbers(
  text: string,
  allowed: readonly number[],
  ignorePhrases: readonly string[] = [],
): ExtractedNumber[] {
  return extractNumbers(text, ignorePhrases).filter((n) => !isAllowed(n, allowed));
}

/** Canonical way to write an allowed number in prose (and in prompts). */
export function fmt(n: number): string {
  return String(n);
}

/** Words the house style forbids. Checked case-insensitively on word stems. */
export const BANNED_WORDS = ['supercharge', 'unlock', 'leverage', 'seamless', 'game-changer', 'revolutionize'] as const;

export function bannedWordsIn(text: string): string[] {
  const found: string[] = [];
  for (const w of BANNED_WORDS) {
    if (new RegExp(`\\b${w}`, 'i').test(text)) found.push(w);
  }
  return found;
}

/** Sorted, de-duplicated finite numbers. */
export function uniqSorted(ns: readonly number[]): number[] {
  return [...new Set(ns.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
}
