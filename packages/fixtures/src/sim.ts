import type { RawSample } from '@tracer/schema';
import type { Rng } from './prng.js';

export interface Ax {
  headings: string[];
  labels: string[];
  text: string;
  secure?: boolean;
}

/** Something the user can be focused on: a native window or a browser tab. */
export interface Screen {
  bundleId: string;
  appName: string;
  title: string | null;
  url: string | null;
  private?: boolean;
  /** Accessibility digests seen while dwelling, cycled in order. */
  ax?: Ax[];
}

export interface DwellOpts {
  /** Seconds between accessibility digests [min, max]. */
  axEvery?: [number, number];
  /** Number of clipboard copies during the dwell. */
  clips?: number;
  clipKind?: 'text' | 'image' | 'file' | 'other';
  /** Screens that may steal focus for <3s (alt-tab flicker). */
  flicker?: Screen[];
  /** Probability of a flicker per digest interval. */
  flickerP?: number;
}

export const IDLE_THRESHOLD_SECONDS = 120;

/**
 * Event-time simulator. `t` only moves forward; every sample is stamped with the
 * current `t`, so raw.jsonl is in time order by construction.
 */
export class Sim {
  readonly samples: RawSample[] = [];
  readonly planted = new Set<string>();
  /** Planted values only protected by context (secure field / exclusion), not detectable on their own. */
  readonly plantedContextual = new Set<string>();
  t: number;
  cur: Screen | null = null;

  constructor(
    readonly rng: Rng,
    startMs: number,
  ) {
    this.t = startMs;
  }

  get iso(): string {
    return new Date(this.t).toISOString();
  }

  adv(sec: number): void {
    this.t += Math.max(1, Math.round(sec * 1000));
  }

  /** Register a planted secret/PII value (the tests assert none survive into events.json). */
  plant<T extends string>(v: T, contextual = false): T {
    this.planted.add(v);
    if (contextual) this.plantedContextual.add(v);
    return v;
  }

  focus(s: Screen): void {
    const c = this.cur;
    if (c && c.bundleId === s.bundleId && c.title === s.title && c.url === s.url && !!c.private === !!s.private) return;
    this.samples.push({
      t: this.iso,
      type: 'focus',
      bundleId: s.bundleId,
      appName: s.appName,
      title: s.title,
      url: s.url,
      private: !!s.private,
    });
    this.cur = s;
  }

  ax(a: Ax): void {
    if (!this.cur) return;
    this.samples.push({
      t: this.iso,
      type: 'ax',
      bundleId: this.cur.bundleId,
      appName: this.cur.appName,
      headings: a.headings,
      labels: a.labels,
      text: a.text,
      secureField: !!a.secure,
    });
  }

  clip(kind: 'text' | 'image' | 'file' | 'other' = 'text'): void {
    if (!this.cur) return;
    this.samples.push({ t: this.iso, type: 'clipboard', bundleId: this.cur.bundleId, appName: this.cur.appName, contentKind: kind });
  }

  /** Focus `s` and stay for `sec` seconds, emitting digests, clipboard and flicker. */
  dwell(s: Screen, sec: number, o: DwellOpts = {}): void {
    const r = this.rng;
    const end = this.t + Math.round(sec * 1000);
    this.focus(s);
    const axs = s.ax ?? [];
    const [amin, amax] = o.axEvery ?? [20, 60];
    const clipAt = Array.from({ length: o.clips ?? 0 }, () => this.t + r.float(0.15, 0.9) * (end - this.t)).sort((a, b) => a - b);
    let k = 0;
    if (axs.length && end - this.t > 3000) {
      this.adv(r.float(0.4, 2.5));
      this.ax(axs[0]!);
      k = 1;
    }
    for (;;) {
      const step = r.float(amin, amax);
      if (this.t + step * 1000 >= end) break;
      this.adv(step);
      if (o.flicker?.length && r.chance(o.flickerP ?? 0.08)) {
        this.focus(r.pick(o.flicker));
        this.adv(r.float(0.5, 2.6));
        this.focus(s);
      }
      while (clipAt.length && clipAt[0]! <= this.t) {
        clipAt.shift();
        this.clip(o.clipKind ?? 'text');
        this.adv(r.float(0.3, 2));
      }
      if (axs.length) this.ax(axs[k++ % axs.length]!);
    }
    for (const _ of clipAt) {
      if (this.t < end - 1500) this.adv(Math.min(1, (end - this.t) / 2000));
      this.clip(o.clipKind ?? 'text');
    }
    if (this.t < end) this.t = end;
  }

  /** No input for `sec` seconds; emits idle_start/idle_end only past the threshold. */
  idle(sec: number): void {
    this.idleUntil(this.t + Math.round(sec * 1000));
  }

  idleUntil(ms: number): void {
    if (ms <= this.t) return;
    if (ms - this.t > IDLE_THRESHOLD_SECONDS * 1000) {
      this.t += IDLE_THRESHOLD_SECONDS * 1000;
      this.samples.push({ t: this.iso, type: 'idle_start', thresholdSeconds: IDLE_THRESHOLD_SECONDS });
      this.t = ms;
      this.samples.push({ t: this.iso, type: 'idle_end' });
    } else {
      this.t = ms;
    }
  }

  /** Close the day: idle_start now(+threshold); the matching idle_end comes when the next day starts. */
  endDay(): void {
    this.t += IDLE_THRESHOLD_SECONDS * 1000;
    this.samples.push({ t: this.iso, type: 'idle_start', thresholdSeconds: IDLE_THRESHOLD_SECONDS });
    this.inOvernightIdle = true;
  }

  inOvernightIdle = false;

  /** Start a day at `ms` (after an overnight idle). */
  startDay(ms: number): void {
    if (ms < this.t) ms = this.t + 1000;
    this.t = ms;
    if (this.inOvernightIdle) {
      this.samples.push({ t: this.iso, type: 'idle_end' });
      this.inOvernightIdle = false;
    }
  }
}
