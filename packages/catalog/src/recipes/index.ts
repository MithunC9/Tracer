import { Recipe } from '@tracer/schema';
import type { RiskTag } from '@tracer/schema';
import { RecipeContext, type RecipeInput, type RecipeTemplate } from './context.js';
import { GENERIC_TEMPLATE, TEMPLATES } from './templates.js';

export type { RecipeInput, RecipeTemplate } from './context.js';
export { GENERIC_TEMPLATE, TEMPLATES } from './templates.js';

/** Human checkpoints added for each risk flag, whatever the template. */
export const RISK_CHECKPOINTS: Record<RiskTag, string> = {
  money: 'Approve each payment, invoice or ledger posting before it goes out',
  pii: 'Check which personal details the automation copies, and where to, before switching it on',
  irreversible: 'Confirm deletions, submissions and sends by hand until it has run correctly for two weeks',
  credentials: 'Type passwords and one-time codes yourself; never store them in the automation',
  health: 'Keep health information out of the automation and handle those items by hand',
};

const JUDGEMENT_CHECKPOINT = 'Read anything an AI tool drafted or sorted before acting on it';

const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…');

/** Pick the best-matching template (ties: earlier in TEMPLATES), or the generic fallback. */
export function selectTemplate(input: RecipeInput): RecipeTemplate {
  const ctx = new RecipeContext(input);
  let best: RecipeTemplate = GENERIC_TEMPLATE;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const s = t.match(ctx);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Build the DIY recipe for a workflow. Deterministic. Always returns a value that passes
 * `Recipe.parse`; `keepHumanFor` always covers the money / pii / irreversible risk flags.
 */
export function recipeFor(input: RecipeInput): Recipe {
  const template = selectTemplate(input);
  const draft = template.build(new RecipeContext(input));

  const human = [...(draft.keepHumanFor ?? [])];
  for (const r of input.riskFlags) human.push(RISK_CHECKPOINTS[r]);
  if (input.requirements.involvesJudgement && input.requirements.capabilities.some((c) => c.startsWith('llm_'))) human.push(JUDGEMENT_CHECKPOINT);
  const keepHumanFor = [...new Set(human)];

  return Recipe.parse({
    templateId: template.id,
    title: cut(draft.title, 120),
    prerequisites: draft.prerequisites.map((p) => cut(p, 160)),
    steps: draft.steps.map((s, i) => ({
      n: i + 1,
      instruction: cut(s.instruction, 400),
      appKey: s.appKey,
      note: s.note === null ? null : cut(s.note, 240),
    })),
    estSetupMinutes: draft.estSetupMinutes,
    difficulty: draft.difficulty,
    keepHumanFor: keepHumanFor.map((h) => cut(h, 160)),
  });
}
