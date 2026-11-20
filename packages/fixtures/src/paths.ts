import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Persona ids, in a stable order. */
export const PERSONAS = ['freelancer', 'ops_manager', 'bookkeeper', 'agency_am', 'founder'] as const;
export type PersonaId = (typeof PERSONAS)[number];

/** Absolute path of packages/fixtures/data (works from src/ and dist/). */
export const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

export const HOSTILE_CORPUS_PATH = join(DATA_DIR, 'hostile-corpus.json');

export function personaDir(p: PersonaId): string {
  return join(DATA_DIR, p);
}

export function personaPaths(p: PersonaId) {
  const dir = personaDir(p);
  return {
    dir,
    raw: join(dir, 'raw.jsonl'),
    events: join(dir, 'events.json'),
    groundTruth: join(dir, 'ground-truth.json'),
  };
}
