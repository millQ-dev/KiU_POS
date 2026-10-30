/**
 * ORDERS-REPLACEMENT-DB-ACCEPTANCE (STREAM_ID KIU-COUNTER-ORDERS)
 *
 * Disposable PostgreSQL proof that a frozen modifier REPLACE drives CompleteOrder
 * inventory consumption when the replacement CatalogItem is absent from the base recipe.
 *
 * Scope: Orders + Modifiers + GoodsIssue persistence path only.
 * Does not re-implement KIU-QA C0 combined golden path (PR #154).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseCanonicalDecimal } from '@millq/domain';
import { OperationalFactType } from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { setOrderCommercialTermsWithRounding } from '../../test/commercial-terms.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { ModifiersService } from '../modifiers/index.js';
import { DomainValidationError, IdempotencyConflictError } from './errors.js';
import { OrdersService } from './orders-service.js';
import type { SaleInventoryWriteOffPort } from './sale-write-off-port.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeReplace = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

type ReplaceFixture = {
  latteItemId: string;
  coffeeItemId: string;
  oatDrinkItemId: string;
  milkItemId: string;
  milkGroupId: string;
  oatOptionId: string;
  oatDeltaId: string;
};

describeReplace('ADR-0049/0052 frozen REPLACE → CompleteOrder (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let ids: ReplaceFixture;
  let orders: OrdersService;
  let modifiers: ModifiersService;
  let receipts: GoodsReceiptService;
  let receiptSeq = 0;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    modifiers = new ModifiersService(pool);
    receipts = new GoodsReceiptService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
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
        order_line_modifier_selection,
        order_line_configuration,
        modifier_option_recipe_delta,
        catalog_item_modifier_group,
        modifier_option,
        modifier_group,
        sales_order_line,
        sales_order,
        catalog_item_recipe_profile,
        inventory_balance,
        inventory_movement,
        goods_receipt_line,
        goods_receipt,
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
    fx = await seedBlockCFixture(pool);
    ids = await seedReplaceFixture(pool, fx);
    receiptSeq = 0;
    await receiveLeafStock(ids.coffeeItemId, '1', 'kg', 'MASS', '100000');
    await receiveLeafStock(ids.oatDrinkItemId, '2', 'L', 'VOLUME', '20000');
    await receiveLeafStock(ids.milkItemId, '2', 'L', 'VOLUME', '15000');
  });

  async function receiveLeafStock(
    catalogItemId: string,
    qty: string,
    unit: string,
    dimension: 'MASS' | 'VOLUME' | 'COUNT',
    unitPriceMinor: string,
  ) {
    const packId = randomUUID();
    const supplierItemId = randomUUID();
    const packKind = dimension === 'MASS' ? 'VARIABLE_WEIGHT' : 'FIXED';
    if (packKind === 'VARIABLE_WEIGHT') {
      await pool.query(
        `INSERT INTO supplier_pack (
           supplier_pack_id, tenant_id, name, pack_kind, units_per_package, dimension, to_base_unit
         ) VALUES ($1,$2,'leaf-pack','VARIABLE_WEIGHT',1,$3,$4)`,
        [packId, fx.tenantId, dimension, unit],
      );
    } else {
      await pool.query(
        `INSERT INTO supplier_pack (
           supplier_pack_id, tenant_id, name, pack_kind, units_per_package,
           unit_quantity, unit, dimension, to_base_unit, factor_per_unit
         ) VALUES ($1,$2,'leaf-pack','FIXED',1,'1',$3,$4,$3,'1')`,
        [packId, fx.tenantId, unit, dimension],
      );
    }
    await pool.query(
      `INSERT INTO supplier_item (
         supplier_item_id, supplier_id, catalog_item_id, supplier_pack_id, external_sku, external_name
       ) VALUES ($1,$2,$3,$4,$5,'Leaf')`,
      [supplierItemId, fx.supplierId, catalogItemId, packId, `LEAF-${catalogItemId.slice(0, 8)}`],
    );
    receiptSeq += 1;
    const packageCount = Number(qty);
    const cost = String(Number(unitPriceMinor) * packageCount);
    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `REP-${receiptSeq}-${randomUUID().slice(0, 8)}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-10-30',
      businessOrder: receiptSeq,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId,
          supplierItemId,
          inputKind: packKind === 'VARIABLE_WEIGHT' ? 'VARIABLE_WEIGHT' : 'FIXED_PACKAGE',
          packageCount: packKind === 'VARIABLE_WEIGHT' ? 1 : packageCount,
          acceptedBaseQuantity: qty,
          baseUnit: unit,
          dimension,
          unitPriceMinor,
          lineAcquisitionCostMinor: cost,
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: `rep-recv-${draft!.goodsReceiptId}`,
      actorId: fx.actorId,
    });
  }

  async function openConfiguredLatte(opts?: {
    yieldOverride?: { quantity: string; unit: string; dimension: 'MASS' | 'VOLUME' | 'COUNT' };
  }) {
    if (opts?.yieldOverride) {
      await pool.query(
        `UPDATE modifier_option_recipe_delta
         SET replacement_quantity = $2,
             replacement_unit = $3,
             replacement_dimension = $4
         WHERE modifier_option_recipe_delta_id = $1`,
        [
          ids.oatDeltaId,
          opts.yieldOverride.quantity,
          opts.yieldOverride.unit,
          opts.yieldOverride.dimension,
        ],
      );
    }

    const opened = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    const withLine = await orders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: ids.latteItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const lineId = withLine.lines[0]!.orderLineId;
    const configured = await modifiers.configureOrderLine({
      orderId: opened.orderId,
      orderLineId: lineId,
      selections: [{ modifierGroupId: ids.milkGroupId, modifierOptionId: ids.oatOptionId }],
    });
    return { orderId: opened.orderId, lineId, configured };
  }

  async function acceptConfiguredCommercial(
    service: OrdersService,
    orderId: string,
    lineId: string,
    configurationFingerprint: string,
    idempotencyKey: string,
  ) {
    // Base 50000 + per-unit oat delta 5000 → gross 55000 (qty 1).
    await setOrderCommercialTermsWithRounding(service, {
      orderId,
      idempotencyKey: `commercial:${idempotencyKey}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '0',
      commercialResolution: 'REPLACE acceptance — BASE_LIST_LINE_GROSS + modifier',
      lineTerms: [
        {
          orderLineId: lineId,
          resolvedUnitPriceMinor: '50000',
          grossMerchandiseMinor: '55000',
          lineMerchantFundedDiscountMinor: '0',
          eligibleForOrderDiscount: true,
          thirdPartyMerchandiseFundingMinor: '0',
          certainty: 'FINAL',
          provenance: {
            additivePriceAdjustmentMinor: '5000',
            configurationFingerprint,
          },
        },
      ],
    });
  }

  async function completeConfigured(
    orderId: string,
    lineId: string,
    configurationFingerprint: string,
    idempotencyKey: string,
  ) {
    await acceptConfiguredCommercial(orders, orderId, lineId, configurationFingerprint, idempotencyKey);
    return orders.completeOrder({
      orderId,
      idempotencyKey,
      businessDate: '2026-10-30',
      businessOrder: 1,
      actorId: fx.actorId,
    });
  }

  async function leavesForOrder(orderId: string) {
    const rows = await pool.query<{
      catalog_item_id: string;
      quantity_base: string;
      unit_base: string;
    }>(
      `SELECT l.catalog_item_id, l.quantity_base, l.unit_base
       FROM consumption_plan_physical_leaf l
       JOIN consumption_plan_snapshot s ON s.consumption_plan_id = l.consumption_plan_id
       JOIN sales_order o ON o.consumption_plan_id = s.consumption_plan_id
       WHERE o.order_id = $1`,
      [orderId],
    );
    return rows.rows;
  }

  it('1–4 — persistence REPLACE: oat issued, milk not, converted qty, exactly one GoodsIssue', async () => {
    const { orderId, lineId, configured } = await openConfiguredLatte();
    expect(configured.additivePriceAdjustmentMinor).toBe('5000');

    const snap = await pool.query<{ effective_recipe_deltas_json: unknown }>(
      `SELECT effective_recipe_deltas_json FROM order_line_configuration WHERE order_line_id = $1`,
      [lineId],
    );
    expect(snap.rows[0]!.effective_recipe_deltas_json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'REPLACE_COMPONENT',
          targetCatalogItemId: ids.milkItemId,
          replacementCatalogItemId: ids.oatDrinkItemId,
        }),
      ]),
    );

    const result = await completeConfigured(
      orderId,
      lineId,
      configured.configurationFingerprint,
      'rep-happy-1',
    );
    expect(result.status).toBe('completed');
    expect(result.goodsIssueId).toBeTruthy();

    const issues = await pool.query<{ goods_issue_id: string; posting_status: string }>(
      `SELECT goods_issue_id, posting_status FROM goods_issue WHERE source_order_id = $1`,
      [orderId],
    );
    expect(issues.rowCount).toBe(1);
    expect(issues.rows[0]!.posting_status).toBe('POSTED');
    expect(issues.rows[0]!.goods_issue_id).toBe(result.goodsIssueId);

    const leaves = await leavesForOrder(orderId);
    const qty = (id: string) => leaves.find((r) => r.catalog_item_id === id)?.quantity_base;
    expect(parseCanonicalDecimal(qty(ids.coffeeItemId)!).eq(parseCanonicalDecimal('0.018'))).toBe(
      true,
    );
    // Base milk was 0.2 L; REPLACE without yield keeps source qty → oat 0.2 L (absent from base recipe).
    expect(parseCanonicalDecimal(qty(ids.oatDrinkItemId)!).eq(parseCanonicalDecimal('0.2'))).toBe(
      true,
    );
    expect(qty(ids.milkItemId)).toBeUndefined();

    const outs = await pool.query<{ catalog_item_id: string; quantity: string }>(
      `SELECT catalog_item_id, quantity FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1 AND direction = 'OUT'`,
      [result.goodsIssueId],
    );
    expect(outs.rows.map((r) => r.catalog_item_id).sort()).toEqual(
      [ids.coffeeItemId, ids.oatDrinkItemId].sort(),
    );
    expect(outs.rows.find((r) => r.catalog_item_id === ids.milkItemId)).toBeUndefined();
  });

  it('3b — published REPLACE yield override converts before issue', async () => {
    const { orderId, lineId, configured } = await openConfiguredLatte({
      yieldOverride: { quantity: '100', unit: 'ml', dimension: 'VOLUME' },
    });
    const result = await completeConfigured(
      orderId,
      lineId,
      configured.configurationFingerprint,
      'rep-yield-1',
    );
    expect(result.status).toBe('completed');

    const leaves = await leavesForOrder(orderId);
    const oat = leaves.find((r) => r.catalog_item_id === ids.oatDrinkItemId);
    expect(oat).toBeTruthy();
    expect(parseCanonicalDecimal(oat!.quantity_base).eq(parseCanonicalDecimal('0.1'))).toBe(true);
    expect(leaves.find((r) => r.catalog_item_id === ids.milkItemId)).toBeUndefined();
  });

  it('5 — repeated and concurrent CompleteOrder do not duplicate GoodsIssue', async () => {
    const { orderId, lineId, configured } = await openConfiguredLatte();
    const first = await completeConfigured(
      orderId,
      lineId,
      configured.configurationFingerprint,
      'rep-idem-1',
    );
    expect(first.status).toBe('completed');

    const replay = await orders.completeOrder({
      orderId,
      idempotencyKey: 'rep-idem-1',
      businessDate: '2026-10-30',
      businessOrder: 1,
      actorId: fx.actorId,
    });
    expect(replay.status).toBe('duplicate');

    await expect(
      orders.completeOrder({
        orderId,
        idempotencyKey: 'rep-idem-other',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const concurrentOpened = await openConfiguredLatte();
    await acceptConfiguredCommercial(
      orders,
      concurrentOpened.orderId,
      concurrentOpened.lineId,
      concurrentOpened.configured.configurationFingerprint,
      'rep-conc-1',
    );
    const concurrent = await Promise.allSettled([
      orders.completeOrder({
        orderId: concurrentOpened.orderId,
        idempotencyKey: 'rep-conc-1',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
      orders.completeOrder({
        orderId: concurrentOpened.orderId,
        idempotencyKey: 'rep-conc-1',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ]);
    const fulfilled = concurrent.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(2);
    const statuses = fulfilled.map(
      (r) => (r as PromiseFulfilledResult<{ status: string }>).value.status,
    );
    expect(statuses.sort()).toEqual(['completed', 'duplicate'].sort());

    for (const oid of [orderId, concurrentOpened.orderId]) {
      const gi = await pool.query(
        `SELECT COUNT(*)::int AS c FROM goods_issue WHERE source_order_id = $1`,
        [oid],
      );
      expect(gi.rows[0]!.c).toBe(1);
    }
  });

  it('6a — missing REPLACE target fails closed (order stays OPEN, no GI)', async () => {
    // Oil exists in the tenant but is not a top-level latte recipe component.
    await pool.query(
      `UPDATE modifier_option_recipe_delta
       SET target_catalog_item_id = $2
       WHERE modifier_option_recipe_delta_id = $1`,
      [ids.oatDeltaId, fx.oilItemId],
    );
    const { orderId, lineId, configured } = await openConfiguredLatte();
    await acceptConfiguredCommercial(
      orders,
      orderId,
      lineId,
      configured.configurationFingerprint,
      'rep-missing-1',
    );
    await expect(
      orders.completeOrder({
        orderId,
        idempotencyKey: 'rep-missing-1',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toMatchObject({ code: 'MODIFIER_DELTA_TARGET_MISSING' });

    const after = await orders.getOrder(orderId);
    expect(after.status).toBe('OPEN');
    const gi = await pool.query(
      `SELECT COUNT(*)::int AS c FROM goods_issue WHERE source_order_id = $1`,
      [orderId],
    );
    expect(gi.rows[0]!.c).toBe(0);
  });

  it('6b — cross-dimension REPLACE without conversion fails closed', async () => {
    // Keep source VOLUME qty/unit; replacement is MASS meat → explode rejects incompatible dimension.
    await pool.query(
      `UPDATE modifier_option_recipe_delta
       SET replacement_catalog_item_id = $2,
           replacement_quantity = NULL,
           replacement_unit = NULL,
           replacement_dimension = NULL
       WHERE modifier_option_recipe_delta_id = $1`,
      [ids.oatDeltaId, fx.meatItemId],
    );
    await receiveLeafStock(fx.meatItemId, '1', 'kg', 'MASS', '50000');

    const { orderId, lineId, configured } = await openConfiguredLatte();
    await acceptConfiguredCommercial(
      orders,
      orderId,
      lineId,
      configured.configurationFingerprint,
      'rep-xdim-1',
    );
    await expect(
      orders.completeOrder({
        orderId,
        idempotencyKey: 'rep-xdim-1',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    const after = await orders.getOrder(orderId);
    expect(after.status).toBe('OPEN');
    const gi = await pool.query(
      `SELECT COUNT(*)::int AS c FROM goods_issue WHERE source_order_id = $1`,
      [orderId],
    );
    expect(gi.rows[0]!.c).toBe(0);
  });

  it('6c — REPLACE targeting nested VIRTUAL preparation ingredient fails closed', async () => {
    const blendPrepSpec = randomUUID();
    const blendPrepVersion = randomUUID();
    const nestedLatte = randomUUID();
    const recipeSpec = randomUUID();
    const recipeVersion = randomUUID();

    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Nested latte','ea','COUNT')`,
      [nestedLatte, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO preparation_specification (preparation_specification_id, tenant_id, name)
       VALUES ($1,$2,'Milk blend')`,
      [blendPrepSpec, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO preparation_version (
         preparation_version_id, preparation_specification_id, version_number, status,
         materialization_mode,
         normative_input_quantity, normative_input_unit, normative_input_dimension,
         normative_output_quantity, normative_output_unit, normative_output_dimension,
         published_at
       ) VALUES ($1,$2,1,'PUBLISHED','VIRTUAL','1','ea','COUNT','1','ea','COUNT', NOW())`,
      [blendPrepVersion, blendPrepSpec],
    );
    await pool.query(
      `INSERT INTO preparation_component (
         preparation_component_id, preparation_version_id, line_number, component_kind,
         catalog_item_id, quantity, unit, dimension
       ) VALUES ($1,$2,1,'CATALOG_ITEM',$3,'0.2','L','VOLUME')`,
      [randomUUID(), blendPrepVersion, ids.milkItemId],
    );
    await pool.query(
      `INSERT INTO recipe_specification (recipe_specification_id, tenant_id, name)
       VALUES ($1,$2,'Nested latte')`,
      [recipeSpec, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO recipe_version (
         recipe_version_id, recipe_specification_id, version_number, status,
         batch_size_quantity, batch_size_unit, batch_size_dimension, published_at
       ) VALUES ($1,$2,1,'PUBLISHED','1','ea','COUNT', NOW())`,
      [recipeVersion, recipeSpec],
    );
    await pool.query(
      `INSERT INTO recipe_component (
         recipe_component_id, recipe_version_id, line_number, component_kind,
         nested_preparation_version_id, quantity, unit, dimension
       ) VALUES ($1,$2,1,'PREPARATION_VERSION',$3,'1','ea','COUNT')`,
      [randomUUID(), recipeVersion, blendPrepVersion],
    );
    await pool.query(
      `INSERT INTO catalog_item_recipe_profile (
         catalog_item_recipe_profile_id, tenant_id, catalog_item_id, recipe_specification_id
       ) VALUES ($1,$2,$3,$4)`,
      [randomUUID(), fx.tenantId, nestedLatte, recipeSpec],
    );
    await pool.query(
      `INSERT INTO catalog_item_modifier_group (
         catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
       ) VALUES ($1,$2,$3,$4,TRUE,1)`,
      [randomUUID(), fx.tenantId, nestedLatte, ids.milkGroupId],
    );

    const opened = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    const withLine = await orders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: nestedLatte,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const nestedConfigured = await modifiers.configureOrderLine({
      orderId: opened.orderId,
      orderLineId: withLine.lines[0]!.orderLineId,
      selections: [{ modifierGroupId: ids.milkGroupId, modifierOptionId: ids.oatOptionId }],
    });
    await acceptConfiguredCommercial(
      orders,
      opened.orderId,
      withLine.lines[0]!.orderLineId,
      nestedConfigured.configurationFingerprint,
      'rep-nested-1',
    );
    await expect(
      orders.completeOrder({
        orderId: opened.orderId,
        idempotencyKey: 'rep-nested-1',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toMatchObject({ code: 'MODIFIER_DELTA_NESTED_TARGET' });

    const after = await orders.getOrder(opened.orderId);
    expect(after.status).toBe('OPEN');
  });

  it('7 — inventory write-off failure rolls back completion and movements', async () => {
    const failingPort: SaleInventoryWriteOffPort = {
      async postGoodsIssueFromConsumptionPlan() {
        throw new Error('simulated inventory failure after REPLACE resolve');
      },
      async reverseGoodsIssueFromOrder() {
        throw new Error('not used');
      },
    };
    const failingOrders = new OrdersService(pool, { saleWriteOffPort: failingPort });
    const failingModifiers = new ModifiersService(pool);

    const opened = await failingOrders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    const withLine = await failingOrders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: ids.latteItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const failingConfigured = await failingModifiers.configureOrderLine({
      orderId: opened.orderId,
      orderLineId: withLine.lines[0]!.orderLineId,
      selections: [{ modifierGroupId: ids.milkGroupId, modifierOptionId: ids.oatOptionId }],
    });
    await acceptConfiguredCommercial(
      failingOrders,
      opened.orderId,
      withLine.lines[0]!.orderLineId,
      failingConfigured.configurationFingerprint,
      'rep-fail-1',
    );

    await expect(
      failingOrders.completeOrder({
        orderId: opened.orderId,
        idempotencyKey: 'rep-fail-1',
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toThrow(/simulated inventory failure/);

    const after = await orders.getOrder(opened.orderId);
    expect(after.status).toBe('OPEN');
    expect(after.consumptionPlanId).toBeNull();
    const gi = await pool.query(`SELECT COUNT(*)::int AS c FROM goods_issue`);
    expect(gi.rows[0]!.c).toBe(0);
    const mov = await pool.query(
      `SELECT COUNT(*)::int AS c FROM inventory_movement WHERE source_document_type = 'GoodsIssue'`,
    );
    expect(mov.rows[0]!.c).toBe(0);
    const facts = await pool.query(
      `SELECT COUNT(*)::int AS c FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.OrderCompleted],
    );
    expect(facts.rows[0]!.c).toBe(0);
  });

  it('8 — frozen REPLACE stays authoritative after live option delta changes', async () => {
    const { orderId, lineId, configured } = await openConfiguredLatte();
    await acceptConfiguredCommercial(
      orders,
      orderId,
      lineId,
      configured.configurationFingerprint,
      'rep-freeze-1',
    );

    const frozenBefore = await pool.query<{
      frozen_at: Date | null;
      effective_recipe_deltas_json: unknown;
    }>(
      `SELECT frozen_at, effective_recipe_deltas_json FROM order_line_configuration WHERE order_line_id = $1`,
      [lineId],
    );
    expect(frozenBefore.rows[0]!.frozen_at).toBeTruthy();
    expect(frozenBefore.rows[0]!.effective_recipe_deltas_json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'REPLACE_COMPONENT',
          replacementCatalogItemId: ids.oatDrinkItemId,
        }),
      ]),
    );

    // Live menu mutates after commercial freeze: REMOVE instead of REPLACE, different yield.
    await pool.query(
      `UPDATE modifier_option_recipe_delta
       SET delta_kind = 'REMOVE_COMPONENT',
           replacement_catalog_item_id = NULL,
           replacement_quantity = NULL,
           replacement_unit = NULL,
           replacement_dimension = NULL
       WHERE modifier_option_recipe_delta_id = $1`,
      [ids.oatDeltaId],
    );

    const result = await orders.completeOrder({
      orderId,
      idempotencyKey: 'rep-freeze-1',
      businessDate: '2026-10-30',
      businessOrder: 1,
      actorId: fx.actorId,
    });
    expect(result.status).toBe('completed');

    const leaves = await leavesForOrder(orderId);
    expect(leaves.find((r) => r.catalog_item_id === ids.oatDrinkItemId)).toBeTruthy();
    expect(leaves.find((r) => r.catalog_item_id === ids.milkItemId)).toBeUndefined();
    expect(
      parseCanonicalDecimal(
        leaves.find((r) => r.catalog_item_id === ids.oatDrinkItemId)!.quantity_base,
      ).eq(parseCanonicalDecimal('0.2')),
    ).toBe(true);

    const frozenAfter = await pool.query<{ effective_recipe_deltas_json: unknown }>(
      `SELECT effective_recipe_deltas_json FROM order_line_configuration WHERE order_line_id = $1`,
      [lineId],
    );
    expect(frozenAfter.rows[0]!.effective_recipe_deltas_json).toEqual(
      frozenBefore.rows[0]!.effective_recipe_deltas_json,
    );
  });
});

async function seedReplaceFixture(pool: pg.Pool, fx: BlockCFixture): Promise<ReplaceFixture> {
  const ids: ReplaceFixture = {
    latteItemId: randomUUID(),
    coffeeItemId: randomUUID(),
    oatDrinkItemId: randomUUID(),
    milkItemId: fx.milkItemId,
    milkGroupId: randomUUID(),
    oatOptionId: randomUUID(),
    oatDeltaId: randomUUID(),
  };

  await pool.query(
    `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension) VALUES
      ($1,$4,'Latte','ea','COUNT'),
      ($2,$4,'Coffee beans','kg','MASS'),
      ($3,$4,'Oat drink','L','VOLUME')`,
    [ids.latteItemId, ids.coffeeItemId, ids.oatDrinkItemId, fx.tenantId],
  );

  const recipeSpecId = randomUUID();
  const recipeVersionId = randomUUID();
  await pool.query(
    `INSERT INTO recipe_specification (recipe_specification_id, tenant_id, name) VALUES ($1,$2,'Latte')`,
    [recipeSpecId, fx.tenantId],
  );
  await pool.query(
    `INSERT INTO recipe_version (
       recipe_version_id, recipe_specification_id, version_number, status,
       batch_size_quantity, batch_size_unit, batch_size_dimension, published_at
     ) VALUES ($1,$2,1,'PUBLISHED','1','ea','COUNT', NOW())`,
    [recipeVersionId, recipeSpecId],
  );
  await pool.query(
    `INSERT INTO recipe_component (
       recipe_component_id, recipe_version_id, line_number, component_kind, catalog_item_id,
       quantity, unit, dimension
     ) VALUES
      ($1,$3,1,'CATALOG_ITEM',$4,'0.018','kg','MASS'),
      ($2,$3,2,'CATALOG_ITEM',$5,'0.2','L','VOLUME')`,
    [randomUUID(), randomUUID(), recipeVersionId, ids.coffeeItemId, ids.milkItemId],
  );
  await pool.query(
    `INSERT INTO catalog_item_recipe_profile (
       catalog_item_recipe_profile_id, tenant_id, catalog_item_id, recipe_specification_id
     ) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), fx.tenantId, ids.latteItemId, recipeSpecId],
  );

  await pool.query(
    `INSERT INTO modifier_group (
       modifier_group_id, tenant_id, code, name, selection_mode, min_select, max_select, ask_every_time
     ) VALUES ($1,$2,'milk','Milk','SINGLE',1,1,TRUE)`,
    [ids.milkGroupId, fx.tenantId],
  );
  await pool.query(
    `INSERT INTO modifier_option (
       modifier_option_id, tenant_id, modifier_group_id, code, name, sort_order, price_adjustment_minor,
       kitchen_instruction_code
     ) VALUES ($1,$2,$3,'oat','Oat drink',1,'5000','MILK_OAT')`,
    [ids.oatOptionId, fx.tenantId, ids.milkGroupId],
  );
  await pool.query(
    `INSERT INTO modifier_option_recipe_delta (
       modifier_option_recipe_delta_id, tenant_id, modifier_option_id, delta_kind,
       target_catalog_item_id, replacement_catalog_item_id
     ) VALUES ($1,$2,$3,'REPLACE_COMPONENT',$4,$5)`,
    [ids.oatDeltaId, fx.tenantId, ids.oatOptionId, ids.milkItemId, ids.oatDrinkItemId],
  );
  await pool.query(
    `INSERT INTO catalog_item_modifier_group (
       catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
     ) VALUES ($1,$2,$3,$4,TRUE,1)`,
    [randomUUID(), fx.tenantId, ids.latteItemId, ids.milkGroupId],
  );

  return ids;
}
