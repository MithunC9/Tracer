import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadConfig } from '../../src/config/config.js';
import { ManualClock } from '../../src/lib/clock.js';
import { aad, aesGcmDecrypt, aesGcmEncrypt, CryptoError, decryptJson, encryptJson, KeyRing } from '../../src/lib/crypto.js';
import { FailureThrottle, TokenBucketLimiter } from '../../src/lib/rate-limit.js';
import { canonicalJson, generatePairingCode, normalizePairingCode, safeEqual } from '../../src/lib/tokens.js';
import { loggerOptions } from '../../src/observability/logger.js';

const validEnv = {
  DATABASE_URL: 'postgres://tracer_app:pw@localhost:5432/tracer',
  JWT_SECRET: 'x'.repeat(40),
  MASTER_KEY: randomBytes(32).toString('base64'),
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('config', () => {
  it('parses a valid environment with defaults', () => {
    const c = loadConfig(validEnv);
    expect(c.API_PORT).toBe(4000);
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.OTEL_ENABLED).toBe(false);
  });

  it('fails fast listing every problem', () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'short', MASTER_KEY: 'AAAA' })).toThrow(ConfigError);
    try {
      loadConfig({ ...validEnv, JWT_SECRET: 'short', MASTER_KEY: 'AAAA' });
    } catch (e) {
      expect((e as Error).message).toMatch(/JWT_SECRET/);
      expect((e as Error).message).toMatch(/MASTER_KEY/);
    }
  });

  it('refuses insecure production settings', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'production', JWT_SECRET: 'dev-only-' + 'x'.repeat(40) })).toThrow(/JWT_SECRET/);
  });

  it('never exposes secrets in its loggable form', () => {
    const d = JSON.stringify(describeConfig(loadConfig(validEnv)));
    expect(d).not.toContain(validEnv.JWT_SECRET);
    expect(d).not.toContain(validEnv.MASTER_KEY);
    expect(d).not.toContain(':pw@');
  });
});

describe('envelope encryption', () => {
  const ring = new KeyRing(randomBytes(32).toString('base64'));

  it('round-trips and binds ciphertext to its AAD', () => {
    const { dek } = ring.newDek('u1');
    const blob = encryptJson(dek, { hello: 'world' }, aad.event('u1', 'e1'));
    expect(decryptJson(dek, blob, aad.event('u1', 'e1'))).toEqual({ hello: 'world' });
    expect(() => decryptJson(dek, blob, aad.event('u2', 'e1'))).toThrow(CryptoError);
    expect(() => decryptJson(dek, blob, aad.event('u1', 'e2'))).toThrow(CryptoError);
  });

  it('detects tampering', () => {
    const key = randomBytes(32);
    const blob = aesGcmEncrypt(key, Buffer.from('secret'), 'x');
    blob[blob.length - 1]! ^= 1;
    expect(() => aesGcmDecrypt(key, blob, 'x')).toThrow(CryptoError);
  });

  it('wraps DEKs per user; a wrapped DEK cannot be unwrapped as another user', () => {
    const { dek, wrapped } = ring.newDek('alice');
    expect(ring.unwrapDek('alice', wrapped).equals(dek)).toBe(true);
    expect(() => ring.unwrapDek('bob', wrapped)).toThrow(CryptoError);
    expect(() => new KeyRing(randomBytes(32).toString('base64')).unwrapDek('alice', wrapped)).toThrow(CryptoError);
  });

  it('derives independent subkeys', () => {
    expect(ring.subkey('a').equals(ring.subkey('b'))).toBe(false);
    expect(ring.subkey('a').equals(ring.subkey('a'))).toBe(true);
  });

  it('uses a fresh IV every time', () => {
    const key = randomBytes(32);
    expect(aesGcmEncrypt(key, Buffer.from('x'), '').equals(aesGcmEncrypt(key, Buffer.from('x'), ''))).toBe(false);
  });
});

describe('tokens', () => {
  it('generates Crockford pairing codes', () => {
    for (let i = 0; i < 200; i++) expect(generatePairingCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
  it('normalizes typed codes', () => {
    expect(normalizePairingCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizePairingCode('oil0 1234')).toBe('01101234');
    expect(normalizePairingCode('ABCU-1234')).toBeNull();
    expect(normalizePairingCode('short')).toBeNull();
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: [2, { x: 2, y: 1 }] }, b: 1 }));
  });
  it('safeEqual compares secrets of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('rate limiting', () => {
  it('token bucket allows bursts up to capacity then refills', () => {
    const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
    const l = new TokenBucketLimiter(3, 1, clock);
    expect([l.take('d'), l.take('d'), l.take('d')]).toEqual([0, 0, 0]);
    expect(l.take('d')).toBeCloseTo(1);
    expect(l.take('other')).toBe(0);
    clock.advance(1500);
    expect(l.take('d')).toBe(0);
  });

  it('bounds memory by evicting idle keys', () => {
    const clock = new ManualClock();
    const l = new TokenBucketLimiter(1, 1, clock, 10);
    for (let i = 0; i < 50; i++) l.take(`k${i}`);
    expect((l as unknown as { buckets: Map<string, unknown> }).buckets.size).toBeLessThanOrEqual(10);
  });

  it('failure throttle locks with backoff and resets on success', () => {
    const clock = new ManualClock();
    const t = new FailureThrottle(3, 60_000, clock);
    t.fail('a');
    t.fail('a');
    expect(t.lockedFor('a')).toBe(0);
    t.fail('a');
    expect(t.lockedFor('a')).toBe(30);
    t.fail('a');
    expect(t.lockedFor('a')).toBe(60);
    clock.advance(61_000);
    expect(t.lockedFor('a')).toBe(0);
    t.succeed('a');
    t.fail('a');
    expect(t.lockedFor('a')).toBe(0);
  });
});

describe('logging', () => {
  it('redacts credentials and secrets', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino(loggerOptions('info'), sink);
    log.info({ req: { headers: { authorization: 'Bearer sekrit', cookie: 'tracer_rt=sekrit' } }, body: { password: 'sekrit', deviceToken: 'sekrit' } }, 'x');
    expect(lines.join('')).not.toContain('sekrit');
    expect(lines.join('')).toContain('[redacted]');
  });
});
