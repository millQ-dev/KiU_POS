/**
 * ADR-0054 I-06 GoodsReceipt adapter acceptance. Disposable millq_ci_pos_* only.
 * Read-only Procurement → Imprint. No HTTP, no migration, no source-domain writes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { FactPath, ImprintClaimOrigin, ImprintFieldState } from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { ImprintClaimService, ImprintInternalAuthority, ImprintScope } from './imprint-claim-service.js';
import {
  ImprintGoodsReceiptAdapter,
  pickLastPostedReceipt,
} from './imprint-goods-receipt-adapter.js';
import { ImprintPersistence } from './imprint-persistence.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeImprint = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

describeImprint('restaurant imprint goods receipt adapter (disposable PG)', () => {
  let pool: pg.Pool;
  let adapter: ImprintGoodsReceiptAdapter;
  let service: ImprintClaimService;
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
    adapter = new ImprintGoodsReceiptAdapter(pool);
    service = new ImprintClaimService(pool);
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
        `INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1, $2, 'LE A'), ($3, $4, 'LE B')`,
        [legalId, tenantId, otherLegalId, otherTenantId],
      );
      await client.query(
        `INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1, $2, 'Brand A'), ($3, $4, 'Brand B')`,
        [brandId, tenantId, otherBrandId, otherTenantId],
      );
      await client.query(
        `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
         VALUES ($1, $2, $3, $4, 'Foreign')`,
        [otherOutletId, otherTenantId, otherBrandId, otherLegalId],
      );
      await client.query(`INSERT INTO supplier (supplier_id, tenant_id, name) VALUES ($1, $2, 'Sup')`, [
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
       VALUES ($1, $2, $3, $4, $5)`,
      [outletId, tenantId, brandId, legalId, name],
    );
    return outletId;
  }

  async function createWarehouse(outletId: string | null, name: string): Promise<string> {
    const warehouseId = randomUUID();
    await pool.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name)
       VALUES ($1, $2, $3, $4, $5)`,
      [warehouseId, tenantId, legalId, outletId, name],
    );
    return warehouseId;
  }

  async function insertReceipt(input: {
    warehouseId: string;
    status: 'DRAFT' | 'POSTED' | 'REVERSED' | 'CORRECTED';
    businessDate: string;
    businessOrder: number;
    postedAt?: string | null;
    reversesId?: string | null;
    legalEntityId?: string;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO goods_receipt (
         goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
         supplier_document_number, currency_code, minor_unit_exponent,
         business_date, business_order, status, posted_at, reverses_goods_receipt_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'RUB',2,$7,$8,$9,$10,$11)`,
      [
        id,
        tenantId,
        input.legalEntityId ?? legalId,
        input.warehouseId,
        supplierId,
        `DOC-${id.slice(0, 8)}`,
        input.businessDate,
        input.businessOrder,
        input.status,
        input.postedAt ?? null,
        input.reversesId ?? null,
      ],
    );
    return id;
  }

  it('requires a sealed procurement authority and denies foreign outlets', async () => {
    const outletId = await createOutlet('Auth Cafe');
    await expect(
      ImprintScope.openInternal(pool, { kind: 'PROCUREMENT_ADAPTER' } as never, tenantId, outletId),
    ).rejects.toMatchObject({ code: 'IMPRINT_SCOPE_DENIED' });
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    expect(scope.authority).toBe('INTERNAL');
    expect(ImprintInternalAuthority.forProcurementAdapter().kind).toBe('PROCUREMENT_ADAPTER');
    expect(ImprintInternalAuthority.forOrganizationAdapter().kind).toBe('ORGANIZATION_ADAPTER');
    await expect(adapter.syncOutlet(otherTenantId, outletId)).rejects.toMatchObject({
      code: 'IMPRINT_SCOPE_DENIED',
    });
    await expect(adapter.syncOutlet(tenantId, otherOutletId)).rejects.toMatchObject({
      code: 'IMPRINT_SCOPE_DENIED',
    });
  });

  it('selects the chronologically last POSTED receipt and excludes DRAFT', async () => {
    const outletId = await createOutlet('Chronology');
    const warehouseId = await createWarehouse(outletId, 'Matched');
    const draftId = await insertReceipt({
      warehouseId,
      status: 'DRAFT',
      businessDate: '2026-10-30',
      businessOrder: 99,
    });
    const older = await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-28',
      businessOrder: 1,
      postedAt: '2026-10-28T08:00:00.000Z',
    });
    const newest = await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-29',
      businessOrder: 2,
      postedAt: '2026-10-29T09:00:00.000Z',
    });
    const mid = await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-29',
      businessOrder: 1,
      postedAt: '2026-10-29T10:00:00.000Z',
    });

    const sync = await adapter.syncOutlet(tenantId, outletId);
    expect(sync.degraded).toBe(false);
    expect(sync.outcomes.some((row) => row.outcome === 'INSERTED')).toBe(true);

    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    const field = await service.resolveField(scope, FactPath.LastPostedReceiptRef);
    expect(field.fieldState).toBe(ImprintFieldState.Known);
    expect(field.canonicalValue).toContain(newest);
    expect(field.canonicalValue).toContain('POSTED');
    expect(field.canonicalValue).not.toContain(draftId);
    expect(field.canonicalValue).not.toContain(older);
    expect(field.canonicalValue).not.toContain(mid);
  });

  it('breaks same business_date/order ties with posted_at then id', () => {
    const a = {
      goods_receipt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'POSTED' as const,
      business_date: '2026-10-29',
      business_order: 1,
      posted_at: '2026-10-29T10:00:00.000Z',
      warehouse_id: randomUUID(),
    };
    const b = {
      goods_receipt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'POSTED' as const,
      business_date: '2026-10-29',
      business_order: 1,
      posted_at: '2026-10-29T11:00:00.000Z',
      warehouse_id: randomUUID(),
    };
    const c = {
      goods_receipt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'POSTED' as const,
      business_date: '2026-10-29',
      business_order: 1,
      posted_at: '2026-10-29T11:00:00.000Z',
      warehouse_id: randomUUID(),
    };
    expect(pickLastPostedReceipt([a, b])?.goods_receipt_id).toBe(b.goods_receipt_id);
    expect(pickLastPostedReceipt([a, b, c])?.goods_receipt_id).toBe(c.goods_receipt_id);
  });

  it('re-reads reversal as REVERSED and does not keep a stale POSTED claim', async () => {
    const outletId = await createOutlet('Reverse');
    const warehouseId = await createWarehouse(outletId, 'WH');
    const receiptId = await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-20',
      businessOrder: 1,
      postedAt: '2026-10-20T08:00:00.000Z',
    });
    await adapter.syncOutlet(tenantId, outletId);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    expect((await service.resolveField(scope, FactPath.LastPostedReceiptRef)).canonicalValue).toContain(
      'POSTED',
    );

    await pool.query(
      `UPDATE goods_receipt SET status = 'REVERSED', reversed_at = NOW()
       WHERE goods_receipt_id = $1 AND tenant_id = $2`,
      [receiptId, tenantId],
    );
    const reverseDoc = await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-20',
      businessOrder: 1,
      postedAt: '2026-10-20T09:00:00.000Z',
      reversesId: receiptId,
    });

    const after = await adapter.syncOutlet(tenantId, outletId);
    expect(after.outcomes.some((row) => row.outcome === 'INSERTED')).toBe(true);
    const field = await service.resolveField(scope, FactPath.LastPostedReceiptRef);
    expect(field.canonicalValue).toContain(receiptId);
    expect(field.canonicalValue).toContain('REVERSED');
    expect(field.canonicalValue).not.toContain('"POSTED"');
    expect(field.canonicalValue).not.toContain(reverseDoc);
  });

  it('excludes NULL-outlet warehouses and sister outlets; missing evidence → UNKNOWN', async () => {
    const outletId = await createOutlet('Null WH');
    const sisterId = await createOutlet('Sister');
    const orphan = await createWarehouse(null, 'Shared');
    const matched = await createWarehouse(outletId, 'Owned');
    const sisterWh = await createWarehouse(sisterId, 'Sister WH');
    await insertReceipt({
      warehouseId: orphan,
      status: 'POSTED',
      businessDate: '2026-10-25',
      businessOrder: 5,
      postedAt: '2026-10-25T08:00:00.000Z',
    });
    const sisterReceipt = await insertReceipt({
      warehouseId: sisterWh,
      status: 'POSTED',
      businessDate: '2026-10-27',
      businessOrder: 9,
      postedAt: '2026-10-27T08:00:00.000Z',
    });
    const empty = await adapter.syncOutlet(tenantId, outletId);
    expect(empty.outcomes).toEqual([]);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    expect(await service.resolveField(scope, FactPath.LastPostedReceiptRef)).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
      value: null,
    });
    const sisterScope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      sisterId,
    );
    await adapter.syncOutlet(tenantId, sisterId);
    expect(
      (await service.resolveField(sisterScope, FactPath.LastPostedReceiptRef)).canonicalValue,
    ).toContain(sisterReceipt);
    expect(await service.resolveField(scope, FactPath.LastPostedReceiptRef)).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
    });

    const posted = await insertReceipt({
      warehouseId: matched,
      status: 'POSTED',
      businessDate: '2026-10-26',
      businessOrder: 1,
      postedAt: '2026-10-26T08:00:00.000Z',
    });
    await adapter.syncOutlet(tenantId, outletId);
    expect(
      (await service.resolveField(scope, FactPath.LastPostedReceiptRef)).canonicalValue,
    ).toContain(posted);
    expect(
      (await service.resolveField(scope, FactPath.LastPostedReceiptRef)).canonicalValue,
    ).not.toContain(sisterReceipt);

    await pool.query(`DELETE FROM goods_receipt WHERE goods_receipt_id = $1`, [posted]);
    const cleared = await adapter.syncOutlet(tenantId, outletId);
    expect(cleared.invalidated).toBe(true);
    expect(await service.resolveField(scope, FactPath.LastPostedReceiptRef)).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
      value: null,
    });
  });

  it('repeats deterministically and rolls back a rejected procurement checkpoint', async () => {
    const outletId = await createOutlet('Idempotent');
    const warehouseId = await createWarehouse(outletId, 'WH');
    await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-15',
      businessOrder: 3,
      postedAt: '2026-10-15T08:00:00.000Z',
    });
    const first = await adapter.syncOutlet(tenantId, outletId);
    const second = await adapter.syncOutlet(tenantId, outletId);
    expect(second.outcomes).toEqual([]);
    expect(
      await store.readCursor(tenantId, outletId, 'procurement', 'goods_receipt_last_posted'),
    ).toBe(first.watermark);

    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    const before = await store.readCursor(
      tenantId,
      outletId,
      'procurement',
      'goods_receipt_last_posted',
    );
    const bogusReceiptId = randomUUID();
    await expect(
      service.commitCheckpoint(scope, {
        sourceModule: 'procurement',
        cursorName: 'goods_receipt_last_posted',
        watermark: 'wm-bad',
        assertions: [
          {
            tenantId,
            outletId,
            factPath: FactPath.LastPostedReceiptRef,
            origin: ImprintClaimOrigin.Observed,
            sensitivityClass: 'INTERNAL_REFERENCE',
            provenance: {
              sourceModule: 'procurement',
              sourceEntityType: 'GoodsReceipt',
              sourceEntityId: bogusReceiptId,
              sourceRevision: 'bad-1',
            },
            value: { goodsReceiptId: bogusReceiptId, postingStatus: 'POSTED' },
            supersedesClaimId: randomUUID(),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_LIFECYCLE_REJECTED' });
    expect(
      await store.readCursor(tenantId, outletId, 'procurement', 'goods_receipt_last_posted'),
    ).toBe(before);
  });

  it('retains the last good claim on source read failure and records a projection error', async () => {
    const outletId = await createOutlet('Stale');
    const warehouseId = await createWarehouse(outletId, 'WH');
    const receiptId = await insertReceipt({
      warehouseId,
      status: 'POSTED',
      businessDate: '2026-10-10',
      businessOrder: 1,
      postedAt: '2026-10-10T08:00:00.000Z',
    });
    await adapter.syncOutlet(tenantId, outletId);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forProcurementAdapter(),
      tenantId,
      outletId,
    );
    const before = await service.resolveField(scope, FactPath.LastPostedReceiptRef);
    expect(before.canonicalValue).toContain(receiptId);

    const originalQuery = pool.query.bind(pool);
    pool.query = (async (sql: unknown, params?: unknown) => {
      if (typeof sql === 'string' && sql.includes('FROM goods_receipt gr')) {
        throw new Error('simulated procurement source failure');
      }
      return originalQuery(sql as never, params as never);
    }) as typeof pool.query;
    try {
      const failingAdapter = new ImprintGoodsReceiptAdapter(pool);
      const failed = await failingAdapter.syncOutlet(tenantId, outletId);
      expect(failed.degraded).toBe(true);
      expect(failed.outcomes).toEqual([]);
      const after = await service.resolveField(scope, FactPath.LastPostedReceiptRef);
      expect(after.canonicalValue).toContain(receiptId);
      expect(after.fieldState).toBe(ImprintFieldState.Known);
      const errors = await pool.query<{ error_code: string }>(
        `SELECT error_code FROM imprint_projection_error
         WHERE tenant_id = $1 AND outlet_id = $2 AND source_module = 'procurement'
         ORDER BY recorded_at DESC LIMIT 1`,
        [tenantId, outletId],
      );
      expect(errors.rows[0]?.error_code).toBe('IMPRINT_SOURCE_READ_FAILED');
    } finally {
      pool.query = originalQuery;
    }
  });
});
