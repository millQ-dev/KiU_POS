/**
 * Migration runner TX integrity — disposable PostgreSQL only.
 * Skips (does not throw) when DATABASE_URL is unset or millq_dev.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  MIGRATION_ADVISORY_LOCK_CLASS,
  MIGRATION_ADVISORY_LOCK_OBJECT,
  assertNoConcurrentIndex,
  runMigrations,
  stripSqlComments,
} from './migrate.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
/**
 * Destructive cleanup (DROP schema_migrations / migrate_probe) is allowed only on
 * explicitly disposable DBs whose name starts with millq_migrate_runner.
 * Never millq_dev, staging, production, or a shared acceptance URL.
 */
const RUN_DISPOSABLE =
  Boolean(DATABASE_URL) &&
  !/\/millq_dev(\?|$)/.test(DATABASE_URL) &&
  /\/millq_migrate_runner(?:_[A-Za-z0-9]+)?(\?|$)/.test(DATABASE_URL);
const describeRunner = RUN_DISPOSABLE ? describe : describe.skip;

const repoMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function withTempMigrations(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'millq-migrate-'));
  try {
    for (const [name, sql] of Object.entries(files)) {
      await writeFile(join(dir, name), sql, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('migrate runner CONCURRENTLY guard (no DB)', () => {
  it('allows CONCURRENTLY only inside SQL comments', () => {
    const sql = `
      -- never use CREATE INDEX CONCURRENTLY in this transactional runner
      /* DROP INDEX CONCURRENTLY IF EXISTS foo; */
      CREATE TABLE migrate_probe (id INT PRIMARY KEY);
    `;
    expect(() => assertNoConcurrentIndex(sql, 'comment_only.sql')).not.toThrow();
    expect(stripSqlComments(sql)).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it('rejects CREATE INDEX CONCURRENTLY DDL', () => {
    expect(() =>
      assertNoConcurrentIndex(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS x ON t (id);`,
        'bad.sql',
      ),
    ).toThrow(/CONCURRENTLY/);
  });

  it('existing repo migrations do not trip the CONCURRENTLY guard', async () => {
    const files = (await readdir(repoMigrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sql = await readFile(join(repoMigrationsDir, file), 'utf8');
      expect(() => assertNoConcurrentIndex(sql, file)).not.toThrow();
    }
  });
});

describeRunner('migrate runner TX integrity (disposable PG)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    // Clean slate for runner tests (empty disposable DB — drop only our artifacts).
    await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS schema_migrations CASCADE`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('multi-statement migration commits on one session (objects + schema_migrations visible together)', async () => {
    await withTempMigrations(
      {
        '001_probe.sql': `
          CREATE TABLE migrate_probe (
            id INT PRIMARY KEY,
            backend_pid INT NOT NULL
          );
          INSERT INTO migrate_probe (id, backend_pid)
          VALUES (1, pg_backend_pid());
        `,
      },
      async (dir) => {
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        const row = await pool.query<{ backend_pid: number }>(
          `SELECT backend_pid FROM migrate_probe WHERE id = 1`,
        );
        expect(row.rows[0]?.backend_pid).toBeTypeOf('number');
        const applied = await pool.query(
          `SELECT filename FROM schema_migrations WHERE filename = '001_probe.sql'`,
        );
        expect(applied.rowCount).toBe(1);
      },
    );
  });

  it('SQL error rolls back fully, leaves no schema_migrations row, releases lock; retry succeeds', async () => {
    await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);
    await pool.query(
      `DELETE FROM schema_migrations WHERE filename LIKE '00%_fail%' OR filename LIKE '00%_ok%'`,
    );

    await withTempMigrations(
      {
        '002_fail.sql': `
          CREATE TABLE migrate_probe (id INT PRIMARY KEY);
          INSERT INTO migrate_probe (id) VALUES (1);
          SELECT * FROM definitely_missing_relation_xyz;
        `,
      },
      async (dir) => {
        await expect(runMigrations(DATABASE_URL, { migrationsDir: dir })).rejects.toThrow();
        const tables = await pool.query(
          `SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'migrate_probe'`,
        );
        expect(tables.rowCount).toBe(0);
        const mig = await pool.query(
          `SELECT 1 FROM schema_migrations WHERE filename = '002_fail.sql'`,
        );
        expect(mig.rowCount).toBe(0);

        // Session-level advisory lock must be released after SQL error.
        const lockClient = await pool.connect();
        try {
          const got = await lockClient.query<{ ok: boolean }>(
            `SELECT pg_try_advisory_lock($1, $2) AS ok`,
            [MIGRATION_ADVISORY_LOCK_CLASS, MIGRATION_ADVISORY_LOCK_OBJECT],
          );
          expect(got.rows[0]?.ok).toBe(true);
          await lockClient.query(`SELECT pg_advisory_unlock($1, $2)`, [
            MIGRATION_ADVISORY_LOCK_CLASS,
            MIGRATION_ADVISORY_LOCK_OBJECT,
          ]);
        } finally {
          lockClient.release();
        }
      },
    );

    await withTempMigrations(
      {
        '002_fail.sql': `
          CREATE TABLE migrate_probe (id INT PRIMARY KEY);
          INSERT INTO migrate_probe (id) VALUES (1);
        `,
      },
      async (dir) => {
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        const tables = await pool.query(`SELECT id FROM migrate_probe`);
        expect(tables.rows).toEqual([{ id: 1 }]);
        const mig = await pool.query(
          `SELECT 1 FROM schema_migrations WHERE filename = '002_fail.sql'`,
        );
        expect(mig.rowCount).toBe(1);
      },
    );
  });

  it('already-applied migration is not re-executed', async () => {
    await withTempMigrations(
      {
        '003_once.sql': `
          CREATE TABLE IF NOT EXISTS migrate_probe (id INT PRIMARY KEY);
          INSERT INTO migrate_probe (id) VALUES (3)
          ON CONFLICT (id) DO NOTHING;
        `,
      },
      async (dir) => {
        await pool.query(`DELETE FROM schema_migrations WHERE filename = '003_once.sql'`);
        await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        await pool.query(`UPDATE migrate_probe SET id = 3 WHERE id = 3`);
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        const count = await pool.query(`SELECT COUNT(*)::int AS c FROM migrate_probe WHERE id = 3`);
        expect(count.rows[0]?.c).toBe(1);
        const mig = await pool.query(
          `SELECT COUNT(*)::int AS c FROM schema_migrations WHERE filename = '003_once.sql'`,
        );
        expect(mig.rows[0]?.c).toBe(1);
      },
    );
  });

  it('parallel migrators wait on advisory lock; apply exactly once after release', async () => {
    await pool.query(`DELETE FROM schema_migrations WHERE filename = '004_parallel.sql'`);
    await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);

    await withTempMigrations(
      {
        '004_parallel.sql': `
          CREATE TABLE migrate_probe (id INT PRIMARY KEY);
          INSERT INTO migrate_probe (id) VALUES (4);
        `,
      },
      async (dir) => {
        const holder = await pool.connect();
        try {
          await holder.query(`SELECT pg_advisory_lock($1, $2)`, [
            MIGRATION_ADVISORY_LOCK_CLASS,
            MIGRATION_ADVISORY_LOCK_OBJECT,
          ]);

          const first = runMigrations(DATABASE_URL, { migrationsDir: dir });
          const second = runMigrations(DATABASE_URL, { migrationsDir: dir });

          // While the lock is held, neither migrator may apply SQL.
          await sleep(400);
          const midTables = await pool.query(
            `SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'migrate_probe'`,
          );
          expect(midTables.rowCount).toBe(0);
          const midMig = await pool.query(
            `SELECT 1 FROM schema_migrations WHERE filename = '004_parallel.sql'`,
          );
          expect(midMig.rowCount).toBe(0);

          await holder.query(`SELECT pg_advisory_unlock($1, $2)`, [
            MIGRATION_ADVISORY_LOCK_CLASS,
            MIGRATION_ADVISORY_LOCK_OBJECT,
          ]);

          const results = await Promise.allSettled([first, second]);
          const fulfilled = results.filter((r) => r.status === 'fulfilled');
          expect(fulfilled.length).toBe(2);

          const rows = await pool.query(`SELECT id FROM migrate_probe`);
          expect(rows.rowCount).toBe(1);
          expect(rows.rows[0]?.id).toBe(4);
          const mig = await pool.query(
            `SELECT COUNT(*)::int AS c FROM schema_migrations WHERE filename = '004_parallel.sql'`,
          );
          expect(mig.rows[0]?.c).toBe(1);
        } finally {
          // Ensure holder never leaves the lock held if an assertion failed mid-test.
          try {
            await holder.query(`SELECT pg_advisory_unlock($1, $2)`, [
              MIGRATION_ADVISORY_LOCK_CLASS,
              MIGRATION_ADVISORY_LOCK_OBJECT,
            ]);
          } catch {
            /* already unlocked or connection broken */
          }
          holder.release();
        }
      },
    );
  });

  it('rejects CONCURRENTLY DDL inside transactional runner; comments alone are fine', async () => {
    await withTempMigrations(
      {
        '005_comment.sql': `
          -- CREATE INDEX CONCURRENTLY is intentionally unsupported here
          CREATE TABLE IF NOT EXISTS migrate_probe (id INT PRIMARY KEY);
        `,
      },
      async (dir) => {
        await pool.query(`DELETE FROM schema_migrations WHERE filename = '005_comment.sql'`);
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        const mig = await pool.query(
          `SELECT 1 FROM schema_migrations WHERE filename = '005_comment.sql'`,
        );
        expect(mig.rowCount).toBe(1);
      },
    );

    await withTempMigrations(
      {
        '005_concurrent.sql': `
          CREATE TABLE IF NOT EXISTS migrate_probe (id INT PRIMARY KEY);
          CREATE INDEX CONCURRENTLY IF NOT EXISTS migrate_probe_idx ON migrate_probe (id);
        `,
      },
      async (dir) => {
        await expect(runMigrations(DATABASE_URL, { migrationsDir: dir })).rejects.toThrow(
          /CONCURRENTLY/,
        );
        const mig = await pool.query(
          `SELECT 1 FROM schema_migrations WHERE filename = '005_concurrent.sql'`,
        );
        expect(mig.rowCount).toBe(0);
      },
    );
  });

  it('advisory lock key constants are exported for ops visibility', () => {
    expect(MIGRATION_ADVISORY_LOCK_CLASS).toBe(872_314_001);
    expect(MIGRATION_ADVISORY_LOCK_OBJECT).toBe(1);
  });
});
