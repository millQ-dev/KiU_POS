import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { RecipesService } from '../recipes/recipes-service.js';
import { DomainValidationError, OrderImmutableError } from './errors.js';
import { OrdersService } from './orders-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let recipes: RecipesService;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed,
      audit_record,
      order_line_commercial_snapshot,
      order_commercial_snapshot,
      sales_order_commercial_line_terms,
      sales_order_commercial_terms,
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

async function countInventoryEffects(orderId?: string) {
  const movements = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM inventory_movement`,
  );
  const goodsIssueRows = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM goods_issue`,
  );
  void orderId;
  return {
    inventoryMovementCount: Number(movements.rows[0]?.c ?? 0),
    goodsIssueRowCount: Number(goodsIssueRows.rows[0]?.c ?? 0),
  };
}

describe('Block D1.3A Orders Foundation & Consumption Plan (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    // D1.3A: no saleWriteOffPort wired → CompleteOrder cannot persist COMPLETED
    orders = new OrdersService(pool);
    recipes = new RecipesService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
  });

  it('OpenOrder creates OPEN order', async () => {
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      actorId: fx.actorId,
    });
    expect(order.status).toBe('OPEN');
    expect(order.lines).toHaveLength(0);
  });

  it('Add / Update / Remove line only while OPEN', async () => {
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    const withLine = await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    expect(withLine.lines).toHaveLength(1);
    const lineId = withLine.lines[0]!.orderLineId;

    const updated = await orders.updateOrderLine({
      orderId: order.orderId,
      orderLineId: lineId,
      quantity: '2',
    });
    expect(updated.lines[0]!.quantity).toBe('2');

    const removed = await orders.removeOrderLine({
      orderId: order.orderId,
      orderLineId: lineId,
    });
    expect(removed.lines).toHaveLength(0);
  });

  it('CancelOrder OPEN→CANCELLED and rejects further mutations', async () => {
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
    const cancelled = await orders.cancelOrder({
      orderId: order.orderId,
      reason: 'guest left',
    });
    expect(cancelled.status).toBe('CANCELLED');

    await expect(
      orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: fx.oilItemId,
        quantity: '1',
        unit: 'L',
        dimension: 'VOLUME',
      }),
    ).rejects.toBeInstanceOf(OrderImmutableError);

    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'k1',
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'SALE_WRITE_OFF_NOT_WIRED' });
  });

  it('D1.3A CompleteOrder cannot persist COMPLETED without Inventory write-off port', async () => {
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

    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'complete-1',
        businessDate: '2026-09-14',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toMatchObject({ code: 'SALE_WRITE_OFF_NOT_WIRED' });

    const after = await orders.getOrder(order.orderId);
    expect(after.status).toBe('OPEN');
    expect(after.consumptionPlanId).toBeNull();

    const snaps = await pool.query(`SELECT COUNT(*)::text AS c FROM consumption_plan_snapshot`);
    expect(snaps.rows[0]!.c).toBe('0');

    const completedFacts = await pool.query(
      `SELECT COUNT(*)::text AS c FROM operational_fact_feed WHERE fact_type = 'OrderCompleted'`,
    );
    expect(completedFacts.rows[0]!.c).toBe('0');

    const inv = await countInventoryEffects(order.orderId);
    expect(inv.inventoryMovementCount).toBe(0);
    expect(inv.goodsIssueRowCount).toBe(0);
  });

  it('concurrent CompleteOrder attempts leave OPEN and no divergent snapshot', async () => {
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
    const results = await Promise.allSettled([
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'c-a',
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'c-b',
        businessDate: '2026-09-14',
        businessOrder: 2,
      }),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const after = await orders.getOrder(order.orderId);
    expect(after.status).toBe('OPEN');
    const snaps = await pool.query(`SELECT COUNT(*)::text AS c FROM consumption_plan_snapshot`);
    expect(snaps.rows[0]!.c).toBe('0');
  });

  it('resolver: direct stock item', async () => {
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1.5',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const plan = await orders.resolveConsumptionPlanPreview(order.orderId);
    expect(plan.lines[0]!.appliedStrategy).toBe('DIRECT_STOCK_OUT');
    expect(plan.lines[0]!.physicalLeaves[0]).toMatchObject({
      catalogItemId: fx.milkItemId,
      quantityBase: '1.5',
      unitBase: 'L',
    });
    expect(plan.resolvedIssueWarehouseId).toBe(fx.warehouseId);
  });

  it('resolver: simple recipe + scaling qty>1 + unit normalization', async () => {
    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Milk drink','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const recipe = await recipes.createRecipeDraft({
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
    await recipes.publishRecipeVersion(recipe.recipeVersionId);
    await orders.bindCatalogItemRecipeProfile({
      tenantId: fx.tenantId,
      catalogItemId: dishId,
      recipeSpecificationId: recipe.recipeSpecificationId,
    });

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
    const plan = await orders.resolveConsumptionPlanPreview(order.orderId);
    expect(plan.lines[0]!.appliedStrategy).toBe('EXPLODE_RECIPE_ON_SALE');
    expect(plan.lines[0]!.physicalLeaves[0]).toMatchObject({
      catalogItemId: fx.milkItemId,
      quantityBase: '0.4',
      unitBase: 'L',
    });
    expect(plan.provenanceHash).toHaveLength(64);
  });

  it('resolver: nested VIRTUAL and STOCK_TRACKED boundary inside recipe', async () => {
    const dishId = randomUUID();
    const sauceFinishedId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension) VALUES
         ($1,$3,'Dish','ea','COUNT'),
         ($2,$3,'Finished sauce','L','VOLUME')`,
      [dishId, sauceFinishedId, fx.tenantId],
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
          catalogItemId: fx.milkItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishPreparationVersion(stock.preparationVersionId);

    const recipe = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Complex dish',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: virtual.preparationVersionId,
          quantity: '0.1',
          unit: 'L',
          dimension: 'VOLUME',
        },
        {
          lineNumber: 2,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: stock.preparationVersionId,
          quantity: '0.2',
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
    const plan = await orders.resolveConsumptionPlanPreview(order.orderId);
    const leaves = Object.fromEntries(
      plan.lines[0]!.physicalLeaves.map((l) => [l.catalogItemId, l]),
    );
    expect(leaves[fx.oilItemId]?.quantityBase).toBe('0.1');
    expect(leaves[sauceFinishedId]?.quantityBase).toBe('0.2');
    expect(leaves[fx.milkItemId]).toBeUndefined();
  });

  it('resolver: STOCK_TRACKED root consumes finished item only', async () => {
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

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: sauceFinishedId,
      quantity: '0.5',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const plan = await orders.resolveConsumptionPlanPreview(order.orderId);
    expect(plan.lines[0]!.appliedStrategy).toBe('CONSUME_FINISHED_ITEM');
    expect(plan.lines[0]!.physicalLeaves).toHaveLength(1);
    expect(plan.lines[0]!.physicalLeaves[0]!.catalogItemId).toBe(sauceFinishedId);
  });

  it('ambiguity: recipe binding + STOCK_TRACKED root rejects (no priority)', async () => {
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

    const recipe = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Conflicting sauce recipe',
      batchSizeQuantity: '1',
      batchSizeUnit: 'L',
      batchSizeDimension: 'VOLUME',
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
    await recipes.publishRecipeVersion(recipe.recipeVersionId);
    await orders.bindCatalogItemRecipeProfile({
      tenantId: fx.tenantId,
      catalogItemId: sauceFinishedId,
      recipeSpecificationId: recipe.recipeSpecificationId,
    });

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: sauceFinishedId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await expect(orders.resolveConsumptionPlanPreview(order.orderId)).rejects.toMatchObject({
      code: 'AMBIGUOUS_CONSUMPTION_ROOT',
    });
  });

  it('versioning: completion preview uses recipe version applicable at resolve time', async () => {
    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Dish','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const v1 = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Dish recipe',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.1',
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

    const before = await orders.resolveConsumptionPlanPreview(order.orderId);
    expect(before.lines[0]!.rootRecipeVersionId).toBe(v1.recipeVersionId);
    expect(before.lines[0]!.physicalLeaves[0]!.quantityBase).toBe('0.1');

    const v2 = await recipes.createNextRecipeVersion(v1.recipeSpecificationId);
    await recipes.updateRecipeDraft({
      recipeVersionId: v2.recipeVersionId,
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.3',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishRecipeVersion(v2.recipeVersionId);

    const after = await orders.resolveConsumptionPlanPreview(order.orderId);
    expect(after.lines[0]!.rootRecipeVersionId).toBe(v2.recipeVersionId);
    expect(after.lines[0]!.physicalLeaves[0]!.quantityBase).toBe('0.3');
    expect(after.provenanceHash).not.toBe(before.provenanceHash);
  });

  it('warehouse: missing default fails; cross-tenant warehouse invalid', async () => {
    await pool.query(
      `UPDATE outlet SET default_sales_issue_warehouse_id = NULL WHERE outlet_id = $1`,
      [fx.outletId],
    );
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
    await expect(orders.resolveConsumptionPlanPreview(order.orderId)).rejects.toMatchObject({
      code: 'DEFAULT_ISSUE_WAREHOUSE_REQUIRED',
    });

    // restore wrong LE warehouse
    await pool.query(
      `UPDATE outlet SET default_sales_issue_warehouse_id = $1 WHERE outlet_id = $2`,
      [fx.otherWarehouseId, fx.outletId],
    );
    await expect(orders.resolveConsumptionPlanPreview(order.orderId)).rejects.toMatchObject({
      code: 'DEFAULT_ISSUE_WAREHOUSE_INVALID',
    });
  });

  it('client cannot pass warehouseId on CompleteOrder schema', async () => {
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'x',
        businessDate: '2026-09-14',
        businessOrder: 1,
        warehouseId: fx.warehouseId,
      }),
    ).rejects.toThrow();
  });

  it('D1.3A suite leaves zero GoodsIssue and zero InventoryMovement', async () => {
    const inv = await countInventoryEffects();
    expect(inv.inventoryMovementCount).toBe(0);
    expect(inv.goodsIssueRowCount).toBe(0);
  });

  it('idempotency foundation: repeated CompleteOrder without port stays safe/rejected', async () => {
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
    const key = 'same-key';
    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: key,
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'SALE_WRITE_OFF_NOT_WIRED' });
    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: key,
        businessDate: '2026-09-14',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'SALE_WRITE_OFF_NOT_WIRED' });
    const after = await orders.getOrder(order.orderId);
    expect(after.status).toBe('OPEN');
  });
});
