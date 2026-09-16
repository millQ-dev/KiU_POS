import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { RecipesService } from '../recipes/recipes-service.js';
import { ActualCogsService } from './actual-cogs-service.js';
import { OperatingEconomicsService } from './operating-economics-service.js';
import { FOOD_COST_RATIO_DECIMAL_PLACES } from './operating-economics-types.js';
import { RevenueBasisService } from './revenue-basis-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let recipes: RecipesService;
let receipts: GoodsReceiptService;
let economics: OperatingEconomicsService;
let revenue: RevenueBasisService;
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

async function receiveMilkStock(packageCount: number, unitPriceMinor: string) {
  receiptSeq += 1;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `MILK-OE-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-01-01',
    businessOrder: receiptSeq,
    actorId: fx.actorId,
    lines: [
      {
        lineNumber: 1,
        catalogItemId: fx.milkItemId,
        supplierItemId: fx.milkSupplierItemId,
        inputKind: 'FIXED_PACKAGE',
        packageCount,
        acceptedBaseQuantity: String(packageCount),
        baseUnit: 'L',
        dimension: 'VOLUME',
        unitPriceMinor,
        lineAcquisitionCostMinor: String(Number(unitPriceMinor) * packageCount),
      },
    ],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `recv-oe-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function openMilkOrder(qty = '1', channel = 'DIRECT') {
  const order = await orders.openOrder({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    outletId: fx.outletId,
    channel,
    actorId: fx.actorId,
  });
  await orders.addOrderLine({
    orderId: order.orderId,
    catalogItemId: fx.milkItemId,
    quantity: qty,
    unit: 'L',
    dimension: 'VOLUME',
  });
  return orders.getOrder(order.orderId);
}

async function completePriced(
  orderId: string,
  opts: {
    idempotencyKey: string;
    businessDate: string;
    businessOrder: number;
    businessTime?: string;
    commercial?: Parameters<typeof acceptFinalMerchandiseTerms>[2];
  },
) {
  await acceptFinalMerchandiseTerms(orders, orderId, {
    defaultGrossMinor: '100000',
    ...opts.commercial,
    idempotencyKey: opts.commercial?.idempotencyKey ?? `commercial:${opts.idempotencyKey}`,
  });
  return orders.completeOrder({
    orderId,
    idempotencyKey: opts.idempotencyKey,
    businessDate: opts.businessDate,
    businessOrder: opts.businessOrder,
    businessTime: opts.businessTime,
    actorId: fx.actorId,
  });
}

/** Simulate incomplete commercial coverage: COGS exists, Revenue snapshot removed. */
async function stripCommercialSnapshot(orderId: string) {
  await pool.query(
    `UPDATE sales_order SET order_commercial_snapshot_id = NULL WHERE order_id = $1`,
    [orderId],
  );
  await pool.query(
    `DELETE FROM order_line_commercial_snapshot
     WHERE order_commercial_snapshot_id IN (
       SELECT order_commercial_snapshot_id FROM order_commercial_snapshot WHERE order_id = $1
     )`,
    [orderId],
  );
  await pool.query(`DELETE FROM order_commercial_snapshot WHERE order_id = $1`, [orderId]);
}

describe('Block D1.4D Food Cost Ratio & Operational Gross Profit (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const goodsIssue = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: goodsIssue });
    recipes = new RecipesService(pool);
    receipts = new GoodsReceiptService(pool);
    revenue = new RevenueBasisService(pool);
    cogs = new ActualCogsService(pool);
    economics = new OperatingEconomicsService(revenue, cogs);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
  });

  it('1-6 — FINAL Food Cost + OGP; ratio fraction; precision; GP subtraction', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('3.5');
    await completePriced(order.orderId, {
      idempotencyKey: 'oe-1',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });

    const r = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(r.revenue.revenueBasisMinor).toBe('100000');
    expect(r.cogs.actualCogsMinor).toBe('35000');
    expect(r.foodCostRatioStatus).toBe('AVAILABLE');
    expect(r.foodCostRatio).toBe('0.35');
    expect(r.foodCostRatioCertainty).toBe('FINAL');
    expect(r.operationalGrossProfitStatus).toBe('AVAILABLE');
    expect(r.operationalGrossProfitMinor).toBe('65000');
    expect(r.operationalGrossProfitCertainty).toBe('FINAL');
    expect(r.numeratorActualCogsMinor).toBe('35000');
    expect(r.denominatorRevenueBasisMinor).toBe('100000');
    // not inverse, not percent integer
    expect(r.foodCostRatio).not.toBe('2.85714286');
    expect(r.foodCostRatio).not.toBe('35');
    expect(FOOD_COST_RATIO_DECIMAL_PLACES).toBe(8);

    const third = economics.derive(
      baseQuery(),
      {
        currencyCode: 'VND',
        minorUnitExponent: 0,
        revenueBasisMinor: '3',
        knownSubtotalMinor: '3',
        certainty: 'FINAL',
        componentCount: 1,
        finalComponentCount: 1,
        unknownComponentCount: 0,
      },
      {
        currencyCode: 'VND',
        minorUnitExponent: 0,
        actualCogsMinor: '1',
        knownSubtotalMinor: '1',
        certainty: 'FINAL',
        componentCount: 1,
        finalComponentCount: 1,
        estimatedComponentCount: 0,
        unknownComponentCount: 0,
        unresolvedComponentCount: 0,
      },
      1,
      false,
      [],
    );
    expect(third.foodCostRatio).toBe('0.33333333');
  });

  it('7-10 — multi-line Revenue; multi-leaf COGS; no Revenue multiplication', async () => {
    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Drink','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const recipe = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Drink recipe',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.5',
          unit: 'L',
          dimension: 'VOLUME',
        },
        {
          lineNumber: 2,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '0.1',
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
    await receiveMilkStock(10, '10000');
    receiptSeq += 1;
    const oilDraft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `OIL-OE-${receiptSeq}`,
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
          acceptedBaseQuantity: '9',
          baseUnit: 'L',
          dimension: 'VOLUME',
          unitPriceMinor: '10000',
          lineAcquisitionCostMinor: '90000',
        },
      ],
    });
    await receipts.post(oilDraft!.goodsReceiptId, {
      idempotencyKey: `recv-oil-${oilDraft!.goodsReceiptId}`,
      actorId: fx.actorId,
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
    await acceptFinalMerchandiseTerms(orders, order.orderId, {
      grossByCatalogItemId: { [dishId]: '100000' },
      idempotencyKey: 'oe-dish',
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'oe-dish-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const revLines = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(revLines).toHaveLength(1);
    const cogsLines = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(cogsLines.length).toBeGreaterThan(1);

    const r = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(r.revenue.revenueBasisMinor).toBe('100000');
    expect(r.revenue.componentCount).toBe(1);
    expect(Number(r.cogs.actualCogsMinor)).toBeGreaterThan(0);
    expect(r.foodCostRatioStatus).toBe('AVAILABLE');
    expect(r.operationalGrossProfitStatus).toBe('AVAILABLE');
  });

  it('11-13 — line/order discounts change denominator; no reallocation', async () => {
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
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const full = await orders.getOrder(order.orderId);
    const sorted = [...full.lines].sort((a, b) => a.lineNumber - b.lineNumber);
    await orders.setOrderCommercialTerms({
      orderId: order.orderId,
      idempotencyKey: 'oe-disc',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '10',
      lineTerms: [
        {
          orderLineId: sorted[0]!.orderLineId,
          grossMerchandiseMinor: '100',
          lineMerchantFundedDiscountMinor: '20',
        },
        { orderLineId: sorted[1]!.orderLineId, grossMerchandiseMinor: '200' },
      ],
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'oe-disc-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const snap = await orders.getCommercialSnapshot(order.orderId);
    const r = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(r.denominatorRevenueBasisMinor).toBe(snap!.netMerchandiseSalesMinor);
    expect(r.foodCostRatioStatus).toBe('AVAILABLE');
  });

  it('14-17 — compliment: Food Cost UNAVAILABLE ZERO_REVENUE_BASIS; GP negative', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await orders.setOrderCommercialTerms({
      orderId: order.orderId,
      idempotencyKey: 'oe-comp',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [
        {
          orderLineId: order.lines[0]!.orderLineId,
          grossMerchandiseMinor: '50000',
          lineMerchantFundedDiscountMinor: '50000',
        },
      ],
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'oe-comp-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const r = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(r.revenue.revenueBasisMinor).toBe('0');
    expect(r.revenue.certainty).toBe('FINAL');
    expect(r.cogs.actualCogsMinor).toBe('10000');
    expect(r.foodCostRatioStatus).toBe('UNAVAILABLE');
    expect(r.foodCostRatio).toBeNull();
    expect(r.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');
    expect(r.operationalGrossProfitStatus).toBe('AVAILABLE');
    expect(r.operationalGrossProfitMinor).toBe('-10000');
  });

  it('18-22 — third-party funding; tax/tip/non-merch/customerPayable excluded from denominator', async () => {
    await receiveMilkStock(5, '10000');
    const order = await openMilkOrder('1');
    await orders.setOrderCommercialTerms({
      orderId: order.orderId,
      idempotencyKey: 'oe-3p',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      taxMinor: '8000',
      tipMinor: '5000',
      nonMerchandiseChargesMinor: '15000',
      customerPayableMinor: '128000',
      lineTerms: [
        {
          orderLineId: order.lines[0]!.orderLineId,
          grossMerchandiseMinor: '100',
          thirdPartyMerchandiseFundingMinor: '20',
        },
      ],
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'oe-3p-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const r = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(r.denominatorRevenueBasisMinor).toBe('120');
    expect(r.denominatorRevenueBasisMinor).not.toBe('128000');
  });

  it('23-30 — UNKNOWN/UNRESOLVED unavailable; ESTIMATED numeric; known subtotals visible', async () => {
    await receiveMilkStock(5, '10000');
    const unkRev = await openMilkOrder('1');
    await orders.setOrderCommercialTerms({
      orderId: unkRev.orderId,
      idempotencyKey: 'oe-unk-r',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'UNKNOWN',
      commercialResolution: 'tax unavailable',
      lineTerms: [{ orderLineId: unkRev.lines[0]!.orderLineId, grossMerchandiseMinor: '100' }],
    });
    await orders.completeOrder({
      orderId: unkRev.orderId,
      idempotencyKey: 'oe-unk-r-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const rUnkRev = await economics.compute(baseQuery({ orderId: unkRev.orderId }));
    expect(rUnkRev.foodCostRatioStatus).toBe('UNAVAILABLE');
    expect(rUnkRev.operationalGrossProfitStatus).toBe('UNAVAILABLE');
    expect(rUnkRev.foodCostRatioUnavailableReasons).toContain('REVENUE_UNKNOWN');
    expect(rUnkRev.revenue.knownSubtotalMinor).toBeDefined();

    // UNKNOWN COGS (no prior stock)
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    const unkCogs = await openMilkOrder('1');
    await completePriced(unkCogs.orderId, {
      idempotencyKey: 'oe-unk-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '50000' },
    });
    const rUnkCogs = await economics.compute(baseQuery({ orderId: unkCogs.orderId }));
    expect(rUnkCogs.foodCostRatioUnavailableReasons).toContain('COGS_UNKNOWN');
    expect(rUnkCogs.operationalGrossProfitUnavailableReasons).toContain('COGS_UNKNOWN');
    expect(rUnkCogs.cogs.knownSubtotalMinor).toBe('0');

    // ESTIMATED COGS via oversell
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(1, '10000');
    const est1 = await openMilkOrder('1');
    await completePriced(est1.orderId, {
      idempotencyKey: 'oe-est-1',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    const est2 = await openMilkOrder('1');
    await completePriced(est2.orderId, {
      idempotencyKey: 'oe-est-2',
      businessDate: '2026-03-10',
      businessOrder: 2,
      commercial: { defaultGrossMinor: '100000' },
    });
    const rEst = await economics.compute(baseQuery({ orderId: est2.orderId }));
    expect(rEst.cogs.certainty).toBe('ESTIMATED_FROM_LAST_KNOWN');
    expect(rEst.foodCostRatioStatus).toBe('AVAILABLE');
    expect(rEst.foodCostRatioCertainty).toBe('ESTIMATED_FROM_LAST_KNOWN');
    expect(rEst.operationalGrossProfitStatus).toBe('AVAILABLE');
    expect(rEst.operationalGrossProfitCertainty).toBe('ESTIMATED_FROM_LAST_KNOWN');

    // ORDER_UNRESOLVED: two independent same-position sales
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const a = await openMilkOrder('1');
    await completePriced(a.orderId, {
      idempotencyKey: 'oe-ur-a',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '50000' },
    });
    const b = await openMilkOrder('1');
    await completePriced(b.orderId, {
      idempotencyKey: 'oe-ur-b',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '50000' },
    });
    const rUr = await economics.compute(baseQuery({ businessDate: '2026-03-10' }));
    expect(rUr.foodCostRatioUnavailableReasons).toContain('COGS_ORDER_UNRESOLVED');
    expect(rUr.operationalGrossProfitUnavailableReasons).toContain('COGS_ORDER_UNRESOLVED');
  });

  it('31-35 — currency match/mismatch; preserve multi-currency rejection', async () => {
    await receiveMilkStock(5, '10000');
    const order = await openMilkOrder('1');
    await completePriced(order.orderId, {
      idempotencyKey: 'oe-cur',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000', currencyCode: 'VND' },
    });
    const ok = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(ok.currencyCode).toBe('VND');
    expect(ok.foodCostRatioStatus).toBe('AVAILABLE');

    const mismatch = economics.derive(
      baseQuery(),
      {
        currencyCode: 'VND',
        minorUnitExponent: 0,
        revenueBasisMinor: '100',
        knownSubtotalMinor: '100',
        certainty: 'FINAL',
        componentCount: 1,
        finalComponentCount: 1,
        unknownComponentCount: 0,
      },
      {
        currencyCode: 'USD',
        minorUnitExponent: 2,
        actualCogsMinor: '10',
        knownSubtotalMinor: '10',
        certainty: 'FINAL',
        componentCount: 1,
        finalComponentCount: 1,
        estimatedComponentCount: 0,
        unknownComponentCount: 0,
        unresolvedComponentCount: 0,
      },
      1,
      false,
      [],
    );
    expect(mismatch.foodCostRatioUnavailableReasons).toContain('CURRENCY_MISMATCH');
    expect(mismatch.operationalGrossProfitUnavailableReasons).toContain('CURRENCY_MISMATCH');
    expect(mismatch.revenue.revenueBasisMinor).toBe('100');
    expect(mismatch.cogs.actualCogsMinor).toBe('10');

    expect(() =>
      revenue.aggregateEffects([
        {
          signedRevenueBasisMinor: '1',
          revenueCertainty: 'FINAL',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        },
        {
          signedRevenueBasisMinor: '1',
          revenueCertainty: 'FINAL',
          currencyCode: 'USD',
          minorUnitExponent: 2,
        },
      ]),
    ).toThrow(DomainValidationError);
    expect(() =>
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
      ]),
    ).toThrow(DomainValidationError);
  });

  it('36-38 — Revenue without COGS effects → exact zero COGS', async () => {
    // Stock exists but we sell with commercial terms and then... actually milk sale always has COGS.
    // Use derive for pure asymmetric case, plus a complimentary-already-tested path.
    // Force zero COGS by querying a sold CatalogItem that has revenue but filter physical mismatch —
    // Better: unit derive.
    const r = economics.derive(
      baseQuery({ currencyCode: 'VND' }),
      {
        currencyCode: 'VND',
        minorUnitExponent: 0,
        revenueBasisMinor: '80000',
        knownSubtotalMinor: '80000',
        certainty: 'FINAL',
        componentCount: 1,
        finalComponentCount: 1,
        unknownComponentCount: 0,
      },
      {
        currencyCode: 'VND',
        minorUnitExponent: 0,
        actualCogsMinor: '0',
        knownSubtotalMinor: '0',
        certainty: 'FINAL',
        componentCount: 0,
        finalComponentCount: 0,
        estimatedComponentCount: 0,
        unknownComponentCount: 0,
        unresolvedComponentCount: 0,
      },
      0,
      false,
      [],
    );
    expect(r.foodCostRatio).toBe('0');
    expect(r.operationalGrossProfitMinor).toBe('80000');
    expect(r.foodCostRatioStatus).toBe('AVAILABLE');
  });

  it('39-41 — COGS without Revenue snapshot → REVENUE_COVERAGE_GAP (never fake Revenue 0)', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await completePriced(order.orderId, {
      idempotencyKey: 'oe-gap',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    await stripCommercialSnapshot(order.orderId);

    const r = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(r.hasRevenueCoverageGap).toBe(true);
    expect(r.coverageGaps.length).toBeGreaterThan(0);
    expect(r.foodCostRatioUnavailableReasons).toContain('REVENUE_COVERAGE_GAP');
    expect(r.operationalGrossProfitUnavailableReasons).toContain('REVENUE_COVERAGE_GAP');
    expect(r.foodCostRatio).toBeNull();
    expect(r.operationalGrossProfitMinor).toBeNull();
    expect(r.cogs.actualCogsMinor).toBe('10000');
    // Must NOT look like compliment (Revenue FINAL 0 → GP -10000)
    expect(r.operationalGrossProfitMinor).not.toBe('-10000');
    expect(r.revenue.componentCount).toBe(0);
  });

  it('42-43 — empty both sides currency handling', async () => {
    const noCur = await economics.compute(baseQuery({ businessDate: '2099-01-01' }));
    expect(noCur.currencyCode).toBeNull();
    expect(noCur.foodCostRatioStatus).toBe('UNAVAILABLE');
    expect(noCur.operationalGrossProfitStatus).toBe('UNAVAILABLE');
    expect(noCur.foodCostRatioUnavailableReasons).toContain('NO_CURRENCY_CONTEXT');

    const withCur = await economics.compute(
      baseQuery({ businessDate: '2099-01-01', currencyCode: 'VND' }),
    );
    expect(withCur.currencyCode).toBe('VND');
    expect(withCur.operationalGrossProfitMinor).toBe('0');
    expect(withCur.operationalGrossProfitStatus).toBe('AVAILABLE');
    expect(withCur.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');
  });

  it('44-55 — reversals: later, same-position, backdated; signed math; zero denominator', async () => {
    await receiveMilkStock(20, '10000');
    const order = await openMilkOrder('3.5');
    await completePriced(order.orderId, {
      idempotencyKey: 'oe-rev',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });

    const saleDay = await economics.compute(baseQuery({ businessDate: '2026-03-10' }));
    expect(saleDay.foodCostRatio).toBe('0.35');
    expect(saleDay.operationalGrossProfitMinor).toBe('65000');

    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'oe-rev-r',
      businessDate: '2026-03-15',
      businessOrder: 1,
      reason: 'later',
      actorId: fx.actorId,
    });

    const revDay = await economics.compute(baseQuery({ businessDate: '2026-03-15' }));
    expect(revDay.revenue.revenueBasisMinor).toBe('-100000');
    expect(revDay.cogs.actualCogsMinor).toBe('-35000');
    expect(revDay.foodCostRatio).toBe('0.35');
    expect(revDay.operationalGrossProfitMinor).toBe('-65000');

    const both = await economics.compute(
      baseQuery({ businessDateFrom: '2026-03-10', businessDateTo: '2026-03-15' }),
    );
    expect(both.revenue.revenueBasisMinor).toBe('0');
    expect(both.cogs.actualCogsMinor).toBe('0');
    expect(both.operationalGrossProfitMinor).toBe('0');
    expect(both.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');

    // Same-position
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const o2 = await openMilkOrder('1');
    await completePriced(o2.orderId, {
      idempotencyKey: 'oe-same',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    await orders.reverseCompletedOrder({
      orderId: o2.orderId,
      idempotencyKey: 'oe-same-r',
      businessDate: '2026-03-10',
      businessOrder: 1,
      reason: 'same position',
      actorId: fx.actorId,
    });
    expect(await revenue.listLineEffects(baseQuery({ orderId: o2.orderId }))).toHaveLength(2);
    expect(await cogs.listLineEffects(baseQuery({ orderId: o2.orderId }))).toHaveLength(2);
    const same = await economics.compute(baseQuery({ orderId: o2.orderId }));
    expect(same.revenue.revenueBasisMinor).toBe('0');
    expect(same.cogs.actualCogsMinor).toBe('0');
    expect(same.operationalGrossProfitMinor).toBe('0');
    expect(same.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');

    // Backdated — reversed_at ≠ business date
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const o3 = await openMilkOrder('1');
    await completePriced(o3.orderId, {
      idempotencyKey: 'oe-back',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    const rev = await orders.reverseCompletedOrder({
      orderId: o3.orderId,
      idempotencyKey: 'oe-back-r',
      businessDate: '2026-03-05',
      businessOrder: 1,
      reason: 'backdated',
      actorId: fx.actorId,
    });
    const row = await pool.query<{ reversed_at: Date }>(
      `SELECT reversed_at FROM sales_order_completion_reversal WHERE sales_order_completion_reversal_id = $1`,
      [rev.reversalId],
    );
    expect(new Date(row.rows[0]!.reversed_at).toISOString().slice(0, 10)).not.toBe('2026-03-05');
    const back = await economics.compute(baseQuery({ businessDate: '2026-03-05' }));
    expect(back.revenue.revenueBasisMinor).toBe('-100000');
    expect(back.cogs.actualCogsMinor).toBe('-10000');
  });

  it('56-59 — historical stability after config mutation', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await completePriced(order.orderId, {
      idempotencyKey: 'oe-hist',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    const before = await economics.compute(baseQuery({ orderId: order.orderId }));
    await pool.query(
      `UPDATE sales_order_commercial_line_terms SET gross_merchandise_minor = '1' WHERE order_id = $1`,
      [order.orderId],
    );
    await pool.query(`UPDATE catalog_item SET name = 'Mutated' WHERE catalog_item_id = $1`, [
      fx.milkItemId,
    ]);
    const after = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(after.foodCostRatio).toBe(before.foodCostRatio);
    expect(after.operationalGrossProfitMinor).toBe(before.operationalGrossProfitMinor);
  });

  it('60-66 — tenant/legal/outlet/order/line/catalog/channel isolation', async () => {
    await receiveMilkStock(20, '10000');
    const direct = await openMilkOrder('1', 'DIRECT');
    await completePriced(direct.orderId, {
      idempotencyKey: 'oe-d',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    const delivery = await openMilkOrder('1', 'DELIVERY');
    await completePriced(delivery.orderId, {
      idempotencyKey: 'oe-del',
      businessDate: '2026-03-11',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '200000' },
    });

    expect((await economics.compute(baseQuery({ channel: 'DELIVERY' }))).denominatorRevenueBasisMinor).toBe(
      '200000',
    );
    expect((await economics.compute(baseQuery({ orderId: direct.orderId }))).denominatorRevenueBasisMinor).toBe(
      '100000',
    );
    expect(
      (await economics.compute(baseQuery({ orderLineId: direct.lines[0]!.orderLineId })))
        .denominatorRevenueBasisMinor,
    ).toBe('100000');
    expect(
      (await economics.compute(baseQuery({ soldCatalogItemId: fx.milkItemId, businessDate: '2026-03-10' })))
        .denominatorRevenueBasisMinor,
    ).toBe('100000');
    expect((await economics.compute(baseQuery({ outletId: fx.outletId }))).revenue.componentCount).toBe(2);
    expect(
      (await economics.compute({ tenantId: randomUUID() })).revenue.componentCount,
    ).toBe(0);
  });

  it('67-69 — period aggregation = SUM COGS / SUM Revenue (not average of ratios)', async () => {
    await receiveMilkStock(20, '10000');
    const o1 = await openMilkOrder('1');
    await completePriced(o1.orderId, {
      idempotencyKey: 'oe-p1',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    const o2 = await openMilkOrder('2');
    await completePriced(o2.orderId, {
      idempotencyKey: 'oe-p2',
      businessDate: '2026-03-10',
      businessOrder: 2,
      commercial: { defaultGrossMinor: '100000' },
    });
    // ratios: 10000/100000=0.1 and 20000/100000=0.2; average would be 0.15
    // aggregate: 30000/200000 = 0.15 coincidentally same — use different amounts
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(30, '10000');
    const a = await openMilkOrder('1');
    await completePriced(a.orderId, {
      idempotencyKey: 'oe-pa',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '100000' },
    });
    const b = await openMilkOrder('1');
    await completePriced(b.orderId, {
      idempotencyKey: 'oe-pb',
      businessDate: '2026-03-10',
      businessOrder: 2,
      commercial: { defaultGrossMinor: '300000' },
    });
    // line ratios: 0.1 and 10000/300000≈0.03333333; average ≈ 0.06666667
    // period: 20000/400000 = 0.05
    const period = await economics.compute(baseQuery({ businessDate: '2026-03-10' }));
    expect(period.numeratorActualCogsMinor).toBe('20000');
    expect(period.denominatorRevenueBasisMinor).toBe('400000');
    expect(period.foodCostRatio).toBe('0.05');
    expect(period.foodCostRatio).not.toBe('0.06666667');
  });

  it('70-72 — D1.4A / D1.4B / D1.4C regression smoke', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('2');
    await completePriced(order.orderId, {
      idempotencyKey: 'oe-reg',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '90000' },
    });
    const cogsAgg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(cogsAgg.actualCogsMinor).toBe('20000');
    const revAgg = await revenue.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(revAgg.revenueBasisMinor).toBe('90000');
    const snap = await orders.getCommercialSnapshot(order.orderId);
    expect(snap!.netMerchandiseSalesMinor).toBe('90000');
    const oe = await economics.compute(baseQuery({ orderId: order.orderId }));
    expect(oe.foodCostRatio).toBe('0.22222222');
    expect(oe.operationalGrossProfitMinor).toBe('70000');
  });
});
