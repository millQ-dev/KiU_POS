/**
 * FISC1.1 Fiscalization Core + PaymentCollectionEvent + ReceiveCash (ADR-0014 / ADR-0038).
 * No Vietnam production provider. No fake fiscal evidence in production adapter path.
 * Cash accepted ≠ Fiscal SATISFIED until verified provider evidence meets profile.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { CheckoutOrchestrator } from '../checkout/checkout-orchestrator.js';
import { CashShiftService } from '../cash/cash-shift-service.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_PAYMENTS_RECEIVE_CASH,
  PERMISSION_POS_OPERATE,
  type AuthenticatedPrincipal,
} from '../identity/index.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { PaymentsService } from '../payments/payments-service.js';
import { ReceiveCashService } from '../payments/receive-cash-service.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { TaxService } from '../tax/tax-service.js';
import {
  FiscalService,
  testSatisfyingFiscalProviderAdapter,
  unavailableFiscalProviderAdapter,
} from './index.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

describe('FISC1.1 Fiscalization Core Runtime', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let tax: TaxService;
  let payments: PaymentsService;
  let settlements: SettlementService;
  let fiscal: FiscalService;
  let receiveCash: ReceiveCashService;
  let identity: IdentityService;
  let cash: CashShiftService;
  let terminalId: string;
  let principal: AuthenticatedPrincipal;
  let eggStocked = false;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    fx = await seedBlockCFixture(pool);
    await pool.query(
      `UPDATE legal_entity SET tax_required = TRUE, fiscal_required = TRUE
       WHERE legal_entity_id = $1`,
      [fx.legalEntityId],
    );

    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    tax = new TaxService(pool);
    identity = new IdentityService(pool, 'test-pepper-fisc11-not-for-production');
    cash = new CashShiftService(pool, identity);

    terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'FISC-T1','FISC Terminal')`,
      [terminalId, fx.tenantId, fx.outletId],
    );

    const company = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    const user = await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'FISC Cashier',
      pin: '654321',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_RECEIVE_CASH, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      ],
    });
    const session = await identity.authenticatePin(
      { companyCode: company.rows[0]!.company_code, pin: '654321', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    principal = await identity.resolveSession(session.sessionToken);
    expect(principal.userId).toBe(user.userId);

    await cash.openShift(principal, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: `fisc-open-${randomUUID()}`,
      openingCash: { amountMinor: '0', currencyCode: 'VND', minorUnitExponent: 0 },
    });

    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `fisc-tax-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });

    fiscal = new FiscalService(pool, { adapter: unavailableFiscalProviderAdapter() });
    const pol = await fiscal.createFiscalPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `fisc-${randomUUID().slice(0, 8)}`,
    });
    await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: pol.fiscalPolicyId,
      policyVersion: 1,
      fiscalDocumentRequired: true,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    });

    payments = new PaymentsService(pool, {
      onCoverageChanged: async (gid) => {
        await settlements.reconcileSettlementCoverage(gid);
      },
    });
    settlements = new SettlementService(pool, {
      coverageReader: payments.createCoverageReader(),
      externalEffects: {
        hasQualifyingPaymentExternalEffect: (gid) =>
          payments.createExternalEffectProbe().hasQualifyingPaymentExternalEffect(gid),
        hasFiscalExternalEffect: (gid) => fiscal.hasFiscalExternalEffect(gid),
      },
      fiscalGate: fiscal.createCheckoutGate(),
    });
    receiveCash = new ReceiveCashService(pool, {
      onCoverageChanged: async (gid) => {
        await settlements.reconcileSettlementCoverage(gid);
      },
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function ensureEggStock() {
    if (eggStocked) return;
    const receipts = new GoodsReceiptService(pool);
    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `FISC-EGG-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-10-11',
      businessOrder: 1,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: fx.eggItemId,
          supplierItemId: fx.eggSupplierItemId,
          inputKind: 'COUNT',
          packageCount: 200,
          acceptedBaseQuantity: '200',
          baseUnit: 'ea',
          dimension: 'COUNT',
          unitPriceMinor: '2000',
          lineAcquisitionCostMinor: '400000',
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: `fisc-egg-${draft!.goodsReceiptId}`,
      actorId: fx.actorId,
    });
    eggStocked = true;
  }

  async function openTaxedSettlement(grossMinor: string) {
    await ensureEggStock();
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
      idempotencyKey: `fisc-comm-${randomUUID()}`,
      defaultGrossMinor: grossMinor,
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: grossMinor },
    });
    await tax.acceptTaxSnapshot({
      orderId: refreshed.orderId,
      idempotencyKey: `fisc-tax-${refreshed.orderId}`,
    });
    const s = await settlements.openSettlement({
      orderId: refreshed.orderId,
      idempotencyKey: `fisc-open-${refreshed.orderId}`,
    });
    return { order: await orders.getOrder(refreshed.orderId), settlement: s };
  }

  it('gate UNAVAILABLE when fiscal_required undecided; NOT_REQUIRED never from missing config', async () => {
    const otherLe = randomUUID();
    await pool.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code, tax_required, fiscal_required)
       VALUES ($1,$2,'LE Fiscal Undecided','VN', FALSE, NULL)`,
      [otherLe, fx.tenantId],
    );
    const gate = fiscal.createCheckoutGate();
    const obs = await gate.observe({
      settlementGroupId: randomUUID(),
      orderId: randomUUID(),
      legalEntityId: otherLe,
    });
    expect(obs.status).toBe('UNAVAILABLE');
    expect(obs.detail).toMatch(/undecided|fail closed/i);
  });

  it('CARD: VERIFIED SUCCESS without COLLECTION_OR_CAPTURE does not mint PCE; gate not SATISFIED', async () => {
    const { settlement } = await openTaxedSettlement('65000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CARD-${randomUUID().slice(0, 6)}`,
      displayName: 'Card',
      instrumentFamily: 'CARD',
      presentationCapability: 'CUSTOMER_PRESENTED',
    });
    const pay = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: `card-${randomUUID()}`,
      requestedAmountMinor: '65000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      settlementCheckId: checkId,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: pay.paymentId,
      providerEventIdentity: `auth-${randomUUID()}`,
      rawProviderStatus: 'AUTHORIZED',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      providerOccurredAt: new Date().toISOString(),
      collectionTimeProvenance: 'AUTHORIZATION',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `alloc-${randomUUID()}`,
    });
    const pce = await pool.query(
      `SELECT 1 FROM payment_collection_event WHERE payment_id = $1`,
      [pay.paymentId],
    );
    expect(pce.rows.length).toBe(0);
    const gate = await settlements.observeFiscalGate(settlement.settlementGroupId);
    expect(gate.status).toBe('REQUIRED_NOT_SATISFIED');
  });

  it('CARD: COLLECTION_OR_CAPTURE mints PCE from provider_occurred_at (not received_at)', async () => {
    const { settlement } = await openTaxedSettlement('65000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const collectedAt = '2026-10-11T03:00:00.000Z';
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CARDC-${randomUUID().slice(0, 6)}`,
      displayName: 'Card Collect',
      instrumentFamily: 'CARD',
      presentationCapability: 'CUSTOMER_PRESENTED',
    });
    const pay = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: `cardc-${randomUUID()}`,
      requestedAmountMinor: '65000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      settlementCheckId: checkId,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: pay.paymentId,
      providerEventIdentity: `coll-${randomUUID()}`,
      rawProviderStatus: 'CAPTURED',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      providerOccurredAt: collectedAt,
      collectionTimeProvenance: 'COLLECTION_OR_CAPTURE',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `alloc-${randomUUID()}`,
    });
    const pce = await pool.query<{ collected_at: Date; collection_evidence_kind: string }>(
      `SELECT collected_at, collection_evidence_kind FROM payment_collection_event
       WHERE payment_id = $1`,
      [pay.paymentId],
    );
    expect(pce.rows.length).toBe(1);
    expect(pce.rows[0]!.collection_evidence_kind).toBe('CARD_PROVIDER_COLLECTION');
    expect(pce.rows[0]!.collected_at.toISOString()).toBe(collectedAt);
  });

  it('ReceiveCash: tendered/change Money; PCE server clock; cash ≠ fiscal SATISFIED', async () => {
    const { settlement } = await openTaxedSettlement('65000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASH-${randomUUID().slice(0, 6)}`,
      displayName: 'Cash',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });

    const result = await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: checkId,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: `rc-${randomUUID()}`,
      amountTenderedMinor: '100000',
      humanConfirmation: true,
    });

    expect(result.payment.requestedAmountMinor).toBe('65000');
    expect(result.payment.lifecycleState).toBe('SUCCEEDED');
    expect(result.evidence.amountDueMinor).toBe('65000');
    expect(result.evidence.amountTenderedMinor).toBe('100000');
    expect(result.evidence.changeMinor).toBe('35000');
    expect(result.collectionEvent.collectionEvidenceKind).toBe('CASH_RECEIVE');
    expect(result.collectionEvent.amountCollectedMinor).toBe('65000');

    const sat = await settlements.reconcileSettlementCoverage(settlement.settlementGroupId);
    expect(sat.state).toBe('SATISFIED');

    // Unavailable adapter → document PENDING / gate not SATISFIED
    const doc = await fiscal.issueForSettlement({
      settlementGroupId: settlement.settlementGroupId,
      issueIdempotencyKey: `issue-${settlement.settlementGroupId}`,
    });
    expect(doc.status).not.toBe('SATISFIED');
    const gate = await settlements.observeFiscalGate(settlement.settlementGroupId);
    expect(['PENDING', 'REQUIRED_NOT_SATISFIED']).toContain(gate.status);

    const checkout = new CheckoutOrchestrator(pool, orders, settlements);
    await expect(
      checkout.tryAdvanceCheckout({
        settlementGroupId: settlement.settlementGroupId,
        completeIdempotencyKey: `complete-${randomUUID()}`,
        businessDate: '2026-10-11',
        businessOrder: 1,
        actorId: fx.actorId,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FISCAL_PREREQUISITE/) });
  });

  it('ReceiveCash: idempotent replay; concurrent distinct keys fail closed; tips/partial/client clock rejected', async () => {
    const { settlement } = await openTaxedSettlement('50000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASH2-${randomUUID().slice(0, 6)}`,
      displayName: 'Cash2',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });

    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: checkId,
        tenderDefinitionId: tender.tenderDefinitionId,
        receiveIdempotencyKey: `tip-${randomUUID()}`,
        amountTenderedMinor: '50000',
        humanConfirmation: true,
        tipAmountMinor: '1000',
      }),
    ).rejects.toMatchObject({ code: 'TIPS_NOT_SUPPORTED' });

    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: checkId,
        tenderDefinitionId: tender.tenderDefinitionId,
        receiveIdempotencyKey: `partial-${randomUUID()}`,
        amountTenderedMinor: '10000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'PARTIAL_CASH_REJECTED' });

    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: checkId,
        tenderDefinitionId: tender.tenderDefinitionId,
        receiveIdempotencyKey: `clock-${randomUUID()}`,
        amountTenderedMinor: '50000',
        humanConfirmation: true,
        collectedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CLIENT_COLLECTED_AT_FORBIDDEN' });

    const key = `idem-${randomUUID()}`;
    const a = await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: checkId,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: key,
      amountTenderedMinor: '50000',
      humanConfirmation: true,
    });
    const b = await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: checkId,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: key,
      amountTenderedMinor: '50000',
      humanConfirmation: true,
    });
    expect(b.duplicate).toBe(true);
    expect(b.payment.paymentId).toBe(a.payment.paymentId);

    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: checkId,
        tenderDefinitionId: tender.tenderDefinitionId,
        receiveIdempotencyKey: `other-${randomUUID()}`,
        amountTenderedMinor: '50000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'CASH_COLLECTION_ALREADY_EXISTS' });
  });

  it('issue + test adapter evidence → SATISFIED → CompleteOrder; Tax not recalculated', async () => {
    const { settlement, order } = await openTaxedSettlement('108000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASH3-${randomUUID().slice(0, 6)}`,
      displayName: 'Cash3',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: checkId,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: `rc-ok-${randomUUID()}`,
      amountTenderedMinor: '108000',
      humanConfirmation: true,
    });
    await settlements.reconcileSettlementCoverage(settlement.settlementGroupId);

    const satisfying = new FiscalService(pool, {
      adapter: testSatisfyingFiscalProviderAdapter('AUTHORITY_ACCEPTED'),
    });
    const doc = await satisfying.issueForSettlement({
      settlementGroupId: settlement.settlementGroupId,
      issueIdempotencyKey: `issue-ok-${settlement.settlementGroupId}`,
    });
    expect(doc.status).toBe('SATISFIED');
    expect(doc.taxOrderSnapshotId).toBeTruthy();
    expect(doc.collectionBusinessTime).toBeTruthy();

    const gated = new SettlementService(pool, {
      coverageReader: payments.createCoverageReader(),
      fiscalGate: satisfying.createCheckoutGate(),
    });
    const gate = await gated.observeFiscalGate(settlement.settlementGroupId);
    expect(gate.status).toBe('SATISFIED');

    const checkout = new CheckoutOrchestrator(pool, orders, gated);
    const advanced = await checkout.tryAdvanceCheckout({
      settlementGroupId: settlement.settlementGroupId,
      completeIdempotencyKey: `complete-ok-${order.orderId}`,
      businessDate: '2026-10-11',
      businessOrder: 1,
      actorId: fx.actorId,
    });
    expect(String(advanced.completion.status).toUpperCase()).toBe('COMPLETED');
    expect(advanced.fiscal.status).toBe('SATISFIED');
  });

  it('ReceiveCash rejects Check already covered by CARD (no double Revenue)', async () => {
    const { settlement } = await openTaxedSettlement('65000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const card = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CARDX-${randomUUID().slice(0, 6)}`,
      displayName: 'CardX',
      instrumentFamily: 'CARD',
      presentationCapability: 'CUSTOMER_PRESENTED',
    });
    const cashTender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASHX-${randomUUID().slice(0, 6)}`,
      displayName: 'CashX',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    const pay = await payments.createPayment({
      tenderDefinitionId: card.tenderDefinitionId,
      createIdempotencyKey: `cardx-${randomUUID()}`,
      requestedAmountMinor: '65000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      settlementCheckId: checkId,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: pay.paymentId,
      providerEventIdentity: `authx-${randomUUID()}`,
      rawProviderStatus: 'AUTHORIZED',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      providerOccurredAt: new Date().toISOString(),
      collectionTimeProvenance: 'AUTHORIZATION',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `allocx-${randomUUID()}`,
    });
    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: checkId,
        tenderDefinitionId: cashTender.tenderDefinitionId,
        receiveIdempotencyKey: `rc-double-${randomUUID()}`,
        amountTenderedMinor: '65000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'CHECK_ALREADY_COVERED' });
  });

  it('issue binds Settlement TaxOrderSnapshot identity (not latest-by-accepted_at)', async () => {
    const { settlement } = await openTaxedSettlement('88000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASH5-${randomUUID().slice(0, 6)}`,
      displayName: 'Cash5',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: checkId,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: `rc-tax-${randomUUID()}`,
      amountTenderedMinor: '88000',
      humanConfirmation: true,
    });
    await settlements.reconcileSettlementCoverage(settlement.settlementGroupId);

    const bound = await pool.query<{ tax_id: string }>(
      `SELECT sps.provenance_json->>'taxOrderSnapshotId' AS tax_id
       FROM settlement_group sg
       INNER JOIN settlement_payable_snapshot sps
         ON sps.settlement_payable_snapshot_id = sg.settlement_payable_snapshot_id
       WHERE sg.settlement_group_id = $1`,
      [settlement.settlementGroupId],
    );
    expect(bound.rows[0]!.tax_id).toBeTruthy();

    const svc = new FiscalService(pool, {
      adapter: testSatisfyingFiscalProviderAdapter(),
    });
    const doc = await svc.issueForSettlement({
      settlementGroupId: settlement.settlementGroupId,
      issueIdempotencyKey: `issue-tax-${settlement.settlementGroupId}`,
    });
    expect(doc.taxOrderSnapshotId).toBe(bound.rows[0]!.tax_id);
  });

  it('semantic idempotency: same issue key returns same document; changed semantics conflict', async () => {
    const { settlement } = await openTaxedSettlement('70000');
    const checkId = settlement.checks[0]!.settlementCheckId;
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASH4-${randomUUID().slice(0, 6)}`,
      displayName: 'Cash4',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: checkId,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: `rc-id-${randomUUID()}`,
      amountTenderedMinor: '70000',
      humanConfirmation: true,
    });
    await settlements.reconcileSettlementCoverage(settlement.settlementGroupId);

    const svc = new FiscalService(pool, {
      adapter: testSatisfyingFiscalProviderAdapter(),
    });
    const key = `idem-issue-${randomUUID()}`;
    const a = await svc.issueForSettlement({
      settlementGroupId: settlement.settlementGroupId,
      issueIdempotencyKey: key,
    });
    const b = await svc.issueForSettlement({
      settlementGroupId: settlement.settlementGroupId,
      issueIdempotencyKey: key,
    });
    expect(b.fiscalDocumentId).toBe(a.fiscalDocumentId);

    const { settlement: other } = await openTaxedSettlement('70000');
    const otherCheck = other.checks[0]!.settlementCheckId;
    await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: otherCheck,
      tenderDefinitionId: tender.tenderDefinitionId,
      receiveIdempotencyKey: `rc-id2-${randomUUID()}`,
      amountTenderedMinor: '70000',
      humanConfirmation: true,
    });
    await settlements.reconcileSettlementCoverage(other.settlementGroupId);
    await expect(
      svc.issueForSettlement({
        settlementGroupId: other.settlementGroupId,
        issueIdempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
