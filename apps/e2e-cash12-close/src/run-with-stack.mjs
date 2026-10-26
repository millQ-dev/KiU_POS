#!/usr/bin/env node
/**
 * Disposable PG → prepare fixture → API + Vite → Playwright → teardown.
 * Requires DATABASE_URL matching millq_ci_pos_*.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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

const work = mkdtempSync(join(tmpdir(), 'millq-cash12-e2e-'));
const fixturePath = join(work, 'fixture.json');
const children = [];

try {
  console.log('prepare fixture…');
  await run(
    'pnpm',
    ['exec', 'tsx', 'src/test/cash12-close-e2e-prepare.ts'],
    { DATABASE_URL, E2E_FIXTURE_PATH: fixturePath, NODE_ENV: 'test' },
    join(ROOT, 'apps/api'),
  );

  const apiPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  console.log(`start API ${apiUrl}…`);
  // Start API via node+tsx in apps/api so PORT/DATABASE_URL are not swallowed by pnpm filter.
  // C0-FISC2: explicit test-adapter opt-in on disposable millq_ci_pos_* only (#111).
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
      },
      join(ROOT, 'apps/api'),
    ),
  );
  await waitHttp(`${apiUrl}/health`);

  // Sanity: PIN must work against this disposable DB before browsers start.
  const fixture = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(fixturePath, 'utf8')));
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

  console.log('run playwright…');
  await run(
    'pnpm',
    ['exec', 'playwright', 'test'],
    {
      DATABASE_URL,
      E2E_BASE_URL: webUrl,
      E2E_API_URL: apiUrl,
      E2E_FIXTURE_PATH: fixturePath,
      CI: process.env.CI ?? '',
    },
    join(ROOT, 'apps/e2e-cash12-close'),
  );
  console.log('cash12-close browser e2e PASS');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  if (existsSync(work)) {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
