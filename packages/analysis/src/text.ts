import { APPS, LIMITS } from '@tracer/schema';
import { fnv1a } from './util.js';

/**
 * Local, deterministic text embedder (see DECISIONS.md): feature hashing of normalized
 * word unigrams + bigrams into `dims` buckets with a hash-derived sign, sublinear term
 * frequency, L2-normalized. No model, no network; redacted text never leaves our servers.
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have in into is it its of on or that the this to was were will with ' +
    'you your we our i me my he she they them their there here not no yes all any can do does did done so if then ' +
    'than too very just about over under up down out off via per vs etc more new get got also one two ' +
    // UI chrome that carries no topic
    'google chrome safari firefox window tab tabs untitled page app web www com http https mozilla microsoft apple ' +
    'menu toolbar button click ok cancel close open file view help edit format tools insert data'
  ).split(/\s+/),
);

// App names and hosts say which app, not what the task is about; app identity is compared separately.
for (const a of APPS) {
  for (const w of `${a.name} ${a.key.replace(/_/g, ' ')} ${a.hosts.join(' ')}`.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2) STOPWORDS.add(w);
}

const REDACTED = /\[redacted:[a-z_]+\]/g;

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/** Normalized word tokens: lowercase, accents stripped, redaction placeholders and digit-bearing tokens dropped, light stemming. */
export function tokenize(text: string): string[] {
  const t = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(REDACTED, ' ');
  const out: string[] = [];
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || /\d/.test(raw) || STOPWORDS.has(raw)) continue;
    const s = stem(raw);
    if (s.length >= 2 && !STOPWORDS.has(s)) out.push(s);
  }
  return out;
}

export function hashEmbed(text: string, dims: number = LIMITS.embeddingDims): number[] {
  const v = new Array<number>(dims).fill(0);
  const toks = tokenize(text);
  const tf = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    tf.set(toks[i]!, (tf.get(toks[i]!) ?? 0) + 1);
    if (i + 1 < toks.length) {
      const bg = `${toks[i]}_${toks[i + 1]}`;
      tf.set(bg, (tf.get(bg) ?? 0) + 0.5);
    }
  }
  for (const [tok, f] of tf) {
    const h = fnv1a(tok);
    const idx = h % dims;
    const sign = (fnv1a(tok, 0x9747b28c) & 1) === 0 ? 1 : -1;
    // sublinear tf; a lone bigram keeps its 0.5 weight
    v[idx]! += sign * (f >= 1 ? 1 + Math.log(f) : f);
  }
  return l2normalize(v);
}

export function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  if (n === 0) return v.map(() => 0);
  const inv = 1 / Math.sqrt(n);
  return v.map((x) => x * inv);
}

/** Cosine similarity; 0 when either vector is empty/zero or dims differ. */
export function cosine(a: readonly number[] | undefined, b: readonly number[] | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** acc += w * v (in place). */
export function addScaled(acc: number[], v: readonly number[], w: number): void {
  for (let i = 0; i < acc.length && i < v.length; i++) acc[i]! += w * v[i]!;
}
