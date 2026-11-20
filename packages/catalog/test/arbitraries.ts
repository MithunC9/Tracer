import fc from 'fast-check';
import { APPS, CapabilityTag, RiskTag, ActionVerb } from '@tracer/schema';
import type { AffiliateRecord, ClusterRequirements, PathStep, UserConstraints } from '@tracer/schema';
import { CATALOG } from '../src/index.js';

export const appKeyArb = fc.oneof(
  { weight: 9, arbitrary: fc.constantFrom(...APPS.map((a) => a.key)) },
  { weight: 1, arbitrary: fc.constantFrom('other:acme-portal', 'other:internal-tool') },
);

export const requirementsArb: fc.Arbitrary<ClusterRequirements> = fc.record({
  capabilities: fc.uniqueArray(fc.constantFrom(...CapabilityTag.options), { minLength: 1, maxLength: 5 }),
  apps: fc.uniqueArray(appKeyArb, { maxLength: 4 }),
  trigger: fc.constantFrom('schedule', 'event', 'manual'),
  involvesJudgement: fc.boolean(),
});

export const constraintsArb: fc.Arbitrary<UserConstraints> = fc.record({
  platform: fc.constantFrom('macos', 'windows', 'linux'),
  budget: fc.constantFrom('free_only', 'low', 'any'),
  skill: fc.constantFrom('none', 'some', 'technical'),
  preferOpenSource: fc.boolean(),
});

/** Random registries: any catalog ids (plus unknown ids), any rates in [0,1], duplicates allowed. */
export const affiliatesArb: fc.Arbitrary<AffiliateRecord[]> = fc.array(
  fc.record({
    entryId: fc.oneof({ weight: 9, arbitrary: fc.constantFrom(...CATALOG.map((e) => e.id)) }, { weight: 1, arbitrary: fc.constant('not-in-catalog') }),
    url: fc.integer({ min: 1, max: 9999 }).map((n) => `https://partners.example.com/r/${n}`),
    programName: fc.constantFrom('Placeholder A', 'Placeholder B', 'Placeholder C'),
    commissionRate: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  { maxLength: 60 },
);

export const pathStepArb: fc.Arbitrary<PathStep> = fc.record({
  appKey: appKeyArb,
  action: fc.constantFrom(...ActionVerb.options),
  label: fc.string({ minLength: 1, maxLength: 120 }),
});

export const recipeInputArb = fc.record({
  label: fc.string({ minLength: 1, maxLength: 120 }),
  canonicalPath: fc.array(pathStepArb, { minLength: 1, maxLength: 8 }),
  requirements: requirementsArb,
  riskFlags: fc.uniqueArray(fc.constantFrom(...RiskTag.options), { maxLength: 3 }),
});
