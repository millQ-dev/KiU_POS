import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    // Keep DDL single-flight when a deploy controller retries the migration job.
    await client.query('SELECT pg_advisory_lock(hashtext($1::text))', ['millq:schema-migrations']);
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
    if (client) {
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1::text))', ['millq:schema-migrations'])
        .catch(() => undefined);
      client.release();
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
