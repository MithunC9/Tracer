import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { ClusterRequirements } from './catalog.js';
import { ScoreBreakdown } from './scoring.js';

/**
 * Intermediate pipeline stage outputs. Each stage is a pure function
 * (prev stage output + config) -> output, persisted by the API so reruns are cheap.
 */
export const PipelineStage = z.enum([
  'sessionize',
  'segment',
  'cluster',
  'score',
  'recommend',
  'narrate',
  'validate',
  'publish',
]);
export type PipelineStage = z.infer<typeof PipelineStage>;
export const PIPELINE_STAGES = PipelineStage.options;

/** Coarse action inferred from window title / digest / clipboard, e.g. "export", "paste". */
export const ActionVerb = z.enum([
  'read',
  'compose',
  'edit',
  'search',
  'export',
  'import',
  'copy',
  'paste',
  'upload',
  'download',
  'review',
  'approve',
  'schedule',
  'reconcile',
  'navigate',
  'unknown',
]);
export type ActionVerb = z.infer<typeof ActionVerb>;

/** Contiguous focus on one app/window, idle gaps removed, alt-tab flicker collapsed. */
export const FocusSession = z.object({
  id: z.string(),
  appKey: z.string(),
  urlHost: z.string().nullable(),
  windowTitle: z.string().nullable(),
  start: IsoDateTime,
  end: IsoDateTime,
  activeSeconds: z.number().nonnegative(),
  /** Event ids folded into this session (traceability). */
  eventIds: z.array(z.string()),
  clipboardEvents: z.number().int().nonnegative(),
  /** Concatenated redacted digest text seen during the session (capped). */
  digestText: z.string(),
  action: ActionVerb,
});
export type FocusSession = z.infer<typeof FocusSession>;

export const PathStep = z.object({
  appKey: z.string(),
  action: ActionVerb,
  /** Human-readable label, e.g. "Export CSV in Stripe" */
  label: z.string().max(120),
});
export type PathStep = z.infer<typeof PathStep>;

/** A task episode: several focus sessions that together accomplish one thing. */
export const TaskEpisode = z.object({
  id: z.string(),
  sessionIds: z.array(z.string()).min(1),
  start: IsoDateTime,
  end: IsoDateTime,
  activeSeconds: z.number().nonnegative(),
  path: z.array(PathStep).min(1),
  /** Embedding of the episode text (title + digest), dims = LIMITS.embeddingDims */
  embedding: z.array(z.number()).optional(),
  /** 0-based day index from audit start */
  dayIndex: z.number().int().nonnegative(),
});
export type TaskEpisode = z.infer<typeof TaskEpisode>;

/** A recurring workflow discovered across days. */
export const WorkflowCluster = z.object({
  /** Stable id: hash of the canonical path signature, `wf_` + 10 hex chars. */
  id: z.string().regex(/^wf_[a-f0-9]{10}$/),
  label: z.string().max(120),
  episodeIds: z.array(z.string()).min(1),
  canonicalPath: z.array(PathStep).min(1),
  occurrences: z.number().int().positive(),
  daysSeen: z.number().int().positive(),
  totalMinutes: z.number().nonnegative(),
  avgMinutes: z.number().nonnegative(),
  cohesion: z.number().min(0).max(1),
  representativeEpisodeId: z.string(),
  requirements: ClusterRequirements,
});
export type WorkflowCluster = z.infer<typeof WorkflowCluster>;

export const ScoredCluster = WorkflowCluster.extend({ score: ScoreBreakdown });
export type ScoredCluster = z.infer<typeof ScoredCluster>;

export const StageState = z.enum(['pending', 'running', 'succeeded', 'failed', 'dead', 'skipped']);
export type StageState = z.infer<typeof StageState>;

export const StageStatus = z.object({
  stage: PipelineStage,
  state: StageState,
  attempts: z.number().int().nonnegative(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  error: z.string().nullable(),
  /** sha256 of the stage's input; equal hash => cached output reused. */
  inputHash: z.string().nullable(),
});
export type StageStatus = z.infer<typeof StageStatus>;

export const PipelineRun = z
  .object({
    id: Uuid,
    auditId: Uuid,
    state: z.enum(['queued', 'running', 'succeeded', 'failed']),
    createdAt: IsoDateTime,
    stages: z.array(StageStatus),
  })
  .meta({ id: 'PipelineRun' });
export type PipelineRun = z.infer<typeof PipelineRun>;
