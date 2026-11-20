#!/usr/bin/env node
/**
 * `pnpm dev`: the whole product locally, one command.
 *
 *   1. .env from .env.example if missing
 *   2. Postgres: use it if already reachable; else `docker compose up -d --wait postgres`;
 *      else `docker start tracer-pg`; else stop with instructions
 *   3. build workspace packages the API and web depend on (turbo, cached) and, if cargo is
 *      installed, the simulated agent (`tracer-sim`, cargo-cached)
 *   4. migrations, then the seed (demo user + a completed audit from the real pipeline)
 *   5. API (tsx watch) + web (next dev), prefixed and coloured logs
 *   6. once the API is ready: the live simulated agent replaying a persona into the demo
 *      user's currently capturing audit (skipped with a message when cargo is missing)
 *
 * Ctrl-C stops everything. Safe to re-run. Flags: --no-web, --no-agent, --no-seed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const WANT_WEB = !argv.has('--no-web');
const WANT_AGENT = !argv.has('--no-agent');
const WANT_SEED = !argv.has('--no-seed');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const C = { dev: 32, db: 34, build: 90, cargo: 33, migrate: 34, seed: 32, api: 36, web: 35, agent: 33 };
const tag = (name) => {
  const label = name.padEnd(7);
  return tty ? `\x1b[${C[name] ?? 37}m${label}\x1b[0m│ ` : `${label}│ `;
};
const say = (name, msg) => {
  for (const line of String(msg).split('\n')) if (line.length) process.stdout.write(tag(name) + line + '\n');
};
const fail = (msg) => {
  say('dev', tty ? `\x1b[31m${msg}\x1b[0m` : msg);
  shutdown(1);
};

// ---------------------------------------------------------------- env
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Node ${process.versions.node} found; Tracer needs Node 22+.`);
  process.exit(1);
}
if (!existsSync(join(root, '.env'))) {
  copyFileSync(join(root, '.env.example'), join(root, '.env'));
  say('dev', 'created .env from .env.example (dev-only secrets; edit before any real use)');
}
const fileEnv = {};
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const env = { ...fileEnv, ...process.env, FORCE_COLOR: tty ? '1' : '0' };
const API_PORT = env.API_PORT || '4000';
const API_URL = `http://localhost:${API_PORT}`;
env.NEXT_PUBLIC_API_URL ??= API_URL;

// ---------------------------------------------------------------- process management
const children = new Set();
let stopping = false;

/** Pino JSON -> one short line; request pairs collapse to "GET /v1/x -> 200 3ms". */
const LEVELS = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
const pending = new Map();
function compactLog(line) {
  if (line[0] !== '{') return line;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof o.msg !== 'string') return line;
  if (o.msg === 'incoming request' && o.req) {
    pending.set(o.reqId, `${o.req.method} ${o.req.url}`);
    return null;
  }
  if (o.msg === 'request completed' && o.res) {
    const what = pending.get(o.reqId) ?? '';
    pending.delete(o.reqId);
    if (/\/(readyz|healthz)$/.test(what) && o.res.statusCode < 400) return null;
    return `${what} -> ${o.res.statusCode} ${Math.round(o.responseTime ?? 0)}ms`;
  }
  const level = typeof o.level === 'number' ? LEVELS[o.level] : o.level;
  const { level: _l, time: _t, service: _s, pid: _p, hostname: _h, msg, config: _c, ...rest } = o;
  const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest).slice(0, 400) : '';
  return `${level && level !== 'info' ? level.toUpperCase() + ' ' : ''}${msg}${extra}`;
}

function pipeLines(stream, name) {
  let buf = '';
  const emit = (l) => {
    const out = name === 'api' ? compactLog(l) : l;
    if (out !== null) say(name, out);
  };
  stream.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) emit(l);
  });
  stream.on('end', () => buf && emit(buf));
}

/** Starts a child in its own process group (so Ctrl-C reaches its whole tree). */
function start(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: opts.cwd ?? root, env: { ...env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  children.add(child);
  pipeLines(child.stdout, name);
  pipeLines(child.stderr, name);
  child.on('exit', () => children.delete(child));
  return child;
}

/** Runs a one-shot step; resolves on exit 0, rejects otherwise. */
function run(name, cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = start(name, cmd, args, opts);
    child.on('error', reject);
    child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code ?? signal}`))));
  });
}

function killTree(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* already gone */
  }
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (children.size) say('dev', 'stopping…');
  for (const c of children) killTree(c, 'SIGTERM');
  const deadline = Date.now() + 8000;
  while (children.size && Date.now() < deadline) await sleep(100);
  for (const c of children) killTree(c, 'SIGKILL');
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

// ---------------------------------------------------------------- postgres
function tcpOpen(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port: Number(port) });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function ensurePostgres() {
  const u = new URL(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL);
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
  const port = u.port || '5432';
  if (await tcpOpen(host, port)) {
    say('db', `Postgres reachable at ${u.hostname}:${port}`);
    return;
  }
  const docker = has('docker', ['info']);
  if (docker) {
    try {
      say('db', 'starting Postgres with `docker compose up -d --wait postgres`');
      await run('db', 'docker', ['compose', 'up', '-d', '--wait', 'postgres']);
    } catch (err) {
      say('db', `docker compose failed (${err.message}); trying the tracer-pg container`);
      try {
        await run('db', 'docker', ['start', 'tracer-pg']);
      } catch {
        /* fall through to the wait below */
      }
    }
  } else if (has('docker', ['--version'])) {
    say('db', 'docker is installed but the daemon is not running');
  }
  for (let i = 0; i < 60; i++) {
    if (await tcpOpen(host, port)) {
      say('db', `Postgres reachable at ${u.hostname}:${port}`);
      return;
    }
    await sleep(1000);
  }
  fail(
    [
      `No Postgres at ${u.hostname}:${port}. Either:`,
      '  - start Docker and re-run `pnpm dev` (it runs `docker compose up -d postgres`), or',
      '  - run a local PostgreSQL 16 with the pgvector extension, create user/db `tracer` (password `tracer`,',
      '    superuser, used only for migrations), and set DATABASE_ADMIN_URL / DATABASE_URL in .env.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------- main
async function main() {
  say('dev', `Tracer dev: API ${API_URL}${WANT_WEB ? ', web http://localhost:3000' : ''}`);
  await ensurePostgres();

  const simBin = join(root, 'apps/agent/core/target/release', process.platform === 'win32' ? 'tracer-sim.exe' : 'tracer-sim');
  const cargo = WANT_AGENT || WANT_SEED ? has('cargo') : false;
  if (!cargo && !existsSync(simBin)) {
    say('cargo', 'Rust (cargo) not found: the simulated agent is skipped; the seed uploads fixture events over HTTP instead.');
    say('cargo', 'Install Rust (https://rustup.rs) and re-run to see live capture from tracer-sim.');
  }
  let cargoBuild = Promise.resolve();
  if (cargo) {
    if (!existsSync(simBin)) say('cargo', 'building tracer-sim (first run takes a few minutes; cached afterwards)');
    // Runs alongside the TS build; cargo is incremental, so this is ~1 s when nothing changed.
    cargoBuild = run('cargo', 'cargo', ['build', '--release', '--quiet', '--manifest-path', 'apps/agent/core/Cargo.toml', '--bin', 'tracer-sim']).catch((err) =>
      say('cargo', `tracer-sim build failed (${err.message}); continuing without the simulated agent`),
    );
  }

  say('build', 'building workspace packages (turbo, cached)');
  const filters = ['--filter=@tracer/api^...', '--filter=@tracer/fixtures'];
  if (WANT_WEB) filters.push('--filter=@tracer/web^...');
  await run('build', 'pnpm', ['exec', 'turbo', 'run', 'build', ...filters, '--output-logs=errors-only']);
  if (!existsSync(join(root, 'packages/fixtures/data/bookkeeper/raw.jsonl'))) {
    await run('build', 'pnpm', ['--filter', '@tracer/fixtures', 'build']);
  }
  await cargoBuild;

  for (let attempt = 1; ; attempt++) {
    try {
      await run('migrate', 'pnpm', ['--silent', '--filter', '@tracer/api', 'migrate']);
      break;
    } catch (err) {
      if (attempt >= 5) return fail(`migrations failed: ${err.message}`);
      await sleep(2000);
    }
  }

  if (WANT_SEED) {
    try {
      await run('seed', 'pnpm', ['--silent', '--filter', '@tracer/api', 'seed']);
    } catch (err) {
      say('seed', `seed failed (${err.message}); continuing (re-run \`pnpm seed\` to retry)`);
    }
  }

  const api = start('api', 'pnpm', ['--silent', '--filter', '@tracer/api', 'dev']);
  api.on('exit', (code) => !stopping && say('api', `exited (${code}); fix the error above, the dev runner keeps the rest up`));
  if (WANT_WEB) {
    const web = start('web', 'pnpm', ['--silent', '--filter', '@tracer/web', 'dev']);
    web.on('exit', (code) => !stopping && say('web', `exited (${code})`));
  }

  let ready = false;
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      if ((await fetch(`${API_URL}/readyz`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await sleep(1000);
  }
  if (!ready) return fail(`API did not become ready at ${API_URL}/readyz`);

  say(
    'dev',
    [
      '',
      `ready:  API  ${API_URL}  (docs ${API_URL}/docs)`,
      ...(WANT_WEB ? ['        web  http://localhost:3000'] : []),
      '        login demo@tracer.local / tracer-demo-password',
      '        Ctrl-C to stop',
      '',
    ].join('\n'),
  );

  if (WANT_AGENT) {
    if (existsSync(simBin)) {
      const agent = start('agent', 'pnpm', ['--silent', '--filter', '@tracer/api', 'live-agent'], { env: { API_URL } });
      agent.on('exit', (code) => !stopping && say('agent', `live simulated agent stopped (${code})`));
    } else {
      say('agent', 'tracer-sim not available; no live capture (the completed demo audit is still there)');
    }
  }
}

main().catch((err) => fail(err?.stack ?? String(err)));
