/**
 * PAY1.1 Payments Core Runtime — acceptance matrix (ADR-0013 / ADR-0016 / ADR-0032).
 * Vietnam-first / Asia-ready: provider-neutral, no CASH|CARD-only axis, no provider SDKs.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckoutOrchestrator } from '../checkout/checkout-orchestrator.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { fixedFiscalCheckoutGate } from '../settlement/settlement-ports.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { PaymentsService } from './payments-service.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

describe('PAY1.1 Payments Core Runtime (PostgreSQL)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let receipts: GoodsReceiptService;
  let payments: PaymentsService;
  let settlements: SettlementService;
  let eggStocked = false;

  beforeAll(async () => {
    fx = await seedBlockCFixture(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    receipts = new GoodsReceiptService(pool);
    payments = new PaymentsService(pool, {
      onCoverageChanged: async (gid) => {
        await settlements.reconcileSettlementCoverage(gid);
      },
    });
    settlements = new SettlementService(pool, {
      coverageReader: payments.createCoverageReader(),
      externalEffects: payments.createExternalEffectProbe(),
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function ensureEggStock() {
    if (eggStocked) return;
    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `PAY11-EGG-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-09-16',
      businessOrder: 1,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: fx.eggItemId,
          supplierItemId: fx.eggSupplierItemId,
          inputKind: 'COUNT',
          packageCount: 100,
          acceptedBaseQuantity: '100',
          baseUnit: 'ea',
          dimension: 'COUNT',
          unitPriceMinor: '2000',
          lineAcquisitionCostMinor: '200000',
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: `pay11-egg-${draft!.goodsReceiptId}`,
      actorId: fx.actorId,
    });
    eggStocked = true;
  }

  async function openAcceptedOrder(grossMinor: string) {
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
      idempotencyKey: `pay11-${randomUUID()}`,
      defaultGrossMinor: grossMinor,
      grossByOrderLineId: {
        [refreshed.lines[0]!.orderLineId]: grossMinor,
      },
    });
    return orders.getOrder(o.orderId);
  }

  async function openSettlementFor(orderId: string) {
    return settlements.openSettlement({
      orderId,
      idempotencyKey: `pay11-settle-${randomUUID()}`,
    });
  }

  async function digitalTender(
    code: string,
    extras?: Partial<{
      providerIdentity: string;
      railIdentity: string;
      instrumentFamily: string;
      presentationCapability: string;
    }>,
  ) {
    return payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code,
      displayName: `DEV ${code}`,
      providerIdentity: extras?.providerIdentity ?? `dev.provider.${code}`,
      railIdentity: extras?.railIdentity ?? 'DOMESTIC_QR',
      instrumentFamily: extras?.instrumentFamily ?? 'DIGITAL_WALLET_OR_QR',
      presentationCapability: extras?.presentationCapability ?? 'MERCHANT_PRESENTED',
      externalConfigRef: `cfg:dev:${code}`,
    });
  }

  it('tender — extensible axes, not closed CASH|CARD; disabled blocks create; two fake providers', async () => {
    const t1 = await digitalTender(`vietqr_pay_${randomUUID().slice(0, 8)}`, {
      railIdentity: 'VIETQR_DOMESTIC',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    const t2 = await digitalTender(`momo_like_${randomUUID().slice(0, 8)}`, {
      providerIdentity: 'dev.wallet.momo_like',
      railIdentity: 'WALLET_QR',
      presentationCapability: 'CUSTOMER_PRESENTED',
    });
    expect(t1.providerIdentity).toBeTruthy();
    expect(t2.presentationCapability).toBe('CUSTOMER_PRESENTED');
    expect(t1.railIdentity).toBe('VIETQR_DOMESTIC');
    expect(t2.railIdentity).toBe('WALLET_QR');

    await payments.setTenderEnabled(t1.tenderDefinitionId, false);
    await expect(
      payments.createPayment({
        tenderDefinitionId: t1.tenderDefinitionId,
        createIdempotencyKey: randomUUID(),
        requestedAmountMinor: '1000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      }),
    ).rejects.toMatchObject({ code: 'TENDER_DISABLED' });
  });

  it('Vietnam async QR — redirect not authoritative; verified success allocates once; stale pending ignored', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await openSettlementFor(o.orderId);
    const checkId = s.checks[0]!.settlementCheckId;
    const tender = await digitalTender(`asia_qr_${randomUUID().slice(0, 8)}`, {
      railIdentity: 'VIETQR_DOMESTIC',
      presentationCapability: 'MERCHANT_PRESENTED',
    });

    const payKey = `create-${randomUUID()}`;
    const p1 = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: payKey,
      requestedAmountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    const pRetry = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: payKey,
      requestedAmountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(pRetry.paymentId).toBe(p1.paymentId);

    await payments.recordVerifiedProviderOutcome({
      paymentId: p1.paymentId,
      providerEventIdentity: `pending-${p1.paymentId}`,
      rawProviderStatus: 'WAIT_CUSTOMER_SCAN',
      normalizedOutcome: 'PENDING',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'DEV_SIMULATOR',
    });
    expect((await payments.getPayment(p1.paymentId))!.lifecycleState).toBe('PENDING');

    await payments.recordClientRedirectSignal(p1.paymentId);
    expect((await payments.getPayment(p1.paymentId))!.lifecycleState).not.toBe('SUCCEEDED');
    let proj = await settlements.getSettlement(s.settlementGroupId);
    expect(proj.state).toBe('COLLECTING');
    expect(proj.outstandingAmountMinor).toBe('100000');

    const successEvent = `success-${p1.paymentId}`;
    const allocKey = `alloc-${p1.paymentId}`;
    const r1 = await payments.recordVerifiedProviderOutcome({
      paymentId: p1.paymentId,
      providerEventIdentity: successEvent,
      rawProviderStatus: '00',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '100000',
      evidenceCurrencyCode: 'VND',
      providerTransactionReference: `prov_${p1.paymentId.slice(0, 8)}`,
      allocateToCheckId: checkId,
      allocationIdempotencyKey: allocKey,
    });
    expect(r1.payment.lifecycleState).toBe('SUCCEEDED');
    expect(r1.allocation).not.toBeNull();

    proj = await settlements.getSettlement(s.settlementGroupId);
    expect(proj.state).toBe('SATISFIED');
    expect(proj.outstandingAmountMinor).toBe('0');

    const dup = await payments.recordVerifiedProviderOutcome({
      paymentId: p1.paymentId,
      providerEventIdentity: successEvent,
      rawProviderStatus: '00',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '100000',
      evidenceCurrencyCode: 'VND',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: allocKey,
    });
    expect(dup.duplicate).toBe(true);

    await expect(
      settlements.abortSettlement({ settlementGroupId: s.settlementGroupId }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_ABORT_FORBIDDEN' });

    await expect(
      new CheckoutOrchestrator(pool, orders, settlements).tryAdvanceCheckout({
        settlementGroupId: s.settlementGroupId,
        completeIdempotencyKey: `complete-${randomUUID()}`,
        businessDate: '2026-09-16',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_FISCAL_PREREQUISITE_UNAVAILABLE' });

    await payments.recordVerifiedProviderOutcome({
      paymentId: p1.paymentId,
      providerEventIdentity: `stale-pending-${randomUUID()}`,
      rawProviderStatus: 'PENDING_LATE',
      normalizedOutcome: 'PENDING',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
    });
    expect((await payments.getPayment(p1.paymentId))!.lifecycleState).toBe('SUCCEEDED');
  });

  it('unverified success / amount / currency mismatch never qualify', async () => {
    const o = await openAcceptedOrder('50000');
    const s = await openSettlementFor(o.orderId);
    const checkId = s.checks[0]!.settlementCheckId;
    const tender = await digitalTender(`mismatch_${randomUUID().slice(0, 8)}`);

    const p = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '50000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: p.paymentId,
      providerEventIdentity: `unv-${randomUUID()}`,
      rawProviderStatus: 'OK',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'UNVERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '50000',
      evidenceCurrencyCode: 'VND',
    });
    expect((await payments.getPayment(p.paymentId))!.lifecycleState).not.toBe('SUCCEEDED');

    const p2 = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '50000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: p2.paymentId,
      providerEventIdentity: `amt-${randomUUID()}`,
      rawProviderStatus: 'OK',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '49999',
      evidenceCurrencyCode: 'VND',
    });
    expect((await payments.getPayment(p2.paymentId))!.reconciliationState).toBe('QUARANTINED');
    await expect(
      payments.allocatePaymentToCheck({
        paymentId: p2.paymentId,
        settlementCheckId: checkId,
        amountMinor: '50000',
        allocationIdempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_QUALIFYING' });

    const p3 = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '50000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: p3.paymentId,
      providerEventIdentity: `ccy-${randomUUID()}`,
      rawProviderStatus: 'OK',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '50000',
      evidenceCurrencyCode: 'USD',
    });
    expect((await payments.getPayment(p3.paymentId))!.reconciliationState).toBe('QUARANTINED');
    expect((await settlements.getSettlement(s.settlementGroupId)).state).toBe('COLLECTING');
  });

  it('partial + mixed tender → SATISFIED; inquiry reconciles late; overcoverage rejected', async () => {
    const o = await openAcceptedOrder('100000');
    const s = await openSettlementFor(o.orderId);
    const checkId = s.checks[0]!.settlementCheckId;
    const tA = await digitalTender(`mix_a_${randomUUID().slice(0, 8)}`);
    const tB = await digitalTender(`mix_b_${randomUUID().slice(0, 8)}`, {
      providerIdentity: 'dev.provider.b',
      railIdentity: 'CROSS_BORDER_QR',
    });

    const payA = await payments.createPayment({
      tenderDefinitionId: tA.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '40000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: payA.paymentId,
      providerEventIdentity: `a-ok-${randomUUID()}`,
      rawProviderStatus: 'SUCCESS',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '40000',
      evidenceCurrencyCode: 'VND',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `a-alloc-${payA.paymentId}`,
    });
    let proj = await settlements.getSettlement(s.settlementGroupId);
    expect(proj.state).toBe('COLLECTING');
    expect(proj.outstandingAmountMinor).toBe('60000');

    const payB = await payments.createPayment({
      tenderDefinitionId: tB.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '60000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: payB.paymentId,
      providerEventIdentity: `b-pend-${randomUUID()}`,
      rawProviderStatus: 'PENDING',
      normalizedOutcome: 'PENDING',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
    });
    expect((await settlements.getSettlement(s.settlementGroupId)).outstandingAmountMinor).toBe('60000');

    await payments.recordVerifiedProviderOutcome({
      paymentId: payB.paymentId,
      providerEventIdentity: `b-inq-${randomUUID()}`,
      rawProviderStatus: 'PAID',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'INQUIRY',
      evidenceAmountMinor: '60000',
      evidenceCurrencyCode: 'VND',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `b-alloc-${payB.paymentId}`,
    });
    proj = await settlements.getSettlement(s.settlementGroupId);
    expect(proj.state).toBe('SATISFIED');
    expect(proj.outstandingAmountMinor).toBe('0');

    const payC = await payments.createPayment({
      tenderDefinitionId: tA.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '1',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: payC.paymentId,
      providerEventIdentity: `c-ok-${randomUUID()}`,
      rawProviderStatus: 'SUCCESS',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '1',
      evidenceCurrencyCode: 'VND',
    });
    await expect(
      payments.allocatePaymentToCheck({
        paymentId: payC.paymentId,
        settlementCheckId: checkId,
        amountMinor: '1',
        allocationIdempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CHECK_OVERCOVERAGE' });
  });

  it('one Payment may allocate across Checks; SUM <= payment amount', async () => {
    const o = await openAcceptedOrder('100000');
    const s0 = await openSettlementFor(o.orderId);
    const lineId = (await orders.getOrder(o.orderId)).lines[0]!.orderLineId;
    const s = await settlements.splitChecksExact({
      settlementGroupId: s0.settlementGroupId,
      expectedVersion: s0.version,
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
    const checkA = s.checks.find((c) => c.customerPayableMinor === '60000')!.settlementCheckId;
    const checkB = s.checks.find((c) => c.customerPayableMinor === '40000')!.settlementCheckId;
    const tender = await digitalTender(`multi_${randomUUID().slice(0, 8)}`);
    const pay = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: pay.paymentId,
      providerEventIdentity: `multi-ok-${randomUUID()}`,
      rawProviderStatus: 'SUCCESS',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '100000',
      evidenceCurrencyCode: 'VND',
    });
    await payments.allocatePaymentToCheck({
      paymentId: pay.paymentId,
      settlementCheckId: checkA,
      amountMinor: '60000',
      allocationIdempotencyKey: `m-a-${pay.paymentId}`,
    });
    await payments.allocatePaymentToCheck({
      paymentId: pay.paymentId,
      settlementCheckId: checkB,
      amountMinor: '40000',
      allocationIdempotencyKey: `m-b-${pay.paymentId}`,
    });
    const proj = await settlements.getSettlement(s.settlementGroupId);
    expect(proj.state).toBe('SATISFIED');
    await expect(
      payments.allocatePaymentToCheck({
        paymentId: pay.paymentId,
        settlementCheckId: checkA,
        amountMinor: '1',
        allocationIdempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ALLOCATION_EXCEEDS_PAYMENT' });
  });

  it('checkout CompleteOrder only via orchestrator + fiscal fixture; Payment never Completes', async () => {
    await ensureEggStock();
    const o = await openAcceptedOrder('25000');
    const s = await openSettlementFor(o.orderId);
    const checkId = s.checks[0]!.settlementCheckId;
    const tender = await digitalTender(`co_${randomUUID().slice(0, 8)}`);
    const pay = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '25000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: pay.paymentId,
      providerEventIdentity: `co-ok-${randomUUID()}`,
      rawProviderStatus: 'SUCCESS',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      evidenceAmountMinor: '25000',
      evidenceCurrencyCode: 'VND',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `co-alloc-${pay.paymentId}`,
    });

    const checkout = new CheckoutOrchestrator(
      pool,
      orders,
      settlements.withDeps({ fiscalGate: fixedFiscalCheckoutGate('NOT_REQUIRED') }),
    );
    const advanced = await checkout.tryAdvanceCheckout({
      settlementGroupId: s.settlementGroupId,
      completeIdempotencyKey: `pay11-complete-${randomUUID()}`,
      businessDate: '2026-09-16',
      businessOrder: Math.floor(Math.random() * 1_000_000) + 100,
    });
    expect(advanced.settlement.state).toBe('SATISFIED');
    expect((await orders.getOrder(o.orderId)).status).toBe('COMPLETED');

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'payment'`,
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name).join(',');
    expect(names).not.toMatch(/pan|cvv|secret|credential/);
  });

  it('schema — Asia-ready axes present; no CASH|CARD PaymentMethod enum on payment', async () => {
    const ddl = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'payment'::regclass AND contype = 'c'`,
    );
    const text = ddl.rows.map((r) => r.definition).join('\n');
    expect(text).not.toMatch(/CASH.*CARD|CARD.*CASH/);
    const tenderCols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tender_definition'
         AND column_name IN ('provider_identity','rail_identity','instrument_family','presentation_capability')`,
    );
    expect(tenderCols.rowCount).toBe(4);
  });
});
