#!/usr/bin/env node
/**
 * DEMO-29 human browser serve — same disposable fixture + API + Vite as E2E,
 * but keeps servers running until SIGINT/SIGTERM.
 *
 * Requires DATABASE_URL matching millq_ci_pos_* (not millq_dev / production).
 * Binds API to 127.0.0.1 only with MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1.
 * Prints fixture path + URLs; credentials stay in fixture file (do not paste into chat).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');
const DATABASE_URL = process.env.DATABASE_URL ?? '';

if (!/\/millq_ci_pos(?:_[A-Za-z0-9]+)+(\?|$)/.test(DATABASE_URL) || /millq_dev/.test(DATABASE_URL)) {
  console.error('DATABASE_URL must be disposable millq_ci_pos_* (not millq_dev)');
  process.exit(1);
}

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

const evidenceDir =
  process.env.DEMO29_EVIDENCE_DIR ??
  join(ROOT, 'docs/processes/demo29/evidence', `run-${Date.now()}`);
mkdirSync(evidenceDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'millq-demo29-serve-'));
const fixturePath = join(work, 'fixture.json');
const children = [];

async function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  console.log('DEMO-29 serve — TEST / NOT LEGAL OR REAL PAYMENT');
  console.log(`evidence dir: ${evidenceDir}`);
  console.log('prepare disposable fixture…');
  await run(
    'pnpm',
    ['exec', 'tsx', 'src/test/cash12-close-e2e-prepare.ts'],
    { DATABASE_URL, E2E_FIXTURE_PATH: fixturePath, NODE_ENV: 'test' },
    join(ROOT, 'apps/api'),
  );
  const durableFixture = join(evidenceDir, 'fixture.json');
  copyFileSync(fixturePath, durableFixture);
  console.log(`fixture copied to ${durableFixture} (redact before sharing)`);

  const apiPort = Number(process.env.DEMO29_API_PORT) || (await freePort());
  const webPort = Number(process.env.DEMO29_WEB_PORT) || (await freePort());
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  console.log(`start API ${apiUrl} (loopback only)…`);
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
        LOG_LEVEL: 'info',
        MILLQ_ALLOW_FISCAL_TEST_ADAPTER: '1',
        MILLQ_LISTEN_HOST: '127.0.0.1',
      },
      join(ROOT, 'apps/api'),
    ),
  );
  await waitHttp(`${apiUrl}/health`);

  const fixture = JSON.parse(
    await import('node:fs').then((fs) => fs.readFileSync(fixturePath, 'utf8')),
  );
  const authProbe = await fetch(`${apiUrl}/api/v1/identity/pin/authenticate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: webUrl },
    body: JSON.stringify({
      companyCode: fixture.companyCode,
      pin: fixture.cashierPin,
      channel: 'TERMINAL',
    }),
  });
  if (!authProbe.ok) {
    throw new Error(`auth probe failed: ${authProbe.status} ${await authProbe.text()}`);
  }
  console.log('auth probe OK');

  console.log(`start web ${webUrl}…`);
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

  console.log('');
  console.log('=== DEMO-29 READY (loopback) ===');
  console.log(`WEB:  ${webUrl}`);
  console.log(`API:  ${apiUrl}`);
  console.log(`DB:   disposable millq_ci_pos_* (see DATABASE_URL)`);
  console.log(`Company code: ${fixture.companyCode}`);
  console.log('PIN: see fixture.json (do not commit / do not paste into chat)');
  console.log('Banner: treat UI as TEST / NOT LEGAL OR REAL PAYMENT');
  console.log('Stop: Ctrl+C (tears down API+Vite only; drop DB manually when done)');
  console.log('===============================');

  await new Promise(() => {
    /* run until signal */
  });
} catch (err) {
  console.error(err);
  await shutdown(1);
}
