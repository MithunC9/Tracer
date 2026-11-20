import { LIMITS, type Exclusions, type PipelineStage } from '@tracer/schema';

/**
 * Every tunable of the analysis pipeline, in one place. Defaults are documented in
 * METHODOLOGY.md; changing a default changes stage input hashes (cached outputs are
 * recomputed), so reruns stay honest.
 */
export interface AnalysisConfig {
  // ---- sessionize ----
  /** No input for this long = idle. Matches the agent's threshold. */
  idleThresholdSeconds: number;
  /** idle_start is emitted after the threshold elapsed; trim that lead-in from the session. */
  trimIdleLeadIn: boolean;
  /** A silence (no events at all, no idle signal) longer than this means the agent was not running. */
  maxSilentGapSeconds: number;
  /** Focus shorter than this that returns to the previous window is alt-tab flicker. */
  flickerSeconds: number;
  /** Max chars of digest text kept per session. */
  maxSessionDigestChars: number;
  /** Server-side second line of defence: sessions matching these exclusions are dropped. */
  exclusions: Exclusions | null;

  // ---- segment ----
  /** A gap between sessions longer than this always starts a new episode. */
  episodeGapSeconds: number;
  /** Episodes never run longer than this (wall clock). */
  maxEpisodeSeconds: number;
  /** A foreign run this short that is followed by a return to the task is an interruption, not a new task. */
  interruptionMaxSeconds: number;
  /** ...and contains at most this many sessions. */
  interruptionMaxSessions: number;
  /** Text cosine to the running episode above which a new session continues the task. */
  topicContinueSimilarity: number;
  /** Same app, but text cosine to the previous session below this = different document = topic shift. */
  sameAppSplitSimilarity: number;
  /** Count detour time (chat pings inside a task) as part of the occurrence's time. Off: detours are not the workflow. */
  keepDetourTime: boolean;
  /** Remove the audit-wide mean from session text vectors before comparing them. */
  centerSessionText: boolean;
  /** Title word overlap (Jaccard) at or above which two windows of the same app show the same item (no restart). */
  sameItemSimilarity: number;
  /** A single-app run this long is a focus block; leaving it for another app starts a new episode unless the words carry over. */
  focusBlockSeconds: number;
  /** Habitual app hand-offs: min distinct days and count for a transition to glue two apps. */
  habitMinDays: number;
  habitMinCount: number;
  /** Min share of transitions out of app A that go to app B for A->B to count as a habit. */
  habitMinShare: number;
  /** Sessions shorter than this are ignored when building an episode's path. */
  minStepSeconds: number;
  /** Episodes with less active time than this are dropped (too small to be a task). */
  minEpisodeSeconds: number;

  // ---- cluster ----
  /** Weights of the episode similarity (sum to 1). */
  simWeights: { sequence: number; appShare: number; text: number };
  /** Average-linkage merge threshold. */
  clusterThreshold: number;
  /** A step must appear in at least this share of occurrences to be in the canonical path. */
  consensusSupport: number;
  /** Max steps in a canonical path. */
  maxPathSteps: number;
  /**
   * Min mean pairwise text similarity (centered embeddings) inside a cluster. Repeating the
   * same work repeats its vocabulary (titles, on-screen labels); app sequences that recur with
   * unrelated text are coincidences (e.g. writing different docs then searching the web).
   */
  minTextCohesion: number;
  /** Findings need at least this many different apps: a loop inside one app (inbox triage, coding) is not a hand-off workflow. */
  minPathApps: number;
  /** Findings need at least this many distinct steps (single-step activity is not a workflow). */
  minPathSteps: number;

  // ---- report ----
  maxFindings: number;
  maxEvidencePerFinding: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  idleThresholdSeconds: LIMITS.idleThresholdSeconds,
  trimIdleLeadIn: true,
  maxSilentGapSeconds: 30 * 60,
  flickerSeconds: 3,
  maxSessionDigestChars: 600,
  exclusions: null,

  episodeGapSeconds: 10 * 60,
  maxEpisodeSeconds: 2 * 60 * 60,
  interruptionMaxSeconds: 5 * 60,
  interruptionMaxSessions: 3,
  topicContinueSimilarity: 0.2,
  sameAppSplitSimilarity: 0.1,
  keepDetourTime: false,
  centerSessionText: true,
  sameItemSimilarity: 0.6,
  focusBlockSeconds: 10 * 60,
  habitMinDays: 2,
  habitMinCount: 3,
  habitMinShare: 0.25,
  minStepSeconds: 10,
  minEpisodeSeconds: 90,

  simWeights: { sequence: 0.3, appShare: 0.2, text: 0.5 },
  clusterThreshold: 0.55,
  consensusSupport: 0.5,
  maxPathSteps: 8,
  minTextCohesion: 0.4,
  minPathSteps: 2,
  minPathApps: 2,

  maxFindings: 10,
  maxEvidencePerFinding: 30,
};

export function resolveConfig(partial?: Partial<AnalysisConfig>): AnalysisConfig {
  return { ...DEFAULT_CONFIG, ...(partial ?? {}), simWeights: { ...DEFAULT_CONFIG.simWeights, ...(partial?.simWeights ?? {}) } };
}

/** Bump a stage's version whenever its logic changes, so cached outputs are invalidated. */
export const STAGE_VERSIONS: Record<PipelineStage, number> = {
  sessionize: 1,
  segment: 1,
  cluster: 1,
  score: 1,
  recommend: 1,
  narrate: 1,
  validate: 1,
  publish: 1,
};
