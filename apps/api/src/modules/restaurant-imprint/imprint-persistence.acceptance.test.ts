/**
 * ADR-0054 I-02 persistence acceptance. Disposable millq_ci_pos_* PostgreSQL only.
 * Covers identity/dedupe, conflict quarantine, immutability, tenant scope,
 * atomic cursor commit, and deterministic snapshot storage.
 * AC-01..AC-16 stay with later slices. This file does not close them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { ImprintPersistence } from './imprint-persistence.js';
import { ImprintPersistenceError } from './errors.js';
import type { AssertionInput } from './imprint-rules.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeImprint = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

function assertion(overrides: Partial<AssertionInput> & Pick<AssertionInput, 'tenantId' | 'outletId'>): AssertionInput {
  return {
    origin: 'OBSERVED',
    factPath: 'organization.outlet.identity',
    sensitivityClass: 'PUBLIC_REFERENCE',
    sourceModule: 'organization',
    sourceEntityType: 'Outlet',
    sourceEntityId: 'outlet-row',
    sourceRevision: 'rev-1',
    canonicalValue: 'Cafe One',
    ...overrides,
  };
}

describeImprint('restaurant imprint persistence (disposable PG)', () => {
  let pool: pg.Pool;
  let store: ImprintPersistence;
  let tenantId: string;
  let outletId: string;
  let otherTenantId: string;
  let otherOutletId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    store = new ImprintPersistence(pool);
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    outletId = randomUUID();
    otherOutletId = randomUUID();
    const legalA = randomUUID();
    const legalB = randomUUID();
    const brandA = randomUUID();
    const brandB = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'Imprint A'), ($2, 'Imprint B')`, [
        tenantId,
        otherTenantId,
      ]);
      await client.query(
        `INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1, $2, 'LE A'), ($3, $4, 'LE B')`,
        [legalA, tenantId, legalB, otherTenantId],
      );
      await client.query(
        `INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1, $2, 'Brand A'), ($3, $4, 'Brand B')`,
        [brandA, tenantId, brandB, otherTenantId],
      );
      await client.query(
        `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
         VALUES ($1, $2, $3, $4, 'Outlet A'), ($5, $6, $7, $8, 'Outlet B')`,
        [outletId, tenantId, brandA, legalA, otherOutletId, otherTenantId, brandB, legalB],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stores one assertion when the same identity and value are retried', async () => {
    const input = assertion({ tenantId, outletId, sourceEntityId: `dedupe-${randomUUID()}` });
    const first = await store.appendAssertion(input);
    const second = await store.appendAssertion(input);
    expect(first.outcome).toBe('INSERTED');
    expect(second).toEqual({ outcome: 'DUPLICATE', claimId: first.claimId });
    const stored = await store.readClaim(tenantId, outletId, first.claimId);
    expect(stored?.canonicalValue).toBe('Cafe One');
    expect(await store.countClaims(tenantId, outletId)).toBeGreaterThan(0);
  });

  it('quarantines a different payload and leaves the first claim unchanged', async () => {
    const entityId = `conflict-${randomUUID()}`;
    const first = await store.appendAssertion(assertion({ tenantId, outletId, sourceEntityId: entityId }));
    const conflict = await store.appendAssertion(
      assertion({ tenantId, outletId, sourceEntityId: entityId, canonicalValue: 'Cafe Two' }),
    );
    expect(conflict.outcome).toBe('CONFLICT');
    if (conflict.outcome !== 'CONFLICT') return;
    expect(conflict.claimId).toBe(first.claimId);
    const stored = await store.readClaim(tenantId, outletId, first.claimId);
    expect(stored?.canonicalValue).toBe('Cafe One');
    expect(await store.countConflicts(tenantId, outletId)).toBeGreaterThan(0);
    const again = await store.appendAssertion(
      assertion({ tenantId, outletId, sourceEntityId: entityId, canonicalValue: 'Cafe Two' }),
    );
    expect(again).toMatchObject({ outcome: 'CONFLICT', conflictId: conflict.conflictId });
  });

  it('rejects update and delete of a claim', async () => {
    const inserted = await store.appendAssertion(
      assertion({ tenantId, outletId, sourceEntityId: `frozen-${randomUUID()}` }),
    );
    await expect(
      pool.query(`UPDATE imprint_claim SET canonical_value = 'rewritten' WHERE claim_id = $1`, [
        inserted.claimId,
      ]),
    ).rejects.toThrow(/IMPRINT_IMMUTABLE/);
    await expect(pool.query(`DELETE FROM imprint_claim WHERE claim_id = $1`, [inserted.claimId])).rejects.toThrow(
      /IMPRINT_IMMUTABLE/,
    );
  });

  it('supersedes and invalidates by new rows, and drops both from the current set', async () => {
    const entityId = `lineage-${randomUUID()}`;
    const original = await store.appendAssertion(
      assertion({ tenantId, outletId, sourceEntityId: entityId, sourceRevision: 'rev-1' }),
    );
    const next = await store.appendAssertion(
      assertion({
        tenantId,
        outletId,
        sourceEntityId: entityId,
        sourceRevision: 'rev-2',
        canonicalValue: 'Cafe Next',
        supersedesClaimId: original.claimId,
      }),
    );
    expect(next.outcome).toBe('INSERTED');
    const invalidated = await store.invalidateAssertion({
      tenantId,
      outletId,
      claimId: next.claimId,
      sourceModule: 'organization',
      sourceRevision: 'rev-3',
    });
    expect(invalidated.outcome).toBe('INSERTED');
    const participating = await store.participatingClaimIds(tenantId, outletId);
    expect(participating).not.toContain(original.claimId);
    expect(participating).not.toContain(next.claimId);
    const still = await store.readClaim(tenantId, outletId, original.claimId);
    expect(still?.canonicalValue).toBe('Cafe One');
  });

  it('refuses an outlet that belongs to another tenant', async () => {
    await expect(
      store.appendAssertion(assertion({ tenantId, outletId: otherOutletId, sourceEntityId: 'cross' })),
    ).rejects.toMatchObject({ code: 'IMPRINT_OUTLET_TENANT_MISMATCH' } satisfies Partial<ImprintPersistenceError>);
    expect(await store.countClaims(otherTenantId, otherOutletId)).toBe(0);
  });

  it('rolls back the claims and the cursor together when a later assertion fails', async () => {
    const cursorName = `batch-${randomUUID().slice(0, 8)}`;
    const entityId = `atomic-${randomUUID()}`;
    await expect(
      store.commitCheckpoint({
        tenantId,
        outletId,
        sourceModule: 'organization',
        cursorName,
        watermark: 'wm-1',
        assertions: [
          assertion({ tenantId, outletId, sourceEntityId: entityId }),
          assertion({
            tenantId,
            outletId,
            sourceEntityId: `${entityId}-next`,
            sourceRevision: 'rev-2',
            supersedesClaimId: randomUUID(),
          }),
        ],
      }),
    ).rejects.toThrow();
    expect(await store.readCursor(tenantId, outletId, 'organization', cursorName)).toBeNull();
    const leftover = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM imprint_claim WHERE source_entity_id = $1`,
      [entityId],
    );
    expect(leftover.rows[0]?.n).toBe(0);
  });

  it('publishes a deterministic revision and keeps it when a source later degrades', async () => {
    const entityId = `snap-${randomUUID()}`;
    const inserted = await store.appendAssertion(
      assertion({
        tenantId,
        outletId,
        sourceEntityId: entityId,
        factPath: 'organization.outlet.brand_ref',
        canonicalValue: 'brand-a',
        businessDate: null,
      }),
    );
    const fields = [
      { factPath: 'organization.outlet.brand_ref', fieldState: 'KNOWN' as const, claimId: inserted.claimId },
      { factPath: 'procurement.last_posted_receipt_ref', fieldState: 'UNKNOWN' as const },
    ];
    const first = await store.publishRevision({
      tenantId,
      outletId,
      resolverVersion: 'imprint-snapshot-1',
      fields,
    });
    const second = await store.publishRevision({
      tenantId,
      outletId,
      resolverVersion: 'imprint-snapshot-1',
      fields: [...fields].reverse(),
    });
    expect(second.rebuildInputHash).toBe(first.rebuildInputHash);
    expect(second.revisionId).not.toBe(first.revisionId);
    const degraded = await store.recordSourceFailure({
      tenantId,
      outletId,
      sourceModule: 'organization',
      errorCode: 'SOURCE_READ_FAILED',
      freshness: 'DEGRADED',
    });
    expect(degraded?.revisionId).toBe(second.revisionId);
    expect(degraded?.freshness).toBe('DEGRADED');
    const storedFields = await pool.query<{ fact_path: string; field_state: string; canonical_value: string | null }>(
      `SELECT fact_path, field_state, canonical_value
       FROM imprint_snapshot_field WHERE revision_id = $1 ORDER BY fact_path`,
      [second.revisionId],
    );
    expect(storedFields.rows).toEqual([
      {
        fact_path: 'organization.outlet.brand_ref',
        field_state: 'KNOWN',
        canonical_value: 'brand-a',
      },
      {
        fact_path: 'procurement.last_posted_receipt_ref',
        field_state: 'UNKNOWN',
        canonical_value: null,
      },
    ]);
  });

  it('lets one of two concurrent payloads win and quarantines the other', async () => {
    const entityId = `race-${randomUUID()}`;
    const [left, right] = await Promise.all([
      store.appendAssertion(assertion({ tenantId, outletId, sourceEntityId: entityId, canonicalValue: 'Left' })),
      store.appendAssertion(assertion({ tenantId, outletId, sourceEntityId: entityId, canonicalValue: 'Right' })),
    ]);
    const outcomes = [left.outcome, right.outcome].sort();
    expect(outcomes).toEqual(['CONFLICT', 'INSERTED']);
    const winnerId = left.outcome === 'INSERTED' ? left.claimId : right.claimId;
    const winner = await store.readClaim(tenantId, outletId, winnerId);
    expect(winner?.canonicalValue === 'Left' || winner?.canonicalValue === 'Right').toBe(true);
    const rows = await pool.query(
      `SELECT COUNT(*)::int AS n FROM imprint_claim
       WHERE tenant_id = $1 AND outlet_id = $2 AND source_entity_id = $3 AND claim_effect = 'ASSERTION'`,
      [tenantId, outletId, entityId],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });
});
