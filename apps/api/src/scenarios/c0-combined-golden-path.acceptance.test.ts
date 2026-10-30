/**
 * C0 combined Golden Path — one order through production commands.
 * Disposable millq_ci_pos_* only. Fiscal success comes only from
 * resolveFiscalProviderAdapter's explicit test-satisfying adapter.
 * Not a Vietnam provider result and not a G2 claim.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseCanonicalDecimal } from '@millq/domain';
import { runMigrations } from '../db/migrate.js';
import { seedAllergenFixture, type AllergenFixture } from '../test/allergen-fixture.js';
import { isPosDisposableDatabaseUrl } from '../test/disposable-database-url.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { CashShiftService } from '../modules/cash/cash-shift-service.js';
import { CheckoutOrchestrator } from '../modules/checkout/checkout-orchestrator.js';
import { BaseCommercialAcceptanceService } from '../modules/commercial-rounding/base-commercial-acceptance.js';
import { CommercialRoundingPolicyService } from '../modules/commercial-rounding/rounding-policy-service.js';
import { ApplyOrderMerchantDiscountService } from '../modules/discounts/apply-order-merchant-discount-service.js';
import {
  FiscalService,
  resolveFiscalProviderAdapter,
} from '../modules/fiscalization/index.js';
import {
  ApprovalRequestService,
  IdentityService,
  ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
  OutboxNotificationPort,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
  PERMISSION_PAYMENTS_RECEIVE_CASH,
  PERMISSION_POS_OPERATE,
  type AuthenticatedPrincipal,
} from '../modules/identity/index.js';
import { GoodsIssueService } from '../modules/inventory/goods-issue-service.js';
import { MenuService } from '../modules/menu/index.js';
import { AllergensService } from '../modules/allergens/index.js';
import { ModifiersService } from '../modules/modifiers/index.js';
import { IdempotencyConflictError, NotFoundError } from '../modules/orders/errors.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import { PaymentsService } from '../modules/payments/payments-service.js';
import { ReceiveCashService } from '../modules/payments/receive-cash-service.js';
import { GoodsReceiptService } from '../modules/procurement/goods-receipt-service.js';
import { SettlementService } from '../modules/settlement/settlement-service.js';
import { TaxService } from '../modules/tax/tax-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeGolden = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

const LIST_PRICE_MINOR = '50000';
const MODIFIER_DELTA_MINOR = '5000';
const DISCOUNT_MINOR = '5000';
const EXPECTED_GROSS_MINOR = '55000';
const EXPECTED_NET_MINOR = '50000';
const SALES_AT = '2026-10-30T08:00:00.000Z';

describeGolden('C0 combined Golden Path (disposable PG)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let al: AllergenFixture;
  let orders: OrdersService;
  let modifiers: ModifiersService;
  let allergens: AllergensService;
  let commercial: BaseCommercialAcceptanceService;
  let discounts: ApplyOrderMerchantDiscountService;
  let approvals: ApprovalRequestService;
  let tax: TaxService;
  let settlements: SettlementService;
  let receiveCash: ReceiveCashService;
  let fiscal: FiscalService;
  let checkout: CheckoutOrchestrator;
  let cashier: AuthenticatedPrincipal;
  let manager: AuthenticatedPrincipal;
  let terminalId: string;
  let tenderDefinitionId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    fx = await seedBlockCFixture(pool);
    al = await seedAllergenFixture(pool, fx);
    await pool.query(
      `UPDATE legal_entity SET tax_required = TRUE, fiscal_required = TRUE WHERE legal_entity_id = $1`,
      [fx.legalEntityId],
    );

    const coffeePack = randomUUID();
    const oatPack = randomUUID();
    const coffeeSupplierItem = randomUUID();
    const oatSupplierItem = randomUUID();
    await pool.query(
      `INSERT INTO supplier_pack (
         supplier_pack_id, tenant_id, name, pack_kind, units_per_package, dimension, to_base_unit
       ) VALUES ($1,$2,'Coffee kg','VARIABLE_WEIGHT',1,'MASS','kg')`,
      [coffeePack, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO supplier_pack (
         supplier_pack_id, tenant_id, name, pack_kind, units_per_package, unit_quantity, unit, dimension, to_base_unit, factor_per_unit
       ) VALUES ($1,$2,'1L oat','FIXED',1,'1','L','VOLUME','L','1')`,
      [oatPack, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO supplier_item (supplier_item_id, supplier_id, catalog_item_id, supplier_pack_id, external_sku, external_name)
       VALUES ($1,$3,$4,$5,'COFFEE','Coffee'), ($2,$3,$6,$7,'OAT','Oat drink')`,
      [coffeeSupplierItem, oatSupplierItem, fx.supplierId, al.coffeeItemId, coffeePack, al.oatDrinkItemId, oatPack],
    );

    const receipts = new GoodsReceiptService(pool);
    const coffee = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `C0-COFFEE-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-10-01',
      businessOrder: 1,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: al.coffeeItemId,
          supplierItemId: coffeeSupplierItem,
          inputKind: 'VARIABLE_WEIGHT',
          packageCount: 1,
          acceptedBaseQuantity: '1',
          baseUnit: 'kg',
          dimension: 'MASS',
          unitPriceMinor: '100000',
          lineAcquisitionCostMinor: '100000',
        },
      ],
    });
    await receipts.post(coffee!.goodsReceiptId, {
      idempotencyKey: `c0-coffee-${coffee!.goodsReceiptId}`,
      actorId: fx.actorId,
    });
    const oat = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `C0-OAT-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-10-01',
      businessOrder: 2,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: al.oatDrinkItemId,
          supplierItemId: oatSupplierItem,
          inputKind: 'FIXED_PACKAGE',
          packageCount: 2,
          acceptedBaseQuantity: '2',
          baseUnit: 'L',
          dimension: 'VOLUME',
          unitPriceMinor: '20000',
          lineAcquisitionCostMinor: '40000',
        },
      ],
    });
    await receipts.post(oat!.goodsReceiptId, {
      idempotencyKey: `c0-oat-${oat!.goodsReceiptId}`,
      actorId: fx.actorId,
    });

    const menu = new MenuService(pool);
    await menu.setOutletTimezone({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const def = await menu.createMenuDefinition({
      tenantId: fx.tenantId,
      code: `c0-golden-${randomUUID().slice(0, 8)}`,
      name: 'C0 Golden',
    });
    await menu.setMenuDefinitionItems({
      menuDefinitionId: def.menuDefinitionId,
      catalogItemIds: [al.latteItemId],
    });
    const pub = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: `c0-menu-${randomUUID()}`,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
    });
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      idempotencyKey: `c0-assign-${randomUUID()}`,
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: al.latteItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: LIST_PRICE_MINOR,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      idempotencyKey: `c0-price-${randomUUID()}`,
    });

    const policies = new CommercialRoundingPolicyService(pool);
    await policies.createPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      calculationContext: 'BASE_LIST_LINE_GROSS',
      roundingMode: 'HALF_UP',
      quantumMinor: '1',
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
    });

    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    modifiers = new ModifiersService(pool);
    allergens = new AllergensService(pool);
    commercial = new BaseCommercialAcceptanceService(pool, orders);
    const identity = new IdentityService(pool, 'c0-golden-test-pepper-not-production');
    discounts = new ApplyOrderMerchantDiscountService(orders, identity);
    approvals = new ApprovalRequestService(pool, identity, new OutboxNotificationPort(pool));
    tax = new TaxService(pool);
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `c0-tax-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [al.latteItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });

    const resolved = resolveFiscalProviderAdapter({
      isProduction: false,
      nodeEnv: 'test',
      allowFiscalTestAdapterEnv: '1',
      databaseUrl: DATABASE_URL,
    });
    expect(resolved.mode).toBe('test-satisfying');
    expect(resolved.adapter.adapterIdentity).toBe('millq.fiscal.test-satisfying');
    fiscal = new FiscalService(pool, { adapter: resolved.adapter });
    const fiscalPolicy = await fiscal.createFiscalPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `c0-fisc-${randomUUID().slice(0, 8)}`,
    });
    await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: fiscalPolicy.fiscalPolicyId,
      policyVersion: 1,
      fiscalDocumentRequired: true,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    });

    const payments = new PaymentsService(pool, {
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
    checkout = new CheckoutOrchestrator(pool, orders, settlements);

    terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name) VALUES ($1,$2,$3,'C0','C0 Terminal')`,
      [terminalId, fx.tenantId, fx.outletId],
    );
    const company = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'C0 Cashier',
      pin: '111111',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_RECEIVE_CASH, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'C0 Manager',
      pin: '222222',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE, outletId: fx.outletId },
      ],
    });
    const cashierSession = await identity.authenticatePin(
      { companyCode: company.rows[0]!.company_code, pin: '111111', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const managerSession = await identity.authenticatePin(
      { companyCode: company.rows[0]!.company_code, pin: '222222', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    cashier = await identity.resolveSession(cashierSession.sessionToken);
    manager = await identity.resolveSession(managerSession.sessionToken);
    const cash = new CashShiftService(pool, identity);
    await cash.openShift(cashier, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: `c0-open-${randomUUID()}`,
      openingCash: { amountMinor: '0', currencyCode: 'VND', minorUnitExponent: 0 },
    });

    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `C0CASH-${randomUUID().slice(0, 6)}`,
      displayName: 'C0 Cash',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    tenderDefinitionId = tender.tenderDefinitionId;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('walks modifier → allergy → discount → cash → test fiscal gate → one GoodsIssue', async () => {
    expect(
      resolveFiscalProviderAdapter({
        isProduction: true,
        nodeEnv: 'production',
        allowFiscalTestAdapterEnv: '1',
        databaseUrl: DATABASE_URL,
      }).mode,
    ).toBe('unavailable');

    const opened = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    const withLine = await orders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: al.latteItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const lineId = withLine.lines[0]!.orderLineId;

    const configured = await modifiers.configureOrderLine({
      orderId: opened.orderId,
      orderLineId: lineId,
      selections: [{ modifierGroupId: al.milkGroupId, modifierOptionId: al.oatOptionId }],
    });
    expect(configured.additivePriceAdjustmentMinor).toBe(MODIFIER_DELTA_MINOR);

    const captured = await allergens.captureContext({
      orderId: opened.orderId,
      captureChoice: 'SELECT_ALLERGENS',
      allergenCodes: ['MILK'],
      actorId: cashier.userId,
    });
    expect(captured.captureChoice).toBe('SELECT_ALLERGENS');
    expect(captured.allergenCodes).toEqual(['MILK']);

    const resolutions = await allergens.resolveOrderLines(opened.orderId);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      orderLineId: lineId,
      result: 'AVAILABLE_WITH_MODIFICATION',
    });
    for (const required of resolutions[0]!.requiredAcknowledgements) {
      await allergens.recordAcknowledgement({
        orderId: opened.orderId,
        orderLineId: lineId,
        kind: required.kind,
        actorId: cashier.userId,
      });
    }

    const accepted = await commercial.calculateAndAcceptBaseCommercialTerms({
      orderId: opened.orderId,
      salesContext: {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
        orderChannel: 'DIRECT',
        businessDateTime: SALES_AT,
      },
      idempotencyKey: `c0-accept-${opened.orderId}`,
      actorId: cashier.userId,
    });
    const acceptedLine = accepted.calculated.lines.find((l) => l.orderLineId === lineId);
    expect(acceptedLine?.grossMerchandiseMinor).toBe(EXPECTED_GROSS_MINOR);
    expect(accepted.accepted).toMatchObject({
      status: 'accepted',
      grossMerchandiseMinor: EXPECTED_GROSS_MINOR,
      netMerchandiseSalesMinor: EXPECTED_GROSS_MINOR,
    });

    const reason = 'Regular guest';
    const requested = await approvals.createRequest(cashier, {
      outletId: fx.outletId,
      terminalId,
      operationType: ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
      operationFingerprint: {
        orderId: opened.orderId,
        mode: 'FIXED_MINOR',
        amountMinor: DISCOUNT_MINOR,
        reason,
      },
    });
    expect((await approvals.decide(manager, requested.approvalRequestId, { decision: 'APPROVE' })).status).toBe(
      'APPROVED',
    );
    const discount = await discounts.apply(cashier, {
      orderId: opened.orderId,
      terminalId,
      idempotencyKey: `c0-disc-${opened.orderId}`,
      mode: 'FIXED_MINOR',
      amountMinor: DISCOUNT_MINOR,
      reason,
      approvalRequestId: requested.approvalRequestId,
    });
    expect(discount).toMatchObject({
      status: 'applied',
      mode: 'FIXED_MINOR',
      discountMinor: DISCOUNT_MINOR,
      eligibleBasisMinor: EXPECTED_GROSS_MINOR,
      netMerchandiseSalesMinor: EXPECTED_NET_MINOR,
      approvalRequestId: requested.approvalRequestId,
    });

    const other = await seedBlockCFixture(pool);
    const otherIdentity = new IdentityService(pool, 'c0-golden-test-pepper-not-production');
    const otherCompany = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [other.tenantId],
    );
    await otherIdentity.provisionUserWithPin({
      tenantId: other.tenantId,
      displayName: 'Other',
      pin: '333333',
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: other.outletId }],
    });
    const otherSession = await otherIdentity.authenticatePin(
      { companyCode: otherCompany.rows[0]!.company_code, pin: '333333', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const outsider = await otherIdentity.resolveSession(otherSession.sessionToken);
    await expect(
      discounts.apply(outsider, {
        orderId: opened.orderId,
        terminalId,
        idempotencyKey: `c0-x-${randomUUID()}`,
        mode: 'FIXED_MINOR',
        amountMinor: '1000',
        reason: 'Cross tenant',
        approvalRequestId: requested.approvalRequestId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const taxSnap = await tax.acceptTaxSnapshot({
      orderId: opened.orderId,
      idempotencyKey: `c0-tax-${opened.orderId}`,
    });
    expect(taxSnap.customerPayableMinor).toBe(EXPECTED_NET_MINOR);

    const settlement = await settlements.openSettlement({
      orderId: opened.orderId,
      idempotencyKey: `c0-settle-${opened.orderId}`,
      actorId: cashier.userId,
    });
    expect((await settlements.observeFiscalGate(settlement.settlementGroupId)).status).not.toBe('SATISFIED');

    const cashResult = await receiveCash.receiveCash({
      principal: cashier,
      terminalId,
      settlementCheckId: settlement.checks[0]!.settlementCheckId,
      tenderDefinitionId,
      receiveIdempotencyKey: `c0-rcv-${opened.orderId}`,
      amountTenderedMinor: taxSnap.customerPayableMinor,
      humanConfirmation: true,
    });
    expect(cashResult.evidence.amountDueMinor).toBe(EXPECTED_NET_MINOR);
    const paid = await settlements.reconcileSettlementCoverage(settlement.settlementGroupId);
    expect(paid.state).toBe('SATISFIED');
    const paidGate = await settlements.observeFiscalGate(settlement.settlementGroupId);
    expect(paidGate.status).not.toBe('SATISFIED');
    await expect(
      checkout.tryAdvanceCheckout({
        settlementGroupId: settlement.settlementGroupId,
        completeIdempotencyKey: `c0-complete-${opened.orderId}`,
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: cashier.userId,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FISCAL_PREREQUISITE/) });

    const issued = await fiscal.issueForSettlement({
      settlementGroupId: settlement.settlementGroupId,
      issueIdempotencyKey: `c0-issue-${opened.orderId}`,
    });
    expect(issued.status).toBe('SATISFIED');
    const gate = await settlements.observeFiscalGate(settlement.settlementGroupId);
    expect(gate.status).toBe('SATISFIED');

    const advanced = await checkout.tryAdvanceCheckout({
      settlementGroupId: settlement.settlementGroupId,
      completeIdempotencyKey: `c0-complete-${opened.orderId}`,
      businessDate: '2026-10-30',
      businessOrder: 1,
      actorId: cashier.userId,
    });
    expect(advanced.completion.status).toBe('completed');
    expect(advanced.fiscal.status).toBe('SATISFIED');

    const replay = await checkout.tryAdvanceCheckout({
      settlementGroupId: settlement.settlementGroupId,
      completeIdempotencyKey: `c0-complete-${opened.orderId}`,
      businessDate: '2026-10-30',
      businessOrder: 1,
      actorId: cashier.userId,
    });
    expect(replay.completion.status).toBe('duplicate');
    await expect(
      checkout.tryAdvanceCheckout({
        settlementGroupId: settlement.settlementGroupId,
        completeIdempotencyKey: `c0-complete-other-${opened.orderId}`,
        businessDate: '2026-10-30',
        businessOrder: 1,
        actorId: cashier.userId,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const issues = await pool.query<{ goods_issue_id: string; posting_status: string }>(
      `SELECT goods_issue_id, posting_status FROM goods_issue WHERE source_order_id = $1`,
      [opened.orderId],
    );
    expect(issues.rowCount).toBe(1);
    expect(issues.rows[0]!.posting_status).toBe('POSTED');

    const leaves = await pool.query<{ catalog_item_id: string; quantity_base: string; unit_base: string }>(
      `SELECT catalog_item_id, quantity_base, unit_base
       FROM consumption_plan_physical_leaf l
       JOIN consumption_plan_snapshot s ON s.consumption_plan_id = l.consumption_plan_id
       JOIN sales_order o ON o.consumption_plan_id = s.consumption_plan_id
       WHERE o.order_id = $1`,
      [opened.orderId],
    );
    const qty = (id: string) => leaves.rows.find((r) => r.catalog_item_id === id)?.quantity_base;
    expect(parseCanonicalDecimal(qty(al.coffeeItemId)!).eq(parseCanonicalDecimal('0.018'))).toBe(true);
    expect(parseCanonicalDecimal(qty(al.oatDrinkItemId)!).eq(parseCanonicalDecimal('0.2'))).toBe(true);
    expect(qty(al.milkItemId)).toBeUndefined();

    const frozen = await pool.query<{ capture_choice: string; allergen_codes: string[]; frozen_at: Date | null }>(
      `SELECT capture_choice, allergen_codes, frozen_at FROM order_allergen_context WHERE order_id = $1`,
      [opened.orderId],
    );
    expect(frozen.rows[0]).toMatchObject({ capture_choice: 'SELECT_ALLERGENS', allergen_codes: ['MILK'] });
    expect(frozen.rows[0]!.frozen_at).toBeTruthy();

    const deltas = await pool.query<{ effective_recipe_deltas_json: unknown }>(
      `SELECT effective_recipe_deltas_json FROM order_line_configuration WHERE order_line_id = $1`,
      [lineId],
    );
    expect(deltas.rows[0]!.effective_recipe_deltas_json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'REPLACE_COMPONENT',
          targetCatalogItemId: al.milkItemId,
          replacementCatalogItemId: al.oatDrinkItemId,
        }),
      ]),
    );
  });
});
