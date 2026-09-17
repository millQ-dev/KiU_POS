import pg from 'pg';
import { runMigrations } from './migrate.js';
import { seedPreviewFixture } from './preview-seed.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_preview';

function assertPreviewResetAllowed(): void {
  if (process.env.PREVIEW_RESET_CONFIRM !== '1') {
    throw new Error('Refusing preview reset: set PREVIEW_RESET_CONFIRM=1');
  }
  if (process.env.APP_ENV && process.env.APP_ENV !== 'preview' && process.env.APP_ENV !== 'local') {
    throw new Error(`Refusing preview reset for APP_ENV=${process.env.APP_ENV}`);
  }
  if (process.env.PREVIEW_DB_ISOLATED !== '1') {
    throw new Error('Refusing preview reset: set PREVIEW_DB_ISOLATED=1 for an isolated database');
  }
}

async function reset(): Promise<void> {
  assertPreviewResetAllowed();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await pool.end();
  }
  await runMigrations(databaseUrl);
  const seeded = new pg.Pool({ connectionString: databaseUrl });
  try {
    await seedPreviewFixture(seeded);
  } finally {
    await seeded.end();
  }
}

reset().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
