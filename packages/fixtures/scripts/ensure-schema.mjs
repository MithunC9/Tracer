// Builds @tracer/schema only when its dist is missing, so `pnpm --filter @tracer/fixtures build`
// works in a fresh checkout without racing turbo's own ^build of the schema.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const schemaDir = fileURLToPath(new URL('../../schema/', import.meta.url));
if (!existsSync(new URL('../../schema/dist/index.d.ts', import.meta.url))) {
  execSync('pnpm run build', { cwd: schemaDir, stdio: 'inherit' });
}
