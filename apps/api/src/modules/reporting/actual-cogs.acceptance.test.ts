import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js'
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { RecipesService } from '../recipes/recipes-service.js';
import { ActualCogsService } from './actual-cogs-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let recipes: RecipesService;
let receipts: GoodsReceiptService;
let cogs: ActualCogsService;
let receiptSeq = 0;

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

function baseQuery(extra: Record<string, unknown> = {}) {
  return {
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    ...extra,
  };
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

async function receiveMilkStock(
  packageCount: number,
  unitPriceMinor: string,
  opts?: { businessDate?: string; businessOrder?: number; warehouseId?: string },
) {
  receiptSeq += 1;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: opts?.warehouseId ?? fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `MILK-COGS-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: opts?.businessDate ?? '2026-01-01',
    businessOrder: opts?.businessOrder ?? receiptSeq,
    actorId: fx.actorId,
    lines: [milkLine(packageCount, unitPriceMinor)],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `recv-milk-cogs-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
  return draft!.goodsReceiptId;
}

async function receiveOilStock(acceptedLiters: string, unitPriceMinor: string) {
  receiptSeq += 1;
  const lineAcquisitionCostMinor = String(
    Number(unitPriceMinor) * Number(acceptedLiters),
  );
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `OIL-COGS-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-01-01',
    businessOrder: receiptSeq,
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
    idempotencyKey: `recv-oil-cogs-${draft!.goodsReceiptId}`,
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
  receiptSeq += 1;
  const packageCount = Number(qty);
  const cost = String(Number(unitPriceMinor) * packageCount);
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `FIN-COGS-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-01-01',
    businessOrder: receiptSeq,
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
    idempotencyKey: `recv-fin-cogs-${draft!.goodsReceiptId}`,
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

async function completeMilkSale(
  quantity: string,
  businessDate: string,
  businessOrder: number,
  idempotencyKey: string,
) {
  const order = await openMilkOrder(quantity);
  const result = await completeOrderWithCommercial({
    orderId: order.orderId,
    idempotencyKey,
    businessDate,
    businessOrder,
    actorId: fx.actorId,
  });
  return { order, result };
}

async function bindMilkDishRecipe(qtyPerEa = '0.2') {
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
        quantity: qtyPerEa,
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
  return { dishId, recipe };
}


async function completeOrderWithCommercial(raw: {
  orderId: string;
  idempotencyKey: string;
  businessDate: string;
  businessOrder: number;
  actorId?: string;
}) {
  const current = await orders.getOrder(raw.orderId);
  if (current.status === 'OPEN') {
    await acceptFinalMerchandiseTerms(orders, raw.orderId, {
      defaultGrossMinor: '0',
      idempotencyKey: `commercial:${raw.idempotencyKey}`,
    });
  }
  return orders.completeOrder(raw);
}

describe('Block D1.4A Actual COGS read model (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const goodsIssue = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: goodsIssue });
    recipes = new RecipesService(pool);
    receipts = new GoodsReceiptService(pool);
    cogs = new ActualCogsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
  });

  it('1+19 — FINAL direct stock sale: aggregate exact + drill-down IDs (#39)', async () => {
    await receiveMilkStock(10, '10000');
    const { order, result } = await completeMilkSale('2', '2026-03-10', 1, 'cogs-1-final');

    const lines = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      effectType: 'SALE',
      soldCatalogItemId: fx.milkItemId,
      physicalCatalogItemId: fx.milkItemId,
      signedActualCogsMinor: '20000',
      costCertainty: 'FINAL',
      orderId: order.orderId,
      goodsIssueId: result.goodsIssueId,
      outletId: fx.outletId,
      warehouseId: fx.warehouseId,
    });
    expect(lines[0]!.orderLineId).toBeTruthy();
    expect(lines[0]!.goodsIssueLineId).toBeTruthy();
    expect(lines[0]!.inventoryMovementId).toBeTruthy();

    const agg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(agg).toMatchObject({
      actualCogsMinor: '20000',
      knownSubtotalMinor: '20000',
      certainty: 'FINAL',
      finalComponentCount: 1,
      unknownComponentCount: 0,
    });

    const phys = await cogs.aggregateByPhysicalMovement(baseQuery({ orderId: order.orderId }));
    expect(phys.actualCogsMinor).toBe('20000');
  });

  it('2 — VIRTUAL recipe: sold under dish, physical under milk', async () => {
    const { dishId } = await bindMilkDishRecipe('0.25');
    await receiveMilkStock(10, '10000');

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
    await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-2-virtual',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const bySold = await cogs.listLineEffects(baseQuery({ soldCatalogItemId: dishId }));
    expect(bySold).toHaveLength(1);
    expect(bySold[0]!.soldCatalogItemId).toBe(dishId);
    expect(bySold[0]!.physicalCatalogItemId).toBe(fx.milkItemId);
    expect(bySold[0]!.signedActualCogsMinor).toBe('5000'); // 0.5 L × 10000

    const byPhysical = await cogs.listPhysicalEffects(
      baseQuery({ physicalCatalogItemId: fx.milkItemId }),
    );
    expect(byPhysical).toHaveLength(1);
    expect(byPhysical[0]!.physicalCatalogItemId).toBe(fx.milkItemId);
    expect(byPhysical[0]!.signedActualCogsMinor).toBe('5000');

    const noDishPhysical = await cogs.listPhysicalEffects(
      baseQuery({ physicalCatalogItemId: dishId }),
    );
    expect(noDishPhysical).toHaveLength(0);
  });

  it('4 — STOCK_TRACKED finished item: physical under finished stock, not oil leaf', async () => {
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
    await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-4-stock-tracked',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const lines = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.physicalCatalogItemId).toBe(sauceFinishedId);
    expect(lines[0]!.signedActualCogsMinor).toBe('30000');

    const oilPhys = await cogs.listPhysicalEffects(
      baseQuery({ physicalCatalogItemId: fx.oilItemId }),
    );
    expect(oilPhys).toHaveLength(0);
  });

  it('5+9-12 — multi-line order: Order / OrderLine / sold / physical filters', async () => {
    await receiveMilkStock(10, '10000');
    await receiveOilStock('9', '5000');
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    const afterMilk = await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const milkOrderLineId = afterMilk.lines.find(
      (l: { catalogItemId: string }) => l.catalogItemId === fx.milkItemId,
    )!.orderLineId;
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.oilItemId,
      quantity: '0.5',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-5-multi',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const byOrder = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(byOrder.actualCogsMinor).toBe('12500'); // 10000 + 0.5*5000
    expect(byOrder.componentCount).toBe(2);

    const byLine = await cogs.listLineEffects(
      baseQuery({ orderId: order.orderId, orderLineId: milkOrderLineId }),
    );
    expect(byLine).toHaveLength(1);
    expect(byLine[0]!.soldCatalogItemId).toBe(fx.milkItemId);
    expect(byLine[0]!.signedActualCogsMinor).toBe('10000');

    const soldMilk = await cogs.aggregateByLine(
      baseQuery({ soldCatalogItemId: fx.milkItemId }),
    );
    expect(soldMilk.actualCogsMinor).toBe('10000');

    const physOil = await cogs.aggregateByPhysicalMovement(
      baseQuery({ physicalCatalogItemId: fx.oilItemId }),
    );
    expect(physOil.actualCogsMinor).toBe('2500');
  });

  it('7+8 — CRITICAL: shared physical movement not double-counted; allocations sum', async () => {
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
    const result = await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-7-shared',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const lineEffects = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lineEffects).toHaveLength(2);
    expect(lineEffects[0]!.inventoryMovementId).toBe(lineEffects[1]!.inventoryMovementId);
    const lineSum = lineEffects.reduce(
      (acc, e) => acc + Number(e.signedActualCogsMinor),
      0,
    );
    expect(lineSum).toBe(30000);

    const physEffects = await cogs.listPhysicalEffects(baseQuery({ orderId: order.orderId }));
    expect(physEffects).toHaveLength(1);
    expect(physEffects[0]!.effectType).toBe('SALE');
    expect(physEffects[0]!.goodsIssueId).toBe(result.goodsIssueId);
    expect(physEffects[0]!.signedActualCogsMinor).toBe('30000');
    expect(physEffects[0]!.signedQuantity).toBe('3');

    // Explicit double-count check: line aggregate equals physical (not 2× movement).
    const byLine = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    const byPhys = await cogs.aggregateByPhysicalMovement(baseQuery({ orderId: order.orderId }));
    expect(byLine.actualCogsMinor).toBe('30000');
    expect(byPhys.actualCogsMinor).toBe('30000');
    expect(byLine.componentCount).toBe(2);
    expect(byPhys.componentCount).toBe(1);

    const mov = await pool.query<{ acquisition_cost_minor: string }>(
      `SELECT acquisition_cost_minor FROM inventory_movement WHERE movement_id = $1`,
      [physEffects[0]!.inventoryMovementId],
    );
    expect(mov.rows[0]!.acquisition_cost_minor).toBe('30000');
    expect(String(lineSum)).toBe(mov.rows[0]!.acquisition_cost_minor);
  });

  it('13-16 — outlet / day / period / warehouse filters', async () => {
    await receiveMilkStock(20, '10000');
    await completeMilkSale('1', '2026-03-10', 1, 'cogs-day-a');
    await completeMilkSale('2', '2026-03-11', 1, 'cogs-day-b');
    await completeMilkSale('1', '2026-03-12', 1, 'cogs-day-c');

    const day = await cogs.aggregateByLine(baseQuery({ businessDate: '2026-03-11' }));
    expect(day.actualCogsMinor).toBe('20000');
    expect(day.componentCount).toBe(1);

    const period = await cogs.aggregateByLine(
      baseQuery({ businessDateFrom: '2026-03-10', businessDateTo: '2026-03-11' }),
    );
    expect(period.actualCogsMinor).toBe('30000');
    expect(period.componentCount).toBe(2);

    const outletOk = await cogs.listLineEffects(baseQuery({ outletId: fx.outletId }));
    expect(outletOk.length).toBeGreaterThanOrEqual(3);

    const outletEmpty = await cogs.listLineEffects(
      baseQuery({ outletId: randomUUID() }),
    );
    expect(outletEmpty).toHaveLength(0);

    const whOk = await cogs.listLineEffects(baseQuery({ warehouseId: fx.warehouseId }));
    expect(whOk.length).toBeGreaterThanOrEqual(3);

    const whEmpty = await cogs.listLineEffects(
      baseQuery({ warehouseId: fx.otherWarehouseId }),
    );
    expect(whEmpty).toHaveLength(0);
  });

  it('17-18 — tenant / wrong LE isolation → empty', async () => {
    await receiveMilkStock(5, '10000');
    await completeMilkSale('1', '2026-03-10', 1, 'cogs-iso');

    const wrongLe = await cogs.listLineEffects({
      tenantId: fx.tenantId,
      legalEntityId: fx.otherLegalEntityId,
    });
    expect(wrongLe).toHaveLength(0);

    const wrongTenant = await cogs.listLineEffects({
      tenantId: randomUUID(),
      legalEntityId: fx.legalEntityId,
    });
    expect(wrongTenant).toHaveLength(0);

    const ok = await cogs.aggregateByLine(baseQuery());
    expect(ok.actualCogsMinor).toBe('10000');
  });

  it('20 — FINAL + ESTIMATED_FROM_LAST_KNOWN when overselling after depletion', async () => {
    await receiveMilkStock(1, '10000');
    await completeMilkSale('1', '2026-03-10', 1, 'cogs-20-final');
    const { order } = await completeMilkSale('1', '2026-03-10', 2, 'cogs-20-est');

    const effects = await cogs.listLineEffects(baseQuery());
    const certainties = effects.map((e) => e.costCertainty).sort();
    expect(certainties).toContain('FINAL');
    expect(certainties).toContain('ESTIMATED_FROM_LAST_KNOWN');

    const agg = await cogs.aggregateByLine(baseQuery());
    expect(agg.certainty).toBe('ESTIMATED_FROM_LAST_KNOWN');
    expect(agg.finalComponentCount).toBe(1);
    expect(agg.estimatedComponentCount).toBe(1);
    expect(agg.actualCogsMinor).toBe('20000'); // both known amounts
    expect(agg.knownSubtotalMinor).toBe('20000');

    const estOnly = await cogs.listLineEffects(
      baseQuery({ orderId: order.orderId, certainty: 'ESTIMATED_FROM_LAST_KNOWN' }),
    );
    expect(estOnly).toHaveLength(1);
  });

  it('21 — UNKNOWN: no prior stock → actualCogsMinor null, never fabricate exact zero', async () => {
    const order = await openMilkOrder('1');
    await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-21-unknown',
      businessDate: '2026-03-10',
      businessOrder: 1,
      actorId: fx.actorId,
    });

    const effects = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(effects).toHaveLength(1);
    expect(effects[0]!.costCertainty).toBe('UNKNOWN');

    const agg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(agg.certainty).toBe('UNKNOWN');
    expect(agg.actualCogsMinor).toBeNull();
    expect(agg.unknownComponentCount).toBe(1);
    // knownSubtotal excludes UNKNOWN — must not treat as exact zero
    expect(agg.knownSubtotalMinor).toBe('0');
  });

  it('22 — legitimate FINAL zero-cost receipt then sale', async () => {
    await receiveMilkStock(5, '0');
    const { order } = await completeMilkSale('1', '2026-03-10', 1, 'cogs-22-zero');

    const effects = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(effects[0]!.costCertainty).toBe('FINAL');
    expect(effects[0]!.signedActualCogsMinor).toBe('0');

    const agg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(agg.actualCogsMinor).toBe('0');
    expect(agg.certainty).toBe('FINAL');
    expect(agg.unknownComponentCount).toBe(0);
  });

  it('23-24 — ORDER_UNRESOLVED precedence via aggregateEffects (unit-style)', async () => {
    const mixed = cogs.aggregateEffects([
      {
        signedActualCogsMinor: '100',
        costCertainty: 'FINAL',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      },
      {
        signedActualCogsMinor: '50',
        costCertainty: 'UNKNOWN',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      },
      {
        signedActualCogsMinor: '25',
        costCertainty: 'ORDER_UNRESOLVED',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      },
    ]);
    expect(mixed.certainty).toBe('ORDER_UNRESOLVED');
    expect(mixed.actualCogsMinor).toBeNull();
    expect(mixed.knownSubtotalMinor).toBe('100');
    expect(mixed.unresolvedComponentCount).toBe(1);
    expect(mixed.unknownComponentCount).toBe(1);

    // Also: two independent same-position sales → ORDER_UNRESOLVED (not exact FINAL).
    await receiveMilkStock(10, '10000');
    await completeMilkSale('1', '2026-03-10', 1, 'cogs-24-a');
    await completeMilkSale('1', '2026-03-10', 1, 'cogs-24-b');
    const effects = await cogs.listLineEffects(baseQuery({ businessDate: '2026-03-10' }));
    expect(effects.length).toBeGreaterThanOrEqual(2);
    expect(effects.every((e) => e.costCertainty === 'ORDER_UNRESOLVED')).toBe(true);
    const dayAgg = await cogs.aggregateByLine(baseQuery({ businessDate: '2026-03-10' }));
    expect(dayAgg.certainty).toBe('ORDER_UNRESOLVED');
    expect(dayAgg.actualCogsMinor).toBeNull();
    expect(dayAgg.unresolvedComponentCount).toBeGreaterThanOrEqual(2);
  });

  it('25-27 — sale+reversal periods: same net~0, A/B split, reversal-only negative', async () => {
    await receiveMilkStock(10, '10000');
    const { order } = await completeMilkSale('2', '2026-03-10', 1, 'cogs-25-sale');

    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'cogs-25-rev',
      businessDate: '2026-03-10',
      businessOrder: 2,
      reason: 'same period',
      actorId: fx.actorId,
    });

    const samePeriod = await cogs.listLineEffects(baseQuery({ businessDate: '2026-03-10' }));
    expect(samePeriod.map((e) => e.effectType)).toEqual(['SALE', 'REVERSAL']);
    const sameAgg = await cogs.aggregateByLine(baseQuery({ businessDate: '2026-03-10' }));
    expect(sameAgg.actualCogsMinor).toBe('0');
    expect(sameAgg.componentCount).toBe(2);

    // Period A sale / period B reverse
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const saleB = await completeMilkSale('3', '2026-03-10', 1, 'cogs-26-sale');
    await orders.reverseCompletedOrder({
      orderId: saleB.order.orderId,
      idempotencyKey: 'cogs-26-rev',
      businessDate: '2026-03-15',
      businessOrder: 1,
      reason: 'later period',
      actorId: fx.actorId,
    });

    const periodA = await cogs.aggregateByLine(baseQuery({ businessDate: '2026-03-10' }));
    expect(periodA.actualCogsMinor).toBe('30000');
    const periodB = await cogs.aggregateByLine(baseQuery({ businessDate: '2026-03-15' }));
    expect(periodB.actualCogsMinor).toBe('-30000');
    expect(periodB.componentCount).toBe(1);
    expect(periodB.certainty).toBe('FINAL');

    const both = await cogs.aggregateByLine(
      baseQuery({ businessDateFrom: '2026-03-10', businessDateTo: '2026-03-15' }),
    );
    expect(both.actualCogsMinor).toBe('0');
  });

  it('28 — same-position linked reverse stays FINAL (not ORDER_UNRESOLVED from link alone)', async () => {
    await receiveMilkStock(10, '10000');
    const { order } = await completeMilkSale('1', '2026-03-10', 1, 'cogs-28-sale');
    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'cogs-28-rev',
      businessDate: '2026-03-10',
      businessOrder: 1,
      reason: 'same position link',
      actorId: fx.actorId,
    });

    const effects = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(effects).toHaveLength(2);
    // ADR-0003 / ADR-0027: primary SALE then linked REVERSAL at shared business position
    expect(effects.map((e) => e.effectType)).toEqual(['SALE', 'REVERSAL']);
    expect(effects.every((e) => e.costCertainty === 'FINAL')).toBe(true);
    const agg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(agg.certainty).toBe('FINAL');
    expect(agg.unresolvedComponentCount).toBe(0);
    expect(agg.actualCogsMinor).toBe('0');
  });

  it('30-32 — backdated reverse: businessDate ≠ reversed_at; amount equals original', async () => {
    await receiveMilkStock(10, '10000');
    const { order, result } = await completeMilkSale('2', '2026-03-10', 1, 'cogs-30-sale');

    const outCost = await pool.query<{ acquisition_cost_minor: string }>(
      `SELECT acquisition_cost_minor FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(outCost.rows[0]!.acquisition_cost_minor).toBe('20000');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'cogs-30-rev',
      businessDate: '2026-03-05',
      businessOrder: 1,
      reason: 'backdated',
      actorId: fx.actorId,
    });

    const gir = await pool.query<{
      business_date: string;
      reversed_at: Date;
    }>(
      `SELECT business_date::text AS business_date, reversed_at
       FROM goods_issue_reversal WHERE goods_issue_reversal_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(gir.rows[0]!.business_date.startsWith('2026-03-05')).toBe(true);
    const reversedAtIso = new Date(gir.rows[0]!.reversed_at).toISOString().slice(0, 10);
    expect(reversedAtIso).not.toBe('2026-03-05');

    const revEffects = await cogs.listLineEffects(baseQuery({ businessDate: '2026-03-05' }));
    expect(revEffects).toHaveLength(1);
    expect(revEffects[0]!.effectType).toBe('REVERSAL');
    expect(revEffects[0]!.signedActualCogsMinor).toBe('-20000');
    expect(revEffects[0]!.goodsIssueReversalId).toBe(reversed.goodsIssueReversalId);

    const physRev = await cogs.listPhysicalEffects(baseQuery({ businessDate: '2026-03-05' }));
    expect(physRev[0]!.signedActualCogsMinor).toBe('-20000');

    // Physical grain + soldCatalogItemId must still include REVERSAL (IN ≠ OUT movement id)
    const physSold = await cogs.listPhysicalEffects(
      baseQuery({ soldCatalogItemId: fx.milkItemId, businessDateFrom: '2026-03-05', businessDateTo: '2026-03-10' }),
    );
    expect(physSold.map((e) => e.effectType).sort()).toEqual(['REVERSAL', 'SALE']);
    const physSoldAgg = await cogs.aggregateByPhysicalMovement(
      baseQuery({ soldCatalogItemId: fx.milkItemId, businessDateFrom: '2026-03-05', businessDateTo: '2026-03-10' }),
    );
    expect(physSoldAgg.actualCogsMinor).toBe('0');
  });

  it('33-34 — recipe change after sale does not change Actual COGS', async () => {
    const { dishId, recipe } = await bindMilkDishRecipe('0.2');
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
    await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-33-sale',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const before = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(before.actualCogsMinor).toBe('2000');

    const v2 = await recipes.createNextRecipeVersion(recipe.recipeSpecificationId);
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

    const after = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(after).toEqual(before);
    const lines = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines[0]!.signedQuantity).toBe('0.2');
  });

  it('3+6 — nested VIRTUAL recipe + quantity scaling (no re-explode after sale)', async () => {
    const sauceBase = await recipes.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Sauce base nested',
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
          quantity: '0.4',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await recipes.publishPreparationVersion(sauceBase.preparationVersionId);

    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Nested dish','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const recipe = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Nested dish recipe',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: sauceBase.preparationVersionId,
          quantity: '0.5',
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

    await receiveOilStock('9', '10000');
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
    await completeOrderWithCommercial({
      orderId: order.orderId,
      idempotencyKey: 'cogs-3-nested',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const lines = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.soldCatalogItemId).toBe(dishId);
    expect(lines[0]!.physicalCatalogItemId).toBe(fx.oilItemId);
    // 2 ea × 0.5 L sauce × 0.4 L oil / L sauce = 0.4 L oil × 10000 = 4000
    expect(lines[0]!.signedActualCogsMinor).toBe('4000');
    expect(lines[0]!.signedQuantity).toBe('0.4');
  });

  it('35 — default warehouse change after sale does not move historical COGS warehouse', async () => {
    await receiveMilkStock(10, '10000');
    const { order } = await completeMilkSale('1', '2026-03-10', 1, 'cogs-35-sale');
    const before = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(before[0]!.warehouseId).toBe(fx.warehouseId);

    const otherWh = randomUUID();
    await pool.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name)
       VALUES ($1,$2,$3,$4,'Other WH')`,
      [otherWh, fx.tenantId, fx.legalEntityId, fx.outletId],
    );
    await pool.query(
      `UPDATE outlet SET default_sales_issue_warehouse_id = $1 WHERE outlet_id = $2`,
      [otherWh, fx.outletId],
    );

    const after = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(after).toEqual(before);
    expect(after[0]!.warehouseId).toBe(fx.warehouseId);
    expect(after[0]!.warehouseId).not.toBe(otherWh);
  });

  it('36 — insertion-order independence: query twice → same result', async () => {
    await receiveMilkStock(10, '10000');
    await completeMilkSale('1', '2026-03-10', 1, 'cogs-36-a');
    await completeMilkSale('2', '2026-03-11', 1, 'cogs-36-b');

    const a = await cogs.listLineEffects(baseQuery());
    const b = await cogs.listLineEffects(baseQuery());
    expect(b).toEqual(a);

    const aggA = await cogs.aggregateByPhysicalMovement(baseQuery());
    const aggB = await cogs.aggregateByPhysicalMovement(baseQuery());
    expect(aggB).toEqual(aggA);
  });

  it('38 — multi currency via aggregateEffects → MULTI_CURRENCY_NOT_AGGREGATABLE', () => {
    expect(() =>
      cogs.aggregateEffects([
        {
          signedActualCogsMinor: '100',
          costCertainty: 'FINAL',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        },
        {
          signedActualCogsMinor: '10',
          costCertainty: 'FINAL',
          currencyCode: 'USD',
          minorUnitExponent: 2,
        },
      ]),
    ).toThrow(DomainValidationError);

    try {
      cogs.aggregateEffects([
        {
          signedActualCogsMinor: '1',
          costCertainty: 'FINAL',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        },
        {
          signedActualCogsMinor: '1',
          costCertainty: 'FINAL',
          currencyCode: 'USD',
          minorUnitExponent: 2,
        },
      ]);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainValidationError);
      expect((e as DomainValidationError).code).toBe('MULTI_CURRENCY_NOT_AGGREGATABLE');
    }
  });

  it('41 — foodCostRatioUnavailable throws FOOD_COST_RATIO_UNAVAILABLE', () => {
    expect(() => cogs.foodCostRatioUnavailable()).toThrow(DomainValidationError);
    try {
      cogs.foodCostRatioUnavailable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainValidationError);
      expect((e as DomainValidationError).code).toBe('FOOD_COST_RATIO_UNAVAILABLE');
    }
  });
});
