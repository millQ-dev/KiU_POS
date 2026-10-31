/**
 * ADR-0054 I-09 Stage 1 acceptance certification (AC-01…AC-16).
 * Disposable millq_ci_pos_* only. Adds gap coverage; does not reopen I-02…I-08.
 * Matrix: docs/processes/imprint-stage1-acceptance-matrix.md
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  FactPath,
  ImprintClaimOrigin,
  ImprintFieldState,
  ImprintSensitivity,
} from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import type { AuthenticatedPrincipal } from '../identity/identity-service.js';
import { ImprintClaimService, ImprintInternalAuthority, ImprintScope } from './imprint-claim-service.js';
import { ImprintGoodsReceiptAdapter } from './imprint-goods-receipt-adapter.js';
import { ImprintOrganizationAdapter } from './imprint-organization-adapter.js';
import { ImprintPersistence } from './imprint-persistence.js';
import { ImprintReplayService } from './imprint-replay-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeI09 = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;
const HERE = dirname(fileURLToPath(import.meta.url));

function principal(tenantId: string): AuthenticatedPrincipal {
  return {
    sessionId: randomUUID(),
    tenantId,
    userId: randomUUID(),
    employeeId: null,
    displayName: 'imprint-i09',
    channel: 'TERMINAL',
  };
}

describeI09('restaurant imprint Stage 1 acceptance certification (I-09)', () => {
  let pool: pg.Pool;
  let replay: ImprintReplayService;
  let org: ImprintOrganizationAdapter;
  let receipts: ImprintGoodsReceiptAdapter;
  let claims: ImprintClaimService;
  let store: ImprintPersistence;
  let tenantId: string;
  let brandId: string;
  let legalA: string;
  let legalB: string;
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
    brandId = randomUUID();
    legalA = randomUUID();
    legalB = randomUUID();
    supplierId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'I09')`, [tenantId]);
      await client.query(
        `INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1,$2,'LE-A'), ($3,$2,'LE-B')`,
        [legalA, tenantId, legalB],
      );
      await client.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Brand')`, [
        brandId,
        tenantId,
      ]);
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

  async function createOutlet(name: string, legalEntityId: string = legalA): Promise<string> {
    const outletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,$5)`,
      [outletId, tenantId, brandId, legalEntityId, name],
    );
    return outletId;
  }

  async function createWarehouse(outletId: string, legalEntityId: string, name: string): Promise<string> {
    const warehouseId = randomUUID();
    await pool.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name)
       VALUES ($1,$2,$3,$4,$5)`,
      [warehouseId, tenantId, legalEntityId, outletId, name],
    );
    return warehouseId;
  }

  async function insertReceipt(opts: {
    warehouseId: string;
    legalEntityId: string;
    status: 'DRAFT' | 'POSTED' | 'REVERSED';
    businessDate: string;
    businessOrder: number;
    postedAt?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO goods_receipt (
         goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
         supplier_document_number, currency_code, minor_unit_exponent,
         business_date, business_order, status, posted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'RUB',2,$7,$8,$9,$10)`,
      [
        id,
        tenantId,
        opts.legalEntityId,
        opts.warehouseId,
        supplierId,
        `DOC-${id.slice(0, 8)}`,
        opts.businessDate,
        opts.businessOrder,
        opts.status,
        opts.postedAt === undefined ? `${opts.businessDate}T08:00:00.000Z` : opts.postedAt,
      ],
    );
    return id;
  }

  it('AC-01: organization-only outlet yields partial snapshot; other paths stay UNKNOWN', async () => {
    const outletId = await createOutlet('Org Only');
    await org.syncOutlet(tenantId, outletId);
    const published = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: false });

    const identity = published.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(identity?.fieldState).toBe('KNOWN');
    expect(identity?.canonicalValue).toContain(outletId);

    const receipt = published.fields.find((f) => f.factPath === FactPath.LastPostedReceiptRef);
    expect(receipt?.fieldState).toBe('UNKNOWN');
    expect(receipt?.canonicalValue).toBeNull();

    const terminals = published.fields.find((f) => f.factPath === FactPath.ActiveTerminalRefs);
    expect(terminals?.fieldState).toBe('UNKNOWN');
    expect(terminals?.canonicalValue).toBeNull();
  });

  it('AC-04: declared/configured-style distinct claims stay visible; same-rank conflict is unresolved', async () => {
    const outletId = await createOutlet('Conflict Cafe');
    const scope = await ImprintScope.open(pool, principal(tenantId), outletId);

    const declared = await claims.appendAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Declared,
      sensitivityClass: ImprintSensitivity.PublicReference,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'human-5',
      },
      value: { outletId, name: 'Five staff note' },
    });
    const observedA = await claims.appendAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'obs-4',
      },
      value: { outletId, name: 'Four' },
    });
    const observedB = await claims.appendAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'obs-3',
      },
      value: { outletId, name: 'Three' },
    });

    expect(declared.outcome).toBe('INSERTED');
    expect(observedA.outcome).toBe('INSERTED');
    expect(observedB.outcome).toBe('INSERTED');
    expect(new Set([declared.claimId, observedA.claimId, observedB.claimId]).size).toBe(3);

    const resolved = await claims.resolveField(scope, FactPath.OutletIdentity);
    expect(resolved.fieldState).toBe(ImprintFieldState.Conflict);
    expect(resolved.canonicalValue).toBeNull();
    expect(resolved.value).toBeNull();

    const histDeclared = await claims.readClaim(scope, declared.claimId);
    const histA = await claims.readClaim(scope, observedA.claimId);
    const histB = await claims.readClaim(scope, observedB.claimId);
    expect(histDeclared?.canonicalValue).toContain('Five');
    expect(histA?.canonicalValue).toContain('Four');
    expect(histB?.canonicalValue).toContain('Three');

    const snapshot = await replay.rebuildOutlet(tenantId, outletId);
    const field = snapshot.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(field?.fieldState).toBe('CONFLICT');
    expect(field?.canonicalValue).toBeNull();
  });

  it('AC-07: late older GoodsReceipt does not downgrade chronologically newer evidence', async () => {
    const outletId = await createOutlet('Chronology');
    const warehouseId = await createWarehouse(outletId, legalA, 'WH');
    const newerId = await insertReceipt({
      warehouseId,
      legalEntityId: legalA,
      status: 'POSTED',
      businessDate: '2026-10-20',
      businessOrder: 2,
      postedAt: '2026-10-20T10:00:00.000Z',
    });
    await org.syncOutlet(tenantId, outletId);
    await receipts.syncOutlet(tenantId, outletId);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    const afterNewer = await claims.resolveField(scope, FactPath.LastPostedReceiptRef);
    expect(afterNewer.canonicalValue).toContain(newerId);

    const olderId = await insertReceipt({
      warehouseId,
      legalEntityId: legalA,
      status: 'POSTED',
      businessDate: '2026-10-01',
      businessOrder: 1,
      postedAt: '2026-10-01T08:00:00.000Z',
    });
    await receipts.syncOutlet(tenantId, outletId);
    const afterLate = await claims.resolveField(scope, FactPath.LastPostedReceiptRef);
    expect(afterLate.canonicalValue).toContain(newerId);
    expect(afterLate.canonicalValue).not.toContain(olderId);
  });

  it('equal rebuild_input_hash keeps identical field projection despite new revisionId', async () => {
    const outletId = await createOutlet('Hash Identity');
    const warehouseId = await createWarehouse(outletId, legalA, 'WH');
    await insertReceipt({
      warehouseId,
      legalEntityId: legalA,
      status: 'POSTED',
      businessDate: '2026-10-15',
      businessOrder: 1,
    });
    await org.syncOutlet(tenantId, outletId);
    await receipts.syncOutlet(tenantId, outletId);

    const first = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: false });
    const second = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: false });

    expect(second.head.rebuildInputHash).toBe(first.head.rebuildInputHash);
    expect(second.head.revisionId).not.toBe(first.head.revisionId);
    expect(second.resolverVersion).toBe(first.resolverVersion);
    expect(second.fields).toEqual(first.fields);
    expect(second.head.freshness).toBe('FRESH');
    expect(first.head.freshness).toBe('FRESH');
  });

  it('AC-12: concurrent rebuild versus source update leaves one atomic coherent head', async () => {
    const outletId = await createOutlet('Race Source');
    await org.syncOutlet(tenantId, outletId);
    await replay.rebuildOutlet(tenantId, outletId);

    const renameAndSync = async () => {
      await pool.query(`UPDATE outlet SET name = 'Renamed Midflight' WHERE outlet_id = $1`, [
        outletId,
      ]);
      return org.syncOutlet(tenantId, outletId);
    };

    // Contended path may reject a mid-flight publish (claim superseded after resolve).
    // Certification requires the retained/published head to stay atomic and coherent.
    const raced = await Promise.allSettled([
      replay.rebuildOutlet(tenantId, outletId, { resyncSources: true }),
      renameAndSync(),
      replay.rebuildOutlet(tenantId, outletId, { resyncSources: true }),
    ]);
    expect(raced.some((r) => r.status === 'fulfilled')).toBe(true);

    const settled = await replay.rebuildOutlet(tenantId, outletId, { resyncSources: true });
    expect(settled.head.freshness).toBe('FRESH');
    expect(settled.fields).toHaveLength(7);

    const head = await pool.query<{ revision_id: string; freshness: string; rebuild_input_hash: string }>(
      `SELECT h.revision_id, h.freshness, r.rebuild_input_hash
       FROM imprint_snapshot_head h
       JOIN imprint_projection_revision r ON r.revision_id = h.revision_id
       WHERE h.tenant_id = $1 AND h.outlet_id = $2`,
      [tenantId, outletId],
    );
    expect(head.rows).toHaveLength(1);
    expect(head.rows[0]?.revision_id).toBe(settled.head.revisionId);
    expect(head.rows[0]?.rebuild_input_hash).toBe(settled.head.rebuildInputHash);
    expect(head.rows[0]?.freshness).toBe('FRESH');

    const fieldCount = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM imprint_snapshot_field WHERE revision_id = $1`,
      [settled.head.revisionId],
    );
    expect(Number(fieldCount.rows[0]?.c)).toBe(settled.fields.length);

    const identity = settled.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(identity?.fieldState).toBe('KNOWN');
    expect(identity?.canonicalValue).toContain('Renamed Midflight');

    const orgCursor = await store.readCursor(tenantId, outletId, 'organization', 'organization_outlet');
    expect(orgCursor).toBeTruthy();
  });

  it('AC-14: sister outlets under different legal entities stay isolated', async () => {
    const outletA = await createOutlet('Outlet LE-A', legalA);
    const outletB = await createOutlet('Outlet LE-B', legalB);
    const whA = await createWarehouse(outletA, legalA, 'WH-A');
    const whB = await createWarehouse(outletB, legalB, 'WH-B');
    const receiptA = await insertReceipt({
      warehouseId: whA,
      legalEntityId: legalA,
      status: 'POSTED',
      businessDate: '2026-10-08',
      businessOrder: 1,
    });
    const receiptB = await insertReceipt({
      warehouseId: whB,
      legalEntityId: legalB,
      status: 'POSTED',
      businessDate: '2026-10-09',
      businessOrder: 1,
    });

    await org.syncOutlet(tenantId, outletA);
    await org.syncOutlet(tenantId, outletB);
    await receipts.syncOutlet(tenantId, outletA);
    await receipts.syncOutlet(tenantId, outletB);
    const snapA = await replay.rebuildOutlet(tenantId, outletA);
    const snapB = await replay.rebuildOutlet(tenantId, outletB);

    const leA = snapA.fields.find((f) => f.factPath === FactPath.OutletLegalEntityRef);
    const leB = snapB.fields.find((f) => f.factPath === FactPath.OutletLegalEntityRef);
    expect(leA?.canonicalValue).toContain(legalA);
    expect(leA?.canonicalValue).not.toContain(legalB);
    expect(leB?.canonicalValue).toContain(legalB);
    expect(leB?.canonicalValue).not.toContain(legalA);

    const grA = snapA.fields.find((f) => f.factPath === FactPath.LastPostedReceiptRef);
    const grB = snapB.fields.find((f) => f.factPath === FactPath.LastPostedReceiptRef);
    expect(grA?.canonicalValue).toContain(receiptA);
    expect(grA?.canonicalValue).not.toContain(receiptB);
    expect(grB?.canonicalValue).toContain(receiptB);
    expect(grB?.canonicalValue).not.toContain(receiptA);
  });

  it('AC-11 partial: superseded claim history remains readable; caller business time is not manufactured', async () => {
    const outletId = await createOutlet('History');
    const scope = await ImprintScope.open(pool, principal(tenantId), outletId);
    const first = await claims.appendAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'hist-1',
      },
      value: { outletId, name: 'Before' },
      businessDate: '2099-01-01',
      effectiveFrom: '2099-01-01T00:00:00.000Z',
    });
    expect(first.outcome).toBe('INSERTED');

    const stored = await pool.query<{ business_date: string | null; effective_from: Date | null }>(
      `SELECT business_date::text AS business_date, effective_from
       FROM imprint_claim WHERE claim_id = $1`,
      [first.claimId],
    );
    expect(stored.rows[0]?.business_date).toBeNull();
    expect(stored.rows[0]?.effective_from).toBeNull();

    const second = await claims.appendAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'hist-2',
      },
      value: { outletId, name: 'After' },
      supersedesClaimId: first.claimId,
    });
    expect(second.outcome).toBe('INSERTED');

    const historical = await claims.readClaim(scope, first.claimId);
    expect(historical?.active).toBe(false);
    expect(historical?.canonicalValue).toContain('Before');
    const current = await claims.resolveField(scope, FactPath.OutletIdentity);
    expect(current.canonicalValue).toContain('After');
  });

  it('AC-15/16 smoke: posting GoodsReceipt and cash module stay independent of Imprint STALE', async () => {
    const cashRoute = readFileSync(join(HERE, '../../routes/cash.ts'), 'utf8');
    const cashModule = readFileSync(join(HERE, '../cash/cash-shift-service.ts'), 'utf8');
    expect(cashRoute).not.toMatch(/restaurant-imprint/);
    expect(cashModule).not.toMatch(/restaurant-imprint|Imprint/);

    const outletId = await createOutlet('Ops Independence');
    const warehouseId = await createWarehouse(outletId, legalA, 'WH');
    await org.syncOutlet(tenantId, outletId);
    const good = await replay.rebuildOutlet(tenantId, outletId);
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
    const head = await pool.query<{ freshness: string; revision_id: string }>(
      `SELECT freshness, revision_id FROM imprint_snapshot_head
       WHERE tenant_id = $1 AND outlet_id = $2`,
      [tenantId, outletId],
    );
    expect(head.rows[0]?.freshness).toBe('STALE');
    expect(head.rows[0]?.revision_id).toBe(good.head.revisionId);

    const postedId = await insertReceipt({
      warehouseId,
      legalEntityId: legalA,
      status: 'POSTED',
      businessDate: '2026-10-22',
      businessOrder: 1,
    });
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM goods_receipt WHERE goods_receipt_id = $1 AND tenant_id = $2`,
      [postedId, tenantId],
    );
    expect(row.rows[0]?.status).toBe('POSTED');
  });
});
