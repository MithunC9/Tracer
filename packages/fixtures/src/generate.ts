import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { ActivityEvent, GroundTruth, RawSample } from '@tracer/schema';
import { rawToEvents } from './convert.js';
import { runPersona } from './engine.js';
import { HOSTILE_CORPUS } from './hostile-corpus.js';
import { DATA_DIR, HOSTILE_CORPUS_PATH, PERSONAS, personaPaths, type PersonaId } from './paths.js';
import { PERSONA_DEFS } from './personas/index.js';

export interface GeneratedPersona {
  raw: RawSample[];
  events: ActivityEvent[];
  groundTruth: GroundTruth;
  /** Every planted secret / PII value (must not appear in events.json). */
  planted: string[];
  /** Subset of `planted` protected only by context (secure field, exclusion), not by pattern. */
  plantedContextual: string[];
  files: { raw: string; events: string; groundTruth: string };
}

/** One JSON object per line; events.json is an array with one event per line (diff-friendly, compact). */
export function serializeRaw(raw: readonly RawSample[]): string {
  return raw.map((s) => JSON.stringify(s)).join('\n') + '\n';
}

export function serializeEvents(events: readonly ActivityEvent[]): string {
  return '[\n' + events.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n';
}

/** Pure: same persona -> byte-identical output. */
export function generatePersona(id: PersonaId): GeneratedPersona {
  const def = PERSONA_DEFS[id];
  const { raw, groundTruth, planted, plantedContextual } = runPersona(def);
  const events = rawToEvents(id, raw);
  return {
    raw,
    events,
    groundTruth,
    planted,
    plantedContextual,
    files: {
      raw: serializeRaw(raw),
      events: serializeEvents(events),
      groundTruth: JSON.stringify(groundTruth, null, 2) + '\n',
    },
  };
}

export function serializeCorpus(): string {
  return JSON.stringify(HOSTILE_CORPUS, null, 2) + '\n';
}

export function writeAll(personas: readonly PersonaId[] = PERSONAS): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(HOSTILE_CORPUS_PATH, serializeCorpus());
  for (const id of personas) {
    const g = generatePersona(id);
    const p = personaPaths(id);
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.raw, g.files.raw);
    writeFileSync(p.events, g.files.events);
    writeFileSync(p.groundTruth, g.files.groundTruth);
    const wf = g.groundTruth.workflows.map((w) => `${w.id}×${w.occurrences.length}`).join(' ');
    console.log(`${id}: ${g.raw.length} raw, ${g.events.length} events (${(g.files.events.length / 1e6).toFixed(2)} MB) — ${wf}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv.slice(2) as PersonaId[];
  writeAll(only.length ? only : PERSONAS);
}
