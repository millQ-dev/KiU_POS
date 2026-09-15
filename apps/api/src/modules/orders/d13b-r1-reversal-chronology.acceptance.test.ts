import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { OperationalFactType } from '@millq/contracts';
import { orderMovementsForEconomicReplay } from '@millq/domain';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js'
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { IdempotencyConflictError } from './errors.js';
import { OrdersService } from './orders-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let orders: OrdersService;
let receipts: GoodsReceiptService;
let milkReceiptSeq = 0;

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
  opts?: { businessDate?: string; businessOrder?: number },
) {
  milkReceiptSeq += 1;
  const businessDate = opts?.businessDate ?? '2026-01-01';
  const businessOrder = opts?.businessOrder ?? milkReceiptSeq;
  const draft = await receipts.createDraft({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: `MILK-D13BR1-${milkReceiptSeq}`,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate,
    businessOrder,
    actorId: fx.actorId,
    lines: [milkLine(packageCount, unitPriceMinor)],
  });
  await receipts.post(draft!.goodsReceiptId, {
    idempotencyKey: `recv-milk-r1-${draft!.goodsReceiptId}`,
    actorId: fx.actorId,
  });
  return draft!.goodsReceiptId;
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
  await acceptFinalMerchandiseTerms(orders, order.orderId, {
    defaultGrossMinor: '0',
    idempotencyKey: `commercial:${idempotencyKey}`,
  });
  const result = await orders.completeOrder({
    orderId: order.orderId,
    idempotencyKey,
    businessDate,
    businessOrder,
    actorId: fx.actorId,
  });
  return { order, result };
}

type ChronoRow = {
  business_date: string;
  business_order: number;
  direction: string;
  source_document_type: string;
  acquisition_cost_minor: string;
  quantity: string;
};

async function milkMovements(): Promise<ChronoRow[]> {
  const r = await pool.query<ChronoRow>(
    `SELECT business_date::text AS business_date, business_order, direction,
            source_document_type, acquisition_cost_minor, quantity
     FROM inventory_movement
     WHERE catalog_item_id = $1
       AND legal_entity_id = $2
       AND warehouse_id = $3
     ORDER BY business_date ASC, business_order ASC`,
    [fx.milkItemId, fx.legalEntityId, fx.warehouseId],
  );
  return r.rows;
}

describe('Block D1.3B-R1 Reversal business chronology (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
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

  it('1 — same-day later order: compensating IN at Jan 10 / order 2; fact matches', async () => {
    await receiveMilkStock(10, '10000');
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-1-sale');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-1-rev',
      businessDate: '2026-01-10',
      businessOrder: 2,
      reason: 'same-day later',
      actorId: fx.actorId,
    });
    expect(reversed.status).toBe('reversed');

    const inMov = await pool.query<ChronoRow>(
      `SELECT business_date::text AS business_date, business_order, direction, source_document_type
       FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inMov.rowCount).toBe(1);
    expect(inMov.rows[0]).toMatchObject({
      direction: 'IN',
      source_document_type: 'GoodsIssueReversal',
      business_order: 2,
    });
    expect(inMov.rows[0]!.business_date.startsWith('2026-01-10')).toBe(true);

    const soc = await pool.query(
      `SELECT business_date::text AS business_date, business_order
       FROM sales_order_completion_reversal WHERE order_id = $1`,
      [order.orderId],
    );
    expect(soc.rows[0]!.business_date.startsWith('2026-01-10')).toBe(true);
    expect(soc.rows[0]!.business_order).toBe(2);

    const gir = await pool.query(
      `SELECT business_date::text AS business_date, business_order
       FROM goods_issue_reversal WHERE goods_issue_reversal_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(gir.rows[0]!.business_date.startsWith('2026-01-10')).toBe(true);
    expect(gir.rows[0]!.business_order).toBe(2);

    const fact = await pool.query(
      `SELECT business_date::text AS business_date, business_order, payload
       FROM operational_fact_feed WHERE fact_type = $1`,
      [OperationalFactType.OrderCompletionReversed],
    );
    expect(fact.rowCount).toBe(1);
    expect(fact.rows[0]!.business_date.startsWith('2026-01-10')).toBe(true);
    expect(fact.rows[0]!.business_order).toBe(2);
    expect(fact.rows[0]!.payload.orderId).toBe(order.orderId);
  });

  it('2 — later-day reversal: IN at Jan 12 / 5; original OUT stays Jan 10 / 1', async () => {
    await receiveMilkStock(10, '10000');
    const { order, result } = await completeMilkSale('1', '2026-01-10', 1, 'r1-2-sale');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-2-rev',
      businessDate: '2026-01-12',
      businessOrder: 5,
      reason: 'later day',
    });

    const outMov = await pool.query(
      `SELECT business_date::text AS business_date, business_order, direction
       FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(outMov.rows[0]).toMatchObject({ direction: 'OUT', business_order: 1 });
    expect(outMov.rows[0]!.business_date.startsWith('2026-01-10')).toBe(true);

    const inMov = await pool.query(
      `SELECT business_date::text AS business_date, business_order, direction
       FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inMov.rows[0]).toMatchObject({ direction: 'IN', business_order: 5 });
    expect(inMov.rows[0]!.business_date.startsWith('2026-01-12')).toBe(true);
  });

  it('3 — explicitly backdated reversal lands at Jan 9 / 1', async () => {
    await receiveMilkStock(10, '10000');
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-3-sale');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-3-rev',
      businessDate: '2026-01-09',
      businessOrder: 1,
      reason: 'backdated',
    });

    const inMov = await pool.query(
      `SELECT business_date::text AS business_date, business_order, direction
       FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inMov.rows[0]).toMatchObject({ direction: 'IN', business_order: 1 });
    expect(inMov.rows[0]!.business_date.startsWith('2026-01-09')).toBe(true);
  });

  it('4 — same-key same chronology retry → duplicate', async () => {
    await receiveMilkStock(5, '10000');
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-4-sale');

    const first = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-4-rev',
      businessDate: '2026-01-12',
      businessOrder: 3,
      reason: 'void',
    });
    expect(first.status).toBe('reversed');

    const second = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-4-rev',
      businessDate: '2026-01-12',
      businessOrder: 3,
      reason: 'void',
    });
    expect(second.status).toBe('duplicate');
    expect(second.reversalId).toBe(first.reversalId);
  });

  it('5 — same key different chronology → IdempotencyConflictError', async () => {
    await receiveMilkStock(5, '10000');
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-5-sale');

    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-5-rev',
      businessDate: '2026-01-12',
      businessOrder: 3,
      reason: 'void',
    });

    await expect(
      orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'r1-5-rev',
        businessDate: '2026-01-13',
        businessOrder: 3,
        reason: 'void',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('6 — different-key second reversal → ALREADY_REVERSED', async () => {
    await receiveMilkStock(5, '10000');
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-6-sale');

    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-6-rev-a',
      businessDate: '2026-01-12',
      businessOrder: 3,
      reason: 'void',
    });

    await expect(
      orders.reverseCompletedOrder({
        orderId: order.orderId,
        idempotencyKey: 'r1-6-rev-b',
        businessDate: '2026-01-12',
        businessOrder: 4,
        reason: 'again',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
  });

  it('7 — same-position linked sale+reversal → primary before reversal; FINAL', async () => {
    await receiveMilkStock(10, '10000', { businessDate: '2026-01-01', businessOrder: 1 });
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-7-sale');

    await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-7-rev',
      businessDate: '2026-01-10',
      businessOrder: 1,
      reason: 'same position',
    });

    const movs = await milkMovements();
    const samePos = movs.filter(
      (m) => m.business_date.startsWith('2026-01-10') && m.business_order === 1,
    );
    expect(samePos).toHaveLength(2);
    const { ordered, orderUnresolved } = orderMovementsForEconomicReplay(samePos);
    expect(orderUnresolved).toBe(false);
    expect(ordered[0]!.source_document_type).toBe('GoodsIssue');
    expect(ordered[1]!.source_document_type).toBe('GoodsIssueReversal');

    const bal = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(bal.quantity).toBe('10');
    expect(bal.carryingCertainty).toBe('FINAL');
  });

  it('8 — unrelated same-position → ORDER_UNRESOLVED', async () => {
    await receiveMilkStock(10, '10000', { businessDate: '2026-01-01', businessOrder: 1 });
    await completeMilkSale('1', '2026-01-10', 1, 'r1-8-sale-a');
    // Second independent sale at the same unresolved position (not a linked reversal).
    await completeMilkSale('1', '2026-01-10', 1, 'r1-8-sale-b');

    const movs = await milkMovements();
    const samePos = movs.filter(
      (m) => m.business_date.startsWith('2026-01-10') && m.business_order === 1,
    );
    expect(samePos.length).toBeGreaterThanOrEqual(2);
    expect(orderMovementsForEconomicReplay(samePos).orderUnresolved).toBe(true);

    const bal = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(bal.carryingCertainty).toBe('ORDER_UNRESOLVED');
  });

  it('9 — quantity returns only from reversal position forward', async () => {
    await receiveMilkStock(10, '10000', { businessDate: '2026-01-01', businessOrder: 1 });
    const { order, result } = await completeMilkSale('3', '2026-01-10', 1, 'r1-9-sale');

    const mid = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(mid.quantity).toBe('7');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-9-rev',
      businessDate: '2026-01-12',
      businessOrder: 1,
      reason: 'period B reverse',
    });

    const outMov = await pool.query(
      `SELECT business_date::text AS business_date, business_order
       FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(outMov.rows[0]!.business_date.startsWith('2026-01-10')).toBe(true);
    expect(outMov.rows[0]!.business_order).toBe(1);

    const inMov = await pool.query(
      `SELECT business_date::text AS business_date, business_order
       FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inMov.rows[0]!.business_date.startsWith('2026-01-12')).toBe(true);

    const end = await receipts.getBalance(fx.legalEntityId, fx.warehouseId, fx.milkItemId);
    expect(end.quantity).toBe('10');
  });

  it('10 — compensating IN cost equals original OUT historical sale cost', async () => {
    await receiveMilkStock(10, '10000');
    const { order, result } = await completeMilkSale('2', '2026-01-10', 1, 'r1-10-sale');

    const out = await pool.query<{ acquisition_cost_minor: string }>(
      `SELECT acquisition_cost_minor FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(out.rows[0]!.acquisition_cost_minor).toBe('20000');

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-10-rev',
      businessDate: '2026-01-12',
      businessOrder: 1,
      reason: 'cost parity',
    });

    const inn = await pool.query<{ acquisition_cost_minor: string; direction: string }>(
      `SELECT acquisition_cost_minor, direction FROM inventory_movement
       WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inn.rows[0]).toMatchObject({
      direction: 'IN',
      acquisition_cost_minor: out.rows[0]!.acquisition_cost_minor,
    });
  });

  it('11 — no current-cost revaluation after expensive receipt', async () => {
    await receiveMilkStock(5, '10000', { businessDate: '2026-01-01', businessOrder: 1 });
    const { order, result } = await completeMilkSale('1', '2026-01-10', 1, 'r1-11-sale');

    const originalOut = await pool.query<{ acquisition_cost_minor: string }>(
      `SELECT acquisition_cost_minor FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1`,
      [result.goodsIssueId],
    );
    expect(originalOut.rows[0]!.acquisition_cost_minor).toBe('10000');

    await receiveMilkStock(5, '90000', { businessDate: '2026-01-11', businessOrder: 1 });

    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-11-rev',
      businessDate: '2026-01-12',
      businessOrder: 1,
      reason: 'no reval',
    });

    const inn = await pool.query<{ acquisition_cost_minor: string }>(
      `SELECT acquisition_cost_minor FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inn.rows[0]!.acquisition_cost_minor).toBe('10000');
    expect(inn.rows[0]!.acquisition_cost_minor).toBe(originalOut.rows[0]!.acquisition_cost_minor);
  });

  it('13 — reversed_at ≠ economics; movement uses businessDate not NOW', async () => {
    await receiveMilkStock(5, '10000');
    const { order } = await completeMilkSale('1', '2026-01-10', 1, 'r1-13-sale');

    const before = Date.now();
    const reversed = await orders.reverseCompletedOrder({
      orderId: order.orderId,
      idempotencyKey: 'r1-13-rev',
      businessDate: '2026-01-08',
      businessOrder: 4,
      reason: 'audit clock vs business',
    });
    const after = Date.now();

    const inMov = await pool.query(
      `SELECT business_date::text AS business_date, business_order
       FROM inventory_movement WHERE source_document_id = $1`,
      [reversed.goodsIssueReversalId],
    );
    expect(inMov.rows[0]!.business_date.startsWith('2026-01-08')).toBe(true);
    expect(inMov.rows[0]!.business_order).toBe(4);

    const row = await pool.query<{
      business_date: string;
      business_order: number;
      reversed_at: Date;
    }>(
      `SELECT business_date::text AS business_date, business_order, reversed_at
       FROM sales_order_completion_reversal WHERE order_id = $1`,
      [order.orderId],
    );
    expect(row.rows[0]!.business_date.startsWith('2026-01-08')).toBe(true);
    expect(row.rows[0]!.business_order).toBe(4);

    const reversedAtMs = new Date(row.rows[0]!.reversed_at).getTime();
    expect(reversedAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(reversedAtMs).toBeLessThanOrEqual(after + 1000);
    expect(new Date(row.rows[0]!.reversed_at).toISOString().slice(0, 10)).not.toBe('2026-01-08');
  });
});
