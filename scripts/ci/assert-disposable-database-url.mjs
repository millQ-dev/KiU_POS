#!/usr/bin/env node
/**
 * Positive allowlist for CI disposable DATABASE_URL values.
 * Fail-closed: missing/empty/wrong URL → exit 1.
 *
 * Usage: node scripts/ci/assert-disposable-database-url.mjs "$DATABASE_URL"
 */
const DISPOSABLE_RE = /\/millq_(?:migrate_runner|ci_pos|ci_gr)(?:_[A-Za-z0-9]+)+(\?|$)/;

export function assertDisposableDatabaseUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_URL is missing or not a string');
  }
  if (/\/millq_dev(\?|$)/.test(url)) {
    throw new Error('DATABASE_URL must not point at millq_dev');
  }
  if (!DISPOSABLE_RE.test(url)) {
    throw new Error(
      'DATABASE_URL must match /millq_migrate_runner(_…)? or /millq_ci_pos(_…)? or /millq_ci_gr(_…)? disposable allowlist',
    );
  }
  return true;
}

function main() {
  const url = process.argv[2] ?? process.env.DATABASE_URL ?? '';
  try {
    assertDisposableDatabaseUrl(url);
    console.log('assert-disposable-database-url: OK');
  } catch (err) {
    console.error(`assert-disposable-database-url: FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('assert-disposable-database-url.mjs');
if (isMain) main();
