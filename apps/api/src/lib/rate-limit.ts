import type { Clock } from './clock.js';

/**
 * In-memory token bucket keyed by an arbitrary string (device id, email...).
 *
 * Deliberately per-process: limits multiply by the number of API instances. That is fine for
 * our scale and keeps Redis out of the stack; the per-user daily quota (enforced in Postgres)
 * is the hard ceiling. Idle buckets are evicted so memory stays bounded.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: Clock,
    private readonly maxKeys = 100_000,
  ) {}

  /** Takes `cost` tokens. Returns 0 if allowed, otherwise seconds until enough tokens exist. */
  take(key: string, cost = 1): number {
    const now = this.clock.now().getTime();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = (now - b.updated) / 1000;
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
      b.updated = now;
    }
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return 0;
    }
    return (cost - b.tokens) / this.refillPerSecond;
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  private evict(now: number) {
    const fullAfterMs = (this.capacity / this.refillPerSecond) * 1000;
    for (const [k, b] of this.buckets) if (now - b.updated > fullAfterMs) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) {
      // Still full: drop the oldest quarter (Map iterates in insertion order).
      let n = Math.floor(this.maxKeys / 4);
      for (const k of this.buckets.keys()) {
        if (n-- <= 0) break;
        this.buckets.delete(k);
      }
    }
  }
}

/**
 * Failed-login tracker: after `maxFailures` within `windowMs`, the key is locked with an
 * exponential backoff. In-memory, per process (documented in SECURITY.md).
 */
export class FailureThrottle {
  private readonly state = new Map<string, { failures: number; first: number; lockedUntil: number }>();
  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** Seconds remaining on a lock, or 0. */
  lockedFor(key: string): number {
    const s = this.state.get(key);
    if (!s) return 0;
    const now = this.clock.now().getTime();
    return s.lockedUntil > now ? (s.lockedUntil - now) / 1000 : 0;
  }

  fail(key: string) {
    const now = this.clock.now().getTime();
    let s = this.state.get(key);
    if (!s || now - s.first > this.windowMs) {
      s = { failures: 0, first: now, lockedUntil: 0 };
      this.state.set(key, s);
    }
    s.failures++;
    if (s.failures >= this.maxFailures) {
      const over = s.failures - this.maxFailures;
      s.lockedUntil = now + Math.min(15 * 60_000, 30_000 * 2 ** over);
    }
    if (this.state.size > 100_000) {
      for (const [k, v] of this.state) if (now - v.first > this.windowMs && v.lockedUntil < now) this.state.delete(k);
    }
  }

  succeed(key: string) {
    this.state.delete(key);
  }
}
