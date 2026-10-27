#!/usr/bin/env node
/**
 * One-shot DEMO-29 golden: prepare + API + Vite + capture + teardown.
 * Env: DATABASE_URL (millq_ci_pos_*), DEMO29_EVIDENCE_DIR
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const evidenceDir = process.env.DEMO29_EVIDENCE_DIR;
if (!evidenceDir) {
  console.error('Need DEMO29_EVIDENCE_DIR');
  process.exit(1);
}
if (!/\/millq_ci_pos(?:_[A-Za-z0-9]+)+(\?|$)/.test(DATABASE_URL) || /millq_dev/.test(DATABASE_URL)) {
  console.error('DATABASE_URL must be disposable millq_ci_pos_* (not millq_dev)');
  process.exit(1);
}

mkdirSync(evidenceDir, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      const port = addr.port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function run(cmd, args, env, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

function start(cmd, args, env, cwd = ROOT) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));
  return child;
}

async function waitHttp(url, timeoutMs = 90_000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function writeRedactedFixture(srcPath, destPath) {
  const raw = JSON.parse(readFileSync(srcPath, 'utf8'));
  writeFileSync(
    destPath,
    `${JSON.stringify(
      {
        ...raw,
        cashierPin: '[REDACTED]',
        managerPin: '[REDACTED]',
        noReceivePin: '[REDACTED]',
      },
      null,
      2,
    )}\n`,
  );
}

const work = mkdtempSync(join(tmpdir(), 'millq-demo29-oneshot-'));
const fixturePath = join(work, 'fixture.json');
const children = [];

async function teardown() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
}

try {
  console.log('oneshot prepare…');
  await run(
    'pnpm',
    ['exec', 'tsx', 'src/test/cash12-close-e2e-prepare.ts'],
    { DATABASE_URL, E2E_FIXTURE_PATH: fixturePath, NODE_ENV: 'test' },
    join(ROOT, 'apps/api'),
  );
  writeRedactedFixture(fixturePath, join(evidenceDir, 'fixture.json'));

  const apiPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  children.push(
    start(
      'pnpm',
      ['exec', 'tsx', 'src/index.ts'],
      {
        DATABASE_URL,
        NODE_ENV: 'development',
        PORT: String(apiPort),
        CORS_ORIGINS: webUrl,
        COOKIE_SECURE: 'false',
        LOG_LEVEL: 'error',
        MILLQ_ALLOW_FISCAL_TEST_ADAPTER: '1',
        MILLQ_LISTEN_HOST: '127.0.0.1',
      },
      join(ROOT, 'apps/api'),
    ),
  );
  await waitHttp(`${apiUrl}/health`);

  children.push(
    start(
      'pnpm',
      ['exec', 'vite', '--config', 'vite.e2e.config.ts'],
      {
        E2E_API_URL: apiUrl,
        E2E_WEB_PORT: String(webPort),
        NODE_ENV: 'development',
      },
      join(ROOT, 'apps/web'),
    ),
  );
  await waitHttp(webUrl);

  console.log('oneshot capture…');
  await run(
    'node',
    ['src/demo29-golden-capture.mjs'],
    {
      E2E_BASE_URL: webUrl,
      E2E_FIXTURE_PATH: fixturePath,
      DEMO29_EVIDENCE_DIR: evidenceDir,
    },
    join(ROOT, 'apps/e2e-cash12-close'),
  );
  console.log('ONESHOT_OK', evidenceDir);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await teardown();
}
