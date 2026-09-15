import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { DomainValidationError, IdempotencyConflictError, OrderImmutableError } from './errors.js';
import { OrdersService } from './orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { ActualCogsService } from '../reporting/actual-cogs-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
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

async function receiveMilk(packageCount: number, unitPriceMinor: string) {
  receiptSeq += 1;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `MILK-D14B-${receiptSeq}`,
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
    idempotencyKey: `recv-d14b-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
}

async function openMilkOrder(qty = '1') {
  const order = await orders.openOrder({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    outletId: fx.outletId,
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

describe('Block D1.4B Order Commercial Snapshot (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const goodsIssue = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: goodsIssue });
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

  it('1+3+23+35 — multi-line FINAL snapshot; line nets sum to order Revenue Basis', async () => {
    await receiveMilk(20, '10000');
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
    const full = await orders.getOrder(order.orderId);
    const [l1, l2] = full.lines;
    await orders.setOrderCommercialTerms({
      orderId: order.orderId,
      idempotencyKey: 'd14b-1',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '0',
      lineTerms: [
        {
          orderLineId: l1!.orderLineId,
          resolvedUnitPriceMinor: '50000',
          grossMerchandiseMinor: '50000',
        },
        {
          orderLineId: l2!.orderLineId,
          resolvedUnitPriceMinor: '50000',
          grossMerchandiseMinor: '100000',
        },
      ],
    });
    await orders.completeOrder({
      orderId: order.orderId,
      idempotencyKey: 'd14b-1-complete',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const snap = await orders.getCommercialSnapshot(order.orderId);
    expect(snap).toBeTruthy();
    expect(snap!.certainty).toBe('FINAL');
    expect(snap!.netMerchandiseSalesMinor).toBe('150000');
    expect(snap!.lines).toHaveLength(2);
    const sum = snap!.lines.reduce((s, l) => s + BigInt(l.netMerchandiseSalesMinor!), 0n);
    expect(sum.toString()).toBe(snap!.netMerchandiseSalesMinor);
  });

  it('6-10 — largest-remainder order discount; residual by line_number; conservation', async () => {
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
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.meatItemId,
      quantity: '1',
      unit: 'kg',
      dimension: 'MASS',
    });
    const full = await orders.getOrder(order.orderId);
    const sorted = [...full.lines].sort((a, b) => a.lineNumber - b.lineNumber);
    const accepted = await orders.setOrderCommercialTerms({
      orderId: order.orderId,
      idempotencyKey: 'd14b-alloc',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '10',
      lineTerms: [
        { orderLineId: sorted[0]!.orderLineId, grossMerchandiseMinor: '100' },
        { orderLineId: sorted[1]!.orderLineId, grossMerchandiseMinor: '200' },
        { orderLineId: sorted[2]!.orderLineId, grossMerchandiseMinor: '300' },
      ],
    });
    expect(accepted.status).toBe('accepted');
    // Domain unit test locks algorithm; service returns allocated per line
    const byLine = new Map(
      (accepted as { lines: Array<{ lineNumber: number; allocatedOrderMerchantDiscountMinor: string }> })
        .lines.map((l) => [l.lineNumber, l.allocatedOrderMerchantDiscountMinor]),
    );
    expect(byLine.get(1)).toBe('2');
    expect(byLine.get(2)).toBe('3');
    expect(byLine.get(3)).toBe('5');
  });

  it('11-12 — reject over-discount and zero-basis nonzero order discount', async () => {
    const o = await openMilkOrder('1');
    await expect(
      orders.setOrderCommercialTerms({
        orderId: o.orderId,
        idempotencyKey: 'd14b-over',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '50',
        lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '10' }],
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    await expect(
      orders.setOrderCommercialTerms({
        orderId: o.orderId,
        idempotencyKey: 'd14b-zerobase',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '1',
        lineTerms: [
          {
            orderLineId: o.lines[0]!.orderLineId,
            grossMerchandiseMinor: '0',
            eligibleForOrderDiscount: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it('13-14 — complimentary item Revenue 0 with real Actual COGS > 0', async () => {
    await receiveMilk(10, '10000');
    const o = await openMilkOrder('1');
    await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'd14b-comp',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [
        {
          orderLineId: o.lines[0]!.orderLineId,
          grossMerchandiseMinor: '50000',
          lineMerchantFundedDiscountMinor: '50000',
        },
      ],
    });
    const completed = await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'd14b-comp-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const snap = await orders.getCommercialSnapshot(o.orderId);
    expect(snap!.netMerchandiseSalesMinor).toBe('0');
    expect(snap!.lines[0]!.netMerchandiseSalesMinor).toBe('0');
    const agg = await cogs.aggregateByLine({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      orderId: o.orderId,
    });
    expect(agg.actualCogsMinor).toBe('10000');
    expect(completed.goodsIssueId).toBeTruthy();
  });

  it('15-16 — third-party funding preserves merchant Revenue Basis', async () => {
    const o = await openMilkOrder('1');
    const accepted = await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'd14b-3p',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [
        {
          orderLineId: o.lines[0]!.orderLineId,
          grossMerchandiseMinor: '100',
          lineMerchantFundedDiscountMinor: '0',
          thirdPartyMerchandiseFundingMinor: '20',
          fundingProvenance: 'platform-promo-reimbursement',
        },
      ],
    });
    expect(accepted.netMerchandiseSalesMinor).toBe('120');
  });

  it('17-20 — tax/tip/non-merch/customerPayable excluded from Revenue Basis', async () => {
    const o = await openMilkOrder('1');
    const accepted = await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'd14b-tax',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      taxMinor: '8000',
      tipMinor: '5000',
      nonMerchandiseChargesMinor: '15000',
      customerPayableMinor: '128000',
      lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '100000' }],
    });
    expect(accepted.netMerchandiseSalesMinor).toBe('100000');
  });

  it('21 — one sales currency frozen on Order commercial snapshot', async () => {
    await receiveMilk(5, '10000');
    const o = await openMilkOrder('1');
    await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'd14b-cur',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '100' }],
    });
    await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'd14b-cur-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const snap = await orders.getCommercialSnapshot(o.orderId);
    expect(snap!.currencyCode).toBe('VND');
    expect(snap!.minorUnitExponent).toBe(0);
  });

  it('24-28 — set-terms idempotency, reprice OPEN, reject after COMPLETE/CANCEL', async () => {
    const o = await openMilkOrder('1');
    const a = await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'same-key',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '100' }],
    });
    const dup = await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'same-key',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '100' }],
    });
    expect(dup.status).toBe('duplicate');
    expect(dup.semanticFingerprint).toBe(a.semanticFingerprint);

    await expect(
      orders.setOrderCommercialTerms({
        orderId: o.orderId,
        idempotencyKey: 'same-key',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '200' }],
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const reprice = await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'new-key',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '200' }],
    });
    expect(reprice.status).toBe('accepted');
    expect(reprice.netMerchandiseSalesMinor).toBe('200');

    await receiveMilk(5, '10000');
    await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'done',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const before = await orders.getCommercialSnapshot(o.orderId);
    await expect(
      orders.setOrderCommercialTerms({
        orderId: o.orderId,
        idempotencyKey: 'after-complete',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '999' }],
      }),
    ).rejects.toBeInstanceOf(OrderImmutableError);
    const after = await orders.getCommercialSnapshot(o.orderId);
    expect(after).toEqual(before);

    const o2 = await openMilkOrder('1');
    await orders.cancelOrder({ orderId: o2.orderId, reason: 'guest left' });
    await expect(
      orders.setOrderCommercialTerms({
        orderId: o2.orderId,
        idempotencyKey: 'after-cancel',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        lineTerms: [{ orderLineId: o2.lines[0]!.orderLineId, grossMerchandiseMinor: '1' }],
      }),
    ).rejects.toBeInstanceOf(OrderImmutableError);
  });

  it('29-32 — completion without terms rejected; UNKNOWN nets null never zero', async () => {
    await receiveMilk(5, '10000');
    const o = await openMilkOrder('1');
    await expect(
      orders.completeOrder({
        orderId: o.orderId,
        idempotencyKey: 'no-terms',
        businessDate: '2026-03-10',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_TERMS_REQUIRED' });

    await orders.setOrderCommercialTerms({
      orderId: o.orderId,
      idempotencyKey: 'unk',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'UNKNOWN',
      commercialResolution: 'tax decomposition unavailable',
      lineTerms: [{ orderLineId: o.lines[0]!.orderLineId, grossMerchandiseMinor: '100' }],
    });
    await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'unk-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const snap = await orders.getCommercialSnapshot(o.orderId);
    expect(snap!.certainty).toBe('UNKNOWN');
    expect(snap!.netMerchandiseSalesMinor).toBeNull();
    expect(snap!.lines[0]!.netMerchandiseSalesMinor).toBeNull();
  });

  it('33-38 — one snapshot; deterministic hash; CompleteOrder retry no duplicate', async () => {
    await receiveMilk(5, '10000');
    const o = await openMilkOrder('1');
    await acceptFinalMerchandiseTerms(orders, o.orderId, {
      defaultGrossMinor: '70000',
      idempotencyKey: 'hash-terms',
    });
    const first = await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'hash-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const second = await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'hash-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    expect(second.status).toBe('duplicate');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS c FROM order_commercial_snapshot WHERE order_id = $1`,
      [o.orderId],
    );
    expect(count.rows[0]!.c).toBe(1);
    const snap = await orders.getCommercialSnapshot(o.orderId);
    expect(snap!.semanticHash).toHaveLength(64);
    expect(first.goodsIssueId).toBeTruthy();
  });

  it('43-45 — reverse leaves commercial snapshot immutable; COGS regression', async () => {
    await receiveMilk(10, '10000');
    const o = await openMilkOrder('2');
    await acceptFinalMerchandiseTerms(orders, o.orderId, { defaultGrossMinor: '90000' });
    await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'rev-c',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const before = await orders.getCommercialSnapshot(o.orderId);
    await orders.reverseCompletedOrder({
      orderId: o.orderId,
      idempotencyKey: 'rev',
      businessDate: '2026-03-12',
      businessOrder: 1,
      reason: 'guest complaint',
    });
    const after = await orders.getCommercialSnapshot(o.orderId);
    expect(after).toEqual(before);
    expect(after!.netMerchandiseSalesMinor).toBe('90000');
    const saleCogs = await cogs.aggregateByLine({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      orderId: o.orderId,
      businessDate: '2026-03-10',
    });
    expect(saleCogs.actualCogsMinor).toBe('20000');
  });

  it('49 — cannot attach another order line commercial terms', async () => {
    const a = await openMilkOrder('1');
    const b = await openMilkOrder('1');
    await expect(
      orders.setOrderCommercialTerms({
        orderId: a.orderId,
        idempotencyKey: 'foreign',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        lineTerms: [{ orderLineId: b.lines[0]!.orderLineId, grossMerchandiseMinor: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'FOREIGN_ORDER_LINE' });
  });

  it('line mutation after SetTerms invalidates commercial state before CompleteOrder', async () => {
    await receiveMilk(5, '10000');
    const o = await openMilkOrder('1');
    await acceptFinalMerchandiseTerms(orders, o.orderId, { defaultGrossMinor: '1000' });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await expect(
      orders.completeOrder({
        orderId: o.orderId,
        idempotencyKey: 'stale-c',
        businessDate: '2026-03-10',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_TERMS_REQUIRED' });

    await acceptFinalMerchandiseTerms(orders, o.orderId, { defaultGrossMinor: '1000' });
    await orders.completeOrder({
      orderId: o.orderId,
      idempotencyKey: 'stale-ok',
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    const snap = await orders.getCommercialSnapshot(o.orderId);
    expect(snap!.lines).toHaveLength(2);
  });
});
