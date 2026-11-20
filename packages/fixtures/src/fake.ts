import { createHash } from 'node:crypto';
import type { Rng } from './prng.js';
import { IBAN_LENGTHS, ibanMod97 } from './redact.js';

/** Fake-but-valid-looking PII and secrets. Every value is synthetic. */

export const FIRST = ['Dana', 'Lukas', 'Priya', 'Marcus', 'Sofia', 'Kenji', 'Amara', 'Tom', 'Elena', 'Omar', 'Hannah', 'Diego', 'Ines', 'Noah', 'Grace', 'Ravi', 'Chloe', 'Felix', 'Zara', 'Ben'];
export const LAST = ['Okafor', 'Schmidt', 'Nguyen', 'Bauer', 'Rossi', 'Tanaka', 'Clarke', 'Haddad', 'Moreau', 'Silva', 'Kowalski', 'Brennan', 'Lindqvist', 'Patel', 'Fischer', 'Alvarez', 'Murphy', 'Sato', 'Novak', 'Reyes'];

export function personName(r: Rng): string {
  return `${r.pick(FIRST)} ${r.pick(LAST)}`;
}

export function emailFor(r: Rng, name: string, domain: string): string {
  const [f = 'x', l = 'y'] = name.toLowerCase().split(' ');
  return r.weighted<string>([
    [`${f}.${l}@${domain}`, 4],
    [`${f}@${domain}`, 2],
    [`${f[0]}${l}@${domain}`, 2],
    [`${f}.${l}+invoices@${domain}`, 1],
    [`${f}@mail.${domain}`, 1],
  ]);
}

/** NANP fictional range 555-01xx. */
export function phoneUS(r: Rng): string {
  const area = r.pick(['415', '212', '646', '312', '773', '617', '206', '512']);
  const line = `01${r.digits(2)}`;
  return r.weighted<string>([
    [`(${area}) 555-${line}`, 3],
    [`${area}-555-${line}`, 2],
    [`${area}.555.${line}`, 1],
    [`+1 ${area} 555 ${line}`, 2],
  ]);
}

export function phoneIntl(r: Rng, cc: 'GB' | 'DE' | 'FR'): string {
  switch (cc) {
    case 'GB':
      return `+44 20 7946 0${r.digits(3)}`;
    case 'DE':
      return `+49 30 ${r.digits(3)} ${r.digits(4)}`;
    case 'FR':
      return `+33 1 ${r.digits(2)} ${r.digits(2)} ${r.digits(2)} ${r.digits(2)}`;
  }
}

function luhnCheckDigit(partial: string): string {
  let sum = 0;
  let dbl = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = partial.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Luhn-valid card number, formatted variously. */
export function card(r: Rng, brand: 'visa' | 'mc' | 'amex' = r.pick(['visa', 'visa', 'mc', 'amex'] as const)): string {
  if (brand === 'amex') {
    const p = r.pick(['34', '37']) + r.digits(12);
    const n = p + luhnCheckDigit(p);
    return r.chance(0.6) ? `${n.slice(0, 4)} ${n.slice(4, 10)} ${n.slice(10)}` : n;
  }
  const p = (brand === 'visa' ? '4' : '5' + r.int(1, 5)) + r.digits(brand === 'visa' ? 14 : 13);
  const n = p + luhnCheckDigit(p);
  const g = [n.slice(0, 4), n.slice(4, 8), n.slice(8, 12), n.slice(12)];
  return r.weighted<string>([
    [g.join(' '), 3],
    [g.join('-'), 1],
    [n, 1],
  ]);
}

export function ssn(r: Rng): string {
  let area = r.int(1, 899);
  if (area === 666) area = 667;
  const a = String(area).padStart(3, '0');
  const g = String(r.int(1, 99)).padStart(2, '0');
  const n = String(r.int(1, 9999)).padStart(4, '0');
  return r.weighted<string>([
    [`${a}-${g}-${n}`, 4],
    [`${a} ${g} ${n}`, 1],
  ]);
}

export function iban(r: Rng, cc: 'DE' | 'GB' | 'FR'): string {
  let bban: string;
  if (cc === 'DE') bban = r.digits(18);
  else if (cc === 'GB') bban = r.pick(['NWBK', 'BARC', 'HBUK', 'LOYD']) + r.digits(14);
  else bban = r.digits(10) + r.str(11, '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ') + r.digits(2);
  const check = String(98 - ibanMod97(`${cc}00${bban}`)).padStart(2, '0');
  const compact = `${cc}${check}${bban}`;
  if (compact.length !== IBAN_LENGTHS[cc]) throw new Error('bad iban length');
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64URL = B62 + '-_';

export const secrets = {
  stripeLive: (r: Rng) => 'sk_' + 'live_' + r.str(24, B62),
  github: (r: Rng) => 'gh' + 'p_' + r.str(36, B62),
  awsKeyId: (r: Rng) => 'AK' + 'IA' + r.str(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
  awsSecret: (r: Rng) => r.str(40, B62 + '/+'),
  slackBot: (r: Rng) => 'xo' + 'xb-' + r.digits(13) + '-' + r.digits(13) + '-' + r.str(24, B62),
  openai: (r: Rng) => 'sk-' + 'proj-' + r.str(48, B64URL),
  anthropic: (r: Rng) => 'sk-' + 'ant-' + 'api03-' + r.str(86, B64URL),
  jwt: (r: Rng) => {
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: r.digits(8), iat: 1793000000 + r.int(0, 999999) })}.${r.str(43, B64URL)}`;
  },
  password: (r: Rng) => r.pick(['Tr0ub4dor', 'Spring', 'Kaffee', 'Bluebird', 'Harbor']) + r.pick(['!', '#', '&', '$']) + r.digits(3) + r.str(4, B62),
};

export const COMPANIES = ['Nordlicht GmbH', 'Bluefin Labs', 'Harbor & Pine', 'Atlas Outdoor Co', 'Kite Analytics', 'Maple Street Bakery', 'Corvid Coffee', 'Sundial Health', 'Ferro Studio', 'Lumen Legal', 'Brightside Dental', 'Orbit Fitness'];

export function money(r: Rng, min: number, max: number): string {
  const cents = Math.round(r.float(min, max) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole}.${String(cents % 100).padStart(2, '0')}`;
}

export function docId(r: Rng): string {
  return '1' + r.str(43, B64URL);
}

/** Stable Google-style document id derived from a name (no RNG consumption, no shared state). */
export function stableDocId(name: string): string {
  return '1' + createHash('sha256').update(name).digest('base64url').slice(0, 43);
}
