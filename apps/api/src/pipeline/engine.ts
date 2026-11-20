import type { ActivityEvent, Exclusions, PipelineStage, StageStatus, UserConstraints } from '@tracer/schema';

/**
 * PORT: the analysis engine. The API owns orchestration (queues, retries, caching, encryption,
 * persistence); the engine owns the maths. `@tracer/analysis` implements this, either directly
 * or through `adaptRunPipeline` below. Swap it in `src/container.ts` (one line).
 *
 * Contract:
 *  - Stages run in PIPELINE_STAGES order, one pg-boss job each.
 *  - `runStage` must be deterministic for a given (input, ctx, version): its output is cached
 *    by input hash and reused by later runs.
 *  - Outputs must be JSON-serializable. The output of the last stage (`publish`) must be a
 *    valid `AuditReport` for `ctx.auditId`; the orchestrator validates it before storing.
 *  - Throwing fails the attempt; the job is retried with exponential backoff and, when retries
 *    are exhausted, dead-lettered (stage state `dead`, audit `failed`).
 */
export interface StageContext {
  userId: string;
  auditId: string;
  runId: string;
  audit: { startsAt: string; endsAt: string; lengthDays: number; pausedSeconds: number };
  exclusions: Exclusions;
  constraints: UserConstraints;
  /** Wall-clock time of this attempt (ISO). Do not use for anything that should affect cached output. */
  now: string;
  signal?: AbortSignal;
}

export interface StageInput {
  /** Decrypted, (ts, id)-ordered events of the audit. Lazily loaded and memoized per job. */
  events: () => Promise<ActivityEvent[]>;
  /** Output of the immediately preceding stage (undefined for the first). */
  previous: unknown;
  /** Outputs of every earlier stage of this run, by stage name. */
  outputs: Partial<Record<PipelineStage, unknown>>;
}

export interface PipelineEngine {
  /** Bump when engine logic changes: part of every input hash, so it invalidates cached outputs. */
  readonly version: string;
  runStage(stage: PipelineStage, input: StageInput, ctx: StageContext): Promise<unknown>;
}

/**
 * The store shape `@tracer/analysis` exports for its whole-pipeline runner. Implemented by
 * the adapter below on top of the orchestrator's per-stage persistence (stage_outputs).
 */
export interface StageStore {
  get(stage: PipelineStage, inputHash: string): Promise<unknown | undefined>;
  put(stage: PipelineStage, inputHash: string, output: unknown): Promise<void>;
  onStatus(status: Partial<StageStatus> & { stage: PipelineStage }): void;
}

export type RunPipelineFn<Deps> = (events: ActivityEvent[], ctx: StageContext, deps: Deps, store: StageStore) => Promise<unknown>;

class StopAfterStage extends Error {
  constructor(readonly output: unknown) {
    super('stop-after-stage');
  }
}

/**
 * Adapts a whole-pipeline `runPipeline(events, ctx, deps, store)` to the per-stage port:
 * to run stage S, the store answers `get` for every earlier stage with that stage's persisted
 * output (so the runner skips it), misses for S (so the runner computes it), and the `put` for
 * S captures the output and stops the runner. If the runner returns without a `put` for the
 * last stage, its return value is taken as that stage's output.
 */
export function adaptRunPipeline<Deps>(runPipeline: RunPipelineFn<Deps>, deps: Deps, version: string, stages: readonly PipelineStage[]): PipelineEngine {
  return {
    version,
    async runStage(stage, input, ctx) {
      const idx = stages.indexOf(stage);
      const store: StageStore = {
        async get(s) {
          return stages.indexOf(s) < idx ? input.outputs[s] : undefined;
        },
        async put(s, _hash, output) {
          if (s === stage) throw new StopAfterStage(output);
        },
        onStatus() {},
      };
      try {
        const result = await runPipeline(await input.events(), ctx, deps, store);
        if (idx === stages.length - 1) return result;
        throw new Error(`runPipeline finished without producing stage ${stage}`);
      } catch (err) {
        if (err instanceof StopAfterStage) return err.output;
        throw err;
      }
    },
  };
}
