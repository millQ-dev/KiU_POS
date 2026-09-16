import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { acceptFinalMerchandiseTerms, setOrderCommercialTermsWithRounding } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { RecipesService } from '../recipes/recipes-service.js';
import { ActualCogsService } from './actual-cogs-service.js';
import { RevenueBasisService } from './revenue-basis-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let recipes: RecipesService;
let receipts: GoodsReceiptService;
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
    supplierDocumentNumber: `MILK-REV-${receiptSeq}`,
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
    idempotencyKey: `recv-rev-${draft!.goodsReceiptId}`,
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

async function completeWithTerms(
  orderId: string,
  opts: {
    idempotencyKey: string;
    businessDate: string;
    businessOrder: number;
    businessTime?: string;
    commercial?: Parameters<typeof acceptFinalMerchandiseTerms>[2];
  },
) {
  if (opts.commercial) {
    await acceptFinalMerchandiseTerms(orders, orderId, {
      ...opts.commercial,
      idempotencyKey: opts.commercial.idempotencyKey ?? `commercial:${opts.idempotencyKey}`,
    });
  }
  return orders.completeOrder({
    orderId,
    idempotencyKey: opts.idempotencyKey,
    businessDate: opts.businessDate,
    businessOrder: opts.businessOrder,
    businessTime: opts.businessTime,
    actorId: fx.actorId,
  });
}

describe('Block D1.4C Revenue Basis read model (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const goodsIssue = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: goodsIssue });
    recipes = new RecipesService(pool);
    receipts = new GoodsReceiptService(pool);
    revenue = new RevenueBasisService(pool);
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

  it('1-3 — FINAL one-line and multi-line SALE; qty>1 reported once per sold line', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('2');
    await completeWithTerms(order.orderId, {
      idempotencyKey: 'rev-1',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '90000' },
    });

    const lines = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      effectType: 'SALE',
      signedRevenueBasisMinor: '90000',
      revenueCertainty: 'FINAL',
      soldCatalogItemId: fx.milkItemId,
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const order2 = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order2.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await orders.addOrderLine({
      orderId: order2.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '2',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const full = await orders.getOrder(order2.orderId);
    const [l1, l2] = full.lines;
    await setOrderCommercialTermsWithRounding(orders, {
      orderId: order2.orderId,
      idempotencyKey: 'rev-multi',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [
        { orderLineId: l1!.orderLineId, grossMerchandiseMinor: '50000' },
        { orderLineId: l2!.orderLineId, grossMerchandiseMinor: '100000' },
      ],
    });
    await orders.completeOrder({
      orderId: order2.orderId,
      idempotencyKey: 'rev-multi-c',
      businessDate: '2026-03-10',
      businessOrder: 2,
    });

    const multi = await revenue.listLineEffects(baseQuery({ orderId: order2.orderId }));
    expect(multi).toHaveLength(2);
    expect(multi.map((e) => e.signedRevenueBasisMinor).sort()).toEqual(['100000', '50000']);
    const agg = await revenue.aggregateByLine(baseQuery({ orderId: order2.orderId }));
    expect(agg.revenueBasisMinor).toBe('150000');
  });

  it('4-6 — line discount, frozen order discount allocation; reporting does not reallocate', async () => {
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
      catalogItemId: fx.oilItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const full = await orders.getOrder(order.orderId);
    const sorted = [...full.lines].sort((a, b) => a.lineNumber - b.lineNumber);
    await setOrderCommercialTermsWithRounding(orders, {
      orderId: order.orderId,
      idempotencyKey: 'rev-alloc',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '10',
      lineTerms: [
        {
          orderLineId: sorted[0]!.orderLineId,
          grossMerchandiseMinor: '100',
          lineMerchantFundedDiscountMinor: '5',
        },
        { orderLineId: sorted[1]!.orderLineId, grossMerchandiseMinor: '200' },
      ],
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-alloc-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const snap = await orders.getCommercialSnapshot(order.orderId);
    const lines = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines).toHaveLength(2);
    for (const l of snap!.lines) {
      const effect = lines.find((e) => e.orderLineId === l.orderLineId);
      expect(effect!.allocatedOrderMerchantDiscountMinor).toBe(l.allocatedOrderMerchantDiscountMinor);
      expect(effect!.signedRevenueBasisMinor).toBe(l.netMerchandiseSalesMinor);
    }
    expect(lines.find((e) => e.orderLineId === sorted[0]!.orderLineId)!.lineMerchantFundedDiscountMinor).toBe(
      '5',
    );

    // Re-accept terms on a different OPEN order — frozen completed reporting unchanged
    const other = await openMilkOrder('1');
    await acceptFinalMerchandiseTerms(orders, other.orderId, {
      defaultGrossMinor: '999',
      idempotencyKey: 'rev-alloc-other',
    });
    const frozenAgain = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(frozenAgain).toEqual(lines);
  });

  it('7-8 — complimentary FINAL zero ≠ UNKNOWN', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await setOrderCommercialTermsWithRounding(orders, {
      orderId: order.orderId,
      idempotencyKey: 'rev-comp',
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
      idempotencyKey: 'rev-comp-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const lines = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lines[0]!.signedRevenueBasisMinor).toBe('0');
    expect(lines[0]!.revenueCertainty).toBe('FINAL');

    const agg = await revenue.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(agg.revenueBasisMinor).toBe('0');
    expect(agg.certainty).toBe('FINAL');

    const cogsAgg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(cogsAgg.actualCogsMinor).toBe('10000');
  });

  it('9-13 — third-party funding; tax/tip/non-merch excluded; customerPayable differs', async () => {
    const order = await openMilkOrder('1');
    await setOrderCommercialTermsWithRounding(orders, {
      orderId: order.orderId,
      idempotencyKey: 'rev-3p',
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
    await receiveMilkStock(5, '10000');
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-3p-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const lineFx = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(lineFx[0]!.signedRevenueBasisMinor).toBe('120');
    expect(lineFx[0]!.thirdPartyMerchandiseFundingMinor).toBe('20');

    const orderFx = await revenue.listOrderEffects(baseQuery({ orderId: order.orderId }));
    expect(orderFx[0]).toMatchObject({
      signedRevenueBasisMinor: '120',
      taxMinor: '8000',
      tipMinor: '5000',
      nonMerchandiseChargesMinor: '15000',
      customerPayableMinor: '128000',
    });
    expect(orderFx[0]!.customerPayableMinor).not.toBe(orderFx[0]!.signedRevenueBasisMinor);
  });

  it('14-23 — SALE/REVERSAL chronology, periods, same-position, backdated, reversed_at ignored', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await completeWithTerms(order.orderId, {
      idempotencyKey: 'rev-sale',
      businessDate: '2026-03-10',
      businessOrder: 1,
      businessTime: '12:00:00',
      commercial: { defaultGrossMinor: '70000' },
    });

    const saleFx = await revenue.listLineEffects(baseQuery({ businessDate: '2026-03-10' }));
    expect(saleFx[0]).toMatchObject({
      effectType: 'SALE',
      businessDate: '2026-03-10',
      businessOrder: 1,
      businessTime: '12:00:00',
      signedRevenueBasisMinor: '70000',
    });

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-later',
      businessDate: '2026-03-15',
      businessOrder: 1,
      reason: 'later period',
      actorId: fx.actorId,
    });

    const revFx = await revenue.listLineEffects(baseQuery({ businessDate: '2026-03-15' }));
    expect(revFx).toHaveLength(1);
    expect(revFx[0]).toMatchObject({
      effectType: 'REVERSAL',
      signedRevenueBasisMinor: '-70000',
      salesOrderCompletionReversalId: reversed.reversalId,
      orderCommercialSnapshotId: saleFx[0]!.orderCommercialSnapshotId,
      orderLineCommercialSnapshotId: saleFx[0]!.orderLineCommercialSnapshotId,
    });

    const period10 = await revenue.aggregateByLine(baseQuery({ businessDate: '2026-03-10' }));
    expect(period10.revenueBasisMinor).toBe('70000');
    const period15 = await revenue.aggregateByLine(baseQuery({ businessDate: '2026-03-15' }));
    expect(period15.revenueBasisMinor).toBe('-70000');

    // Same-period sale + reversal → net 0
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const o2 = await openMilkOrder('1');
    await completeWithTerms(o2.orderId, {
      idempotencyKey: 'rev-same',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '50000' },
    });
    await orders.reverseCompletedOrder({
      orderId: o2.orderId,
      idempotencyKey: 'rev-same-r',
      businessDate: '2026-03-10',
      businessOrder: 2,
      reason: 'same period',
      actorId: fx.actorId,
    });
    const samePeriod = await revenue.listLineEffects(baseQuery({ businessDate: '2026-03-10' }));
    expect(samePeriod.map((e) => e.effectType)).toEqual(['SALE', 'REVERSAL']);
    const sameAgg = await revenue.aggregateByLine(baseQuery({ businessDate: '2026-03-10' }));
    expect(sameAgg.revenueBasisMinor).toBe('0');
    expect(sameAgg.componentCount).toBe(2);

    // Same-position linked — both visible
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const o3 = await openMilkOrder('1');
    await completeWithTerms(o3.orderId, {
      idempotencyKey: 'rev-pos',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '40000' },
    });
    await orders.reverseCompletedOrder({
      orderId: o3.orderId,
      idempotencyKey: 'rev-pos-r',
      businessDate: '2026-03-10',
      businessOrder: 1,
      reason: 'same position',
      actorId: fx.actorId,
    });
    const posFx = await revenue.listLineEffects(baseQuery({ orderId: o3.orderId }));
    expect(posFx).toHaveLength(2);
    expect(posFx.every((e) => e.revenueCertainty === 'FINAL')).toBe(true);

    // Backdated reversal — business period not reversed_at
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    receiptSeq = 0;
    await receiveMilkStock(10, '10000');
    const o4 = await openMilkOrder('1');
    await completeWithTerms(o4.orderId, {
      idempotencyKey: 'rev-back',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '60000' },
    });
    const revBack = await orders.reverseCompletedOrder({
      orderId: o4.orderId,
      idempotencyKey: 'rev-back-r',
      businessDate: '2026-03-05',
      businessOrder: 1,
      reason: 'backdated',
      actorId: fx.actorId,
    });
    const gir = await pool.query<{ reversed_at: Date }>(
      `SELECT reversed_at FROM sales_order_completion_reversal WHERE sales_order_completion_reversal_id = $1`,
      [revBack.reversalId],
    );
    const reversedAtDay = new Date(gir.rows[0]!.reversed_at).toISOString().slice(0, 10);
    expect(reversedAtDay).not.toBe('2026-03-05');
    const backFx = await revenue.listLineEffects(baseQuery({ businessDate: '2026-03-05' }));
    expect(backFx[0]!.effectType).toBe('REVERSAL');
    expect(backFx[0]!.signedRevenueBasisMinor).toBe('-60000');
  });

  it('16-17 — reversal uses original snapshot amount after price mutation', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await completeWithTerms(order.orderId, {
      idempotencyKey: 'rev-stab',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '80000' },
    });
    await pool.query(
      `UPDATE sales_order_commercial_line_terms SET gross_merchandise_minor = '999999'
       WHERE order_id = $1`,
      [order.orderId],
    );
    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-stab-r',
      businessDate: '2026-03-12',
      businessOrder: 1,
      reason: 'after mutation',
      actorId: fx.actorId,
    });
    const revFx = await revenue.listLineEffects(
      baseQuery({ orderId: order.orderId, effectType: 'REVERSAL' }),
    );
    expect(revFx[0]!.signedRevenueBasisMinor).toBe('-80000');
    expect(revFx[0]!.grossMerchandiseMinor).toBe('80000');
  });

  it('24-28 — UNKNOWN sale/reversal null; mixed aggregate; FINAL zero aggregate', async () => {
    await receiveMilkStock(5, '10000');
    const unk = await openMilkOrder('1');
    await setOrderCommercialTermsWithRounding(orders, {
      orderId: unk.orderId,
      idempotencyKey: 'rev-unk',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'UNKNOWN',
      commercialResolution: 'tax unavailable',
      lineTerms: [{ orderLineId: unk.lines[0]!.orderLineId, grossMerchandiseMinor: '100' }],
    });
    await orders.completeOrder({
      orderId: unk.orderId,
      idempotencyKey: 'rev-unk-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const unkFx = await revenue.listLineEffects(baseQuery({ orderId: unk.orderId }));
    expect(unkFx[0]!.signedRevenueBasisMinor).toBeNull();
    expect(unkFx[0]!.revenueCertainty).toBe('UNKNOWN');
    await orders.reverseCompletedOrder({
      orderId: unk.orderId,
      idempotencyKey: 'rev-unk-r',
      businessDate: '2026-03-11',
      businessOrder: 1,
      reason: 'unk reverse',
      actorId: fx.actorId,
    });
    const unkRev = await revenue.listLineEffects(
      baseQuery({ orderId: unk.orderId, effectType: 'REVERSAL' }),
    );
    expect(unkRev[0]!.signedRevenueBasisMinor).toBeNull();

    // Mixed FINAL + UNKNOWN
    const fin = await openMilkOrder('1');
    await completeWithTerms(fin.orderId, {
      idempotencyKey: 'rev-fin',
      businessDate: '2026-03-10',
      businessOrder: 2,
      commercial: { defaultGrossMinor: '50000' },
    });
    const mixed = await revenue.listLineEffects(
      baseQuery({ businessDateFrom: '2026-03-10', businessDateTo: '2026-03-11' }),
    );
    expect(mixed.length).toBeGreaterThanOrEqual(2);
    const mixedAgg = revenue.aggregateEffects(
      mixed.map((e) => ({
        signedRevenueBasisMinor: e.signedRevenueBasisMinor,
        revenueCertainty: e.revenueCertainty,
        currencyCode: e.currencyCode,
        minorUnitExponent: e.minorUnitExponent,
      })),
    );
    expect(mixedAgg.certainty).toBe('UNKNOWN');
    expect(mixedAgg.revenueBasisMinor).toBeNull();
    expect(mixedAgg.knownSubtotalMinor).toBe('50000');

    const zeroAgg = revenue.aggregateEffects([
      {
        signedRevenueBasisMinor: '0',
        revenueCertainty: 'FINAL',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      },
    ]);
    expect(zeroAgg.revenueBasisMinor).toBe('0');
    expect(zeroAgg.certainty).toBe('FINAL');
  });

  it('29-32 — multi-order aggregate; multi-currency rejected; empty no fabricated currency', async () => {
    await receiveMilkStock(10, '10000');
    const o1 = await openMilkOrder('1');
    await completeWithTerms(o1.orderId, {
      idempotencyKey: 'rev-a',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '30000' },
    });
    const o2 = await openMilkOrder('1');
    await completeWithTerms(o2.orderId, {
      idempotencyKey: 'rev-b',
      businessDate: '2026-03-10',
      businessOrder: 2,
      commercial: { defaultGrossMinor: '20000' },
    });
    const agg = await revenue.aggregateByLine(baseQuery({ businessDate: '2026-03-10' }));
    expect(agg.revenueBasisMinor).toBe('50000');
    expect(agg.currencyCode).toBe('VND');

    expect(() =>
      revenue.aggregateEffects([
        {
          signedRevenueBasisMinor: '100',
          revenueCertainty: 'FINAL',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        },
        {
          signedRevenueBasisMinor: '10',
          revenueCertainty: 'FINAL',
          currencyCode: 'USD',
          minorUnitExponent: 2,
        },
      ]),
    ).toThrow(DomainValidationError);

    const empty = await revenue.aggregateByLine(baseQuery({ businessDate: '2099-01-01' }));
    expect(empty).toMatchObject({
      componentCount: 0,
      revenueBasisMinor: '0',
      knownSubtotalMinor: '0',
      certainty: 'FINAL',
      currencyCode: null,
      minorUnitExponent: null,
    });

    const emptyFiltered = await revenue.aggregateByLine(
      baseQuery({ businessDate: '2099-01-01', currencyCode: 'VND' }),
    );
    expect(emptyFiltered.currencyCode).toBe('VND');
    expect(emptyFiltered.minorUnitExponent).toBeNull();
  });

  it('33-40 — tenant/legal/outlet/order/line/catalog/channel/date filters', async () => {
    await receiveMilkStock(20, '10000');
    const direct = await openMilkOrder('1', 'DIRECT');
    await completeWithTerms(direct.orderId, {
      idempotencyKey: 'rev-direct',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '10000' },
    });
    const delivery = await openMilkOrder('1', 'DELIVERY');
    await completeWithTerms(delivery.orderId, {
      idempotencyKey: 'rev-delivery',
      businessDate: '2026-03-11',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '20000' },
    });

    expect(await revenue.listLineEffects(baseQuery({ channel: 'DELIVERY' }))).toHaveLength(1);
    expect(
      (await revenue.listLineEffects(baseQuery({ channel: 'DELIVERY' })))[0]!.signedRevenueBasisMinor,
    ).toBe('20000');

    expect(await revenue.listLineEffects(baseQuery({ orderId: direct.orderId }))).toHaveLength(1);
    expect(
      (await revenue.listLineEffects(baseQuery({ orderLineId: direct.lines[0]!.orderLineId })))[0]!
        .orderId,
    ).toBe(direct.orderId);
    expect(
      (await revenue.listLineEffects(baseQuery({ soldCatalogItemId: fx.milkItemId }))).length,
    ).toBe(2);
    expect(await revenue.listLineEffects(baseQuery({ outletId: fx.outletId }))).toHaveLength(2);

    const foreignTenant = randomUUID();
    expect(await revenue.listLineEffects({ tenantId: foreignTenant })).toHaveLength(0);

    const range = await revenue.listLineEffects(
      baseQuery({ businessDateFrom: '2026-03-10', businessDateTo: '2026-03-10' }),
    );
    expect(range).toHaveLength(1);
    expect(range[0]!.signedRevenueBasisMinor).toBe('10000');
  });

  it('41-43 — one commercial line per sold line; no GoodsIssue/Inventory multiplication', async () => {
    const dishId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Milk drink','ea','COUNT')`,
      [dishId, fx.tenantId],
    );
    const recipe = await recipes.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Milk drink',
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
    await pool.query(
      `INSERT INTO supplier_pack (
         supplier_pack_id, tenant_id, name, pack_kind, units_per_package,
         unit_quantity, unit, dimension, to_base_unit, factor_per_unit
       ) VALUES ($1,$2,'Oil pack','FIXED',1,'1','L','VOLUME','L','1')`,
      [randomUUID(), fx.tenantId],
    );
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
    await acceptFinalMerchandiseTerms(orders, order.orderId, {
      grossByCatalogItemId: { [dishId]: '120000' },
      idempotencyKey: 'rev-dish',
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-dish-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const revLines = await revenue.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(revLines).toHaveLength(1);
    expect(revLines[0]!.signedRevenueBasisMinor).toBe('120000');

    const cogsLines = await cogs.listLineEffects(baseQuery({ orderId: order.orderId }));
    expect(cogsLines.length).toBeGreaterThan(1);
  });

  it('44-47 — historical stability: menu/promo/tax/payment config changes do not alter Revenue', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('1');
    await completeWithTerms(order.orderId, {
      idempotencyKey: 'rev-hist',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: {
        defaultGrossMinor: '75000',
        taxMinor: '5000',
        tipMinor: '3000',
        customerPayableMinor: '83000',
      },
    });
    const before = await revenue.aggregateByLine(baseQuery({ orderId: order.orderId }));

    await pool.query(
      `UPDATE sales_order_commercial_line_terms SET gross_merchandise_minor = '1' WHERE order_id = $1`,
      [order.orderId],
    );
    await pool.query(
      `UPDATE catalog_item SET name = 'Mutated milk' WHERE catalog_item_id = $1`,
      [fx.milkItemId],
    );

    const after = await revenue.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(after).toEqual(before);
    expect(cogs.foodCostRatioUnavailable).toBeDefined();
    try {
      cogs.foodCostRatioUnavailable();
      expect.unreachable('should throw');
    } catch (e) {
      expect((e as DomainValidationError).code).toBe('FOOD_COST_RATIO_USE_OPERATING_ECONOMICS');
    }
  });

  it('48-49 — reversal drill-down; line FINAL sums equal order Revenue Basis', async () => {
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
    await setOrderCommercialTermsWithRounding(orders, {
      orderId: order.orderId,
      idempotencyKey: 'rev-sum',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: full.lines.map((l) => ({
        orderLineId: l.orderLineId,
        grossMerchandiseMinor: '40000',
      })),
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-sum-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });

    const lineAgg = await revenue.aggregateByLine(baseQuery({ orderId: order.orderId }));
    const orderAgg = await revenue.aggregateByOrder(baseQuery({ orderId: order.orderId }));
    expect(lineAgg.revenueBasisMinor).toBe('80000');
    expect(orderAgg.revenueBasisMinor).toBe('80000');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'rev-sum-r',
      businessDate: '2026-03-12',
      businessOrder: 1,
      reason: 'drill',
      actorId: fx.actorId,
    });
    const revFx = await revenue.listLineEffects(
      baseQuery({ orderId: order.orderId, effectType: 'REVERSAL' }),
    );
    expect(revFx[0]!.salesOrderCompletionReversalId).toBe(reversed.reversalId);
    expect(revFx.every((e) => e.orderCommercialSnapshotId === revFx[0]!.orderCommercialSnapshotId)).toBe(
      true,
    );
  });

  it('50 — D1.4A Actual COGS regression unchanged for same order', async () => {
    await receiveMilkStock(10, '10000');
    const order = await openMilkOrder('2');
    await completeWithTerms(order.orderId, {
      idempotencyKey: 'rev-cogs',
      businessDate: '2026-03-10',
      businessOrder: 1,
      commercial: { defaultGrossMinor: '90000' },
    });
    const revAgg = await revenue.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(revAgg.revenueBasisMinor).toBe('90000');
    const cogsAgg = await cogs.aggregateByLine(baseQuery({ orderId: order.orderId }));
    expect(cogsAgg.actualCogsMinor).toBe('20000');
    expect(cogsAgg.certainty).toBe('FINAL');
  });
});
