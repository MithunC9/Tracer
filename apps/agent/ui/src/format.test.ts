import { describe, expect, it } from 'vitest';
import { MockAdapter } from './adapter';
import { dayLine, describe as describeEvent, SELF_OBSERVATION_LINE } from './format';

describe('agent ui', () => {
  it('shows "Day N of M"', async () => {
    const s = await new MockAdapter().status();
    expect(dayLine(s)).toBe('Day 3 of 7');
  });
  it('never describes excluded windows', async () => {
    const t = await new MockAdapter().today();
    const ex = t.events.find((e) => e.event.kind === 'capture_state' && e.event.state === 'excluded_app_active');
    expect(ex && describeEvent(ex.event).detail).toBe('Nothing about it was recorded.');
  });
  it('keeps private browsing on', async () => {
    const a = new MockAdapter();
    const ex = await a.setExclusions({ apps: [], domains: [], titleKeywords: [], privateBrowsing: true });
    expect(ex.privateBrowsing).toBe(true);
  });
  it('has the consent line', () => {
    expect(SELF_OBSERVATION_LINE).toBe('Tracer only observes your own work, on this computer, with your consent.');
  });
});
