import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Opaque random token, base64url. 32 bytes = 256 bits. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (input: string | Buffer): Buffer => createHash('sha256').update(input).digest();
export const sha256Hex = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');
export const hmacSha256Hex = (key: Buffer, input: string): string => createHmac('sha256', key).update(input).digest('hex');

/** Constant-time comparison for secrets of possibly different length. */
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  // Hash first so lengths always match and timing does not leak the length.
  return timingSafeEqual(sha256(a), sha256(b));
}

/** Crockford base32 alphabet (no I, L, O, U). */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Pairing code `XXXX-XXXX`, 40 bits from a CSPRNG. */
export function generatePairingCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CROCKFORD[randomInt(32)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Normalize user-typed codes: uppercase, map Crockford look-alikes, strip separators. */
export function normalizePairingCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[OIL]/g, (c) => (c === 'O' ? '0' : '1'));
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  return s;
}

/**
 * Stable JSON: object keys sorted recursively. Used for content hashes and signatures so the
 * same value always produces the same bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}
