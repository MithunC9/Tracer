import { createHash } from 'node:crypto';

/** Namespace for all fixture UUIDs (uuid v5 of "tracer-fixtures" under the URL namespace). */
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function uuidBytes(u: string): Buffer {
  return Buffer.from(u.replace(/-/g, ''), 'hex');
}

/** RFC 9562 UUID v5 (SHA-1, name-based). Deterministic. */
export function uuidV5(name: string, namespace: string = URL_NAMESPACE): string {
  const hash = createHash('sha1').update(uuidBytes(namespace)).update(name, 'utf8').digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const FIXTURE_NAMESPACE = uuidV5('https://tracer.local/fixtures');

/** Deterministic event id for `<persona>:<seq>`. */
export function eventId(persona: string, seq: number): string {
  return uuidV5(`${persona}:${seq}`, FIXTURE_NAMESPACE);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
