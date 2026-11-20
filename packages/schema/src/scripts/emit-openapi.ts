import { writeFileSync } from 'node:fs';
import { buildOpenApi } from '../openapi.js';

const out = process.argv[2] ?? 'openapi.json';
writeFileSync(out, JSON.stringify(buildOpenApi(), null, 2) + '\n');
console.log(`wrote ${out}`);
