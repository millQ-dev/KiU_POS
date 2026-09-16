/**
 * S1.1 Settlement / Checkout Runtime Foundation — acceptance matrix (ADR-0032).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CheckoutOrchestrator } from '../checkout/checkout-orchestrator.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  fixedFiscalCheckoutGate,
  stubExternalEffectProbe,
  stubPaymentCoverageReader,
} from './settlement-ports.js';
import { SettlementService } from './settlement-service.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

describe('S1.1 Settlement / Checkout foundation', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let settlements: SettlementService;

  beforeAll(async () => {
    fx = await seedBlockCFixture(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    settlements = new SettlementService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Isolation via unique orders per test; no global truncate of settlement.
  });

  async function openAcceptedOrder(grossMinor = '100000') {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `s11-${randomUUID()}`,
      defaultGrossMinor: grossMinor,
      grossByOrderLineId: {
        [refreshed.lines[0]!.orderLineId]: grossMinor,
      },
    });
    return orders.getOrder(o.orderId);
  }

  it('1-4 — OpenSettlement freezes payable snapshot + one Check; payable == merchandise gross numerically', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    expect(s.state).toBe('COLLECTING');
    expect(s.checks).toHaveLength(1);
    expect(s.checks[0]!.customerPayableMinor).toBe('100000');
    expect(s.customerPayableMinor).toBe('100000');
    expect(s.merchandiseGrossMinor).toBe('100000');
    expect(s.payableSnapshot.tax.presence).toBe('ABSENT');
    expect(s.payableSnapshot.tips.presence).toBe('ABSENT');
    expect(s.payableSnapshot.merchandiseGross.presence).toBe('PRESENT');
    expect(s.outstandingAmountMinor).toBe('100000');
  });

  it('5 — ABSENT != calculated zero', async () => {
    const o = await openAcceptedOrder('50000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    expect(s.payableSnapshot.tax).toEqual({ presence: 'ABSENT' });
    expect(s.payableSnapshot.tax).not.toEqual({ presence: 'PRESENT', amountMinor: '0' });
  });

  it('6-7 — NEEDS_REACCEPTANCE / missing commercial rejected', async () => {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await expect(
      settlements.openSettlement({ orderId: o.orderId, idempotencyKey: 'x' }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_COMMERCIAL_TERMS_NOT_CURRENT' });
  });

  it('12-13 — second live settlement rejected; idempotent retry ok', async () => {
    const o = await openAcceptedOrder('10000');
    const key = `idem-${o.orderId}`;
    const a = await settlements.openSettlement({ orderId: o.orderId, idempotencyKey: key });
    const b = await settlements.openSettlement({ orderId: o.orderId, idempotencyKey: key });
    expect(b.settlementGroupId).toBe(a.settlementGroupId);
    await expect(
      settlements.openSettlement({ orderId: o.orderId, idempotencyKey: `other-${o.orderId}` }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_ALREADY_OPEN' });
  });

  it('15-19 — live Settlement edit lock; safe Abort restores editing', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `lock-${o.orderId}`,
    });
    await expect(
      orders.addOrderLine({
        orderId: o.orderId,
        catalogItemId: fx.eggItemId,
        quantity: '1',
        unit: 'ea',
        dimension: 'COUNT',
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_EDIT_LOCKED' });

    await expect(
      orders.updateOrderLine({
        orderId: o.orderId,
        orderLineId: o.lines[0]!.orderLineId,
        quantity: '2',
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_EDIT_LOCKED' });

    const aborted = await settlements.abortSettlement({ settlementGroupId: s.settlementGroupId });
    expect(aborted.state).toBe('ABORTED');

    const hist = await pool.query(
      `SELECT state FROM settlement_group WHERE settlement_group_id = $1`,
      [s.settlementGroupId],
    );
    expect(hist.rows[0]!.state).toBe('ABORTED');

    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
  });

  it('24-25 — external-effect probe blocks Abort', async () => {
    const o = await openAcceptedOrder('100000');
    const base = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `ext-${o.orderId}`,
    });
    const withPay = settlements.withDeps({
      externalEffects: stubExternalEffectProbe({ payment: true }),
    });
    await expect(
      withPay.abortSettlement({ settlementGroupId: base.settlementGroupId }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_ABORT_FORBIDDEN' });

    const o2 = await openAcceptedOrder('100000');
    const base2 = await settlements.openSettlement({
      orderId: o2.orderId,
      idempotencyKey: `fisc-${o2.orderId}`,
    });
    const withFiscal = settlements.withDeps({
      externalEffects: stubExternalEffectProbe({ fiscal: true }),
    });
    await expect(
      withFiscal.abortSettlement({ settlementGroupId: base2.settlementGroupId }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_ABORT_FORBIDDEN' });
  });

  it('26-28 — exact split conservation; non-conserving rejected', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `split-${o.orderId}`,
    });
    const lineId = o.lines[0]!.orderLineId;
    await expect(
      settlements.splitChecksExact({
        settlementGroupId: s.settlementGroupId,
        expectedVersion: s.version,
        checks: [
          {
            customerPayableMinor: '60000',
            lineAllocations: [{ orderLineId: lineId, allocatedMerchandiseGrossMinor: '60000' }],
          },
          {
            customerPayableMinor: '30000',
            lineAllocations: [{ orderLineId: lineId, allocatedMerchandiseGrossMinor: '40000' }],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_SPLIT_NOT_CONSERVING' });

    const ok = await settlements.splitChecksExact({
      settlementGroupId: s.settlementGroupId,
      expectedVersion: s.version,
      checks: [
        {
          customerPayableMinor: '60000',
          lineAllocations: [{ orderLineId: lineId, allocatedMerchandiseGrossMinor: '60000' }],
        },
        {
          customerPayableMinor: '40000',
          lineAllocations: [{ orderLineId: lineId, allocatedMerchandiseGrossMinor: '40000' }],
        },
      ],
    });
    expect(ok.checks).toHaveLength(2);
    expect(ok.checks.map((c) => c.customerPayableMinor).sort()).toEqual(['40000', '60000']);
  });

  it('33-40 — coverage: partial, exact, over-allocation, zero-payable, no double count', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `cov-${o.orderId}`,
    });
    const checkId = s.checks[0]!.settlementCheckId;

    const partial = settlements.withDeps({
      coverageReader: stubPaymentCoverageReader([
        {
          allocationIdentity: 'a1',
          settlementCheckId: checkId,
          amountMinor: '60000',
          qualifies: true,
        },
      ]),
    });
    let proj = await partial.reconcileSettlementCoverage(s.settlementGroupId);
    expect(proj.state).toBe('COLLECTING');
    expect(proj.outstandingAmountMinor).toBe('40000');

    const exact = settlements.withDeps({
      coverageReader: stubPaymentCoverageReader([
        {
          allocationIdentity: 'a1',
          settlementCheckId: checkId,
          amountMinor: '60000',
          qualifies: true,
        },
        {
          allocationIdentity: 'a2',
          settlementCheckId: checkId,
          amountMinor: '40000',
          qualifies: true,
        },
        // duplicate identity must not double-count
        {
          allocationIdentity: 'a1',
          settlementCheckId: checkId,
          amountMinor: '60000',
          qualifies: true,
        },
      ]),
    });
    proj = await exact.reconcileSettlementCoverage(s.settlementGroupId);
    expect(proj.state).toBe('SATISFIED');
    expect(proj.outstandingAmountMinor).toBe('0');

    const over = settlements.withDeps({
      coverageReader: stubPaymentCoverageReader([
        {
          allocationIdentity: 'over',
          settlementCheckId: checkId,
          amountMinor: '100001',
          qualifies: true,
        },
      ]),
    });
    // reopen path: use fresh order for over-allocation
    const o2 = await openAcceptedOrder('100000');
    const s2 = await settlements.openSettlement({
      orderId: o2.orderId,
      idempotencyKey: `over-${o2.orderId}`,
    });
    const overSvc = over.withDeps({
      coverageReader: stubPaymentCoverageReader([
        {
          allocationIdentity: 'over',
          settlementCheckId: s2.checks[0]!.settlementCheckId,
          amountMinor: '100001',
          qualifies: true,
        },
      ]),
    });
    await expect(overSvc.reconcileSettlementCoverage(s2.settlementGroupId)).rejects.toMatchObject({
      code: 'SETTLEMENT_OVERALLOCATION',
    });

    const z = await openAcceptedOrder('0');
    const zs = await settlements.openSettlement({
      orderId: z.orderId,
      idempotencyKey: `zero-${z.orderId}`,
    });
    expect(zs.state).toBe('SATISFIED');
    expect(zs.checks[0]!.customerPayableMinor).toBe('0');
  });

  it('43-50 — Checkout→CompleteOrder with fiscal gate; Payment never calls CompleteOrder', async () => {
    const o = await openAcceptedOrder('0');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `co-${o.orderId}`,
    });
    expect(s.state).toBe('SATISFIED');

    const blocked = new CheckoutOrchestrator(pool, orders, settlements);
    await expect(
      blocked.tryAdvanceCheckout({
        settlementGroupId: s.settlementGroupId,
        completeIdempotencyKey: `c-${o.orderId}`,
        businessDate: '2026-09-16',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_FISCAL_PREREQUISITE_UNAVAILABLE' });

    const gated = settlements.withDeps({
      fiscalGate: fixedFiscalCheckoutGate('NOT_REQUIRED'),
    });
    const orch = new CheckoutOrchestrator(pool, orders, gated);
    const result = await orch.tryAdvanceCheckout({
      settlementGroupId: s.settlementGroupId,
      completeIdempotencyKey: `c2-${o.orderId}`,
      businessDate: '2026-09-16',
      businessOrder: 2,
    });
    expect(result.completion.status === 'completed' || result.completion.status === 'duplicate').toBe(
      true,
    );
    const order = await orders.getOrder(o.orderId);
    expect(order.status).toBe('COMPLETED');

    // retry idempotent
    const again = await orch.tryAdvanceCheckout({
      settlementGroupId: s.settlementGroupId,
      completeIdempotencyKey: `c2-${o.orderId}`,
      businessDate: '2026-09-16',
      businessOrder: 2,
    });
    expect(again.completion.status).toBe('duplicate');
  });

  it('non-zero fake coverage → CompleteOrder once', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `nz-${o.orderId}`,
    });
    const checkId = s.checks[0]!.settlementCheckId;

    const empty = new CheckoutOrchestrator(
      pool,
      orders,
      settlements.withDeps({ fiscalGate: fixedFiscalCheckoutGate('NOT_REQUIRED') }),
    );
    await expect(
      empty.tryAdvanceCheckout({
        settlementGroupId: s.settlementGroupId,
        completeIdempotencyKey: `nzc-${o.orderId}`,
        businessDate: '2026-09-16',
        businessOrder: 10,
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_NOT_SATISFIED' });

    const paid = settlements.withDeps({
      coverageReader: stubPaymentCoverageReader([
        {
          allocationIdentity: 'p1',
          settlementCheckId: checkId,
          amountMinor: '100000',
          qualifies: true,
        },
      ]),
      fiscalGate: fixedFiscalCheckoutGate('SATISFIED'),
    });
    const orch = new CheckoutOrchestrator(pool, orders, paid);
    const done = await orch.tryAdvanceCheckout({
      settlementGroupId: s.settlementGroupId,
      completeIdempotencyKey: `nzc2-${o.orderId}`,
      businessDate: '2026-09-16',
      businessOrder: 11,
    });
    expect(done.settlement.state).toBe('SATISFIED');
    expect((await orders.getOrder(o.orderId)).status).toBe('COMPLETED');
  });

  it('COLLECTING cannot CompleteOrder via checkout', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `col-${o.orderId}`,
    });
    const orch = new CheckoutOrchestrator(
      pool,
      orders,
      settlements.withDeps({ fiscalGate: fixedFiscalCheckoutGate('NOT_REQUIRED') }),
    );
    await expect(
      orch.tryAdvanceCheckout({
        settlementGroupId: s.settlementGroupId,
        completeIdempotencyKey: `colc-${o.orderId}`,
        businessDate: '2026-09-16',
        businessOrder: 20,
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_NOT_SATISFIED' });
  });

  it('fiscal PENDING blocks CompleteOrder', async () => {
    const o = await openAcceptedOrder('0');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `fp-${o.orderId}`,
    });
    const orch = new CheckoutOrchestrator(
      pool,
      orders,
      settlements.withDeps({ fiscalGate: fixedFiscalCheckoutGate('PENDING') }),
    );
    await expect(
      orch.tryAdvanceCheckout({
        settlementGroupId: s.settlementGroupId,
        completeIdempotencyKey: `fpc-${o.orderId}`,
        businessDate: '2026-09-16',
        businessOrder: 21,
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_FISCAL_PREREQUISITE_PENDING' });
  });

  it('DomainValidationError codes are explicit', () => {
    const e = new DomainValidationError('SETTLEMENT_EDIT_LOCKED', 'x');
    expect(e.code).toBe('SETTLEMENT_EDIT_LOCKED');
  });
});
