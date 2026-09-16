/**
 * C1.1 — Commercial Rounding Runtime & Automatic Base Gross Acceptance (ADR-0030)
 * Level B — BASE_LIST_LINE_GROSS only. No Payments / Settlement / Fiscal / tax / cash / promo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { calculateRoundedLineGross, createMoney } from '@millq/domain';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { MenuService } from '../menu/index.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { BaseCommercialAcceptanceService } from './base-commercial-acceptance.js';
import { CommercialRoundingPolicyService } from './rounding-policy-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const TZ = 'Asia/Ho_Chi_Minh';
const BIZ = '2026-03-10T10:00:00.000Z';

let pool: pg.Pool;
let fx: BlockCFixture;
let policies: CommercialRoundingPolicyService;
let menu: MenuService;
let orders: OrdersService;
let acceptance: BaseCommercialAcceptanceService;
let receipts: GoodsReceiptService;
let seq = 0;
const idem = (p: string) => `${p}-${++seq}-${randomUUID()}`;

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
      commercial_rounding_policy,
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

function salesContext(overrides: Partial<{ businessDateTime: string }> = {}) {
  return {
    tenantId: fx.tenantId,
    brandId: fx.brandId,
    outletId: fx.outletId,
    orderChannel: 'DIRECT',
    businessDateTime: overrides.businessDateTime ?? BIZ,
  };
}

async function ensureMenuAndPrices(items: Array<{ catalogItemId: string; amountMinor: string }>) {
  await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: TZ });
  const def = await menu.createMenuDefinition({
    tenantId: fx.tenantId,
    code: `c11-${seq}`,
    name: 'C1.1 Menu',
  });
  await menu.setMenuDefinitionItems({
    menuDefinitionId: def.menuDefinitionId,
    catalogItemIds: items.map((i) => i.catalogItemId),
  });
  const pub = await menu.publishMenu({
    menuDefinitionId: def.menuDefinitionId,
    idempotencyKey: idem('pub'),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await menu.assignMenu({
    tenantId: fx.tenantId,
    menuPublicationId: pub.menuPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('assign'),
  });
  for (const item of items) {
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: item.catalogItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: item.amountMinor,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('price'),
    });
  }
}

async function createVnPolicy(overrides: {
  effectiveFrom?: string;
  effectiveTo?: string | null;
  legalEntityId?: string;
  jurisdictionCode?: string;
  policyVersion?: number;
} = {}) {
  return policies.createPolicy({
    tenantId: fx.tenantId,
    legalEntityId: overrides.legalEntityId ?? fx.legalEntityId,
    jurisdictionCode: overrides.jurisdictionCode ?? 'VN',
    calculationContext: 'BASE_LIST_LINE_GROSS',
    roundingMode: 'HALF_UP',
    quantumMinor: '1',
    effectiveFrom: overrides.effectiveFrom ?? '2026-01-01T00:00:00.000Z',
    effectiveTo: overrides.effectiveTo === undefined ? null : overrides.effectiveTo,
    ...(overrides.policyVersion != null ? { policyVersion: overrides.policyVersion } : {}),
  });
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  policies = new CommercialRoundingPolicyService(pool);
  menu = new MenuService(pool);
  orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
  acceptance = new BaseCommercialAcceptanceService(pool, orders);
  receipts = new GoodsReceiptService(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateBusiness();
  fx = await seedBlockCFixture(pool);
});

describe('C1.1 RoundingPolicy persistence & resolver', () => {
  it('1–3 — create policy; definition immutable; no production default seed', async () => {
    const seeded = await pool.query(`SELECT COUNT(*)::int AS n FROM commercial_rounding_policy`);
    expect(seeded.rows[0]!.n).toBe(0);

    const policy = await createVnPolicy();
    expect(policy.roundingMode).toBe('HALF_UP');
    expect(policy.quantumMinor).toBe('1');
    expect(policy.calculationContext).toBe('BASE_LIST_LINE_GROSS');

    await expect(
      pool.query(
        `UPDATE commercial_rounding_policy SET rounding_mode = 'DOWN' WHERE rounding_policy_id = $1`,
        [policy.roundingPolicyId],
      ),
    ).rejects.toThrow(/COMMERCIAL_ROUNDING_POLICY_IMMUTABLE/);
    await expect(
      pool.query(`DELETE FROM commercial_rounding_policy WHERE rounding_policy_id = $1`, [
        policy.roundingPolicyId,
      ]),
    ).rejects.toThrow(/COMMERCIAL_ROUNDING_POLICY_IMMUTABLE/);
  });

  it('4–8 — effectivity inclusive/exclusive; missing → REQUIRED; overlap → AMBIGUOUS', async () => {
    const from = '2026-03-10T00:00:00.000Z';
    const to = '2026-03-11T00:00:00.000Z';
    await createVnPolicy({ effectiveFrom: from, effectiveTo: to });

    await expect(
      policies.resolveRoundingPolicy({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        jurisdictionCode: 'VN',
        calculationContext: 'BASE_LIST_LINE_GROSS',
        businessDateTime: '2026-03-09T23:59:59.999Z',
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_REQUIRED' });

    const atFrom = await policies.resolveRoundingPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      calculationContext: 'BASE_LIST_LINE_GROSS',
      businessDateTime: from,
    });
    expect(atFrom.policyVersion).toBe(1);

    await expect(
      policies.resolveRoundingPolicy({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        jurisdictionCode: 'VN',
        calculationContext: 'BASE_LIST_LINE_GROSS',
        businessDateTime: to,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_REQUIRED' });

    await expect(
      createVnPolicy({
        effectiveFrom: '2026-03-10T12:00:00.000Z',
        effectiveTo: '2026-03-12T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_AMBIGUOUS' });
  });

  it('9–14 — LE / jurisdiction / tenant isolation; no global fallback; supersede by non-overlap', async () => {
    await createVnPolicy({ effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-06-01T00:00:00.000Z' });
    await createVnPolicy({
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      effectiveTo: null,
      policyVersion: 2,
    });

    const v1 = await policies.resolveRoundingPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      calculationContext: 'BASE_LIST_LINE_GROSS',
      businessDateTime: '2026-05-01T00:00:00.000Z',
    });
    expect(v1.policyVersion).toBe(1);
    const v2 = await policies.resolveRoundingPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      calculationContext: 'BASE_LIST_LINE_GROSS',
      businessDateTime: '2026-07-01T00:00:00.000Z',
    });
    expect(v2.policyVersion).toBe(2);

    await expect(
      policies.resolveRoundingPolicy({
        tenantId: fx.tenantId,
        legalEntityId: fx.otherLegalEntityId,
        jurisdictionCode: 'VN',
        calculationContext: 'BASE_LIST_LINE_GROSS',
        businessDateTime: BIZ,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_REQUIRED' });

    await expect(
      policies.resolveRoundingPolicy({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        jurisdictionCode: 'TH',
        calculationContext: 'BASE_LIST_LINE_GROSS',
        businessDateTime: BIZ,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_REQUIRED' });

    await expect(
      createVnPolicy({ legalEntityId: fx.otherLegalEntityId, jurisdictionCode: 'US' }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_INVALID' });
  });
});

describe('C1.1 arithmetic kernel (domain)', () => {
  const policy = {
    roundingPolicyId: '11111111-1111-4111-8111-111111111111',
    policyVersion: 1,
    calculationContext: 'BASE_LIST_LINE_GROSS' as const,
    roundingMode: 'HALF_UP' as const,
    quantumMinor: '1',
  };

  it('16–23 — COUNT exact provenance; MASS exact; HALF_UP boundaries; sub-minor delta', () => {
    const count = calculateRoundedLineGross({
      unitMoney: createMoney('65000', 'VND', 0),
      quantity: '2',
      roundingPolicy: policy,
    });
    expect(count.roundedGrossMoney.amountMinor).toBe('130000');
    expect(count.roundingDelta).toBe('0');
    expect(count.policyProvenance.roundingPolicyId).toBe(policy.roundingPolicyId);

    const mass = calculateRoundedLineGross({
      unitMoney: createMoney('450000', 'VND', 0),
      quantity: '0.25',
      roundingPolicy: policy,
    });
    expect(mass.exactUnroundedMinorBasis).toBe('112500');
    expect(mass.roundingDelta).toBe('0');

    const half = calculateRoundedLineGross({
      unitMoney: createMoney('10001', 'VND', 0),
      quantity: '0.5',
      roundingPolicy: policy,
    });
    expect(half.exactUnroundedMinorBasis).toBe('5000.5');
    expect(half.roundedGrossMoney.amountMinor).toBe('5001');
    expect(half.roundingDelta).toBe('0.5');
  });
});

describe('C1.1 Orders automatic acceptance', () => {
  it('31–45 — calculate+accept freezes provenance; mutation invalidates; reprice uses current', async () => {
    await createVnPolicy();
    await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: TZ });
    const def = await menu.createMenuDefinition({
      tenantId: fx.tenantId,
      code: `c11-${seq}`,
      name: 'C1.1 Menu',
    });
    await menu.setMenuDefinitionItems({
      menuDefinitionId: def.menuDefinitionId,
      catalogItemIds: [fx.eggItemId, fx.meatItemId],
    });
    const pub = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: idem('pub'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('assign'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.eggItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '65000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-03-10T12:00:00.000Z',
      idempotencyKey: idem('price-egg-v1'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.eggItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '70000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-03-10T12:00:00.000Z',
      idempotencyKey: idem('price-egg-v2'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.meatItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '10001',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('price-meat'),
    });

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
      catalogItemId: fx.meatItemId,
      quantity: '0.5',
      unit: 'kg',
      dimension: 'MASS',
    });

    await acceptance.calculateAndAcceptBaseCommercialTerms({
      orderId: order.orderId,
      salesContext: salesContext({ businessDateTime: '2026-03-10T10:00:00.000Z' }),
      idempotencyKey: idem('accept'),
    });

    let status = await orders.getOpenCommercialStatus(order.orderId);
    expect(status.commercialState).toBe('ACCEPTED');
    expect(status.merchandiseGrossMinor).toBe('135001'); // 130000 + 5001
    expect(status.commercialGrossPolicy).toBe('BASE_LIST_LINE_GROSS_ROUNDED');
    const massLine = status.lines.find((l) => l.grossMerchandiseMinor === '5001')!;
    expect(massLine.exactUnroundedMinorBasis).toBe('5000.5');
    expect(massLine.roundingDelta).toBe('0.5');
    expect(massLine.roundingPolicyId).toBeTruthy();

    const live = await orders.getOrder(order.orderId);
    const eggLine = live.lines.find((l) => l.catalogItemId === fx.eggItemId)!;
    await orders.updateOrderLine({
      orderId: order.orderId,
      orderLineId: eggLine.orderLineId,
      quantity: '3',
    });
    status = await orders.getOpenCommercialStatus(order.orderId);
    expect(status.commercialState).toBe('NOT_ACCEPTED');
    expect(status.merchandiseGrossMinor).toBeNull();

    await acceptance.calculateAndAcceptBaseCommercialTerms({
      orderId: order.orderId,
      salesContext: salesContext({ businessDateTime: '2026-03-10T10:00:00.000Z' }),
      idempotencyKey: idem('reaccept'),
    });
    status = await orders.getOpenCommercialStatus(order.orderId);
    expect(status.merchandiseGrossMinor).toBe('200001'); // 195000 + 5001

    // Price change does not mutate accepted state (still under v1 window facts)
    const frozenBefore = await orders.getOpenCommercialStatus(order.orderId);
    expect(frozenBefore.merchandiseGrossMinor).toBe('200001');

    // Explicit reprice at business instant governed by egg price v2
    await acceptance.calculateAndAcceptBaseCommercialTerms({
      orderId: order.orderId,
      salesContext: salesContext({ businessDateTime: '2026-03-10T13:00:00.000Z' }),
      idempotencyKey: idem('reprice'),
    });
    const afterReprice = await orders.getOpenCommercialStatus(order.orderId);
    expect(afterReprice.merchandiseGrossMinor).toBe('215001'); // 210000 + 5001
  });

  it('missing policy → REQUIRED; legacy explicit gross still readable', async () => {
    await ensureMenuAndPrices([{ catalogItemId: fx.eggItemId, amountMinor: '5000' }]);
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });

    await expect(
      acceptance.calculateAndAcceptBaseCommercialTerms({
        orderId: order.orderId,
        salesContext: salesContext(),
        idempotencyKey: idem('nop'),
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      acceptance.calculateAndAcceptBaseCommercialTerms({
        orderId: order.orderId,
        salesContext: salesContext(),
        idempotencyKey: idem('nop2'),
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_REQUIRED' });

    // OPTION A bare explicit gross is rejected (ADR-0030 §29)
    const live = await orders.getOrder(order.orderId);
    await expect(
      orders.setOrderCommercialTerms({
        orderId: order.orderId,
        idempotencyKey: idem('legacy'),
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '0',
        lineTerms: [
          {
            orderLineId: live.lines[0]!.orderLineId,
            resolvedUnitPriceMinor: '5000',
            grossMerchandiseMinor: '5000',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUNDING_POLICY_REQUIRED' });
  });

  it('46–49 — CompleteOrder freezes; later policy does not mutate; reversal leaves frozen facts', async () => {
    await createVnPolicy({
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-03-11T00:00:00.000Z',
    });
    await ensureMenuAndPrices([{ catalogItemId: fx.milkItemId, amountMinor: '10001' }]);

    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `C11-MILK-${seq}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-01-01',
      businessOrder: 1,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: fx.milkItemId,
          supplierItemId: fx.milkSupplierItemId,
          inputKind: 'FIXED_PACKAGE',
          packageCount: 10,
          acceptedBaseQuantity: '10',
          baseUnit: 'L',
          dimension: 'VOLUME',
          unitPriceMinor: '1000',
          lineAcquisitionCostMinor: '10000',
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: idem('recv'),
      actorId: fx.actorId,
    });

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '0.5',
      unit: 'L',
      dimension: 'VOLUME',
    });

    await acceptance.calculateAndAcceptBaseCommercialTerms({
      orderId: order.orderId,
      salesContext: salesContext(),
      idempotencyKey: idem('acc'),
    });

    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: idem('complete'),
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const snap = await orders.getCommercialSnapshot(order.orderId);
    expect(snap!.grossMerchandiseMinor).toBe('5001');
    expect(snap!.lines[0]!.exactUnroundedMinorBasis).toBe('5000.5');
    expect(snap!.lines[0]!.roundingDelta).toBe('0.5');

    await createVnPolicy({
      effectiveFrom: '2026-03-11T00:00:00.000Z',
      policyVersion: 2,
    });
    const snapAfter = await orders.getCommercialSnapshot(order.orderId);
    expect(snapAfter!.grossMerchandiseMinor).toBe('5001');
    expect(snapAfter!.lines[0]!.roundingPolicyVersion).toBe(1);

    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: idem('rev'),
      businessDate: '2026-03-11',
      businessOrder: 1,
      reason: 'c11-test',
    });
    const frozen = await orders.getCommercialSnapshot(order.orderId);
    expect(frozen!.grossMerchandiseMinor).toBe('5001');
    expect(frozen!.lines[0]!.exactUnroundedMinorBasis).toBe('5000.5');
    expect(frozen!.lines[0]!.roundingDelta).toBe('0.5');
  });
});
