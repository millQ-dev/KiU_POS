/**
 * Migration runner TX integrity — disposable PostgreSQL only.
 * Skips (does not throw) when DATABASE_URL is unset or millq_dev.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import {
  MIGRATION_ADVISORY_LOCK_CLASS,
  MIGRATION_ADVISORY_LOCK_OBJECT,
  runMigrations,
} from './migrate.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN_DISPOSABLE =
  Boolean(DATABASE_URL) && !/\/millq_dev(\?|$)/.test(DATABASE_URL);
const describeRunner = RUN_DISPOSABLE ? describe : describe.skip;

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

  it('SQL error rolls back fully and leaves no schema_migrations row; retry succeeds', async () => {
    await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);
    await pool.query(`DELETE FROM schema_migrations WHERE filename LIKE '00%_fail%' OR filename LIKE '00%_ok%'`);

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
        // Ensure clean for this filename
        await pool.query(`DELETE FROM schema_migrations WHERE filename = '003_once.sql'`);
        await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        await pool.query(`UPDATE migrate_probe SET id = 3 WHERE id = 3`); // no-op marker
        await runMigrations(DATABASE_URL, { migrationsDir: dir });
        // If re-run executed INSERT without ON CONFLICT it would fail; with IF NOT EXISTS table ok.
        // Stronger: change file content would still be skipped because filename recorded.
        const count = await pool.query(`SELECT COUNT(*)::int AS c FROM migrate_probe WHERE id = 3`);
        expect(count.rows[0]?.c).toBe(1);
        const mig = await pool.query(
          `SELECT COUNT(*)::int AS c FROM schema_migrations WHERE filename = '003_once.sql'`,
        );
        expect(mig.rows[0]?.c).toBe(1);
      },
    );
  });

  it('parallel migrators serialize via advisory lock (no double apply)', async () => {
    await pool.query(`DELETE FROM schema_migrations WHERE filename = '004_parallel.sql'`);
    await pool.query(`DROP TABLE IF EXISTS migrate_probe CASCADE`);

    await withTempMigrations(
      {
        '004_parallel.sql': `
          CREATE TABLE migrate_probe (id INT PRIMARY KEY);
          INSERT INTO migrate_probe (id) VALUES (4);
          -- brief hold so the second runner contends on advisory lock
          SELECT pg_sleep(0.3);
        `,
      },
      async (dir) => {
        const results = await Promise.allSettled([
          runMigrations(DATABASE_URL, { migrationsDir: dir }),
          runMigrations(DATABASE_URL, { migrationsDir: dir }),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        expect(fulfilled.length).toBe(2);
        const rows = await pool.query(`SELECT id FROM migrate_probe`);
        expect(rows.rowCount).toBe(1);
        const mig = await pool.query(
          `SELECT COUNT(*)::int AS c FROM schema_migrations WHERE filename = '004_parallel.sql'`,
        );
        expect(mig.rows[0]?.c).toBe(1);
      },
    );
  });

  it('rejects CONCURRENTLY DDL inside transactional runner', async () => {
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
