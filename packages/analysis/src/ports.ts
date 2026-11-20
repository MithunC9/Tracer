import type {
  ClusterRequirements,
  Finding,
  Narrative,
  PathStep,
  PipelineStage,
  RankedTool,
  Recipe,
  RiskTag,
  ScoreBreakdown,
  StageStatus,
  UserConstraints,
  AuditReport,
} from '@tracer/schema';

/** What the catalog's recommender receives for one finding. */
export interface RecommendInput {
  label: string;
  canonicalPath: PathStep[];
  requirements: ClusterRequirements;
  riskFlags: RiskTag[];
}

export interface Recommendation {
  tools: RankedTool[];
  recipe: Recipe;
}

/** Facts handed to the narrator for one finding. Prose may only mention `allowedNumbers`. */
export interface FindingFacts {
  label: string;
  path: PathStep[];
  metrics: Finding['metrics'];
  score: ScoreBreakdown;
  recipeTitle: string;
  topToolNames: string[];
  allowedNumbers: number[];
}

export interface SummaryFacts {
  reclaimableHoursPerWeek: number;
  daysObserved: number;
  findingCount: number;
  topFindingLabel: string | null;
  allowedNumbers: number[];
}

export interface ValidationResult {
  passed: boolean;
  checkedNumbers: number;
  errors: unknown[];
}

export interface UsageReport {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheHits: number;
}

/** Injected collaborators. The API wires @tracer/catalog and @tracer/llm in here. */
export interface PipelineDeps {
  recommend(input: RecommendInput, constraints: UserConstraints): Recommendation;
  narrateFinding(facts: FindingFacts): Promise<Narrative>;
  narrateSummary(facts: SummaryFacts): Promise<Narrative>;
  validate(report: AuditReport): ValidationResult;
  /** Text embedder; default is the local `hashEmbed`. Must be deterministic for caching to be sound. */
  embed?(text: string): number[];
  usage?(): UsageReport;
}

/** Persistence + resumability. The API implements this with Postgres (stage_outputs). */
export interface StageStore {
  get<T>(stage: PipelineStage, inputHash: string): Promise<T | undefined>;
  put<T>(stage: PipelineStage, inputHash: string, output: T): Promise<void>;
  onStatus?(s: StageStatus): void | Promise<void>;
}

export class InMemoryStageStore implements StageStore {
  readonly outputs = new Map<string, unknown>();
  readonly statuses: StageStatus[] = [];
  hits = 0;
  async get<T>(stage: PipelineStage, inputHash: string): Promise<T | undefined> {
    const v = this.outputs.get(`${stage}:${inputHash}`);
    if (v !== undefined) this.hits++;
    // structuredClone so callers cannot mutate the cache
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put<T>(stage: PipelineStage, inputHash: string, output: T): Promise<void> {
    this.outputs.set(`${stage}:${inputHash}`, structuredClone(output));
  }
  onStatus(s: StageStatus): void {
    this.statuses.push(s);
  }
}
