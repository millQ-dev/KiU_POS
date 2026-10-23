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

function assertNoConcurrentIndex(sql: string, filename: string): void {
  // Transactional runner cannot host CREATE INDEX CONCURRENTLY (PG forbids it in a TX).
  if (/\bconcurrently\b/i.test(sql)) {
    throw new Error(
      `Migration ${filename}: CREATE INDEX CONCURRENTLY (or CONCURRENTLY DDL) is not supported by the transactional migrate runner; use a separate online-migration mechanism`,
    );
  }
}

/**
 * Apply pending *.sql migrations in sorted filename order.
 * Each migration runs on a single PoolClient: BEGIN → SQL → schema_migrations insert → COMMIT.
 * Concurrent migrators serialize via pg_advisory_lock.
 */
export async function runMigrations(
  connectionString: string,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir;
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [
      MIGRATION_ADVISORY_LOCK_CLASS,
      MIGRATION_ADVISORY_LOCK_OBJECT,
    ]);
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
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [
        MIGRATION_ADVISORY_LOCK_CLASS,
        MIGRATION_ADVISORY_LOCK_OBJECT,
      ]);
    }
  } finally {
    client.release();
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
