// Regenerates src/contract/*.json from the built @tracer/schema package, so the Rust
// agent never hand-copies the app table, default exclusions, limits or event JSON Schema.
//
// Usage (from repo root):
//   pnpm --filter @tracer/schema build
//   node apps/agent/core/scripts/gen-contract.mjs          # write
//   node apps/agent/core/scripts/gen-contract.mjs --check  # exit 1 if stale
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const schema = await import(pathToFileURL(join(repo, 'packages/schema/dist/index.js')).href);
const { z } = await import(pathToFileURL(join(repo, 'packages/schema/node_modules/zod/index.js')).href);

const outputs = {
  'apps.json': schema.APPS.map((a) => ({
    key: a.key,
    name: a.name,
    bundleIds: a.bundleIds,
    hosts: a.hosts,
    excludedByDefault: a.excludedByDefault,
  })),
  'default-exclusions.json': schema.DEFAULT_EXCLUSIONS,
  'limits.json': { ...schema.LIMITS, schemaVersion: schema.SCHEMA_VERSION },
  'activity-event.schema.json': z.toJSONSchema(schema.ActivityEvent, { target: 'draft-2020-12', io: 'input' }),
  'ingest-batch.schema.json': z.toJSONSchema(schema.IngestBatch, { target: 'draft-2020-12', io: 'input' }),
};

const check = process.argv.includes('--check');
let stale = false;
for (const [name, value] of Object.entries(outputs)) {
  const path = join(here, '..', 'src', 'contract', name);
  const text = JSON.stringify(value, null, 2) + '\n';
  let prev = '';
  try {
    prev = readFileSync(path, 'utf8');
  } catch {
    // missing file counts as stale
  }
  if (prev !== text) {
    stale = true;
    if (check) console.error(`stale: ${name}`);
    else writeFileSync(path, text);
  }
}
if (check && stale) process.exit(1);
console.log(check ? 'contract files up to date' : 'contract files written');
