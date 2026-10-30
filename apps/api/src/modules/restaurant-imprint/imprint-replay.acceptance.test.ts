/**
 * ADR-0054 I-08 disposable snapshot replay. millq_ci_pos_* only.
 * Rebuild from claims (+ optional source re-sync). No HTTP, no prod migrate, no I-09.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { FactPath } from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { ImprintClaimService, ImprintInternalAuthority, ImprintScope } from './imprint-claim-service.js';
import { ImprintGoodsReceiptAdapter } from './imprint-goods-receipt-adapter.js';
import { ImprintOrganizationAdapter } from './imprint-organization-adapter.js';
import { ImprintPersistence } from './imprint-persistence.js';
import { ImprintReplayService } from './imprint-replay-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeReplay = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;
const HERE = dirname(fileURLToPath(import.meta.url));

describeReplay('restaurant imprint disposable replay (I-08)', () => {
  let pool: pg.Pool;
  let replay: ImprintReplayService;
  let org: ImprintOrganizationAdapter;
  let receipts: ImprintGoodsReceiptAdapter;
  let claims: ImprintClaimService;
  let store: ImprintPersistence;
  let tenantId: string;
  let otherTenantId: string;
  let brandId: string;
  let legalId: string;
  let otherBrandId: string;
  let otherLegalId: string;
  let otherOutletId: string;
  let supplierId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    replay = new ImprintReplayService(pool);
    org = new ImprintOrganizationAdapter(pool);
    receipts = new ImprintGoodsReceiptAdapter(pool);
    claims = new ImprintClaimService(pool);
    store = new ImprintPersistence(pool);
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    brandId = randomUUID();
    legalId = randomUUID();
    otherBrandId = randomUUID();
    otherLegalId = randomUUID();
    otherOutletId = randomUUID();
    supplierId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'A'), ($2, 'B')`, [
        tenantId,
        otherTenantId,
      ]);
      await client.query(
        `INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1,$2,'LE A'), ($3,$4,'LE B')`,
        [legalId, tenantId, otherLegalId, otherTenantId],
      );
      await client.query(
        `INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Brand A'), ($3,$4,'Brand B')`,
        [brandId, tenantId, otherBrandId, otherTenantId],
      );
      await client.query(
        `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
         VALUES ($1,$2,$3,$4,'Foreign')`,
        [otherOutletId, otherTenantId, otherBrandId, otherLegalId],
      );
      await client.query(`INSERT INTO supplier (supplier_id, tenant_id, name) VALUES ($1,$2,'Sup')`, [
        supplierId,
        tenantId,
      ]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createOutlet(name: string): Promise<string> {
    const outletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,$5)`,
      [outletId, tenantId, brandId, legalId, name],
    );
    return outletId;
  }

  async function createWarehouse(outletId: string, name: string): Promise<string> {
    const warehouseId = randomUUID();
    await pool.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name)
       VALUES ($1,$2,$3,$4,$5)`,
      [warehouseId, tenantId, legalId, outletId, name],
    );
    return warehouseId;
  }

  async function insertPostedReceipt(warehouseId: string, businessDate: string, order: number) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO goods_receipt (
         goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
         supplier_document_number, currency_code, minor_unit_exponent,
         business_date, business_order, status, posted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'RUB',2,$7,$8,'POSTED',$9)`,
      [
        id,
        tenantId,
        legalId,
        warehouseId,
        supplierId,
        `DOC-${id.slice(0, 8)}`,
        businessDate,
        order,
        `${businessDate}T08:00:00.000Z`,
      ],
    );
    return id;
  }

  it('replays twice to the same rebuild_input_hash under the same resolver version', async () => {
    const outletId = await createOutlet('Replay Cafe');
    const warehouseId = await createWarehouse(outletId, 'WH');
    const receiptId = await insertPostedReceipt(warehouseId, '2026-10-20', 1);
    await org.syncOutlet(tenantId, outletId);
    await receipts.syncOutlet(tenantId, outletId);

    const first = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: false });
    const second = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: false });
    expect(first.resolverVersion).toBe('imprint-snapshot-1');
    expect(second.head.rebuildInputHash).toBe(first.head.rebuildInputHash);
    expect(second.head.revisionId).not.toBe(first.head.revisionId);
    expect(second.head.freshness).toBe('FRESH');

    const identity = first.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(identity?.fieldState).toBe('KNOWN');
    const receipt = first.fields.find((f) => f.factPath === FactPath.LastPostedReceiptRef);
    expect(receipt?.canonicalValue).toContain(receiptId);
    expect(receipt?.canonicalValue).toContain('POSTED');
    const terminals = first.fields.find((f) => f.factPath === FactPath.ActiveTerminalRefs);
    expect(terminals?.fieldState).toBe('UNKNOWN');
    expect(terminals?.canonicalValue).toBeNull();
  });

  it('excludes superseded and invalidated claims from the published snapshot', async () => {
    const outletId = await createOutlet('Lifecycle');
    await org.syncOutlet(tenantId, outletId);
    await pool.query(`UPDATE outlet SET name = 'After' WHERE outlet_id = $1`, [outletId]);
    await org.syncOutlet(tenantId, outletId);
    const published = await replay.rebuildOutlet(tenantId, outletId);
    const identity = published.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(identity?.canonicalValue).toContain('After');
    expect(identity?.canonicalValue).not.toContain('Lifecycle');

    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forSnapshotRebuild(),
      tenantId,
      outletId,
    );
    await claims.invalidateAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      invalidatesClaimId: identity!.claimId!,
      origin: 'OBSERVED',
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'replay-off',
      },
    });
    const afterInvalidate = await replay.rebuildOutlet(tenantId, outletId);
    const cleared = afterInvalidate.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(cleared?.fieldState).toBe('UNKNOWN');
    expect(cleared?.canonicalValue).toBeNull();
  });

  it('re-syncs GoodsReceipt reverse so REVERSED is not left as POSTED', async () => {
    const outletId = await createOutlet('Reverse Replay');
    const warehouseId = await createWarehouse(outletId, 'WH');
    const receiptId = await insertPostedReceipt(warehouseId, '2026-10-18', 2);
    await org.syncOutlet(tenantId, outletId);
    await receipts.syncOutlet(tenantId, outletId);
    await replay.rebuildOutlet(tenantId, outletId);

    await pool.query(
      `UPDATE goods_receipt SET status = 'REVERSED', reversed_at = NOW()
       WHERE goods_receipt_id = $1`,
      [receiptId],
    );
    await pool.query(
      `INSERT INTO goods_receipt (
         goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
         supplier_document_number, currency_code, minor_unit_exponent,
         business_date, business_order, status, posted_at, reverses_goods_receipt_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'RUB',2,'2026-10-18',2,'POSTED','2026-10-18T09:00:00.000Z',$7)`,
      [randomUUID(), tenantId, legalId, warehouseId, supplierId, 'REV-doc', receiptId],
    );

    const rebuilt = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: true });
    const field = rebuilt.fields.find((f) => f.factPath === FactPath.LastPostedReceiptRef);
    expect(field?.canonicalValue).toContain(receiptId);
    expect(field?.canonicalValue).toContain('REVERSED');
    expect(field?.canonicalValue).not.toContain('"POSTED"');
  });

  it('keeps last-good snapshot and marks STALE when source resync fails', async () => {
    const outletId = await createOutlet('Stale Replay');
    await org.syncOutlet(tenantId, outletId);
    const good = await replay.rebuildOutlet(tenantId, outletId);
    expect(good.head.freshness).toBe('FRESH');

    const originalQuery = pool.query.bind(pool);
    pool.query = (async (sql: unknown, params?: unknown) => {
      if (typeof sql === 'string' && sql.includes('FROM outlet') && sql.includes('brand_id')) {
        throw new Error('simulated organization source failure');
      }
      return originalQuery(sql as never, params as never);
    }) as typeof pool.query;
    try {
      const failed = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: true });
      expect(failed.sourceFailureRetained).toBe(true);
      expect(failed.head.revisionId).toBe(good.head.revisionId);
      expect(failed.head.freshness).toBe('STALE');
      const head = await pool.query<{ freshness: string; revision_id: string }>(
        `SELECT freshness, revision_id FROM imprint_snapshot_head
         WHERE tenant_id = $1 AND outlet_id = $2`,
        [tenantId, outletId],
      );
      expect(head.rows[0]?.revision_id).toBe(good.head.revisionId);
      expect(head.rows[0]?.freshness).toBe('STALE');
      const revisions = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM imprint_projection_revision
         WHERE tenant_id = $1 AND outlet_id = $2`,
        [tenantId, outletId],
      );
      expect(Number(revisions.rows[0]?.c)).toBe(1);
    } finally {
      pool.query = originalQuery;
    }
  });

  it('retains last-good on soft procurement degradation without publishing a new head', async () => {
    const outletId = await createOutlet('Soft Procure');
    const warehouseId = await createWarehouse(outletId, 'WH');
    await insertPostedReceipt(warehouseId, '2026-10-11', 1);
    await org.syncOutlet(tenantId, outletId);
    await receipts.syncOutlet(tenantId, outletId);
    const good = await replay.rebuildOutlet(tenantId, outletId);

    const originalQuery = pool.query.bind(pool);
    pool.query = (async (sql: unknown, params?: unknown) => {
      if (typeof sql === 'string' && sql.includes('FROM goods_receipt gr')) {
        throw new Error('simulated procurement soft failure');
      }
      return originalQuery(sql as never, params as never);
    }) as typeof pool.query;
    try {
      const failed = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: true });
      expect(failed.sourceFailureRetained).toBe(true);
      expect(failed.head.revisionId).toBe(good.head.revisionId);
      expect(failed.head.freshness).toBe('STALE');
      const revisions = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM imprint_projection_revision
         WHERE tenant_id = $1 AND outlet_id = $2`,
        [tenantId, outletId],
      );
      expect(Number(revisions.rows[0]?.c)).toBe(1);
      const err = await pool.query<{ source_module: string; error_code: string }>(
        `SELECT source_module, error_code FROM imprint_projection_error
         WHERE tenant_id = $1 AND outlet_id = $2
         ORDER BY recorded_at DESC LIMIT 1`,
        [tenantId, outletId],
      );
      expect(err.rows[0]?.source_module).toBe('procurement');
      expect(err.rows[0]?.error_code).toBe('IMPRINT_SOURCE_READ_FAILED');
    } finally {
      pool.query = originalQuery;
    }
  });

  it('isolates tenants and outlets during rebuild', async () => {
    const outletA = await createOutlet('Tenant A');
    await org.syncOutlet(tenantId, outletA);
    await replay.rebuildOutlet(tenantId, outletA);

    await expect(replay.rebuildOutlet(otherTenantId, outletA)).rejects.toMatchObject({
      code: 'IMPRINT_SCOPE_DENIED',
    });
    await expect(replay.rebuildOutlet(tenantId, otherOutletId)).rejects.toMatchObject({
      code: 'IMPRINT_SCOPE_DENIED',
    });
    expect(await store.countClaims(otherTenantId, otherOutletId)).toBe(0);
  });

  it('serializes concurrent rebuilds to one consistent head', async () => {
    const outletId = await createOutlet('Concurrent');
    await org.syncOutlet(tenantId, outletId);
    const results = await Promise.all([
      replay.rebuildOutlet(tenantId, outletId),
      replay.rebuildOutlet(tenantId, outletId),
      replay.rebuildOutlet(tenantId, outletId),
    ]);
    const hashes = new Set(results.map((r) => r.head.rebuildInputHash));
    expect(hashes.size).toBe(1);
    const head = await pool.query<{ revision_id: string; n: string }>(
      `SELECT h.revision_id, COUNT(*)::text AS n
       FROM imprint_snapshot_head h
       JOIN imprint_projection_revision r ON r.revision_id = h.revision_id
       WHERE h.tenant_id = $1 AND h.outlet_id = $2
       GROUP BY h.revision_id`,
      [tenantId, outletId],
    );
    expect(head.rows).toHaveLength(1);
    const revisions = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM imprint_projection_revision
       WHERE tenant_id = $1 AND outlet_id = $2`,
      [tenantId, outletId],
    );
    expect(Number(revisions.rows[0]?.c)).toBeGreaterThanOrEqual(3);
    const fields = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM imprint_snapshot_field WHERE revision_id = $1`,
      [head.rows[0]!.revision_id],
    );
    expect(Number(fields.rows[0]?.c)).toBe(results[0]!.fields.length);
  });

  it('preserves ingest cursors/watermarks in the rebuild input hash material', async () => {
    const outletId = await createOutlet('Cursors');
    await org.syncOutlet(tenantId, outletId);
    const warehouseId = await createWarehouse(outletId, 'WH');
    await insertPostedReceipt(warehouseId, '2026-10-12', 1);
    await receipts.syncOutlet(tenantId, outletId);
    const rebuilt = await replay.rebuildOutlet(tenantId, outletId);
    const orgCursor = await store.readCursor(tenantId, outletId, 'organization', 'organization_outlet');
    const procCursor = await store.readCursor(
      tenantId,
      outletId,
      'procurement',
      'goods_receipt_last_posted',
    );
    expect(orgCursor).toBeTruthy();
    expect(procCursor).toBeTruthy();
    expect(rebuilt.head.rebuildInputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps cash routes independent of Imprint availability', async () => {
    const cashRoute = readFileSync(join(HERE, '../../routes/cash.ts'), 'utf8');
    const cashModule = readFileSync(join(HERE, '../cash/cash-shift-service.ts'), 'utf8');
    expect(cashRoute).not.toMatch(/restaurant-imprint/);
    expect(cashModule).not.toMatch(/restaurant-imprint|Imprint/);

    const outletId = await createOutlet('Cash Independence');
    await org.syncOutlet(tenantId, outletId);
    const published = await replay.rebuildOutlet(tenantId, outletId);
    await claims.recordSourceFailure(
      await ImprintScope.openInternal(
        pool,
        ImprintInternalAuthority.forSnapshotRebuild(),
        tenantId,
        outletId,
      ),
      {
        sourceModule: 'organization',
        errorCode: 'IMPRINT_SOURCE_READ_FAILED',
        freshness: 'STALE',
      },
    );
    // Operational Organization write still succeeds while Imprint head is STALE.
    await pool.query(`UPDATE outlet SET name = 'Cash Still Works' WHERE outlet_id = $1`, [
      outletId,
    ]);
    const outlet = await pool.query<{ name: string }>(
      `SELECT name FROM outlet WHERE outlet_id = $1 AND tenant_id = $2`,
      [outletId, tenantId],
    );
    expect(outlet.rows[0]?.name).toBe('Cash Still Works');
    const head = await pool.query<{ freshness: string; revision_id: string }>(
      `SELECT freshness, revision_id FROM imprint_snapshot_head
       WHERE tenant_id = $1 AND outlet_id = $2`,
      [tenantId, outletId],
    );
    expect(head.rows[0]?.freshness).toBe('STALE');
    expect(head.rows[0]?.revision_id).toBe(published.head.revisionId);
  });
});
