import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const defaultMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Stable advisory-lock key pair for MillQ schema migrations (class + object). */
export const MIGRATION_ADVISORY_LOCK_CLASS = 872_314_001;
export const MIGRATION_ADVISORY_LOCK_OBJECT = 1;

export type RunMigrationsOptions = {
  /** Override migrations directory (tests). Default: apps/api/migrations */
  migrationsDir?: string;
};

/**
 * Strip SQL line (`--`) and block comments outside string literals
 * so CONCURRENTLY mentions in comments do not false-positive the DDL guard.
 */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i < sql.length) i += 2;
      continue;
    }

    if (ch === "'") {
      out += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        out += sql[i]!;
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Reject DDL that PostgreSQL forbids inside a transaction.
 * Comments mentioning CONCURRENTLY are ignored (see stripSqlComments).
 */
export function assertNoConcurrentIndex(sql: string, filename: string): void {
  const code = stripSqlComments(sql);
  const concurrentDdl =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(code) ||
    /\bDROP\s+INDEX\s+CONCURRENTLY\b/i.test(code) ||
    /\bREINDEX\s+CONCURRENTLY\b/i.test(code) ||
    /\bREINDEX\s+(?:TABLE|INDEX|SCHEMA|DATABASE|SYSTEM)\s+\S+\s+CONCURRENTLY\b/i.test(code);

  if (concurrentDdl) {
    throw new Error(
      `Migration ${filename}: CREATE/DROP INDEX CONCURRENTLY (or REINDEX CONCURRENTLY) is not supported by the transactional migrate runner; use a separate online-migration mechanism`,
    );
  }
}

/**
 * Apply pending *.sql migrations in sorted filename order.
 * Each migration runs on a single PoolClient: BEGIN → SQL → schema_migrations insert → COMMIT.
 * Concurrent migrators serialize via pg_advisory_lock acquired before any schema work.
 */
export async function runMigrations(
  connectionString: string,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir;
  const pool = new pg.Pool({ connectionString });
  let client: pg.PoolClient | undefined;
  let lockHeld = false;
  let destroyClient = false;

  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1, $2)', [
      MIGRATION_ADVISORY_LOCK_CLASS,
      MIGRATION_ADVISORY_LOCK_OBJECT,
    ]);
    lockHeld = true;

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const files = (await readdir(migrationsDir))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [
          file,
        ]);
        if (applied.rowCount && applied.rowCount > 0) {
          continue;
        }
        const sql = await readFile(join(migrationsDir, file), 'utf8');
        assertNoConcurrentIndex(sql, file);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Applied migration: ${file}`);
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Session may be unusable; do not return it to the pool with a held lock.
            destroyClient = true;
          }
          throw err;
        }
      }
    } finally {
      if (lockHeld && client) {
        try {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [
            MIGRATION_ADVISORY_LOCK_CLASS,
            MIGRATION_ADVISORY_LOCK_OBJECT,
          ]);
          lockHeld = false;
        } catch {
          // Unlock failed — destroy the connection so a locked session never re-enters the pool.
          destroyClient = true;
          lockHeld = false;
        }
      }
    }
  } finally {
    if (client) {
      client.release(destroyClient || lockHeld);
    }
    await pool.end();
  }
}

const isMain =
  process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');

if (isMain) {
  const url = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
  runMigrations(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
