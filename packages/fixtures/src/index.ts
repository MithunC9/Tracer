import { readFileSync } from 'node:fs';
import { ActivityEvent, GroundTruth, RawSample } from '@tracer/schema';
import type { HostileCase } from './hostile-corpus.js';
import { HOSTILE_CORPUS_PATH, personaPaths, type PersonaId } from './paths.js';

export { PERSONAS, DATA_DIR, HOSTILE_CORPUS_PATH, personaDir, personaPaths, type PersonaId } from './paths.js';
export { redact, luhnValid, ibanValid, type RedactResult } from './redact.js';
export { HOSTILE_CORPUS, type HostileCase } from './hostile-corpus.js';
export { rawToEvents, digestHash, normalizeDigest } from './convert.js';
export { resolveApp, otherSlug } from './resolve.js';
export { uuidV5, eventId } from './ids.js';
export { Rng } from './prng.js';

export interface LoadOptions {
  /** Validate every record with the schema (slower). Default false. */
  validate?: boolean;
}

/** Redacted, agent-shaped events (what the API would ingest). */
export function loadEvents(persona: PersonaId, opts: LoadOptions = {}): ActivityEvent[] {
  const data = JSON.parse(readFileSync(personaPaths(persona).events, 'utf8')) as unknown[];
  return opts.validate ? data.map((e) => ActivityEvent.parse(e)) : (data as ActivityEvent[]);
}

/** Pre-redaction device-local capture, in time order. Contains planted fake secrets. */
export function loadRaw(persona: PersonaId, opts: LoadOptions = {}): RawSample[] {
  const lines = readFileSync(personaPaths(persona).raw, 'utf8').split('\n').filter(Boolean);
  return lines.map((l) => (opts.validate ? RawSample.parse(JSON.parse(l)) : (JSON.parse(l) as RawSample)));
}

export function loadGroundTruth(persona: PersonaId): GroundTruth {
  return GroundTruth.parse(JSON.parse(readFileSync(personaPaths(persona).groundTruth, 'utf8')));
}

export function loadHostileCorpus(): HostileCase[] {
  return JSON.parse(readFileSync(HOSTILE_CORPUS_PATH, 'utf8')) as HostileCase[];
}
