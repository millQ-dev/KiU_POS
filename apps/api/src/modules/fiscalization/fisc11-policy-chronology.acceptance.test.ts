/**
 * FISC1.1 FiscalPolicy collection-time chronology + document-bound freeze (ADR-0014).
 * Wall-clock / live re-resolve forbidden after document creation.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
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
import { PaymentsService } from '../payments/payments-service.js';
import { ReceiveCashService } from '../payments/receive-cash-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { TaxService } from '../tax/tax-service.js';
import {
  FiscalService,
  testSatisfyingFiscalProviderAdapter,
  unavailableFiscalProviderAdapter,
} from './index.js';
import { defaultC0SatisfactionProfile } from './fiscal-satisfaction-profile.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

const T0 = '2026-06-01T00:00:00.000Z';
const T_COLLECT = '2026-06-15T12:00:00.000Z';
const T_V2 = '2026-07-01T00:00:00.000Z';
const T_BOUNDARY = '2026-06-30T23:59:59.000Z';

describe('FISC1.1 FiscalPolicy chronology + document freeze', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let tax: TaxService;
  let payments: PaymentsService;
  let settlements: SettlementService;
  let receiveCash: ReceiveCashService;
  let identity: IdentityService;
  let cash: CashShiftService;
  let terminalId: string;
  let principal: AuthenticatedPrincipal;
  let cashTenderId: string;
  let cardTenderId: string;

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
    identity = new IdentityService(pool, 'test-pepper-fisc11-chronology-32chars!!');
    cash = new CashShiftService(pool, identity);

    terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'CHRON-T1','Chronology Terminal')`,
      [terminalId, fx.tenantId, fx.outletId],
    );

    const company = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Chron Cashier',
      pin: '777777',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_RECEIVE_CASH, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      ],
    });
    const session = await identity.authenticatePin(
      { companyCode: company.rows[0]!.company_code, pin: '777777', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    principal = await identity.resolveSession(session.sessionToken);
    await cash.openShift(principal, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: `chron-open-${randomUUID()}`,
      openingCash: { amountMinor: '1000', currencyCode: 'VND', minorUnitExponent: 0 },
    });

    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `chron-tax-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });

    const receipts = new GoodsReceiptService(pool);
    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `CHRON-EGG-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-06-15',
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
      idempotencyKey: `chron-egg-${draft!.goodsReceiptId}`,
      actorId: fx.actorId,
    });

    payments = new PaymentsService(pool, {
      onCoverageChanged: async (gid) => {
        await settlements.reconcileSettlementCoverage(gid);
      },
    });
    settlements = new SettlementService(pool, {
      coverageReader: payments.createCoverageReader(),
      externalEffects: payments.createExternalEffectProbe(),
    });
    receiveCash = new ReceiveCashService(pool, {
      onCoverageChanged: async (gid) => {
        await settlements.reconcileSettlementCoverage(gid);
      },
    });

    cashTenderId = (
      await payments.createTenderDefinition({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        code: `CASH-CH-${randomUUID().slice(0, 6)}`,
        displayName: 'Cash Chron',
        instrumentFamily: 'CASH',
        presentationCapability: 'MERCHANT_PRESENTED',
      })
    ).tenderDefinitionId;
    cardTenderId = (
      await payments.createTenderDefinition({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        code: `CARD-CH-${randomUUID().slice(0, 6)}`,
        displayName: 'Card Chron',
        instrumentFamily: 'CARD',
        presentationCapability: 'CUSTOMER_PRESENTED',
      })
    ).tenderDefinitionId;
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Relocate every prior version on this LE into unique far-past 1ms slots.
   * Row-by-row to satisfy fiscal_policy_version_no_overlap during the move.
   * Closing to effective_from+1ms is insufficient: a collapsed head whose
   * effective_from equals the next seed boundary remains effective at that instant.
   */
  let policyCloseSeq = 0;

  async function closeOpenPolicyHeads(_beforeIso?: string) {
    const rows = await pool.query<{ fiscal_policy_version_id: string }>(
      `SELECT fiscal_policy_version_id
       FROM fiscal_policy_version
       WHERE legal_entity_id = $1
       ORDER BY fiscal_policy_version_id`,
      [fx.legalEntityId],
    );
    // Park versions in year-1900 1ms slots (well before T0). Sequential counter avoids
    // re-close collisions; do not use epoch-seconds — they land in 2025+ and overlap live windows.
    for (const row of rows.rows) {
      policyCloseSeq += 1;
      await pool.query(
        `UPDATE fiscal_policy_version
         SET
           effective_from =
             TIMESTAMPTZ '1900-01-01 00:00:00+00' + make_interval(secs => $2),
           effective_to =
             TIMESTAMPTZ '1900-01-01 00:00:00+00'
               + make_interval(secs => $2)
               + interval '1 millisecond'
         WHERE fiscal_policy_version_id = $1`,
        [row.fiscal_policy_version_id, policyCloseSeq],
      );
    }
  }

  async function openSettledCheck(grossMinor: string) {
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
      idempotencyKey: `chron-comm-${randomUUID()}`,
      defaultGrossMinor: grossMinor,
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: grossMinor },
    });
    await tax.acceptTaxSnapshot({
      orderId: refreshed.orderId,
      idempotencyKey: `chron-tax-${refreshed.orderId}`,
    });
    const s = await settlements.openSettlement({
      orderId: refreshed.orderId,
      idempotencyKey: `chron-open-${refreshed.orderId}`,
    });
    return {
      settlementGroupId: s.settlementGroupId,
      settlementCheckId: s.checks[0]!.settlementCheckId,
      orderId: refreshed.orderId,
    };
  }

  async function seedV1V2Policy() {
    await closeOpenPolicyHeads(T0);
    const fiscal = new FiscalService(pool);
    const pol = await fiscal.createFiscalPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `chron-${randomUUID().slice(0, 8)}`,
    });
    const v1 = await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: pol.fiscalPolicyId,
      policyVersion: 1,
      fiscalDocumentRequired: true,
      satisfactionEvidenceProfile: {
        ...defaultC0SatisfactionProfile(),
        acceptedEvidenceClasses: ['AUTHORITY_ACCEPTED'],
      },
      effectiveFrom: T0,
      effectiveTo: T_V2,
    });
    const v2 = await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: pol.fiscalPolicyId,
      policyVersion: 2,
      fiscalDocumentRequired: true,
      satisfactionEvidenceProfile: {
        acceptedEvidenceClasses: ['PROVIDER_CONFIRMED_ISSUED'],
        requireVerified: true,
      },
      effectiveFrom: T_V2,
      effectiveTo: null,
    });
    return { fiscalPolicyId: pol.fiscalPolicyId, v1, v2 };
  }

  async function cardCollectAt(
    checkId: string,
    amountMinor: string,
    collectedAt: string,
  ) {
    const pay = await payments.createPayment({
      tenderDefinitionId: cardTenderId,
      createIdempotencyKey: `chron-card-${randomUUID()}`,
      requestedAmountMinor: amountMinor,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      settlementCheckId: checkId,
    });
    await payments.recordVerifiedProviderOutcome({
      paymentId: pay.paymentId,
      providerEventIdentity: `chron-coll-${randomUUID()}`,
      rawProviderStatus: 'CAPTURED',
      normalizedOutcome: 'SUCCEEDED',
      verificationStatus: 'VERIFIED',
      reconciliationOrigin: 'CALLBACK',
      providerOccurredAt: collectedAt,
      collectionTimeProvenance: 'COLLECTION_OR_CAPTURE',
      allocateToCheckId: checkId,
      allocationIdempotencyKey: `chron-alloc-${randomUUID()}`,
    });
    await settlements.reconcileSettlementCoverage(
      (
        await pool.query<{ settlement_group_id: string }>(
          `SELECT settlement_group_id FROM settlement_check WHERE settlement_check_id = $1`,
          [checkId],
        )
      ).rows[0]!.settlement_group_id,
    );
    return pay.paymentId;
  }

  it('1/2/3/10: collection under v1; after v2 activates delayed issue + reconcile retain v1', async () => {
    const { v1, v2 } = await seedV1V2Policy();
    const check = await openSettledCheck('65000');
    await cardCollectAt(check.settlementCheckId, '65000', T_COLLECT);

    const fiscal = new FiscalService(pool, {
      adapter: unavailableFiscalProviderAdapter(),
    });
    // Wall-clock is after T_V2 — live resolve would pick v2; collection time must pick v1.
    const atCollect = await fiscal.resolveEffectivePolicy(fx.legalEntityId, T_COLLECT);
    expect(atCollect?.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    const atNow = await fiscal.resolveEffectivePolicy(fx.legalEntityId, new Date().toISOString());
    expect(atNow?.fiscalPolicyVersionId).toBe(v2.fiscalPolicyVersionId);

    const doc = await fiscal.issueForSettlement({
      settlementGroupId: check.settlementGroupId,
      issueIdempotencyKey: `chron-issue-${check.settlementGroupId}`,
    });
    expect(doc.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    expect(doc.collectionBusinessTime).toBe(T_COLLECT);

    const satisfying = fiscal.withAdapter(
      testSatisfyingFiscalProviderAdapter('AUTHORITY_ACCEPTED'),
    );
    const reconciled = await satisfying.reconcileDocument(doc.fiscalDocumentId);
    expect(reconciled.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    expect(reconciled.status).toBe('SATISFIED');

    const gate = await satisfying.createCheckoutGate().observe({
      settlementGroupId: check.settlementGroupId,
      orderId: check.orderId,
      legalEntityId: fx.legalEntityId,
    });
    expect(gate.status).toBe('SATISFIED');

    // Provider/retry cannot rebind policy id on document
    const again = await satisfying.issueForSettlement({
      settlementGroupId: check.settlementGroupId,
      issueIdempotencyKey: `chron-issue-${check.settlementGroupId}`,
    });
    expect(again.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    expect(again.fiscalDocumentId).toBe(doc.fiscalDocumentId);
  });

  it('4: policy effective-date boundary — at T_V2 uses v2; just before uses v1', async () => {
    const { v1, v2 } = await seedV1V2Policy();
    const fiscal = new FiscalService(pool);
    const before = await fiscal.resolveEffectivePolicy(fx.legalEntityId, T_BOUNDARY);
    expect(before?.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    const at = await fiscal.resolveEffectivePolicy(fx.legalEntityId, T_V2);
    expect(at?.fiscalPolicyVersionId).toBe(v2.fiscalPolicyVersionId);
  });

  it('5: missing applicable policy fails closed', async () => {
    await closeOpenPolicyHeads(T0);
    const fiscal = new FiscalService(pool);
    const early = await fiscal.resolveEffectivePolicy(
      fx.legalEntityId,
      '2020-01-01T00:00:00.000Z',
    );
    expect(early).toBeNull();

    const check = await openSettledCheck('50000');
    await cardCollectAt(check.settlementCheckId, '50000', '2020-01-01T00:00:00.000Z');
    await expect(
      fiscal.issueForSettlement({
        settlementGroupId: check.settlementGroupId,
        issueIdempotencyKey: `miss-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'FISCAL_POLICY_BLOCKED' });
  });

  it('6: ambiguous overlapping policy heads fail closed', async () => {
    await closeOpenPolicyHeads(T0);
    const fiscal = new FiscalService(pool);
    const a = await fiscal.createFiscalPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `amb-a-${randomUUID().slice(0, 6)}`,
    });
    const b = await fiscal.createFiscalPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `amb-b-${randomUUID().slice(0, 6)}`,
    });
    await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: a.fiscalPolicyId,
      policyVersion: 1,
      fiscalDocumentRequired: true,
      effectiveFrom: '2025-01-01T00:00:00.000Z',
    });
    await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: b.fiscalPolicyId,
      policyVersion: 1,
      fiscalDocumentRequired: true,
      effectiveFrom: '2025-01-01T00:00:00.000Z',
    });
    await expect(
      fiscal.resolveEffectivePolicy(fx.legalEntityId, '2025-06-01T00:00:00.000Z'),
    ).rejects.toMatchObject({ code: 'FISCAL_POLICY_AMBIGUOUS' });
  });

  it('7: CASH server-authoritative collection time binds policy', async () => {
    const { v1 } = await seedV1V2Policy();
    const check = await openSettledCheck('40000');
    const result = await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: check.settlementCheckId,
      tenderDefinitionId: cashTenderId,
      receiveIdempotencyKey: `cash-chron-${randomUUID()}`,
      amountTenderedMinor: '40000',
      humanConfirmation: true,
    });
    // ReceiveCash uses server NOW(); pin PCE.collected_at into v1 window for chronology proof.
    await pool.query(
      `UPDATE payment_collection_event SET collected_at = $2 WHERE payment_id = $1`,
      [result.payment.paymentId, T_COLLECT],
    );

    const fiscal = new FiscalService(pool, {
      adapter: testSatisfyingFiscalProviderAdapter('AUTHORITY_ACCEPTED'),
    });
    const doc = await fiscal.issueForSettlement({
      settlementGroupId: check.settlementGroupId,
      issueIdempotencyKey: `cash-issue-${randomUUID()}`,
    });
    expect(doc.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    expect(doc.collectionBusinessTime).toBe(T_COLLECT);
  });

  it('8: CARD verified provider collection time binds policy', async () => {
    const { v1 } = await seedV1V2Policy();
    const check = await openSettledCheck('55000');
    await cardCollectAt(check.settlementCheckId, '55000', T_COLLECT);
    const pce = await pool.query<{ collected_at: Date }>(
      `SELECT collected_at FROM payment_collection_event WHERE settlement_check_id = $1`,
      [check.settlementCheckId],
    );
    expect(pce.rows[0]!.collected_at.toISOString()).toBe(T_COLLECT);

    const fiscal = new FiscalService(pool, {
      adapter: testSatisfyingFiscalProviderAdapter('AUTHORITY_ACCEPTED'),
    });
    const doc = await fiscal.issueForSettlement({
      settlementGroupId: check.settlementGroupId,
      issueIdempotencyKey: `card-issue-${randomUUID()}`,
    });
    expect(doc.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
  });

  it('9: no PaymentCollectionEvent → gate not SATISFIED', async () => {
    await seedV1V2Policy();
    const check = await openSettledCheck('33000');
    const fiscal = new FiscalService(pool);
    const gate = await fiscal.createCheckoutGate().observe({
      settlementGroupId: check.settlementGroupId,
      orderId: check.orderId,
      legalEntityId: fx.legalEntityId,
    });
    expect(gate.status).toBe('REQUIRED_NOT_SATISFIED');
    expect(gate.detail).toMatch(/PaymentCollectionEvent/i);
  });

  it('attempt_number: concurrent reconcile under submission lock yields unique attempts', async () => {
    const { v1 } = await seedV1V2Policy();
    const check = await openSettledCheck('45000');
    await cardCollectAt(check.settlementCheckId, '45000', T_COLLECT);

    const fiscal = new FiscalService(pool, {
      adapter: unavailableFiscalProviderAdapter(),
    });
    const doc = await fiscal.issueForSettlement({
      settlementGroupId: check.settlementGroupId,
      issueIdempotencyKey: `attempt-${check.settlementGroupId}`,
    });
    expect(doc.fiscalPolicyVersionId).toBe(v1.fiscalPolicyVersionId);
    expect(doc.status).toBe('PENDING_ISSUE');

    const retrying = fiscal.withAdapter(
      testSatisfyingFiscalProviderAdapter('AUTHORITY_ACCEPTED'),
    );
    const results = await Promise.allSettled([
      retrying.reconcileDocument(doc.fiscalDocumentId),
      retrying.reconcileDocument(doc.fiscalDocumentId),
      retrying.reconcileDocument(doc.fiscalDocumentId),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const attempts = await pool.query<{ attempt_number: number }>(
      `SELECT attempt_number FROM fiscal_provider_attempt
       WHERE fiscal_document_id = $1
       ORDER BY attempt_number`,
      [doc.fiscalDocumentId],
    );
    const nums = attempts.rows.map((r) => r.attempt_number);
    expect(nums.length).toBe(new Set(nums).size);
    expect(nums[0]).toBe(1);

    const frozen = await pool.query<{ fiscal_policy_version_id: string; status: string }>(
      `SELECT fiscal_policy_version_id, status FROM fiscal_document WHERE fiscal_document_id = $1`,
      [doc.fiscalDocumentId],
    );
    expect(frozen.rows[0]!.fiscal_policy_version_id).toBe(v1.fiscalPolicyVersionId);
    expect(frozen.rows[0]!.status).toBe('SATISFIED');
  });
});
