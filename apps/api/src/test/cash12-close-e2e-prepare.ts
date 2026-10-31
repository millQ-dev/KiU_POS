/**
 * Prepare disposable DB + fixture JSON for C0-PAY1 / CASH1.2 / C0-FISC2 browser E2E.
 * Seeds POS surface + RoundingPolicy + CASH tender + Tax/FiscalPolicy + egg stock.
 * Destructive — millq_ci_pos_* only. Does NOT seed Payment / PCE / FiscalDocument evidence.
 *
 * Usage:
 *   DATABASE_URL=... E2E_FIXTURE_PATH=... pnpm --filter @millq/api exec tsx src/test/cash12-close-e2e-prepare.ts
 */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../db/migrate.js';
import { seedBlockCFixture } from './seed.js';
import { assertPosDisposableDatabaseUrl } from './disposable-database-url.js';
import { loadEnv, resolvePinPepper } from '../config.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
  PERMISSION_PAYMENTS_RECEIVE_CASH,
  PERMISSION_POS_OPERATE,
} from '../modules/identity/index.js';
import { MenuService } from '../modules/menu/index.js';
import { LayoutService } from '../modules/pos/index.js';
import { CommercialRoundingPolicyService } from '../modules/commercial-rounding/rounding-policy-service.js';
import { FiscalService } from '../modules/fiscalization/index.js';
import { PaymentsService } from '../modules/payments/index.js';
import { GoodsReceiptService } from '../modules/procurement/goods-receipt-service.js';
import { TaxService } from '../modules/tax/tax-service.js';
import { TEST_PIN } from './financial-auth-harness.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
assertPosDisposableDatabaseUrl(DATABASE_URL);

const FIXTURE_PATH = process.env.E2E_FIXTURE_PATH;
if (!FIXTURE_PATH) {
  throw new Error('E2E_FIXTURE_PATH is required');
}
const fixtureOutPath: string = FIXTURE_PATH;

/** Same pepper resolution as the running API (honours IDENTITY_PIN_PEPPER). */
const PEPPER = resolvePinPepper(loadEnv());

const MANAGER_PIN = '654321';
const NO_RECEIVE_PIN = '111111';
const EGG_PRICE_MINOR = '5000';
const MEAT_PRICE_MINOR = '20000';
const OPENING_MINOR = '100000';

async function truncate(pool: pg.Pool) {
  await pool.query(`
    TRUNCATE
      fiscal_provider_outcome_evidence, fiscal_provider_attempt, fiscal_submission,
      fiscal_document, fiscal_policy_version, fiscal_policy,
      tax_line_snapshot, tax_order_snapshot,
      tax_classification_assignment, tax_policy_version, tax_policy, tax_classification,
      payment_collection_event, payment_cash_collection_evidence,
      payment_allocation, payment_provider_outcome, payment, tender_definition,
      settlement_check_line_allocation, settlement_check, settlement_group,
      settlement_payable_snapshot,
      cash_shift,
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
      identity_network_throttle,
      identity_pin_credential, workforce_employee, identity_user, terminal,
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
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      commercial_rounding_policy,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function seedPosSurface(
  pool: pg.Pool,
  fx: Awaited<ReturnType<typeof seedBlockCFixture>>,
): Promise<{ tenderDefinitionId: string; disabledTenderDefinitionId: string }> {
  const menu = new MenuService(pool);
  const layout = new LayoutService(pool);
  const policies = new CommercialRoundingPolicyService(pool);
  const payments = new PaymentsService(pool);

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

  await menu.setOutletTimezone({
    tenantId: fx.tenantId,
    outletId: fx.outletId,
    timezone: 'Asia/Ho_Chi_Minh',
  });
  const def = await menu.createMenuDefinition({
    tenantId: fx.tenantId,
    code: 'e2e-pay1',
    name: 'E2E Cashier Menu',
  });
  await menu.setMenuDefinitionItems({
    menuDefinitionId: def.menuDefinitionId,
    catalogItemIds: [fx.eggItemId, fx.meatItemId],
  });
  const mpub = await menu.publishMenu({
    menuDefinitionId: def.menuDefinitionId,
    idempotencyKey: `e2e-mp-${randomUUID()}`,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
  });
  await menu.assignMenu({
    tenantId: fx.tenantId,
    menuPublicationId: mpub.menuPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    idempotencyKey: `e2e-ma-${randomUUID()}`,
  });
  await menu.activatePriceRule({
    tenantId: fx.tenantId,
    catalogItemId: fx.eggItemId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    amountMinor: EGG_PRICE_MINOR,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    idempotencyKey: `e2e-pe-${randomUUID()}`,
  });
  await menu.activatePriceRule({
    tenantId: fx.tenantId,
    catalogItemId: fx.meatItemId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    amountMinor: MEAT_PRICE_MINOR,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    idempotencyKey: `e2e-pm-${randomUUID()}`,
  });

  const ldef = await layout.createLayoutDefinition({
    tenantId: fx.tenantId,
    code: 'e2e-lay',
    name: 'E2E Cashier',
  });
  await layout.setLayoutPages({
    layoutDefinitionId: ldef.layoutDefinitionId,
    pages: [{ pageCode: 'main', label: 'Main', sortOrder: 0 }],
  });
  await layout.setLayoutSlots({
    layoutDefinitionId: ldef.layoutDefinitionId,
    slots: [
      { zone: 'PAGE', pageCode: 'main', catalogItemId: fx.eggItemId, position: 1 },
      { zone: 'PAGE', pageCode: 'main', catalogItemId: fx.meatItemId, position: 2 },
      { zone: 'QUICK_ACCESS', catalogItemId: fx.eggItemId, position: 1 },
    ],
  });
  const lpub = await layout.publishLayout({
    layoutDefinitionId: ldef.layoutDefinitionId,
    idempotencyKey: `e2e-lp-${randomUUID()}`,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
  });
  await layout.assignLayout({
    tenantId: fx.tenantId,
    layoutPublicationId: lpub.layoutPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    idempotencyKey: `e2e-la-${randomUUID()}`,
  });

  const cash = await payments.createTenderDefinition({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    code: 'CASH',
    displayName: 'Cash',
    instrumentFamily: 'CASH',
    presentationCapability: 'MERCHANT_PRESENTED',
    enabled: true,
  });
  const disabled = await payments.createTenderDefinition({
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    code: 'CASH-OFF',
    displayName: 'Cash Disabled',
    instrumentFamily: 'CASH',
    presentationCapability: 'MERCHANT_PRESENTED',
    enabled: false,
  });

  return {
    tenderDefinitionId: cash.tenderDefinitionId,
    disabledTenderDefinitionId: disabled.tenderDefinitionId,
  };
}

async function main() {
  await runMigrations(DATABASE_URL);
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await truncate(pool);
    const fx = await seedBlockCFixture(pool);
    const identity = new IdentityService(pool, PEPPER);
    const tenders = await seedPosSurface(pool, fx);

    // C0-FISC2: tax + fiscal required; policies effective; stock for DIRECT_STOCK GoodsIssue.
    await pool.query(
      `UPDATE legal_entity SET tax_required = TRUE, fiscal_required = TRUE
       WHERE legal_entity_id = $1`,
      [fx.legalEntityId],
    );
    const tax = new TaxService(pool);
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `e2e-tax-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId, fx.meatItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });
    const fiscal = new FiscalService(pool);
    const pol = await fiscal.createFiscalPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `e2e-fisc-${randomUUID().slice(0, 8)}`,
    });
    await fiscal.addFiscalPolicyVersion({
      fiscalPolicyId: pol.fiscalPolicyId,
      policyVersion: 1,
      fiscalDocumentRequired: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
    });
    const receipts = new GoodsReceiptService(pool);
    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `E2E-EGG-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-01-01',
      businessOrder: 1,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: fx.eggItemId,
          supplierItemId: fx.eggSupplierItemId,
          inputKind: 'COUNT',
          packageCount: 500,
          acceptedBaseQuantity: '500',
          baseUnit: 'ea',
          dimension: 'COUNT',
          unitPriceMinor: '2000',
          lineAcquisitionCostMinor: '1000000',
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: `e2e-egg-${draft!.goodsReceiptId}`,
      actorId: fx.actorId,
    });

    const terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'T1','Front')`,
      [terminalId, fx.tenantId, fx.outletId],
    );

    const foreignTenantId = randomUUID();
    const foreignOutletId = randomUUID();
    const foreignBrandId = randomUUID();
    const foreignLeId = randomUUID();
    await pool.query(
      `INSERT INTO tenant (tenant_id, name, company_code) VALUES ($1,'Other Co',$2)`,
      [foreignTenantId, foreignTenantId.replace(/-/g, '').toUpperCase()],
    );
    await pool.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code, tax_required)
       VALUES ($1,$2,'Other LE','VN',FALSE)`,
      [foreignLeId, foreignTenantId],
    );
    await pool.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Other')`, [
      foreignBrandId,
      foreignTenantId,
    ]);
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Foreign Outlet')`,
      [foreignOutletId, foreignTenantId, foreignBrandId, foreignLeId],
    );
    const foreignTerminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'FX','Foreign')`,
      [foreignTerminalId, foreignTenantId, foreignOutletId],
    );

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Cashier',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_RECEIVE_CASH, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Manager',
      pin: MANAGER_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_RECEIVE_CASH, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'NoReceive',
      pin: NO_RECEIVE_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
      ],
    });

    const company = await pool.query<{ company_code: string; name: string }>(
      `SELECT company_code, name FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );

    const fixture = {
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      legalEntityId: fx.legalEntityId,
      brandId: fx.brandId,
      terminalId,
      eggCatalogItemId: fx.eggItemId,
      meatCatalogItemId: fx.meatItemId,
      eggPriceMinor: EGG_PRICE_MINOR,
      meatPriceMinor: MEAT_PRICE_MINOR,
      tenderDefinitionId: tenders.tenderDefinitionId,
      disabledTenderDefinitionId: tenders.disabledTenderDefinitionId,
      companyCode: company.rows[0]!.company_code,
      companyDisplayName: company.rows[0]!.name,
      cashierPin: TEST_PIN,
      managerPin: MANAGER_PIN,
      noReceivePin: NO_RECEIVE_PIN,
      foreignCompanyCode: foreignTenantId.replace(/-/g, '').toUpperCase(),
      foreignTerminalId,
      openingAmountMinor: OPENING_MINOR,
      /** Overpay: tendered 10000 on due 5000 → change 5000; PCE collected = due only. */
      overpayTenderedMinor: '10000',
      expectedChangeMinor: '5000',
      expectedCollectedMinor: EGG_PRICE_MINOR,
      expectedCloseMinor: (BigInt(OPENING_MINOR) + BigInt(EGG_PRICE_MINOR)).toString(),
    };
    writeFileSync(fixtureOutPath, JSON.stringify(fixture, null, 2));
    console.log(`e2e fixture written: ${fixtureOutPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
