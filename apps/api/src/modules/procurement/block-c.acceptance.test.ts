import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { registerGoodsReceiptRoutes } from '../../routes/goods-receipts.js';
import { GoodsReceiptService } from './goods-receipt-service.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { PostedImmutableError, IdempotencyConflictError } from './errors.js';
import { OperationalFactType } from '@millq/contracts';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let service: GoodsReceiptService;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed,
      audit_record,
      inventory_balance,
      inventory_movement,
      goods_receipt_line,
      goods_receipt,
      production_batch_reversal,
      production_batch_input,
      production_batch,
      recipe_component,
      recipe_version,
      recipe_specification,
      preparation_component,
      preparation_version,
      preparation_specification,
      supplier_item,
      supplier_pack,
      catalog_item,
      supplier,
      warehouse,
      outlet,
      brand,
      legal_entity,
      tenant
    RESTART IDENTITY CASCADE
  `);
}

function milkLine(overrides: Partial<{ packageCount: number; unitPriceMinor: string; lineAcquisitionCostMinor: string }> = {}) {
  const packageCount = overrides.packageCount ?? 6;
  const unitPriceMinor = overrides.unitPriceMinor ?? '10000';
  const accepted = String(packageCount);
  const lineAcquisitionCostMinor =
    overrides.lineAcquisitionCostMinor ?? String(Number(unitPriceMinor) * packageCount);
  return {
    lineNumber: 1,
    catalogItemId: fx.milkItemId,
    supplierItemId: fx.milkSupplierItemId,
    inputKind: 'FIXED_PACKAGE' as const,
    packageCount,
    acceptedBaseQuantity: accepted,
    baseUnit: 'L',
    dimension: 'VOLUME' as const,
    unitPriceMinor,
    lineAcquisitionCostMinor,
  };
}

function draftBase(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: 'SD-1',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-03-01',
    businessOrder: 1,
    actorId: fx.actorId,
    lines: [milkLine()],
    ...overrides,
  };
}

describe('Block C Goods Receipt vertical (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    service = new GoodsReceiptService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
  });

  it('SCENARIO 1 — fixed package milk 6 × 1 L → 6 L + movement + stock + cost + fact', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'MILK-1' }));
    const posted = await service.post(draft!.goodsReceiptId, {
      idempotencyKey: 'post-milk-1',
      actorId: fx.actorId,
      restaurantLocationId: fx.outletId,
      businessGroupId: fx.tenantId,
      jurisdictionProfileVersionId: '00000000-0000-4000-8000-000000000098',
    });
    expect(posted.status).toBe('created');
    expect(posted.receipt!.status).toBe('POSTED');

    const mov = await pool.query(
      `SELECT quantity, direction FROM inventory_movement WHERE source_document_id = $1`,
      [draft!.goodsReceiptId],
    );
    expect(mov.rowCount).toBe(1);
    expect(mov.rows[0].quantity).toBe('6');
    expect(mov.rows[0].direction).toBe('IN');

    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(bal.quantity).toBe('6');
    expect(bal.carryingValueMinor).toBe('60000');
    expect(bal.costQuote?.amountMinorUnits).toBe('10000');
    expect(bal.costQuote?.certainty).toBe('FINAL');

    const facts = await pool.query(
      `SELECT fact_type, payload FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.GoodsReceived],
    );
    expect(facts.rowCount).toBe(1);
    expect(facts.rows[0].payload.acceptedBaseQuantity.value).toBe('6');
    expect(facts.rows[0].payload.stockItemId).toBe(fx.milkItemId);
  });

  it('SCENARIO 2 — multipack oil 12 × 0.75 L → 9 L', async () => {
    const draft = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'OIL-1',
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.oilItemId,
            supplierItemId: fx.oilSupplierItemId,
            inputKind: 'FIXED_PACKAGE',
            packageCount: 1,
            acceptedBaseQuantity: '9',
            baseUnit: 'L',
            dimension: 'VOLUME',
            unitPriceMinor: '5000',
            lineAcquisitionCostMinor: '45000',
          },
        ],
      }),
    );
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'post-oil-1', actorId: fx.actorId });
    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.oilItemId);
    expect(bal.quantity).toBe('9');
    expect(bal.carryingValueMinor).toBe('45000');
  });

  it('SCENARIO 3 — variable weight meat 18.7 kg (not 4 ea)', async () => {
    const draft = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'MEAT-1',
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.meatItemId,
            supplierItemId: fx.meatSupplierItemId,
            inputKind: 'VARIABLE_WEIGHT',
            packageCount: 4,
            acceptedBaseQuantity: '18.7',
            baseUnit: 'kg',
            dimension: 'MASS',
            unitPriceMinor: '100000',
            lineAcquisitionCostMinor: '1870000',
          },
        ],
      }),
    );
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'post-meat-1', actorId: fx.actorId });
    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.meatItemId);
    expect(bal.quantity).toBe('18.7');
    const mov = await pool.query(`SELECT quantity, base_unit FROM inventory_movement WHERE catalog_item_id = $1`, [
      fx.meatItemId,
    ]);
    expect(mov.rows[0].quantity).toBe('18.7');
    expect(mov.rows[0].base_unit).toBe('kg');
  });

  it('SCENARIO 4 — COUNT eggs 24 ea', async () => {
    const draft = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'EGG-1',
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.eggItemId,
            supplierItemId: fx.eggSupplierItemId,
            inputKind: 'COUNT',
            packageCount: 24,
            acceptedBaseQuantity: '24',
            baseUnit: 'ea',
            dimension: 'COUNT',
            unitPriceMinor: '3000',
            lineAcquisitionCostMinor: '72000',
          },
        ],
      }),
    );
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'post-egg-1', actorId: fx.actorId });
    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.eggItemId);
    expect(bal.quantity).toBe('24');
  });

  it('SCENARIO 5 — moving weighted average 10@100 + 10@200 → 150', async () => {
    const a = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'AVG-A',
        businessOrder: 1,
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.meatItemId,
            supplierItemId: fx.meatSupplierItemId,
            inputKind: 'VARIABLE_WEIGHT',
            packageCount: 1,
            acceptedBaseQuantity: '10',
            baseUnit: 'kg',
            dimension: 'MASS',
            unitPriceMinor: '100',
            lineAcquisitionCostMinor: '1000',
          },
        ],
      }),
    );
    await service.post(a!.goodsReceiptId, { idempotencyKey: 'avg-a', actorId: fx.actorId });

    const b = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'AVG-B',
        businessOrder: 2,
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.meatItemId,
            supplierItemId: fx.meatSupplierItemId,
            inputKind: 'VARIABLE_WEIGHT',
            packageCount: 1,
            acceptedBaseQuantity: '10',
            baseUnit: 'kg',
            dimension: 'MASS',
            unitPriceMinor: '200',
            lineAcquisitionCostMinor: '2000',
          },
        ],
      }),
    );
    await service.post(b!.goodsReceiptId, { idempotencyKey: 'avg-b', actorId: fx.actorId });

    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.meatItemId);
    expect(bal.quantity).toBe('20');
    expect(bal.carryingValueMinor).toBe('3000');
    expect(bal.costQuote?.amountMinorUnits).toBe('150');
    expect(bal.costQuote?.certainty).toBe('FINAL');
  });

  it('SCENARIO 6 — idempotent retry does not double-post', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'RETRY-1' }));
    const first = await service.post(draft!.goodsReceiptId, { idempotencyKey: 'retry-key', actorId: fx.actorId });
    const second = await service.post(draft!.goodsReceiptId, { idempotencyKey: 'retry-key', actorId: fx.actorId });
    expect(first.status).toBe('created');
    expect(second.status).toBe('duplicate');
    const mov = await pool.query(`SELECT COUNT(*)::int AS c FROM inventory_movement WHERE catalog_item_id = $1`, [
      fx.milkItemId,
    ]);
    expect(mov.rows[0].c).toBe(1);
    const facts = await pool.query(`SELECT COUNT(*)::int AS c FROM operational_fact_feed`);
    expect(facts.rows[0].c).toBe(1);
  });

  it('SCENARIO 7 — same idempotency key + different semantics → IDEMPOTENCY_CONFLICT', async () => {
    const d1 = await service.createDraft(draftBase({ supplierDocumentNumber: 'C1', lines: [milkLine()] }));
    await service.post(d1!.goodsReceiptId, { idempotencyKey: 'shared-key', actorId: fx.actorId });

    const d2 = await service.createDraft(
      draftBase({ supplierDocumentNumber: 'C2', businessOrder: 2, lines: [milkLine({ packageCount: 3 })] }),
    );
    await expect(service.post(d2!.goodsReceiptId, { idempotencyKey: 'shared-key', actorId: fx.actorId })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it('SCENARIO 8 — draft has zero inventory impact', async () => {
    await service.createDraft(draftBase({ supplierDocumentNumber: 'DRAFT-ONLY' }));
    const mov = await pool.query(`SELECT COUNT(*)::int AS c FROM inventory_movement`);
    expect(mov.rows[0].c).toBe(0);
    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(bal.quantity).toBe('0');
    const facts = await pool.query(`SELECT COUNT(*)::int AS c FROM operational_fact_feed`);
    expect(facts.rows[0].c).toBe(0);
  });

  it('SCENARIO 9 — POSTED economic fields are immutable', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'IMM' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'imm-1', actorId: fx.actorId });
    await expect(
      service.updateDraft(draft!.goodsReceiptId, { supplierDocumentNumber: 'HACKED', actorId: fx.actorId }),
    ).rejects.toBeInstanceOf(PostedImmutableError);
  });

  it('SCENARIO 10 — backdated receipt B between A and C matches chronological A→B→C', async () => {
    const line = (price: string, qty: string, cost: string) => ({
      lineNumber: 1,
      catalogItemId: fx.meatItemId,
      supplierItemId: fx.meatSupplierItemId,
      inputKind: 'VARIABLE_WEIGHT' as const,
      packageCount: 1,
      acceptedBaseQuantity: qty,
      baseUnit: 'kg',
      dimension: 'MASS' as const,
      unitPriceMinor: price,
      lineAcquisitionCostMinor: cost,
    });

    const a = await service.createDraft(
      draftBase({ supplierDocumentNumber: 'A', businessOrder: 1, lines: [line('100', '10', '1000')] }),
    );
    await service.post(a!.goodsReceiptId, { idempotencyKey: 'bd-a', actorId: fx.actorId });

    const c = await service.createDraft(
      draftBase({ supplierDocumentNumber: 'C', businessOrder: 3, lines: [line('300', '10', '3000')] }),
    );
    await service.post(c!.goodsReceiptId, { idempotencyKey: 'bd-c', actorId: fx.actorId });

    const b = await service.createDraft(
      draftBase({ supplierDocumentNumber: 'B', businessOrder: 2, lines: [line('200', '10', '2000')] }),
    );
    await service.post(b!.goodsReceiptId, { idempotencyKey: 'bd-b', actorId: fx.actorId });

    const chronology = await pool.query(
      `SELECT source_document_id, business_order, acquisition_cost_minor
       FROM inventory_movement
       WHERE catalog_item_id = $1
       ORDER BY business_date, business_order`,
      [fx.meatItemId],
    );
    expect(chronology.rows.map((r) => r.business_order)).toEqual([1, 2, 3]);
    expect(chronology.rows.map((r) => r.acquisition_cost_minor)).toEqual(['1000', '2000', '3000']);

    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.meatItemId);
    expect(bal.quantity).toBe('30');
    expect(bal.carryingValueMinor).toBe('6000');
    expect(bal.costQuote?.amountMinorUnits).toBe('200');

    // Control: fresh chronological posting on oil stream equals same math
    const ca = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'CTRL-A',
        businessOrder: 1,
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.oilItemId,
            supplierItemId: fx.oilSupplierItemId,
            inputKind: 'FIXED_PACKAGE',
            packageCount: 1,
            acceptedBaseQuantity: '9',
            baseUnit: 'L',
            dimension: 'VOLUME',
            unitPriceMinor: '100',
            lineAcquisitionCostMinor: '900',
          },
        ],
      }),
    );
    await service.post(ca!.goodsReceiptId, { idempotencyKey: 'ctrl-a', actorId: fx.actorId });
    // Not required to match meat — just prove late-insert stream rebuild is deterministic above.
  });

  it('SCENARIO 11 — wrong LegalEntity/Warehouse boundary rejected atomically', async () => {
    await expect(
      service.createDraft(
        draftBase({
          legalEntityId: fx.legalEntityId,
          warehouseId: fx.otherWarehouseId,
          supplierDocumentNumber: 'BAD-WH',
        }),
      ),
    ).rejects.toMatchObject({ code: 'LEGAL_ENTITY_WAREHOUSE_MISMATCH' });

    const mov = await pool.query(`SELECT COUNT(*)::int AS c FROM inventory_movement`);
    expect(mov.rows[0].c).toBe(0);
  });

  it('SCENARIO 12 — operational fact mirror: line-level facts, document group key', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'FACT-1' }));
    await service.post(draft!.goodsReceiptId, {
      idempotencyKey: 'fact-post-1',
      actorId: fx.actorId,
      restaurantLocationId: fx.outletId,
      businessGroupId: fx.tenantId,
    });
    const facts = await pool.query(`SELECT * FROM operational_fact_feed WHERE fact_type = $1`, [
      OperationalFactType.GoodsReceived,
    ]);
    expect(facts.rowCount).toBe(1);
    expect(facts.rows[0].payload.supplierReceiptId).toBe(draft!.goodsReceiptId);
    expect(facts.rows[0].payload.sourceDocumentLineId).toBe(draft!.lines[0]!.goodsReceiptLineId);

    // Production Intelligence may READ facts; must not mutate Operational Core
    const before = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(before.quantity).toBe('6');
  });

  it('multi-line POST → N line facts, one document (distinct supplierReceiptId)', async () => {
    const draft = await service.createDraft(
      draftBase({
        supplierDocumentNumber: 'MULTI-1',
        lines: [
          milkLine(),
          {
            lineNumber: 2,
            catalogItemId: fx.eggItemId,
            supplierItemId: fx.eggSupplierItemId,
            inputKind: 'COUNT',
            packageCount: 24,
            acceptedBaseQuantity: '24',
            baseUnit: 'ea',
            dimension: 'COUNT',
            unitPriceMinor: '3000',
            lineAcquisitionCostMinor: '72000',
          },
        ],
      }),
    );
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'multi-post-1', actorId: fx.actorId });

    const facts = await pool.query(
      `SELECT payload->>'supplierReceiptId' AS doc_id, payload->>'sourceDocumentLineId' AS line_id
       FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.GoodsReceived],
    );
    expect(facts.rowCount).toBe(2);
    expect(new Set(facts.rows.map((r) => r.doc_id)).size).toBe(1);
    expect(facts.rows[0].doc_id).toBe(draft!.goodsReceiptId);
    expect(new Set(facts.rows.map((r) => r.line_id)).size).toBe(2);

    // Retry must not duplicate line facts
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'multi-post-1', actorId: fx.actorId });
    const afterRetry = await pool.query(`SELECT COUNT(*)::int AS c FROM operational_fact_feed`);
    expect(afterRetry.rows[0].c).toBe(2);
  });

  it('reversal foundation creates compensating OUT and restores balance', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'REV-1' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'rev-post', actorId: fx.actorId });
    const rev = await service.reverse(draft!.goodsReceiptId, {
      idempotencyKey: 'rev-key',
      actorId: fx.actorId,
      reason: 'supplier return',
    });
    expect(rev.status).toBe('created');
    const doc = await service.get(draft!.goodsReceiptId);
    expect(doc!.status).toBe('REVERSED');
    const bal = await service.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(bal.quantity).toBe('0');
    expect(bal.carryingValueMinor).toBe('0');
  });

  it('HTTP API posts milk receipt end-to-end', async () => {
    const app = Fastify();
    await registerGoodsReceiptRoutes(app, pool);
    await app.ready();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      payload: draftBase({ supplierDocumentNumber: 'API-1' }),
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as { goodsReceiptId: string };

    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${body.goodsReceiptId}/post`,
      payload: { idempotencyKey: 'api-post-1', actorId: fx.actorId },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toMatchObject({ status: 'created' });

    const quote = await app.inject({
      method: 'GET',
      url: `/api/v1/costing/quote?legalEntityId=${fx.legalEntityId}&warehouseId=${fx.warehouseId}&catalogItemId=${fx.milkItemId}`,
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json()).toMatchObject({
      quantity: '6',
      costQuote: { amountMinorUnits: '10000', certainty: 'FINAL' },
    });

    await app.close();
  });
});
