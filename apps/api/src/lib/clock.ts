/** Injectable time source so services are testable without fake timers. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** Test clock: fixed or manually advanced. */
export class ManualClock implements Clock {
  constructor(private t: Date = new Date()) {}
  now() {
    return new Date(this.t.getTime());
  }
  set(d: Date) {
    this.t = new Date(d.getTime());
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;
