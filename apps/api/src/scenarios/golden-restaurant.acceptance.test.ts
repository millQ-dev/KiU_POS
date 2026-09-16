/**
 * PERMANENT GOLDEN RESTAURANT TORTURE TEST (GOLDEN-1).
 * DO NOT DELETE OR REDUCE COVERAGE TO MAKE CI GREEN.
 * Unsupported future semantics must remain explicit DEFERRED markers.
 *
 * Cross-module continuity gate — not a rename of existing unit suites.
 * Manifest: docs/processes/golden-restaurant-scenario.md
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OperationalFactType } from '@millq/contracts';
import { allocateOrderMerchantDiscount, parseCanonicalDecimal, toCanonicalDecimal } from '@millq/domain';
import { runMigrations } from '../db/migrate.js';
import { acceptFinalMerchandiseTerms, setOrderCommercialTermsWithRounding } from '../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { GoodsIssueService } from '../modules/inventory/goods-issue-service.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import type { SaleInventoryWriteOffPort } from '../modules/orders/sale-write-off-port.js';
import { GoodsReceiptService } from '../modules/procurement/goods-receipt-service.js';
import { ProductionBatchService } from '../modules/production/production-batch-service.js';
import { ProductionPostingService } from '../modules/production/production-posting-service.js';
import { RecipesService } from '../modules/recipes/recipes-service.js';
import { ActualCogsService } from '../modules/reporting/actual-cogs-service.js';
import { OperatingEconomicsService } from '../modules/reporting/operating-economics-service.js';
import { RevenueBasisService } from '../modules/reporting/revenue-basis-service.js';
import {
  buildMenuResolvedCommercialTermsInput,
  MenuResolver,
  MenuService,
} from '../modules/menu/index.js';
import {
  LayoutService,
  PosSelectionService,
  PosSurfaceResolver,
} from '../modules/pos/index.js';
import { BaseCommercialAcceptanceService } from '../modules/commercial-rounding/base-commercial-acceptance.js';
import { CommercialRoundingPolicyService } from '../modules/commercial-rounding/rounding-policy-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

/** Fixed business dates — never wall-clock. */
const DAY = {
  PROCURE_1: '2026-03-01',
  PROCURE_2: '2026-03-02',
  PRODUCE: '2026-03-05',
  SALE: '2026-03-10',
  REVERSE_LATER: '2026-03-15',
  REVERSE_BACK: '2026-03-04',
} as const;

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let recipes: RecipesService;
let receipts: GoodsReceiptService;
let batches: ProductionBatchService;
let posting: ProductionPostingService;
let revenue: RevenueBasisService;
let cogs: ActualCogsService;
let economics: OperatingEconomicsService;
let receiptSeq = 0;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed, audit_record,
      order_line_commercial_snapshot, order_commercial_snapshot,
      sales_order_commercial_line_terms, sales_order_commercial_terms,
      sales_order_completion_reversal, goods_issue_reversal,
      goods_issue_line, goods_issue,
      consumption_plan_physical_leaf, consumption_plan_resolved_version,
      consumption_plan_line, consumption_plan_snapshot,
      sales_order_line, sales_order, catalog_item_recipe_profile,
      inventory_balance, inventory_movement,
      goods_receipt_line, goods_receipt,
      production_batch_reversal, production_batch_input, production_batch,
      recipe_component, recipe_version, recipe_specification,
      preparation_component, preparation_version, preparation_specification,
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function nameGoldenRestaurant() {
  await pool.query(`UPDATE tenant SET name = 'Golden Hospitality' WHERE tenant_id = $1`, [fx.tenantId]);
  await pool.query(`UPDATE legal_entity SET name = 'Golden Restaurant Vietnam' WHERE legal_entity_id = $1`, [
    fx.legalEntityId,
  ]);
  await pool.query(`UPDATE outlet SET name = 'Golden Restaurant — Torture Branch' WHERE outlet_id = $1`, [
    fx.outletId,
  ]);
}

function q(extra: Record<string, unknown> = {}) {
  return { tenantId: fx.tenantId, legalEntityId: fx.legalEntityId, ...extra };
}

async function receiveMilk(liters: number, unitPriceMinor: string, businessDate: string, businessOrder: number) {
  receiptSeq += 1;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `GOLDEN-MILK-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate,
    businessOrder,
    actorId: fx.actorId,
    lines: [
      {
        lineNumber: 1,
        catalogItemId: fx.milkItemId,
        supplierItemId: fx.milkSupplierItemId,
        inputKind: 'FIXED_PACKAGE',
        packageCount: liters,
        acceptedBaseQuantity: String(liters),
        baseUnit: 'L',
        dimension: 'VOLUME',
        unitPriceMinor,
        lineAcquisitionCostMinor: String(Number(unitPriceMinor) * liters),
      },
    ],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `golden-recv-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function receiveOilCase(unitPricePerLiter: string, businessDate: string, businessOrder: number) {
  receiptSeq += 1;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `GOLDEN-OIL-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate,
    businessOrder,
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
        unitPriceMinor: unitPricePerLiter,
        lineAcquisitionCostMinor: String(Number(unitPricePerLiter) * 9),
      },
    ],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `golden-oil-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function receiveMeatKg(qtyKg: string, unitPriceMinor: string, businessDate: string, businessOrder: number) {
  receiptSeq += 1;
  const cost = String(Number(unitPriceMinor) * Number(qtyKg));
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `GOLDEN-MEAT-${receiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate,
    businessOrder,
    actorId: fx.actorId,
    lines: [
      {
        lineNumber: 1,
        catalogItemId: fx.meatItemId,
        supplierItemId: fx.meatSupplierItemId,
        inputKind: 'VARIABLE_WEIGHT',
        packageCount: 1,
        acceptedBaseQuantity: qtyKg,
        baseUnit: 'kg',
        dimension: 'MASS',
        unitPriceMinor,
        lineAcquisitionCostMinor: cost,
      },
    ],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `golden-meat-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function balance(catalogItemId: string) {
  const r = await pool.query<{ quantity: string; carrying_value_minor: string }>(
    `SELECT quantity, carrying_value_minor FROM inventory_balance
     WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3`,
    [fx.legalEntityId, fx.warehouseId, catalogItemId],
  );
  return r.rows[0] ?? null;
}

describe('GOLDEN-1 — Golden Restaurant Scenario / Torture Test (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const gi = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: gi });
    recipes = new RecipesService(pool);
    receipts = new GoodsReceiptService(pool);
    batches = new ProductionBatchService(pool);
    posting = new ProductionPostingService(pool);
    revenue = new RevenueBasisService(pool);
    cogs = new ActualCogsService(pool);
    economics = new OperatingEconomicsService(revenue, cogs);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    await nameGoldenRestaurant();
    receiptSeq = 0;
  });

  describe('MAIN DAY — procurement → production → order → economics → later reversal', () => {
    it('PROCUREMENT — dual milk receipts change moving-average; oil + meat stocked', async () => {
      await receiveMilk(10, '10000', DAY.PROCURE_1, 1);
      let bal = await balance(fx.milkItemId);
      expect(bal!.quantity).toBe('10');
      expect(bal!.carrying_value_minor).toBe('100000');

      await receiveMilk(10, '20000', DAY.PROCURE_2, 1);
      bal = await balance(fx.milkItemId);
      expect(bal!.quantity).toBe('20');
      expect(bal!.carrying_value_minor).toBe('300000'); // MA unit = 15000

      await receiveOilCase('5000', DAY.PROCURE_1, 2);
      await receiveMeatKg('20', '5000', DAY.PROCURE_1, 3);
      expect((await balance(fx.oilItemId))!.quantity).toBe('9');
      expect((await balance(fx.meatItemId))!.quantity).toBe('20');

      const movDates = await pool.query<{ business_date: string }>(
        `SELECT to_char(business_date, 'YYYY-MM-DD') AS business_date FROM inventory_movement
         WHERE catalog_item_id = $1 ORDER BY business_date, business_order`,
        [fx.milkItemId],
      );
      expect(movDates.rows[0]!.business_date).toBe(DAY.PROCURE_1);
      expect(movDates.rows[1]!.business_date).toBe(DAY.PROCURE_2);
    });

    it('PRODUCTION — STOCK_TRACKED dough with yield ≠ plan; VIRTUAL recipe published', async () => {
      await receiveMeatKg('20', '5000', DAY.PROCURE_1, 1);
      const doughId = randomUUID();
      await pool.query(
        `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
         VALUES ($1,$2,'Golden Dough','kg','MASS')`,
        [doughId, fx.tenantId],
      );
      const prepDraft = await recipes.createPreparationDraft({
        tenantId: fx.tenantId,
        name: 'Golden Dough Prep',
        materializationMode: 'STOCK_TRACKED',
        outputCatalogItemId: doughId,
        normativeInputQuantity: '10',
        normativeInputUnit: 'kg',
        normativeInputDimension: 'MASS',
        normativeOutputQuantity: '8',
        normativeOutputUnit: 'kg',
        normativeOutputDimension: 'MASS',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.meatItemId,
            quantity: '10',
            unit: 'kg',
            dimension: 'MASS',
          },
        ],
      });
      const prep = await recipes.publishPreparationVersion(prepDraft.preparationVersionId);

      // Ugly yield: planned 8, actual 7; actual input still 10
      const draft = await batches.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        actualInputQuantity: '10',
        actualInputUnit: 'kg',
        actualInputDimension: 'MASS',
        actualOutputQuantity: '7',
        actualOutputUnit: 'kg',
        actualOutputDimension: 'MASS',
        deviationClass: 'NORMAL',
        actorId: fx.actorId,
        inputActuals: [
          { lineNumber: 1, actualQuantity: '10', actualUnit: 'kg', actualDimension: 'MASS' },
        ],
      });
      await batches.finalize({
        productionBatchId: draft.productionBatchId,
        idempotencyKey: `golden-fin-${draft.productionBatchId}`,
        actorId: fx.actorId,
      });
      await posting.post({
        productionBatchId: draft.productionBatchId,
        idempotencyKey: `golden-post-${draft.productionBatchId}`,
        currencyCode: 'VND',
        minorUnitExponent: 0,
        businessDate: DAY.PRODUCE,
        businessOrder: 1,
        actorId: fx.actorId,
      });

      const doughBal = await balance(doughId);
      expect(doughBal!.quantity).toBe('7');
      // 10 kg meat @ 5000 = 50000 transferred to 7 kg dough
      expect(doughBal!.carrying_value_minor).toBe('50000');
      expect((await balance(fx.meatItemId))!.quantity).toBe('10');

      const outs = await pool.query(
        `SELECT COUNT(*)::int AS c FROM inventory_movement
         WHERE source_document_type = 'ProductionBatch' AND direction = 'OUT'`,
      );
      const ins = await pool.query(
        `SELECT COUNT(*)::int AS c FROM inventory_movement
         WHERE source_document_type = 'ProductionBatch' AND direction = 'IN'`,
      );
      expect(outs.rows[0]!.c).toBe(1);
      expect(ins.rows[0]!.c).toBe(1);
    });

    it('ORDER+COMMERCIAL+COMPLETE+ECONOMICS+REVERSAL — full restaurant day fingerprint', async () => {
      // Rebuild procurement + production inline for isolation (vitest order not guaranteed across files)
      await receiveMilk(10, '10000', DAY.PROCURE_1, 1);
      await receiveMilk(10, '20000', DAY.PROCURE_2, 1);
      await receiveOilCase('5000', DAY.PROCURE_1, 2);
      await receiveMeatKg('20', '5000', DAY.PROCURE_1, 3);

      const doughId = randomUUID();
      await pool.query(
        `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
         VALUES ($1,$2,'Golden Dough','kg','MASS')`,
        [doughId, fx.tenantId],
      );
      const prepDraft = await recipes.createPreparationDraft({
        tenantId: fx.tenantId,
        name: 'Golden Dough Prep',
        materializationMode: 'STOCK_TRACKED',
        outputCatalogItemId: doughId,
        normativeInputQuantity: '10',
        normativeInputUnit: 'kg',
        normativeInputDimension: 'MASS',
        normativeOutputQuantity: '8',
        normativeOutputUnit: 'kg',
        normativeOutputDimension: 'MASS',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.meatItemId,
            quantity: '10',
            unit: 'kg',
            dimension: 'MASS',
          },
        ],
      });
      const prep = await recipes.publishPreparationVersion(prepDraft.preparationVersionId);
      const batchDraft = await batches.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        actualInputQuantity: '10',
        actualInputUnit: 'kg',
        actualInputDimension: 'MASS',
        actualOutputQuantity: '7',
        actualOutputUnit: 'kg',
        actualOutputDimension: 'MASS',
        deviationClass: 'NORMAL',
        actorId: fx.actorId,
        inputActuals: [
          { lineNumber: 1, actualQuantity: '10', actualUnit: 'kg', actualDimension: 'MASS' },
        ],
      });
      await batches.finalize({
        productionBatchId: batchDraft.productionBatchId,
        idempotencyKey: `g-fin-${batchDraft.productionBatchId}`,
        actorId: fx.actorId,
      });
      await posting.post({
        productionBatchId: batchDraft.productionBatchId,
        idempotencyKey: `g-post-${batchDraft.productionBatchId}`,
        currencyCode: 'VND',
        minorUnitExponent: 0,
        businessDate: DAY.PRODUCE,
        businessOrder: 1,
        actorId: fx.actorId,
      });

      const drinkId = randomUUID();
      await pool.query(
        `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
         VALUES ($1,$2,'Golden Milk Drink','ea','COUNT')`,
        [drinkId, fx.tenantId],
      );
      const recipe = await recipes.createRecipeDraft({
        tenantId: fx.tenantId,
        name: 'Golden Drink',
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
        catalogItemId: drinkId,
        recipeSpecificationId: recipe.recipeSpecificationId,
      });

      // --- OPEN ORDER with three sold strategies ---
      const order = await orders.openOrder({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
        actorId: fx.actorId,
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
        catalogItemId: drinkId,
        quantity: '1',
        unit: 'ea',
        dimension: 'COUNT',
      });
      await orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: doughId,
        quantity: '1',
        unit: 'kg',
        dimension: 'MASS',
      });

      // Quantity mutation while OPEN
      let full = await orders.getOrder(order.orderId);
      const milkLine = full.lines.find((l) => l.catalogItemId === fx.milkItemId)!;
      await acceptFinalMerchandiseTerms(orders, order.orderId, {
        defaultGrossMinor: '1000',
        idempotencyKey: 'golden-stale-terms',
      });
      await orders.updateOrderLine({
        orderId: order.orderId,
        orderLineId: milkLine.orderLineId,
        quantity: '2',
      });
      await expect(
        orders.completeOrder({
          orderId: order.orderId,
          idempotencyKey: 'golden-stale-complete',
          businessDate: DAY.SALE,
          businessOrder: 1,
        }),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_TERMS_REQUIRED' });

      // Re-accept after mutation — commercial torture
      full = await orders.getOrder(order.orderId);
      const byCatalog = (id: string) => full.lines.find((l) => l.catalogItemId === id)!;
      const lineMilk = byCatalog(fx.milkItemId);
      const lineDrink = byCatalog(drinkId);
      const lineDough = byCatalog(doughId);

      // Order discount 7 across eligible bases after line discounts
      // milk: 80000-5000=75000; drink: 120000; dough compliment basis 0 after 40000 disc
      const accepted = await setOrderCommercialTermsWithRounding(orders, {
        orderId: order.orderId,
        idempotencyKey: 'golden-commercial-final',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '7',
        taxMinor: '8000',
        tipMinor: '5000',
        nonMerchandiseChargesMinor: '10000',
        customerPayableMinor: '250000',
        lineTerms: [
          {
            orderLineId: lineMilk.orderLineId,
            grossMerchandiseMinor: '80000',
            lineMerchantFundedDiscountMinor: '5000',
            eligibleForOrderDiscount: true,
          },
          {
            orderLineId: lineDrink.orderLineId,
            grossMerchandiseMinor: '120000',
            thirdPartyMerchandiseFundingMinor: '15000',
            fundingProvenance: 'platform-promo',
            eligibleForOrderDiscount: true,
          },
          {
            orderLineId: lineDough.orderLineId,
            grossMerchandiseMinor: '40000',
            lineMerchantFundedDiscountMinor: '40000',
            eligibleForOrderDiscount: false,
          },
        ],
      });
      expect(accepted.status).toBe('accepted');

      const expectedAlloc = allocateOrderMerchantDiscount('7', [
        { orderLineId: lineMilk.orderLineId, lineNumber: lineMilk.lineNumber, basisMinor: '75000' },
        { orderLineId: lineDrink.orderLineId, lineNumber: lineDrink.lineNumber, basisMinor: '120000' },
      ]);
      const allocMilk = expectedAlloc.get(lineMilk.orderLineId)!;
      const allocDrink = expectedAlloc.get(lineDrink.orderLineId)!;
      expect(Number(allocMilk) + Number(allocDrink)).toBe(7);

      // Semantic idempotent re-accept
      const again = await setOrderCommercialTermsWithRounding(orders, {
        orderId: order.orderId,
        idempotencyKey: 'golden-commercial-final',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '7',
        taxMinor: '8000',
        tipMinor: '5000',
        nonMerchandiseChargesMinor: '10000',
        customerPayableMinor: '250000',
        lineTerms: [
          {
            orderLineId: lineMilk.orderLineId,
            grossMerchandiseMinor: '80000',
            lineMerchantFundedDiscountMinor: '5000',
            eligibleForOrderDiscount: true,
          },
          {
            orderLineId: lineDrink.orderLineId,
            grossMerchandiseMinor: '120000',
            thirdPartyMerchandiseFundingMinor: '15000',
            fundingProvenance: 'platform-promo',
            eligibleForOrderDiscount: true,
          },
          {
            orderLineId: lineDough.orderLineId,
            grossMerchandiseMinor: '40000',
            lineMerchantFundedDiscountMinor: '40000',
            eligibleForOrderDiscount: false,
          },
        ],
      });
      expect(again.status).toBe('duplicate');

      // Expected Revenue Basis:
      // milk: 80000-5000-allocMilk = 75000-allocMilk
      // drink: 120000-allocDrink+15000 = 135000-allocDrink
      // dough: 0
      const milkNet = String(75000 - Number(allocMilk));
      const drinkNet = String(135000 - Number(allocDrink));
      const orderRevenue = String(Number(milkNet) + Number(drinkNet)); // dough 0

      const completed = await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-complete',
        businessDate: DAY.SALE,
        businessOrder: 1,
        businessTime: '19:30:00',
        actorId: fx.actorId,
      });
      expect(completed.status).toBe('completed');
      expect(completed.goodsIssueId).toBeTruthy();

      // CompleteOrder retry idempotency
      const retry = await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-complete',
        businessDate: DAY.SALE,
        businessOrder: 1,
        businessTime: '19:30:00',
        actorId: fx.actorId,
      });
      expect(retry.status).toBe('duplicate');

      const snapCount = await pool.query(
        `SELECT COUNT(*)::int AS c FROM order_commercial_snapshot WHERE order_id = $1`,
        [order.orderId],
      );
      expect(snapCount.rows[0]!.c).toBe(1);
      const giCount = await pool.query(
        `SELECT COUNT(*)::int AS c FROM goods_issue WHERE source_order_id = $1`,
        [order.orderId],
      );
      expect(giCount.rows[0]!.c).toBe(1);
      const movCount = await pool.query(
        `SELECT COUNT(*)::int AS c FROM inventory_movement
         WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1`,
        [completed.goodsIssueId],
      );
      // milk OUT + drink milk leaf + drink oil leaf + dough OUT = 4 (or 3 if shared — assert >=3 and no excess)
      expect(movCount.rows[0]!.c).toBeGreaterThanOrEqual(3);
      expect(movCount.rows[0]!.c).toBeLessThanOrEqual(4);

      const after = await orders.getOrder(order.orderId);
      expect(after.status).toBe('COMPLETED');
      expect(after.consumptionPlanId).toBeTruthy();

      const snap = await orders.getCommercialSnapshot(order.orderId);
      expect(snap!.certainty).toBe('FINAL');
      expect(snap!.netMerchandiseSalesMinor).toBe(orderRevenue);
      expect(snap!.taxMinor).toBe('8000');
      expect(snap!.tipMinor).toBe('5000');
      expect(snap!.customerPayableMinor).toBe('250000');
      expect(snap!.customerPayableMinor).not.toBe(snap!.netMerchandiseSalesMinor);

      const doughLineSnap = snap!.lines.find((l) => l.soldCatalogItemId === doughId)!;
      expect(doughLineSnap.netMerchandiseSalesMinor).toBe('0');
      expect(doughLineSnap.certainty).toBe('FINAL');

      // Frozen allocation — reporting must match snapshot, not recalculate
      const milkSnap = snap!.lines.find((l) => l.soldCatalogItemId === fx.milkItemId)!;
      const drinkSnap = snap!.lines.find((l) => l.soldCatalogItemId === drinkId)!;
      expect(milkSnap.allocatedOrderMerchantDiscountMinor).toBe(allocMilk);
      expect(drinkSnap.allocatedOrderMerchantDiscountMinor).toBe(allocDrink);

      // PHYSICAL write-off strategies
      const gil = await pool.query<{
        catalog_item_id: string;
        order_line_id: string;
        quantity_base: string;
      }>(
        `SELECT catalog_item_id, order_line_id, quantity_base FROM goods_issue_line
         WHERE goods_issue_id = $1 ORDER BY line_number`,
        [completed.goodsIssueId],
      );
      const milkLeaves = gil.rows.filter((r) => r.order_line_id === lineMilk.orderLineId);
      expect(milkLeaves).toHaveLength(1);
      expect(milkLeaves[0]!.catalog_item_id).toBe(fx.milkItemId);
      expect(milkLeaves[0]!.quantity_base).toBe('2');

      const drinkLeaves = gil.rows.filter((r) => r.order_line_id === lineDrink.orderLineId);
      expect(drinkLeaves.map((r) => r.catalog_item_id).sort()).toEqual(
        [fx.milkItemId, fx.oilItemId].sort(),
      );

      const doughLeaves = gil.rows.filter((r) => r.order_line_id === lineDough.orderLineId);
      expect(doughLeaves).toHaveLength(1);
      expect(doughLeaves[0]!.catalog_item_id).toBe(doughId);
      // STOCK_TRACKED root: finished dough only — no meat leaf
      expect(doughLeaves.some((r) => r.catalog_item_id === fx.meatItemId)).toBe(false);

      // ACTUAL COGS from historical MA (milk blended 15000)
      const cogsLines = await cogs.listLineEffects(q({ orderId: order.orderId }));
      expect(cogsLines.length).toBeGreaterThanOrEqual(3);
      expect(cogsLines.every((e) => e.costCertainty === 'FINAL')).toBe(true);
      const cogsAgg = await cogs.aggregateByLine(q({ orderId: order.orderId }));
      expect(cogsAgg.actualCogsMinor).not.toBeNull();
      expect(Number(cogsAgg.actualCogsMinor)).toBeGreaterThan(0);

      const doughCogs = cogsLines
        .filter((e) => e.orderLineId === lineDough.orderLineId)
        .reduce((s, e) => s + Number(e.signedActualCogsMinor ?? 0), 0);
      expect(doughCogs).toBeGreaterThan(0); // compliment still has COGS

      // REVENUE
      const revLines = await revenue.listLineEffects(q({ orderId: order.orderId }));
      expect(revLines).toHaveLength(3);
      expect(revLines.find((e) => e.orderLineId === lineDough.orderLineId)!.signedRevenueBasisMinor).toBe(
        '0',
      );
      const revAgg = await revenue.aggregateByLine(q({ orderId: order.orderId }));
      expect(revAgg.revenueBasisMinor).toBe(orderRevenue);

      // OPERATING ECONOMICS — order scope
      const oe = await economics.compute(q({ orderId: order.orderId }));
      expect(oe.denominatorRevenueBasisMinor).toBe(orderRevenue);
      expect(oe.numeratorActualCogsMinor).toBe(cogsAgg.actualCogsMinor);
      expect(oe.foodCostRatioStatus).toBe('AVAILABLE');
      expect(oe.operationalGrossProfitStatus).toBe('AVAILABLE');
      expect(oe.denominatorRevenueBasisMinor).toBe(orderRevenue);
      expect(oe.numeratorActualCogsMinor).toBe(cogsAgg.actualCogsMinor);
      expect(oe.operationalGrossProfitMinor).toBe(
        toCanonicalDecimal(
          parseCanonicalDecimal(oe.denominatorRevenueBasisMinor!).minus(
            parseCanonicalDecimal(oe.numeratorActualCogsMinor!),
          ),
        ),
      );
      expect(oe.foodCostRatio).toBeTruthy();

      // Compliment line economics
      const complimentOe = await economics.compute(q({ orderLineId: lineDough.orderLineId }));
      expect(complimentOe.revenue.revenueBasisMinor).toBe('0');
      expect(complimentOe.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');
      expect(complimentOe.operationalGrossProfitMinor).toBe(`-${doughCogs}`);

      // No Revenue multiplication by recipe leaves
      expect(revLines.filter((e) => e.orderLineId === lineDrink.orderLineId)).toHaveLength(1);
      expect(drinkLeaves.length).toBeGreaterThan(1);

      // HISTORICAL STABILITY — mutate recipe + catalog after sale
      const beforeHist = {
        cogs: cogsAgg.actualCogsMinor,
        rev: revAgg.revenueBasisMinor,
        fc: oe.foodCostRatio,
        gp: oe.operationalGrossProfitMinor,
      };
      await pool.query(`UPDATE catalog_item SET name = 'Mutated Milk' WHERE catalog_item_id = $1`, [
        fx.milkItemId,
      ]);
      const v2 = await recipes.createNextRecipeVersion(recipe.recipeSpecificationId);
      await recipes.updateRecipeDraft({
        recipeVersionId: v2.recipeVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '9',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      });
      await recipes.publishRecipeVersion(v2.recipeVersionId);
      const afterHist = await economics.compute(q({ orderId: order.orderId }));
      expect(afterHist.numeratorActualCogsMinor).toBe(beforeHist.cogs);
      expect(afterHist.denominatorRevenueBasisMinor).toBe(beforeHist.rev);
      expect(afterHist.foodCostRatio).toBe(beforeHist.fc);
      expect(afterHist.operationalGrossProfitMinor).toBe(beforeHist.gp);

      // FULL LATER REVERSAL
      const reversed = await orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-rev-later',
        businessDate: DAY.REVERSE_LATER,
        businessOrder: 1,
        reason: 'guest complaint',
        actorId: fx.actorId,
      });
      expect(reversed.reversalId).toBeTruthy();
      const snapAfterRev = await orders.getCommercialSnapshot(order.orderId);
      expect(snapAfterRev).toEqual(snap);

      const salePeriod = await economics.compute(q({ businessDate: DAY.SALE }));
      expect(Number(salePeriod.denominatorRevenueBasisMinor)).toBeGreaterThan(0);
      expect(Number(salePeriod.numeratorActualCogsMinor)).toBeGreaterThan(0);

      const revPeriod = await economics.compute(q({ businessDate: DAY.REVERSE_LATER }));
      expect(revPeriod.denominatorRevenueBasisMinor).toBe(`-${orderRevenue}`);
      expect(revPeriod.numeratorActualCogsMinor).toBe(`-${cogsAgg.actualCogsMinor}`);
      expect(revPeriod.operationalGrossProfitMinor).toBe(
        toCanonicalDecimal(parseCanonicalDecimal(salePeriod.operationalGrossProfitMinor!).neg()),
      );
      expect(revPeriod.foodCostRatio).toBe(salePeriod.foodCostRatio);

      const combined = await economics.compute(
        q({ businessDateFrom: DAY.SALE, businessDateTo: DAY.REVERSE_LATER }),
      );
      expect(combined.denominatorRevenueBasisMinor).toBe('0');
      expect(combined.numeratorActualCogsMinor).toBe('0');
      expect(combined.operationalGrossProfitMinor).toBe('0');
      expect(combined.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');

      // Tenant isolation
      expect((await economics.compute({ tenantId: randomUUID() })).revenue.componentCount).toBe(0);

      // Provenance drill-down
      const revSale = (await revenue.listLineEffects(q({ orderId: order.orderId, effectType: 'SALE' })))[0]!;
      expect(revSale.orderCommercialSnapshotId).toBe(snap!.orderCommercialSnapshotId);
      const revRev = (
        await revenue.listLineEffects(q({ orderId: order.orderId, effectType: 'REVERSAL' }))
      )[0]!;
      expect(revRev.salesOrderCompletionReversalId).toBe(reversed.reversalId);
      expect(revRev.orderCommercialSnapshotId).toBe(snap!.orderCommercialSnapshotId);
      const cogsSale = (await cogs.listLineEffects(q({ orderId: order.orderId })))[0]!;
      expect(cogsSale.goodsIssueId).toBe(completed.goodsIssueId);
      expect(cogsSale.inventoryMovementId).toBeTruthy();
    });
  });

  describe('VARIATION — CompleteOrder atomic rollback', () => {
    it('COMPLETION — failing write-off leaves OPEN, no snapshot/GI/movement', async () => {
      await receiveMilk(5, '10000', DAY.PROCURE_1, 1);
      const failingPort: SaleInventoryWriteOffPort = {
        async postGoodsIssueFromConsumptionPlan() {
          throw new Error('golden simulated inventory failure');
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
      await acceptFinalMerchandiseTerms(failingOrders, order.orderId, {
        defaultGrossMinor: '50000',
        idempotencyKey: 'golden-fail-terms',
      });
      await expect(
        failingOrders.completeOrder({
          orderId: order.orderId,
          idempotencyKey: 'golden-fail-complete',
          businessDate: DAY.SALE,
          businessOrder: 1,
        }),
      ).rejects.toThrow(/golden simulated inventory failure/);

      const after = await orders.getOrder(order.orderId);
      expect(after.status).toBe('OPEN');
      expect(after.consumptionPlanId).toBeNull();
      expect(
        (await pool.query(`SELECT COUNT(*)::int AS c FROM order_commercial_snapshot WHERE order_id = $1`, [
          order.orderId,
        ])).rows[0]!.c,
      ).toBe(0);
      expect((await pool.query(`SELECT COUNT(*)::int AS c FROM goods_issue`)).rows[0]!.c).toBe(0);
      expect(
        (
          await pool.query(`SELECT COUNT(*)::int AS c FROM operational_fact_feed WHERE fact_type = $1`, [
            OperationalFactType.OrderCompleted,
          ])
        ).rows[0]!.c,
      ).toBe(0);
    });
  });

  describe('VARIATION — same-position & backdated reversal', () => {
    it('REVERSAL — same-position nets zero; Food Cost denominator-zero', async () => {
      await receiveMilk(5, '10000', DAY.PROCURE_1, 1);
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
      await acceptFinalMerchandiseTerms(orders, order.orderId, { defaultGrossMinor: '100000' });
      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-same-c',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });
      await orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-same-r',
        businessDate: DAY.SALE,
        businessOrder: 1,
        reason: 'same position',
        actorId: fx.actorId,
      });
      expect(await revenue.listLineEffects(q({ orderId: order.orderId }))).toHaveLength(2);
      expect(await cogs.listLineEffects(q({ orderId: order.orderId }))).toHaveLength(2);
      const oe = await economics.compute(q({ orderId: order.orderId }));
      expect(oe.denominatorRevenueBasisMinor).toBe('0');
      expect(oe.numeratorActualCogsMinor).toBe('0');
      expect(oe.operationalGrossProfitMinor).toBe('0');
      expect(oe.foodCostRatioUnavailableReasons).toContain('ZERO_REVENUE_BASIS');
    });

    it('REVERSAL — backdated chronology beats reversed_at', async () => {
      await receiveMilk(5, '10000', DAY.PROCURE_1, 1);
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
      await acceptFinalMerchandiseTerms(orders, order.orderId, { defaultGrossMinor: '100000' });
      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-back-c',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });
      const rev = await orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-back-r',
        businessDate: DAY.REVERSE_BACK,
        businessOrder: 1,
        reason: 'backdated',
        actorId: fx.actorId,
      });
      const row = await pool.query<{ reversed_at: Date; business_date: string }>(
        `SELECT reversed_at, business_date::text AS business_date
         FROM sales_order_completion_reversal WHERE sales_order_completion_reversal_id = $1`,
        [rev.reversalId],
      );
      expect(row.rows[0]!.business_date.startsWith(DAY.REVERSE_BACK)).toBe(true);
      expect(new Date(row.rows[0]!.reversed_at).toISOString().slice(0, 10)).not.toBe(DAY.REVERSE_BACK);
      const back = await economics.compute(q({ businessDate: DAY.REVERSE_BACK }));
      expect(back.denominatorRevenueBasisMinor).toBe('-100000');
      expect(back.numeratorActualCogsMinor).toBe('-10000');
    });
  });

  describe('VARIATION — UNKNOWN / ORDER_UNRESOLVED / coverage gap', () => {
    it('COGS — UNKNOWN never zero; metrics unavailable; Revenue visible', async () => {
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
      await acceptFinalMerchandiseTerms(orders, order.orderId, { defaultGrossMinor: '50000' });
      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-unk',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });
      const effects = await cogs.listLineEffects(q({ orderId: order.orderId }));
      expect(effects[0]!.costCertainty).toBe('UNKNOWN');
      const oe = await economics.compute(q({ orderId: order.orderId }));
      expect(oe.foodCostRatioUnavailableReasons).toContain('COGS_UNKNOWN');
      expect(oe.operationalGrossProfitUnavailableReasons).toContain('COGS_UNKNOWN');
      expect(oe.revenue.revenueBasisMinor).toBe('50000');
      expect(oe.cogs.actualCogsMinor).toBeNull();
      expect(oe.cogs.knownSubtotalMinor).toBe('0');
    });

    it('COGS — ORDER_UNRESOLVED at shared business position', async () => {
      await receiveMilk(10, '10000', DAY.PROCURE_1, 1);
      for (const key of ['a', 'b'] as const) {
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
        await acceptFinalMerchandiseTerms(orders, order.orderId, {
          defaultGrossMinor: '50000',
          idempotencyKey: `golden-ur-${key}`,
        });
        await orders.completeOrder({
          orderId: order.orderId,
          idempotencyKey: `golden-ur-c-${key}`,
          businessDate: DAY.SALE,
          businessOrder: 1,
        });
      }
      const oe = await economics.compute(q({ businessDate: DAY.SALE }));
      expect(oe.foodCostRatioUnavailableReasons).toContain('COGS_ORDER_UNRESOLVED');
      expect(oe.operationalGrossProfitUnavailableReasons).toContain('COGS_ORDER_UNRESOLVED');
    });

    it('ECONOMICS — REVENUE_COVERAGE_GAP never fabricates Revenue 0', async () => {
      await receiveMilk(5, '10000', DAY.PROCURE_1, 1);
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
      await acceptFinalMerchandiseTerms(orders, order.orderId, { defaultGrossMinor: '100000' });
      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-gap-c',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });
      await pool.query(`UPDATE sales_order SET order_commercial_snapshot_id = NULL WHERE order_id = $1`, [
        order.orderId,
      ]);
      await pool.query(
        `DELETE FROM order_line_commercial_snapshot WHERE order_commercial_snapshot_id IN (
           SELECT order_commercial_snapshot_id FROM order_commercial_snapshot WHERE order_id = $1)`,
        [order.orderId],
      );
      await pool.query(`DELETE FROM order_commercial_snapshot WHERE order_id = $1`, [order.orderId]);

      const oe = await economics.compute(q({ orderId: order.orderId }));
      expect(oe.hasRevenueCoverageGap).toBe(true);
      expect(oe.foodCostRatioUnavailableReasons).toContain('REVENUE_COVERAGE_GAP');
      expect(oe.operationalGrossProfitMinor).toBeNull();
      expect(oe.operationalGrossProfitMinor).not.toBe('-10000');
      expect(oe.cogs.actualCogsMinor).toBe('10000');
    });
  });

  describe('VARIATION — Live Menu/Pricing (M1.1 + C1.1 RoundingPolicy)', () => {
    it('MENU — publish/assign/price → unit resolve → kernel gross → freeze; later price does not rewrite', async () => {
      await receiveMilk(5, '10000', DAY.PROCURE_1, 1);

      const menuSvc = new MenuService(pool);
      const menuResolver = new MenuResolver(pool);
      await menuSvc.setOutletTimezone({
        tenantId: fx.tenantId,
        outletId: fx.outletId,
        timezone: 'Asia/Ho_Chi_Minh',
      });

      const def = await menuSvc.createMenuDefinition({
        tenantId: fx.tenantId,
        code: 'golden-main',
        name: 'Golden Main Menu',
      });
      await menuSvc.setMenuDefinitionItems({
        menuDefinitionId: def.menuDefinitionId,
        catalogItemIds: [fx.milkItemId],
      });
      const pub = await menuSvc.publishMenu({
        menuDefinitionId: def.menuDefinitionId,
        idempotencyKey: 'golden-menu-pub-v1',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });
      await menuSvc.assignMenu({
        tenantId: fx.tenantId,
        menuPublicationId: pub.menuPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-menu-assign',
      });
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-09-01T00:00:00.000Z',
        idempotencyKey: 'golden-price-v1',
      });

      const salesContext = {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
        orderChannel: 'DIRECT',
        businessDateTime: '2026-03-10T10:00:00.000Z',
      };
      const resolvedMenu = await menuResolver.resolveMenu({ salesContext });
      expect(resolvedMenu.menuPublicationId).toBe(pub.menuPublicationId);
      const milkItem = resolvedMenu.items.find((i) => i.catalogItemId === fx.milkItemId)!;
      expect(milkItem.availabilityStatus).toBe('AVAILABLE');
      expect(milkItem.price.status).toBe('RESOLVED');
      if (milkItem.price.status !== 'RESOLVED') throw new Error('expected resolved unit price');
      expect(milkItem.price.quote.resolvedUnitPriceMinor).toBe('100000');

      const order = await orders.openOrder({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      });
      await orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: fx.milkItemId,
        quantity: '1',
        unit: 'L',
        dimension: 'VOLUME',
      });

      const resolvedLines = await menuResolver.resolveOrderLinesFromMenu({
        orderId: order.orderId,
        salesContext,
      });
      expect(resolvedLines.lines[0]!.resolvedUnitPriceMinor).toBe('100000');

      // C1.1 — kernel derives gross from unit × qty under RoundingPolicy
      await orders.setOrderCommercialTerms(
        buildMenuResolvedCommercialTermsInput({
          orderId: order.orderId,
          idempotencyKey: 'golden-menu-commercial',
          resolvedLines: resolvedLines.lines,
          roundingPolicy: {
            roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            policyVersion: 1,
            calculationContext: 'BASE_LIST_LINE_GROSS',
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
          },
        }),
      );

      // OPEN: activate new price — must NOT silently mutate accepted terms
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '120000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        idempotencyKey: 'golden-price-v2',
      });
      const openTerms = await pool.query<{
        gross_merchandise_minor: string;
        resolved_unit_price_minor: string;
        provenance_json: unknown;
      }>(
        `SELECT gross_merchandise_minor, resolved_unit_price_minor, provenance_json
         FROM sales_order_commercial_line_terms WHERE order_id = $1`,
        [order.orderId],
      );
      expect(openTerms.rows[0]!.gross_merchandise_minor).toBe('100000');
      expect(openTerms.rows[0]!.resolved_unit_price_minor).toBe('100000');
      expect(JSON.stringify(openTerms.rows[0]!.provenance_json)).toContain('C1_1_BASE_LIST_LINE_GROSS');

      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-menu-complete',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });

      const beforeOe = await economics.compute(q({ orderId: order.orderId }));
      expect(beforeOe.denominatorRevenueBasisMinor).toBe('100000');
      const beforeCogs = beforeOe.numeratorActualCogsMinor;
      const beforeGp = beforeOe.operationalGrossProfitMinor;
      const beforeFc = beforeOe.foodCostRatio;

      // Post-completion menu/price change must not rewrite frozen economics
      await menuSvc.setMenuDefinitionItems({
        menuDefinitionId: def.menuDefinitionId,
        catalogItemIds: [fx.milkItemId, fx.oilItemId],
      });
      await menuSvc.publishMenu({
        menuDefinitionId: def.menuDefinitionId,
        idempotencyKey: 'golden-menu-pub-v2',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });

      const afterOe = await economics.compute(q({ orderId: order.orderId }));
      expect(afterOe.denominatorRevenueBasisMinor).toBe(beforeOe.denominatorRevenueBasisMinor);
      expect(afterOe.numeratorActualCogsMinor).toBe(beforeCogs);
      expect(afterOe.operationalGrossProfitMinor).toBe(beforeGp);
      expect(afterOe.foodCostRatio).toBe(beforeFc);

      const snapProv = await pool.query<{ provenance_json: unknown }>(
        `SELECT provenance_json FROM order_commercial_snapshot WHERE order_id = $1`,
        [order.orderId],
      );
      expect(JSON.stringify(snapProv.rows[0]!.provenance_json)).toContain('C1_1_BASE_LIST_LINE_GROSS');
      expect(JSON.stringify(snapProv.rows[0]!.provenance_json)).toContain(pub.menuPublicationId);
    });
  });

  describe('VARIATION — Live POS Presentation / Cashier Selection (P1.1)', () => {
    it('POS — LayoutPublication ∩ ResolvedMenu → ACTIVE select → AddOrderLine → explicit gross → economics; Layout v2 stable', async () => {
      await receiveMilk(5, '10000', DAY.PROCURE_1, 1);

      const menuSvc = new MenuService(pool);
      const menuResolver = new MenuResolver(pool);
      const layoutSvc = new LayoutService(pool);
      const posSurface = new PosSurfaceResolver(pool);
      const posSelect = new PosSelectionService(pool, orders);

      await menuSvc.setOutletTimezone({
        tenantId: fx.tenantId,
        outletId: fx.outletId,
        timezone: 'Asia/Ho_Chi_Minh',
      });

      const menuDef = await menuSvc.createMenuDefinition({
        tenantId: fx.tenantId,
        code: 'golden-pos-menu',
        name: 'Golden POS Menu',
      });
      await menuSvc.setMenuDefinitionItems({
        menuDefinitionId: menuDef.menuDefinitionId,
        catalogItemIds: [fx.milkItemId],
      });
      const menuPub = await menuSvc.publishMenu({
        menuDefinitionId: menuDef.menuDefinitionId,
        idempotencyKey: 'golden-pos-menu-pub-v1',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });
      await menuSvc.assignMenu({
        tenantId: fx.tenantId,
        menuPublicationId: menuPub.menuPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-pos-menu-assign',
      });
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-09-01T00:00:00.000Z',
        idempotencyKey: 'golden-pos-price-v1',
      });

      const layoutDef = await layoutSvc.createLayoutDefinition({
        tenantId: fx.tenantId,
        code: 'golden-pos-layout',
        name: 'Golden Cashier',
      });
      await layoutSvc.setLayoutPages({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        pages: [
          { pageCode: 'drinks', label: 'Drinks', sortOrder: 0 },
          { pageCode: 'food', label: 'Food', sortOrder: 1 },
        ],
      });
      await layoutSvc.setLayoutSlots({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        slots: [
          {
            zone: 'PAGE',
            pageCode: 'drinks',
            catalogItemId: fx.milkItemId,
            position: 1,
            labelOverride: 'Milk',
          },
          { zone: 'QUICK_ACCESS', catalogItemId: fx.milkItemId, position: 1 },
        ],
      });
      const layoutPub = await layoutSvc.publishLayout({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        idempotencyKey: 'golden-pos-layout-pub-v1',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });
      await layoutSvc.assignLayout({
        tenantId: fx.tenantId,
        layoutPublicationId: layoutPub.layoutPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-pos-layout-assign',
      });

      const presentationContext = {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
      };
      const salesContext = {
        ...presentationContext,
        orderChannel: 'DIRECT',
        businessDateTime: '2026-03-10T10:00:00.000Z',
      };

      const surface = await posSurface.resolvePosSurface({ presentationContext, salesContext });
      expect(surface.layoutPublicationId).toBe(layoutPub.layoutPublicationId);
      expect(surface.menuPublicationId).toBe(menuPub.menuPublicationId);
      expect(surface.pages.map((p) => p.pageCode)).toEqual(['drinks', 'food']);
      const active = surface.pages[0]!.slots.find((s) => s.catalogItemId === fx.milkItemId)!;
      expect(active.state).toBe('ACTIVE');
      expect(active.unitPrice).toEqual({
        amountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      });
      expect(surface.quickAccess[0]!.state).toBe('ACTIVE');

      // Tableless Open Order → POS select → basket
      const order = await orders.openOrder({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      });
      expect(order).not.toHaveProperty('tableId');
      const selected = await posSelect.selectPosItem({
        orderId: order.orderId,
        layoutPublicationSlotId: active.layoutPublicationSlotId,
        presentationContext,
        salesContext,
        quantity: '1',
        unit: 'L',
        dimension: 'VOLUME',
      });
      expect(selected.order.status).toBe('OPEN');
      expect(selected.order.lines).toHaveLength(1);
      expect(selected.order.lines[0]!.catalogItemId).toBe(fx.milkItemId);
      // Tap does not commercial-accept
      const openTerms = await pool.query(
        `SELECT 1 FROM sales_order_commercial_terms WHERE order_id = $1`,
        [order.orderId],
      );
      expect(openTerms.rowCount).toBe(0);

      const resolvedLines = await menuResolver.resolveOrderLinesFromMenu({
        orderId: order.orderId,
        salesContext,
      });
      const kernelGross = '100000';
      await orders.setOrderCommercialTerms(
        buildMenuResolvedCommercialTermsInput({
          orderId: order.orderId,
          idempotencyKey: 'golden-pos-commercial',
          resolvedLines: resolvedLines.lines,
          roundingPolicy: {
            roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            policyVersion: 1,
            calculationContext: 'BASE_LIST_LINE_GROSS',
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
          },
        }),
      );

      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-pos-complete',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });

      const beforeOe = await economics.compute(q({ orderId: order.orderId }));
      expect(beforeOe.denominatorRevenueBasisMinor).toBe('100000');
      const beforeCogs = beforeOe.numeratorActualCogsMinor;
      const beforeGp = beforeOe.operationalGrossProfitMinor;
      const beforeFc = beforeOe.foodCostRatio;

      // Layout v2 (repage/recolor) must not alter completed economics
      await layoutSvc.setLayoutPages({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        pages: [{ pageCode: 'all', label: 'All', sortOrder: 0, colorToken: 'amber' }],
      });
      await layoutSvc.setLayoutSlots({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        slots: [
          {
            zone: 'PAGE',
            pageCode: 'all',
            catalogItemId: fx.milkItemId,
            position: 1,
            colorToken: 'green',
          },
        ],
      });
      await layoutSvc.publishLayout({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        idempotencyKey: 'golden-pos-layout-pub-v2',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });

      // Same LayoutPublication + new PriceRule → current surface shows new unit price
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '150000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        idempotencyKey: 'golden-pos-price-v2',
      });

      const liveSurface = await posSurface.resolvePosSurface({
        presentationContext,
        salesContext: {
          ...salesContext,
          businessDateTime: '2026-09-16T10:00:00.000Z',
        },
      });
      expect(liveSurface.layoutPublicationId).toBe(layoutPub.layoutPublicationId);
      const liveMilk = liveSurface.pages
        .flatMap((p) => p.slots)
        .find((s) => s.catalogItemId === fx.milkItemId)!;
      expect(liveMilk.state).toBe('ACTIVE');
      expect(liveMilk.unitPrice?.amountMinor).toBe('150000');

      const afterOe = await economics.compute(q({ orderId: order.orderId }));
      expect(afterOe.denominatorRevenueBasisMinor).toBe(beforeOe.denominatorRevenueBasisMinor);
      expect(afterOe.numeratorActualCogsMinor).toBe(beforeCogs);
      expect(afterOe.operationalGrossProfitMinor).toBe(beforeGp);
      expect(afterOe.foodCostRatio).toBe(beforeFc);
    });
  });

  describe('VARIATION — Order Interaction (P1.3 COUNT mutate + commercial invalidate + re-resolve)', () => {
    it('POS COUNT select → accept → qty change clears terms → re-resolve unit → explicit re-accept → CompleteOrder economics', async () => {
      // Stock eggs (DIRECT_STOCK COUNT)
      receiptSeq += 1;
      const eggDraft = await receipts.createDraft({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        warehouseId: fx.warehouseId,
        supplierId: fx.supplierId,
        supplierDocumentNumber: `GOLDEN-EGG-${receiptSeq}`,
        currencyCode: 'VND',
        minorUnitExponent: 0,
        businessDate: DAY.PROCURE_1,
        businessOrder: 1,
        actorId: fx.actorId,
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
            unitPriceMinor: '2000',
            lineAcquisitionCostMinor: '48000',
          },
        ],
      });
      await receipts.post(eggDraft!.goodsReceiptId, {
        idempotencyKey: `golden-egg-${eggDraft!.goodsReceiptId}`,
        actorId: fx.actorId,
      });

      const menuSvc = new MenuService(pool);
      const menuResolver = new MenuResolver(pool);
      const layoutSvc = new LayoutService(pool);
      const posSurface = new PosSurfaceResolver(pool);
      const posSelect = new PosSelectionService(pool, orders);

      await menuSvc.setOutletTimezone({
        tenantId: fx.tenantId,
        outletId: fx.outletId,
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const def = await menuSvc.createMenuDefinition({
        tenantId: fx.tenantId,
        code: 'golden-p13',
        name: 'Golden P1.3',
      });
      await menuSvc.setMenuDefinitionItems({
        menuDefinitionId: def.menuDefinitionId,
        catalogItemIds: [fx.eggItemId],
      });
      const menuPub = await menuSvc.publishMenu({
        menuDefinitionId: def.menuDefinitionId,
        idempotencyKey: 'golden-p13-menu-pub',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });
      await menuSvc.assignMenu({
        tenantId: fx.tenantId,
        menuPublicationId: menuPub.menuPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-p13-menu-assign',
      });
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.eggItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '5000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-p13-price-v1',
      });

      const layoutDef = await layoutSvc.createLayoutDefinition({
        tenantId: fx.tenantId,
        code: 'golden-p13-layout',
        name: 'P1.3 Layout',
      });
      await layoutSvc.setLayoutPages({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        pages: [{ pageCode: 'main', label: 'Main', sortOrder: 0 }],
      });
      await layoutSvc.setLayoutSlots({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        slots: [{ zone: 'PAGE', pageCode: 'main', catalogItemId: fx.eggItemId, position: 1 }],
      });
      const layoutPub = await layoutSvc.publishLayout({
        layoutDefinitionId: layoutDef.layoutDefinitionId,
        idempotencyKey: 'golden-p13-layout-pub',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });
      await layoutSvc.assignLayout({
        tenantId: fx.tenantId,
        layoutPublicationId: layoutPub.layoutPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-p13-layout-assign',
      });

      const presentationContext = {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
      };
      const salesContext = {
        ...presentationContext,
        orderChannel: 'DIRECT',
        businessDateTime: '2026-03-10T10:00:00.000Z',
      };

      const surface = await posSurface.resolvePosSurface({ presentationContext, salesContext });
      const eggSlot = surface.pages[0]!.slots.find((s) => s.catalogItemId === fx.eggItemId)!;
      expect(eggSlot.state).toBe('ACTIVE');
      expect(eggSlot.quantityEntry).toBe('COUNT_ONE');

      const order = await orders.openOrder({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      });
      expect(order).not.toHaveProperty('tableId');

      const selected = await posSelect.selectPosCountTap({
        orderId: order.orderId,
        layoutPublicationSlotId: eggSlot.layoutPublicationSlotId,
        presentationContext,
        salesContext,
      });
      expect(selected.order.lines).toHaveLength(1);
      expect(selected.order.lines[0]!.quantity).toBe('1');
      const lineId = selected.order.lines[0]!.orderLineId;

      const resolved1 = await menuResolver.resolveOrderLinesFromMenu({
        orderId: order.orderId,
        salesContext,
      });
      expect(resolved1.lines[0]!.resolvedUnitPriceMinor).toBe('5000');
      const grossV1 = '5000';
      await orders.setOrderCommercialTerms(
        buildMenuResolvedCommercialTermsInput({
          orderId: order.orderId,
          idempotencyKey: 'golden-p13-commercial-v1',
          resolvedLines: resolved1.lines,
          roundingPolicy: {
            roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            policyVersion: 1,
            calculationContext: 'BASE_LIST_LINE_GROSS',
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
          },
        }),
      );
      let commercial = await orders.getOpenCommercialStatus(order.orderId);
      expect(commercial.commercialState).toBe('ACCEPTED');

      // D — COUNT quantity mutation
      await orders.updateOrderLine({
        orderId: order.orderId,
        orderLineId: lineId,
        quantity: '2',
      });
      commercial = await orders.getOpenCommercialStatus(order.orderId);
      expect(commercial.commercialState).toBe('NOT_ACCEPTED');
      expect(commercial.presentationHint).toBe('NEEDS_REACCEPTANCE');

      // F — re-resolve current unit prices (does not accept)
      const resolved2 = await menuResolver.resolveOrderLinesFromMenu({
        orderId: order.orderId,
        salesContext,
      });
      expect(resolved2.lines[0]!.resolvedUnitPriceMinor).toBe('5000');
      const stillClear = await pool.query(
        `SELECT 1 FROM sales_order_commercial_terms WHERE order_id = $1`,
        [order.orderId],
      );
      expect(stillClear.rowCount).toBe(0);

      // G/H — caller explicitly re-supplies gross (NOT unit×qty derivation)
      const explicitGrossV2 = '10000';
      await orders.setOrderCommercialTerms(
        buildMenuResolvedCommercialTermsInput({
          orderId: order.orderId,
          idempotencyKey: 'golden-p13-commercial-v2',
          resolvedLines: resolved2.lines,
          roundingPolicy: {
            roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            policyVersion: 1,
            calculationContext: 'BASE_LIST_LINE_GROSS',
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
          },
        }),
      );

      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-p13-complete',
        businessDate: DAY.SALE,
        businessOrder: 1,
      });

      const oe = await economics.compute(q({ orderId: order.orderId }));
      expect(oe.denominatorRevenueBasisMinor).toBe(explicitGrossV2);
      expect(oe.numeratorActualCogsMinor).toBe('4000'); // 2 × 2000
      expect(oe.operationalGrossProfitMinor).toBe('6000');
    });

    it('C1.1 — RoundingPolicy HALF_UP fractional + explicit accept + invalidate + reaccept + history stable + reverse', async () => {
      const policies = new CommercialRoundingPolicyService(pool);
      const acceptance = new BaseCommercialAcceptanceService(pool, orders);
      const menuSvc = new MenuService(pool);

      await policies.createPolicy({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        jurisdictionCode: 'VN',
        calculationContext: 'BASE_LIST_LINE_GROSS',
        roundingMode: 'HALF_UP',
        quantumMinor: '1',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-12-01T00:00:00.000Z',
      });

      await menuSvc.setOutletTimezone({
        tenantId: fx.tenantId,
        outletId: fx.outletId,
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const def = await menuSvc.createMenuDefinition({
        tenantId: fx.tenantId,
        code: 'golden-c11',
        name: 'Golden C1.1',
      });
      await menuSvc.setMenuDefinitionItems({
        menuDefinitionId: def.menuDefinitionId,
        catalogItemIds: [fx.eggItemId, fx.milkItemId],
      });
      const menuPub = await menuSvc.publishMenu({
        menuDefinitionId: def.menuDefinitionId,
        idempotencyKey: 'golden-c11-menu-pub',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });
      await menuSvc.assignMenu({
        tenantId: fx.tenantId,
        menuPublicationId: menuPub.menuPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-c11-menu-assign',
      });
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.eggItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '65000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-c11-egg-price',
      });
      await menuSvc.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '10001',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'golden-c11-milk-price',
      });

      // Receive milk for VOLUME sale write-off
      const milkDraft = await receipts.createDraft({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        warehouseId: fx.warehouseId,
        supplierId: fx.supplierId,
        supplierDocumentNumber: 'GOLDEN-C11-MILK',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        businessDate: DAY.PROCURE_1,
        businessOrder: 90,
        actorId: fx.actorId,
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.milkItemId,
            supplierItemId: fx.milkSupplierItemId,
            inputKind: 'FIXED_PACKAGE',
            packageCount: 20,
            acceptedBaseQuantity: '20',
            baseUnit: 'L',
            dimension: 'VOLUME',
            unitPriceMinor: '2000',
            lineAcquisitionCostMinor: '40000',
          },
        ],
      });
      await receipts.post(milkDraft!.goodsReceiptId, {
        idempotencyKey: `golden-c11-milk-${milkDraft!.goodsReceiptId}`,
        actorId: fx.actorId,
      });
      // Eggs for COUNT sale write-off
      const eggDraft = await receipts.createDraft({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        warehouseId: fx.warehouseId,
        supplierId: fx.supplierId,
        supplierDocumentNumber: 'GOLDEN-C11-EGG',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        businessDate: DAY.PROCURE_1,
        businessOrder: 91,
        actorId: fx.actorId,
        lines: [
          {
            lineNumber: 1,
            catalogItemId: fx.eggItemId,
            supplierItemId: fx.eggSupplierItemId,
            inputKind: 'COUNT',
            packageCount: 50,
            acceptedBaseQuantity: '50',
            baseUnit: 'ea',
            dimension: 'COUNT',
            unitPriceMinor: '2000',
            lineAcquisitionCostMinor: '100000',
          },
        ],
      });
      await receipts.post(eggDraft!.goodsReceiptId, {
        idempotencyKey: `golden-c11-egg-${eggDraft!.goodsReceiptId}`,
        actorId: fx.actorId,
      });

      const salesContext = {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
        orderChannel: 'DIRECT',
        businessDateTime: '2026-03-10T10:00:00.000Z',
      };

      const order = await orders.openOrder({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      });
      await orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: fx.eggItemId,
        quantity: '2',
        unit: 'ea',
        dimension: 'COUNT',
      });
      await orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: fx.milkItemId,
        quantity: '0.5',
        unit: 'L',
        dimension: 'VOLUME',
      });

      const accepted = await acceptance.calculateAndAcceptBaseCommercialTerms({
        orderId: order.orderId,
        salesContext,
        idempotencyKey: 'golden-c11-accept',
      });
      expect(accepted.calculated.merchandiseGrossMinor).toBe('135001'); // 130000 + 5001
      expect(accepted.commercialStatus.commercialState).toBe('ACCEPTED');
      const frac = accepted.calculated.lines.find((l) => l.grossMerchandiseMinor === '5001')!;
      expect(frac.exactUnroundedMinorBasis).toBe('5000.5');
      expect(frac.roundingDelta).toBe('0.5');

      const live = await orders.getOrder(order.orderId);
      const eggLine = live.lines.find((l) => l.catalogItemId === fx.eggItemId)!;
      await orders.updateOrderLine({
        orderId: order.orderId,
        orderLineId: eggLine.orderLineId,
        quantity: '3',
      });
      let commercial = await orders.getOpenCommercialStatus(order.orderId);
      expect(commercial.commercialState).toBe('NOT_ACCEPTED');

      await acceptance.calculateAndAcceptBaseCommercialTerms({
        orderId: order.orderId,
        salesContext,
        idempotencyKey: 'golden-c11-reaccept',
      });
      commercial = await orders.getOpenCommercialStatus(order.orderId);
      expect(commercial.merchandiseGrossMinor).toBe('200001'); // 195000 + 5001

      await orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-c11-complete',
        businessDate: DAY.SALE,
        businessOrder: 50,
      });

      const oe = await economics.compute(q({ orderId: order.orderId }));
      expect(oe.denominatorRevenueBasisMinor).toBe('200001');
      expect(oe.numeratorActualCogsMinor).toBeTruthy();
      const cogsBefore = oe.numeratorActualCogsMinor;
      const ogpBefore = oe.operationalGrossProfitMinor;

      await policies.createPolicy({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        jurisdictionCode: 'VN',
        calculationContext: 'BASE_LIST_LINE_GROSS',
        roundingMode: 'HALF_UP',
        quantumMinor: '1',
        effectiveFrom: '2026-12-01T00:00:00.000Z',
        policyVersion: 2,
      });
      const oeAfterPolicy = await economics.compute(q({ orderId: order.orderId }));
      expect(oeAfterPolicy.denominatorRevenueBasisMinor).toBe('200001');
      expect(oeAfterPolicy.numeratorActualCogsMinor).toBe(cogsBefore);
      expect(oeAfterPolicy.operationalGrossProfitMinor).toBe(ogpBefore);

      const snap = await orders.getCommercialSnapshot(order.orderId);
      expect(snap!.lines.find((l) => l.grossMerchandiseMinor === '5001')!.roundingDelta).toBe('0.5');

      await orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'golden-c11-rev',
        businessDate: DAY.REVERSE_LATER,
        businessOrder: 1,
      });
      const snapAfterRev = await orders.getCommercialSnapshot(order.orderId);
      expect(snapAfterRev!.grossMerchandiseMinor).toBe('200001');
      expect(snapAfterRev!.lines.find((l) => l.grossMerchandiseMinor === '5001')!.exactUnroundedMinorBasis).toBe(
        '5000.5',
      );
    });
  });

  describe('VARIATION — Settlement / Checkout foundation (S1.1)', () => {
    it('OpenSettlement → edit lock → Abort → reaccept → Open → zero-payable SATISFIED → fiscal fixture → CompleteOrder', async () => {
      const { SettlementService } = await import('../modules/settlement/settlement-service.js');
      const { CheckoutOrchestrator } = await import('../modules/checkout/checkout-orchestrator.js');
      const { fixedFiscalCheckoutGate } = await import('../modules/settlement/settlement-ports.js');

      const order = await orders.openOrder({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        actorId: fx.actorId,
      });
      await orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: fx.eggItemId,
        quantity: '1',
        unit: 'ea',
        dimension: 'COUNT',
      });
      await acceptFinalMerchandiseTerms(orders, order.orderId, {
        defaultGrossMinor: '100000',
        idempotencyKey: `golden-s11-${order.orderId}`,
      });

      const settlements = new SettlementService(pool);
      const s1 = await settlements.openSettlement({
        orderId: order.orderId,
        idempotencyKey: `golden-open-${order.orderId}`,
      });
      expect(s1.checks).toHaveLength(1);
      expect(s1.customerPayableMinor).toBe('100000');
      expect(s1.merchandiseGrossMinor).toBe('100000');
      expect(s1.payableSnapshot.tax.presence).toBe('ABSENT');

      await expect(
        orders.updateOrderLine({
          orderId: order.orderId,
          orderLineId: (await orders.getOrder(order.orderId)).lines[0]!.orderLineId,
          quantity: '2',
        }),
      ).rejects.toMatchObject({ code: 'SETTLEMENT_EDIT_LOCKED' });

      await settlements.abortSettlement({ settlementGroupId: s1.settlementGroupId });
      await orders.updateOrderLine({
        orderId: order.orderId,
        orderLineId: (await orders.getOrder(order.orderId)).lines[0]!.orderLineId,
        quantity: '1',
      });
      await acceptFinalMerchandiseTerms(orders, order.orderId, {
        defaultGrossMinor: '0',
        idempotencyKey: `golden-s11-zero-${order.orderId}`,
      });

      const s2 = await settlements.openSettlement({
        orderId: order.orderId,
        idempotencyKey: `golden-open2-${order.orderId}`,
      });
      expect(s2.state).toBe('COLLECTING');
      expect(s2.customerPayableMinor).toBe('0');
      expect(s2.outstandingAmountMinor).toBe('0');

      const orch = new CheckoutOrchestrator(
        pool,
        orders,
        settlements.withDeps({ fiscalGate: fixedFiscalCheckoutGate('NOT_REQUIRED') }),
      );
      const advanced = await orch.tryAdvanceCheckout({
        settlementGroupId: s2.settlementGroupId,
        completeIdempotencyKey: `golden-s11-complete-${order.orderId}`,
        businessDate: '2026-09-16',
        businessOrder: 900,
      });
      expect(advanced.settlement.state).toBe('SATISFIED');
      expect((await orders.getOrder(order.orderId)).status).toBe('COMPLETED');
    });
  });

  describe('DEFERRED markers (must remain explicit — do not fake PASS)', () => {
    it('documents unsupported torture steps as EXPECTED STOP', () => {
      const deferred = [
        'MODIFIER commercial + physical semantics → future Modifier / Effective Recipe vertical',
        'DANGEROUS OPERATION / MANAGER OVERRIDE → future Authorization / Roles vertical',
        'SPLIT PAYMENT / SETTLEMENT runtime payments → Payments Core after S1.1',
        'PARTIAL RETURN → Partial Return / Partial Commercial Correction model',
        'PERIOD LOCK → PeriodLock vertical',
        'Contribution Margin / channel commissions / payment fees → ADR-0019 future',
        'Explainable Intelligence → later reads proven economic evidence only',
        'TOTAL_LOSS production variation → covered in D1.2B suite; not on main sale path',
        'React cashier Order Interaction UX → PASS P1.3 (domain Golden variation + web suite)',
        'MASS/VOLUME quantity entry UX → PASS P1.3 (authoritative dimension/unit metadata)',
        'COMMERCIAL ROUNDING POLICY runtime → PASS C1.1 (ADR-0030 BASE_LIST_LINE_GROSS)',
        'Settlement / Checkout foundation → PASS S1.1 (ADR-0032)',
        'Floor/Table runtime → DEFERRED (P1.1/P1.2/P1.3 tableless POS proven without Floor/Table)',
        'Payments / Fiscalization → DEFERRED (after S1.1; Payments Core before provider adapters)',
        'Settlement / Checkout orchestration boundary → PASS ADR-0032',
      ] as const;
      expect(deferred.length).toBeGreaterThanOrEqual(8);
      for (const d of deferred) {
        expect(d).toMatch(/→/);
      }
      expect(deferred.some((d) => d.includes('ADR-0030'))).toBe(true);
      expect(deferred.some((d) => d.includes('S1.1'))).toBe(true);
    });
  });
});
