import { APP_BY_KEY } from '@tracer/schema';
import type { ActionVerb, AppCategory, CapabilityTag, ClusterRequirements, PathStep, Recipe, RiskTag } from '@tracer/schema';

export interface RecipeInput {
  label: string;
  canonicalPath: PathStep[];
  requirements: ClusterRequirements;
  riskFlags: RiskTag[];
}

/** A step as a template writes it; `n` is assigned by recipeFor. */
export interface DraftStep {
  instruction: string;
  appKey: string | null;
  note: string | null;
}

export interface RecipeDraft {
  title: string;
  prerequisites: string[];
  steps: DraftStep[];
  estSetupMinutes: number;
  difficulty: Recipe['difficulty'];
  /** Template-specific human checkpoints; risk-based ones are added by recipeFor. */
  keepHumanFor?: string[];
}

export interface RecipeTemplate {
  id: string;
  /** What the template is for, in one line (README / debugging). */
  description: string;
  /** 0 = does not apply. Highest score wins; ties go to the earlier template in the library. */
  match(ctx: RecipeContext): number;
  build(ctx: RecipeContext): RecipeDraft;
}

export const step = (instruction: string, appKey: string | null = null, note: string | null = null): DraftStep => ({ instruction, appKey, note });

/** Read-only helpers over a recipe input, shared by all templates. */
export class RecipeContext {
  readonly apps: readonly string[];
  readonly caps: ReadonlySet<CapabilityTag>;
  readonly actions: ReadonlySet<ActionVerb>;

  constructor(readonly input: RecipeInput) {
    this.apps = [...new Set([...input.canonicalPath.map((s) => s.appKey), ...input.requirements.apps])];
    this.caps = new Set(input.requirements.capabilities);
    this.actions = new Set(input.canonicalPath.map((s) => s.action));
  }

  get label(): string {
    return this.input.label;
  }
  has(app: string): boolean {
    return this.apps.includes(app);
  }
  hasCap(...c: CapabilityTag[]): boolean {
    return c.some((x) => this.caps.has(x));
  }
  hasAction(...a: ActionVerb[]): boolean {
    return a.some((x) => this.actions.has(x));
  }
  hasRisk(r: RiskTag): boolean {
    return this.input.riskFlags.includes(r);
  }
  categoryOf(app: string): AppCategory | null {
    return APP_BY_KEY.get(app)?.category ?? null;
  }
  /** Display name: "Google Sheets", or the slug for `other:` apps. */
  name(app: string): string {
    return APP_BY_KEY.get(app)?.name ?? app.replace(/^other:/, '');
  }
  /** First app (path order) in one of the given categories. */
  firstOf(...cats: AppCategory[]): string | null {
    return this.apps.find((a) => {
      const c = this.categoryOf(a);
      return c !== null && cats.includes(c);
    }) ?? null;
  }
  /** Display name of the first app in the categories, or the fallback text. */
  nameOf(fallback: string, ...cats: AppCategory[]): string {
    const a = this.firstOf(...cats);
    return a ? this.name(a) : fallback;
  }
  /** Distinct apps in the canonical path, excluding the generic browser container. */
  pathApps(): string[] {
    return [...new Set(this.input.canonicalPath.map((s) => s.appKey))].filter((a) => a !== 'browser');
  }
  /** "A", "A and B", "A, B and C" using display names. */
  list(apps: readonly string[]): string {
    const n = apps.map((a) => this.name(a));
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  }
  /** First path step with the given action, if any. */
  stepWith(...a: ActionVerb[]): PathStep | undefined {
    return this.input.canonicalPath.find((s) => a.includes(s.action));
  }
}
