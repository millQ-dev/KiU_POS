import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OperationalFactType } from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { RecipesService } from '../recipes/recipes-service.js';
import { IdempotencyConflictError } from './errors.js';
import { OrdersService } from './orders-service.js';
import type { SaleInventoryWriteOffPort } from './sale-write-off-port.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let recipes: RecipesService;
let receipts: GoodsReceiptService;
let goodsIssue: GoodsIssueService;
let milkReceiptSeq = 0;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed,
      audit_record,
      sales_order_completion_reversal,
      goods_issue_reversal,
      goods_issue_line,
      goods_issue,
      consumption_plan_physical_leaf,
      consumption_plan_resolved_version,
      consumption_plan_line,
      consumption_plan_snapshot,
      sales_order_line,
      sales_order,
      catalog_item_recipe_profile,
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

function milkLine(packageCount: number, unitPriceMinor: string) {
  const accepted = String(packageCount);
  const lineAcquisitionCostMinor = String(Number(unitPriceMinor) * packageCount);
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

/** Receive N × 1L milk bottles at unitPriceMinor (packageCount * unitPrice = line cost). */
async function receiveMilkStock(packageCount: number, unitPriceMinor: string) {
  milkReceiptSeq += 1;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `MILK-D13B-${milkReceiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-09-01',
    businessOrder: milkReceiptSeq,
    actorId: fx.actorId,
    lines: [milkLine(packageCount, unitPriceMinor)],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `recv-milk-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
  return draft!.goodsReceiptId;
}

async function receiveOilStock(acceptedLiters: string, unitPriceMinor: string) {
  milkReceiptSeq += 1;
  const lineAcquisitionCostMinor = String(
    Number(unitPriceMinor) * Number(acceptedLiters),
  );
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `OIL-D13B-${milkReceiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-09-01',
    businessOrder: milkReceiptSeq,
    actorId: fx.actorId,
    lines: [
      {
        lineNumber: 1,
        catalogItemId: fx.oilItemId,
        supplierItemId: fx.oilSupplierItemId,
        inputKind: 'FIXED_PACKAGE',
        packageCount: 1,
        acceptedBaseQuantity: acceptedLiters,
        baseUnit: 'L',
        dimension: 'VOLUME',
        unitPriceMinor,
        lineAcquisitionCostMinor,
      },
    ],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `recv-oil-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function receiveFinishedItemStock(
  catalogItemId: string,
  qty: string,
  unit: string,
  dimension: 'MASS' | 'VOLUME' | 'COUNT',
  unitPriceMinor: string,
) {
  const packId = randomUUID();
  const supplierItemId = randomUUID();
  await pool.query(
    `INSERT INTO supplier_pack (
       supplier_pack_id, tenant_id, name, pack_kind, units_per_package,
       unit_quantity, unit, dimension, to_base_unit, factor_per_unit
     ) VALUES ($1,$2,'Finished pack','FIXED',1,'1',$3,$4,$3,'1')`,
    [packId, fx.tenantId, unit, dimension],
  );
  await pool.query(
    `INSERT INTO supplier_item (
       supplier_item_id, supplier_id, catalog_item_id, supplier_pack_id, external_sku, external_name
     ) VALUES ($1,$2,$3,$4,$5,'Finished stock')`,
    [supplierItemId, fx.supplierId, catalogItemId, packId, `FIN-${catalogItemId.slice(0, 8)}`],
  );
  milkReceiptSeq += 1;
  const packageCount = Number(qty);
  const cost = String(Number(unitPriceMinor) * packageCount);
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `FIN-D13B-${milkReceiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-09-01',
    businessOrder: milkReceiptSeq,
    actorId: fx.actorId,
    lines: [
      {
        lineNumber: 1,
        catalogItemId,
        supplierItemId,
        inputKind: 'FIXED_PACKAGE',
        packageCount,
        acceptedBaseQuantity: qty,
        baseUnit: unit,
        dimension,
        unitPriceMinor,
        lineAcquisitionCostMinor: cost,
      },
    ],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `recv-fin-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function openMilkOrder(quantity = '1') {
  const order = await orders.openOrder({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    outletId: fx.outletId,
    actorId: fx.actorId,
  });
  await orders.addOrderLine({
    orderId: order.orderId,
    catalogItemId: fx.milkItemId,
    quantity,
    unit: 'L',
    dimension: 'VOLUME',
  });
  return order;
}

async function countGiOutMovements(orderId?: string) {
  const gi = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM goods_issue`);
  const out = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM inventory_movement
     WHERE source_document_type = 'GoodsIssue' AND direction = 'OUT'`,
  );
  if (orderId) {
    const byOrder = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM goods_issue WHERE source_order_id = $1`,
      [orderId],
    );
    return {
      goodsIssueCount: Number(gi.rows[0]?.c ?? 0),
      outMovementCount: Number(out.rows[0]?.c ?? 0),
      goodsIssueForOrder: Number(byOrder.rows[0]?.c ?? 0),
    };
  }
  return {
    goodsIssueCount: Number(gi.rows[0]?.c ?? 0),
    outMovementCount: Number(out.rows[0]?.c ?? 0),
  };
}

describe('Block D1.3B Sale GoodsIssue via Orders (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    goodsIssue = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: goodsIssue });
    recipes = new RecipesService(pool);
    receipts = new GoodsReceiptService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    milkReceiptSeq = 0;
  });

  it('1 — DIRECT_STOCK CompleteOrder → COMPLETED + GI POSTED + OUT + facts + balance', async () => {
    await receiveMilkStock(10, '10000');
    const before = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(before.quantity).toBe('10');

    const order = await openMilkOrder('2');
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-direct-1',
      businessDate: '2026-09-14',
      businessOrder: 1,
      actorId: fx.actorId,
    });
    expect(result.status).toBe('completed');
    expect(result.order.status).toBe('COMPLETED');
    expect(result.goodsIssueId).toBeTruthy();

    const gi = await pool.query(
      `SELECT posting_status, source_order_id FROM goods_issue WHERE goods_issue_id = $1`,
      [result.goodsIssueId],
    );
    expect(gi.rows[0]).toMatchObject({
      posting_status: 'POSTED',
      source_order_id: order.orderId,
    });

    const mov = await pool.query(
      `SELECT direction, quantity, catalog_item_id, source_document_type
       FROM inventory_movement WHERE source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(mov.rowCount).toBe(1);
    expect(mov.rows[0]).toMatchObject({
      direction: 'OUT',
      quantity: '2',
      catalog_item_id: fx.milkItemId,
      source_document_type: 'GoodsIssue',
    });

    const completed = await pool.query(
      `SELECT payload FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.OrderCompleted],
    );
    expect(completed.rowCount).toBe(1);
    expect(completed.rows[0].payload.orderId).toBe(order.orderId);

    const consumed = await pool.query(
      `SELECT payload FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.InventoryConsumed],
    );
    expect(consumed.rowCount).toBe(1);
    expect(consumed.rows[0].payload.sourceOrderId).toBe(order.orderId);
    expect(consumed.rows[0].payload.stockItemId).toBe(fx.milkItemId);

    const after = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(after.quantity).toBe('8');
  });

  it('2 — VIRTUAL recipe explode → only physical leaves OUT, not sold parent', async () => {
    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Oil drink','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const virtual = await recipes.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Oil blend',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishPreparationVersion(virtual.preparationVersionId);
    const recipe = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Oil drink recipe',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: virtual.preparationVersionId,
          quantity: '0.25',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishRecipeVersion(recipe.recipeVersionId);
    await orders.bindCatalogItemRecipeProfile({
      tenantId: fx.tenantId,
      catalogItemId: dishId,
      recipeSpecificationId: recipe.recipeSpecificationId,
    });

    await receiveOilStock('9', '5000');
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: dishId,
      quantity: '2',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-virtual-1',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });

    const lines = await pool.query(
      `SELECT catalog_item_id, quantity_base FROM goods_issue_line WHERE goods_issue_id = $1`,
      [result.goodsIssueId],
    );
    expect(lines.rowCount).toBe(1);
    expect(lines.rows[0]).toMatchObject({ catalog_item_id: fx.oilItemId, quantity_base: '0.5' });
    expect(lines.rows.every((r) => r.catalog_item_id !== dishId)).toBe(true);

    const dishMov = await pool.query(
      `SELECT COUNT(*)::text AS c FROM inventory_movement WHERE catalog_item_id = $1 AND direction = 'OUT'`,
      [dishId],
    );
    expect(dishMov.rows[0]!.c).toBe('0');
  });

  it('3 — STOCK_TRACKED root → consume finished item only (not recipe ingredients)', async () => {
    const sauceFinishedId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Finished sauce','L','VOLUME')`,
      [sauceFinishedId, fx.tenantId],
    );
    const stock = await recipes.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Stock sauce',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: sauceFinishedId,
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishPreparationVersion(stock.preparationVersionId);

    await receiveFinishedItemStock(sauceFinishedId, '5', 'L', 'VOLUME', '20000');
    await receiveOilStock('9', '5000');

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: sauceFinishedId,
      quantity: '1.5',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-stock-tracked-1',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });

    const lines = await pool.query(
      `SELECT catalog_item_id, quantity_base FROM goods_issue_line WHERE goods_issue_id = $1`,
      [result.goodsIssueId],
    );
    expect(lines.rowCount).toBe(1);
    expect(lines.rows[0]).toMatchObject({
      catalog_item_id: sauceFinishedId,
      quantity_base: '1.5',
    });

    const oilOut = await pool.query(
      `SELECT COUNT(*)::text AS c FROM inventory_movement
       WHERE catalog_item_id = $1 AND direction = 'OUT' AND source_document_type = 'GoodsIssue'`,
      [fx.oilItemId],
    );
    expect(oilOut.rows[0]!.c).toBe('0');
  });

  it('4 — multi-line order issues all physical leaves', async () => {
    await receiveMilkStock(10, '10000');
    await receiveOilStock('9', '5000');
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.oilItemId,
      quantity: '0.5',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-multi-1',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    const lines = await pool.query(
      `SELECT catalog_item_id, quantity_base FROM goods_issue_line
       WHERE goods_issue_id = $1 ORDER BY line_number`,
      [result.goodsIssueId],
    );
    expect(lines.rowCount).toBe(2);
    const byItem = Object.fromEntries(lines.rows.map((r) => [r.catalog_item_id, r.quantity_base]));
    expect(byItem[fx.milkItemId]).toBe('1');
    expect(byItem[fx.oilItemId]).toBe('0.5');
  });

  it('4b — same catalog item on two lines aggregates to one OUT (no ORDER_UNRESOLVED)', async () => {
    await receiveMilkStock(10, '10000');
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '2',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-same-item-1',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    expect(result.status).toBe('completed');

    const lines = await pool.query(
      `SELECT quantity_base, inventory_movement_id FROM goods_issue_line
       WHERE goods_issue_id = $1 ORDER BY line_number`,
      [result.goodsIssueId],
    );
    expect(lines.rowCount).toBe(2);
    expect(lines.rows[0]!.inventory_movement_id).toBe(lines.rows[1]!.inventory_movement_id);

    const outs = await pool.query(
      `SELECT quantity, cost_certainty FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1
         AND catalog_item_id = $2 AND direction = 'OUT'`,
      [result.goodsIssueId, fx.milkItemId],
    );
    expect(outs.rowCount).toBe(1);
    expect(outs.rows[0]!.quantity).toBe('3');
    expect(outs.rows[0]!.cost_certainty).toBe('FINAL');

    const bal = await pool.query(
      `SELECT quantity, carrying_certainty FROM inventory_balance
       WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3`,
      [fx.legalEntityId, fx.warehouseId, fx.milkItemId],
    );
    expect(bal.rows[0]!.quantity).toBe('7');
    expect(bal.rows[0]!.carrying_certainty).toBe('FINAL');
  });

  it('5 — failing write-off port rolls back (OPEN, no GI, no snapshot, no OrderCompleted)', async () => {
    const failingPort: SaleInventoryWriteOffPort = {
      async postGoodsIssueFromConsumptionPlan() {
        throw new Error('simulated inventory failure');
      },
      async reverseGoodsIssueFromOrder() {
        throw new Error('not used');
      },
    };
    const failingOrders = new OrdersService(pool, { saleWriteOffPort: failingPort });
    const order = await failingOrders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await failingOrders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });

    await expect(
      failingOrders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'd13b-fail-1',
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
    ).rejects.toThrow(/simulated inventory failure/);

    const after = await orders.getOrder(order.orderId);
    expect(after.status).toBe('OPEN');
    expect(after.consumptionPlanId).toBeNull();

    const snaps = await pool.query(`SELECT COUNT(*)::text AS c FROM consumption_plan_snapshot`);
    expect(snaps.rows[0]!.c).toBe('0');
    const gi = await pool.query(`SELECT COUNT(*)::text AS c FROM goods_issue`);
    expect(gi.rows[0]!.c).toBe('0');
    const facts = await pool.query(
      `SELECT COUNT(*)::text AS c FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.OrderCompleted],
    );
    expect(facts.rows[0]!.c).toBe('0');
  });

  it('6 — same-key retry → duplicate, zero extra movements', async () => {
    await receiveMilkStock(5, '10000');
    const order = await openMilkOrder('1');
    const first = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-retry-same',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    expect(first.status).toBe('completed');
    const movBefore = await countGiOutMovements(order.orderId);

    const second = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-retry-same',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    expect(second.status).toBe('duplicate');
    const movAfter = await countGiOutMovements(order.orderId);
    expect(movAfter.goodsIssueForOrder).toBe(1);
    expect(movAfter.outMovementCount).toBe(movBefore.outMovementCount);
  });

  it('7 — same-key different semantics → IdempotencyConflictError', async () => {
    await receiveMilkStock(5, '10000');
    const order = await openMilkOrder('1');
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-sem-conflict',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'd13b-sem-conflict',
        businessDate: '2026-09-14',
        businessOrder: 2,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('8 — different key on already COMPLETED → conflict', async () => {
    await receiveMilkStock(5, '10000');
    const order = await openMilkOrder('1');
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-key-a',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'd13b-key-b',
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('9 — concurrent same Order same key → exactly one GI / one COMPLETED', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        orders.completeOrder({
          orderId: order.orderId,
          idempotencyKey: 'd13b-conc-same',
          businessDate: '2026-09-14',
          businessOrder: 1,
        }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      status: string;
    }>[];
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.every((r) => r.value.status === 'completed' || r.value.status === 'duplicate')).toBe(
      true,
    );
    expect(fulfilled.filter((r) => r.value.status === 'completed').length).toBeLessThanOrEqual(1);

    const after = await orders.getOrder(order.orderId);
    expect(after.status).toBe('COMPLETED');
    const counts = await countGiOutMovements(order.orderId);
    expect(counts.goodsIssueForOrder).toBe(1);
    const completedFacts = await pool.query(
      `SELECT COUNT(*)::text AS c FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.OrderCompleted],
    );
    expect(completedFacts.rows[0]!.c).toBe('1');
  });

  it('10 — concurrent same Order different keys → one success one conflict', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    const results = await Promise.allSettled([
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'd13b-conc-a',
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'd13b-conc-b',
        businessDate: '2026-09-14',
        businessOrder: 2,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyConflictError);

    const counts = await countGiOutMovements(order.orderId);
    expect(counts.goodsIssueForOrder).toBe(1);
  });

  it('11 — cost FINAL after receipt; UNKNOWN when no stock history (negative ok)', async () => {
    await receiveMilkStock(6, '10000');
    const priced = await openMilkOrder('1');
    const pricedResult = await orders.completeOrder({
      orderId: priced.orderId,
      idempotencyKey: 'd13b-cost-final',
      businessDate: '2026-09-14',
      businessOrder: 10,
    });
    const pricedLine = await pool.query(
      `SELECT issue_cost_minor, cost_certainty FROM goods_issue_line WHERE goods_issue_id = $1`,
      [pricedResult.goodsIssueId],
    );
    expect(pricedLine.rows[0].cost_certainty).toBe('FINAL');
    expect(pricedLine.rows[0].issue_cost_minor).toBe('10000');

    const oilOrder = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: oilOrder.orderId,
      catalogItemId: fx.oilItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const unknownResult = await orders.completeOrder({
      orderId: oilOrder.orderId,
      idempotencyKey: 'd13b-cost-unknown',
      businessDate: '2026-09-14',
      businessOrder: 11,
    });
    const unknownLine = await pool.query(
      `SELECT issue_cost_minor, cost_certainty FROM goods_issue_line WHERE goods_issue_id = $1`,
      [unknownResult.goodsIssueId],
    );
    expect(unknownLine.rows[0].cost_certainty).toBe('UNKNOWN');
    const oilBal = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.oilItemId);
    expect(Number(oilBal.quantity)).toBeLessThan(0);
  });

  it('12 — backdated businessDate/businessOrder used on movements', async () => {
    await receiveMilkStock(5, '10000');
    const order = await openMilkOrder('1');
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-backdate',
      businessDate: '2026-01-15',
      businessOrder: 7,
    });
    const mov = await pool.query(
      `SELECT business_date::text AS business_date, business_order
       FROM inventory_movement WHERE source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(mov.rows[0].business_date.startsWith('2026-01-15')).toBe(true);
    expect(mov.rows[0].business_order).toBe(7);
    const gi = await pool.query(
      `SELECT business_date::text AS business_date, business_order FROM goods_issue WHERE goods_issue_id = $1`,
      [result.goodsIssueId],
    );
    expect(gi.rows[0].business_date.startsWith('2026-01-15')).toBe(true);
    expect(gi.rows[0].business_order).toBe(7);
  });

  it('13 — historical: recipe change after complete leaves GI lines unchanged', async () => {
    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Milk drink','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const v1 = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Milk drink recipe',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.2',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishRecipeVersion(v1.recipeVersionId);
    await orders.bindCatalogItemRecipeProfile({
      tenantId: fx.tenantId,
      catalogItemId: dishId,
      recipeSpecificationId: v1.recipeSpecificationId,
    });
    await receiveMilkStock(10, '10000');

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: dishId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const result = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-hist-1',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    const beforeLines = await pool.query(
      `SELECT catalog_item_id, quantity_base FROM goods_issue_line WHERE goods_issue_id = $1`,
      [result.goodsIssueId],
    );
    expect(beforeLines.rows[0]).toMatchObject({
      catalog_item_id: fx.milkItemId,
      quantity_base: '0.2',
    });

    const v2 = await recipes.createNextRecipeVersion(v1.recipeSpecificationId);
    await recipes.updateRecipeDraft({
      recipeVersionId: v2.recipeVersionId,
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.9',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishRecipeVersion(v2.recipeVersionId);

    const afterLines = await pool.query(
      `SELECT catalog_item_id, quantity_base FROM goods_issue_line WHERE goods_issue_id = $1`,
      [result.goodsIssueId],
    );
    expect(afterLines.rows).toEqual(beforeLines.rows);
  });

  it('14 — ReverseCompletedOrder: compensating IN, GI REVERSED, Order COMPLETED, fact, balance', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('3');
    const completed = await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-rev-complete',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    const mid = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(mid.quantity).toBe('7');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-rev-1',
      reason: 'guest void',
      actorId: fx.actorId,
    });
    expect(reversed.status).toBe('reversed');

    const gi = await pool.query(
      `SELECT posting_status FROM goods_issue WHERE goods_issue_id = $1`,
      [completed.goodsIssueId],
    );
    expect(gi.rows[0].posting_status).toBe('REVERSED');

    const inMov = await pool.query(
      `SELECT direction, quantity, source_document_type
       FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inMov.rowCount).toBe(1);
    expect(inMov.rows[0]).toMatchObject({
      direction: 'IN',
      quantity: '3',
      source_document_type: 'GoodsIssueReversal',
    });

    const afterOrder = await orders.getOrder(order.orderId);
    expect(afterOrder.status).toBe('COMPLETED');

    const fact = await pool.query(
      `SELECT payload FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.OrderCompletionReversed],
    );
    expect(fact.rowCount).toBe(1);
    expect(fact.rows[0].payload.orderId).toBe(order.orderId);

    const bal = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(bal.quantity).toBe('10');
  });

  it('15 — reverse same-key duplicate; different key ALREADY_REVERSED; concurrent one only', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-rev15-c',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });

    const first = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-rev15-r',
      reason: 'void',
    });
    expect(first.status).toBe('reversed');

    const dup = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-rev15-r',
      reason: 'void',
    });
    expect(dup.status).toBe('duplicate');

    await expect(
      orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'd13b-rev15-other',
        reason: 'void again',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });

    // Concurrent reverse on a fresh completed order
    const order2 = await openMilkOrder('1');
    await orders.completeOrder({
      orderId: order2.orderId,
      idempotencyKey: 'd13b-rev15-c2',
      businessDate: '2026-09-14',
      businessOrder: 2,
    });
    const concurrent = await Promise.allSettled([
      orders.reverseCompletedOrder({
        orderId: order2.orderId,
        idempotencyKey: 'd13b-rev15-conc-a',
        reason: 'a',
      }),
      orders.reverseCompletedOrder({
        orderId: order2.orderId,
        idempotencyKey: 'd13b-rev15-conc-b',
        reason: 'b',
      }),
    ]);
    const ok = concurrent.filter((r) => r.status === 'fulfilled');
    const bad = concurrent.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    const revCount = await pool.query(
      `SELECT COUNT(*)::text AS c FROM goods_issue_reversal WHERE source_order_id = $1`,
      [order2.orderId],
    );
    expect(revCount.rows[0]!.c).toBe('1');
  });

  it('16 — scope: no food_cost / payment / settlement tables used', async () => {
    await receiveMilkStock(3, '10000');
    const order = await openMilkOrder('1');
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd13b-scope',
      businessDate: '2026-09-14',
      businessOrder: 1,
    });
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename ~* '(food_cost|payment|settlement)'`,
    );
    expect(tables.rows).toEqual([]);
  });
});
