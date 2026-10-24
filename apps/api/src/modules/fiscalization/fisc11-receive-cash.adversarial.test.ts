/**
 * FISC1.1 ReceiveCash adversarial suite (PO pre-merge close-out).
 * HTTP auth denial, CLOSED shift, concurrency, semantic idempotency conflict,
 * cross-tenant / wrong-terminal isolation, migration 031→032 fresh DB.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { resolvePinPepper } from '../../config.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import {
  authInjectHeaders,
  loginPosSession,
  TEST_ORIGIN,
  TEST_PIN,
} from '../../test/financial-auth-harness.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { CashShiftService } from '../cash/cash-shift-service.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_PAYMENTS_RECEIVE_CASH,
  PERMISSION_POS_OPERATE,
} from '../identity/index.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import { PaymentsService } from '../payments/payments-service.js';
import { ReceiveCashService } from '../payments/receive-cash-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { TaxService } from '../tax/tax-service.js';
import { registerCashRoutes } from '../../routes/cash.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { registerPosRoutes } from '../../routes/pos.js';
import { FiscalService } from './index.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

const CASHIER_PIN = '654321';
const NO_CASH_PIN = '111111';

describe('FISC1.1 ReceiveCash adversarial (PO close-out)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let identity: IdentityService;
  let cash: CashShiftService;
  let orders: OrdersService;
  let tax: TaxService;
  let payments: PaymentsService;
  let settlements: SettlementService;
  let receiveCash: ReceiveCashService;
  let terminalId: string;
  let cashTenderId: string;

  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(cookie);
    await registerCompanyIdentityRoutes(app, pool);
    await registerIdentityRoutes(app, pool, {
      pepper: PEPPER,
      cookieSecure: false,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await registerCashRoutes(app, pool, {
      pepper: PEPPER,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await registerPosRoutes(app, pool, {
      pepper: PEPPER,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await app.ready();
    return app;
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    identity = new IdentityService(pool, PEPPER);
    cash = new CashShiftService(pool, identity);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    tax = new TaxService(pool);
    const fiscal = new FiscalService(pool);
    payments = new PaymentsService(pool, {
      onCoverageChanged: async (gid) => {
        await settlements.reconcileSettlementCoverage(gid);
      },
    });
    settlements = new SettlementService(pool, {
      coverageReader: payments.createCoverageReader(),
      externalEffects: payments.createExternalEffectProbe(),
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

  beforeEach(async () => {
    fx = await seedBlockCFixture(pool);
    await pool.query(
      `UPDATE legal_entity SET tax_required = TRUE, fiscal_required = TRUE
       WHERE legal_entity_id = $1`,
      [fx.legalEntityId],
    );
    terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,$4,$5)`,
      [terminalId, fx.tenantId, fx.outletId, `ADV-${randomUUID().slice(0, 6)}`, 'Adv Terminal'],
    );

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Cash Receiver',
      pin: CASHIER_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_RECEIVE_CASH, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Operate Only',
      pin: NO_CASH_PIN,
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });

    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `adv-tax-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });

    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `CASH-ADV-${randomUUID().slice(0, 6)}`,
      displayName: 'Cash Adv',
      instrumentFamily: 'CASH',
      presentationCapability: 'MERCHANT_PRESENTED',
    });
    cashTenderId = tender.tenderDefinitionId;
  });

  async function ensureEggStock(target: BlockCFixture = fx) {
    const receipts = new GoodsReceiptService(pool);
    const draft = await receipts.createDraft({
      tenantId: target.tenantId,
      legalEntityId: target.legalEntityId,
      warehouseId: target.warehouseId,
      supplierId: target.supplierId,
      supplierDocumentNumber: `ADV-EGG-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-10-11',
      businessOrder: 1,
      actorId: target.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: target.eggItemId,
          supplierItemId: target.eggSupplierItemId,
          inputKind: 'COUNT',
          packageCount: 50,
          acceptedBaseQuantity: '50',
          baseUnit: 'ea',
          dimension: 'COUNT',
          unitPriceMinor: '2000',
          lineAcquisitionCostMinor: '100000',
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: `adv-egg-${draft!.goodsReceiptId}`,
      actorId: target.actorId,
    });
  }

  async function openCollectingCheck(grossMinor: string) {
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
      idempotencyKey: `adv-comm-${randomUUID()}`,
      defaultGrossMinor: grossMinor,
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: grossMinor },
    });
    await tax.acceptTaxSnapshot({
      orderId: refreshed.orderId,
      idempotencyKey: `adv-tax-${refreshed.orderId}`,
    });
    const s = await settlements.openSettlement({
      orderId: refreshed.orderId,
      idempotencyKey: `adv-open-${refreshed.orderId}`,
    });
    return {
      settlementGroupId: s.settlementGroupId,
      settlementCheckId: s.checks[0]!.settlementCheckId,
      customerPayableMinor: s.checks[0]!.customerPayableMinor,
    };
  }

  async function openShiftForCashier() {
    const company = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    const auth = await identity.authenticatePin(
      { companyCode: company.rows[0]!.company_code, pin: CASHIER_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const principal = await identity.resolveSession(auth.sessionToken);
    await cash.openShift(principal, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: `adv-open-${randomUUID()}`,
      openingCash: { amountMinor: '1000', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    return principal;
  }

  it('HTTP: cashier with pos.operate but without payments.receive_cash is forbidden', async () => {
    const app = await buildApp();
    try {
      await openShiftForCashier();
      const check = await openCollectingCheck('50000');
      const token = await loginPosSession(app, pool, fx, NO_CASH_PIN);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/receive-cash',
        headers: authInjectHeaders(token),
        payload: {
          settlementCheckId: check.settlementCheckId,
          tenderDefinitionId: cashTenderId,
          terminalId,
          receiveIdempotencyKey: `http-deny-${randomUUID()}`,
          amountTenderedMinor: '50000',
          humanConfirmation: true,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN|AUTH/);
    } finally {
      await app.close();
    }
  });

  it('HTTP: authorized cashier with CLOSED CashShift cannot ReceiveCash', async () => {
    const app = await buildApp();
    try {
      await openShiftForCashier();
      // CASH1.2 / ADR-0046: CLOSED requires coherent close evidence (not bare status flip).
      await pool.query(
        `UPDATE cash_shift SET
           status = 'CLOSED',
           closed_at = NOW(),
           closed_by_user_id = opened_by_user_id,
           actual_amount_minor = opening_amount_minor,
           expected_amount_minor = opening_amount_minor,
           difference_minor = '0',
           variance_kind = 'BALANCED',
           close_idempotency_key = $2,
           expected_source_refs = '[]'::jsonb
         WHERE terminal_id = $1 AND status = 'OPEN'`,
        [terminalId, `fisc-fixture-close-${randomUUID()}`],
      );
      const check = await openCollectingCheck('50000');
      const token = await loginPosSession(app, pool, fx, CASHIER_PIN);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/receive-cash',
        headers: authInjectHeaders(token),
        payload: {
          settlementCheckId: check.settlementCheckId,
          tenderDefinitionId: cashTenderId,
          terminalId,
          receiveIdempotencyKey: `http-closed-${randomUUID()}`,
          amountTenderedMinor: '50000',
          humanConfirmation: true,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CASH_SHIFT_NOT_OPEN');
    } finally {
      await app.close();
    }
  });

  it('concurrent ReceiveCash with distinct keys → single Payment (fail closed)', async () => {
    // Lock-order regression (Bugbot thread 2): Check→evidence-by-key→evidence-by-check.
    // Concurrent distinct keys must serialize on the Check lock — no deadlock, one winner.
    const principal = await openShiftForCashier();
    const check = await openCollectingCheck('65000');
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        receiveCash.receiveCash({
          principal,
          terminalId,
          settlementCheckId: check.settlementCheckId,
          tenderDefinitionId: cashTenderId,
          receiveIdempotencyKey: `conc-${i}-${randomUUID()}`,
          amountTenderedMinor: '65000',
          humanConfirmation: true,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(rejected.length).toBe(7);
    // Fail-closed losers: domain CASH_COLLECTION_ALREADY_EXISTS (Check lock path).
    for (const r of rejected) {
      if (r.status !== 'rejected') continue;
      const code = (r.reason as { code?: string })?.code;
      expect(code === 'CASH_COLLECTION_ALREADY_EXISTS' || code === undefined).toBe(true);
    }
    const payCount = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM payment_allocation
       WHERE settlement_check_id = $1 AND active = TRUE`,
      [check.settlementCheckId],
    );
    expect(payCount.rows[0]!.c).toBe(1);
    const pceCount = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM payment_collection_event
       WHERE settlement_check_id = $1`,
      [check.settlementCheckId],
    );
    expect(pceCount.rows[0]!.c).toBe(1);
  });

  it('same idempotency key with different tendered amount → IDEMPOTENCY_CONFLICT', async () => {
    const principal = await openShiftForCashier();
    const check = await openCollectingCheck('50000');
    const key = `sem-${randomUUID()}`;
    await receiveCash.receiveCash({
      principal,
      terminalId,
      settlementCheckId: check.settlementCheckId,
      tenderDefinitionId: cashTenderId,
      receiveIdempotencyKey: key,
      amountTenderedMinor: '50000',
      humanConfirmation: true,
    });
    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: check.settlementCheckId,
        tenderDefinitionId: cashTenderId,
        receiveIdempotencyKey: key,
        amountTenderedMinor: '100000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('cross-tenant Check and foreign Terminal are rejected', async () => {
    const principal = await openShiftForCashier();
    const check = await openCollectingCheck('40000');

    const foreignTerminal = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,$4,'Foreign Term')`,
      [foreignTerminal, fx.tenantId, fx.outletId, `FT-${randomUUID().slice(0, 4)}`],
    );
    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId: foreignTerminal,
        settlementCheckId: check.settlementCheckId,
        tenderDefinitionId: cashTenderId,
        receiveIdempotencyKey: `ft-${randomUUID()}`,
        amountTenderedMinor: '40000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'CASH_SHIFT_NOT_OPEN' });

    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: randomUUID(),
        tenderDefinitionId: cashTenderId,
        receiveIdempotencyKey: `miss-${randomUUID()}`,
        amountTenderedMinor: '40000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Cross-tenant: principal tenant A vs SettlementCheck on tenant B
    const fxB = await seedBlockCFixture(pool);
    await pool.query(
      `UPDATE legal_entity SET tax_required = FALSE, fiscal_required = FALSE
       WHERE legal_entity_id = $1`,
      [fxB.legalEntityId],
    );
    await ensureEggStock(fxB);
    const oB = await orders.openOrder({
      tenantId: fxB.tenantId,
      legalEntityId: fxB.legalEntityId,
      outletId: fxB.outletId,
    });
    await orders.addOrderLine({
      orderId: oB.orderId,
      catalogItemId: fxB.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const rB = await orders.getOrder(oB.orderId);
    await acceptFinalMerchandiseTerms(orders, rB.orderId, {
      idempotencyKey: `xb2-${randomUUID()}`,
      defaultGrossMinor: '1000',
      grossByOrderLineId: { [rB.lines[0]!.orderLineId]: '1000' },
    });
    const sB = await settlements.openSettlement({
      orderId: rB.orderId,
      idempotencyKey: `xb-open-${rB.orderId}`,
    });
    await expect(
      receiveCash.receiveCash({
        principal,
        terminalId,
        settlementCheckId: sB.checks[0]!.settlementCheckId,
        tenderDefinitionId: cashTenderId,
        receiveIdempotencyKey: `xb-rc-${randomUUID()}`,
        amountTenderedMinor: '1000',
        humanConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ENTITY' });
  });

  it('migration 031→032 applies on a fresh database (not no-op-only)', async () => {
    const dbName = `millq_fisc11_mig_${Date.now()}`;
    const adminUrl =
      process.env.DATABASE_URL?.replace(/\/[^/]+$/, '/postgres') ??
      'postgresql://millq:millq@localhost:5432/postgres';
    const freshUrl =
      process.env.DATABASE_URL?.replace(/\/[^/]+$/, `/${dbName}`) ??
      `postgresql://millq:millq@localhost:5432/${dbName}`;

    const admin = new pg.Pool({ connectionString: adminUrl });
    try {
      await admin.query(`CREATE DATABASE ${dbName}`);
    } finally {
      await admin.end();
    }

    try {
      // Apply through 031 only first
      const migDir = new URL('../../../migrations/', import.meta.url);
      const { readdirSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const dir = fileURLToPath(migDir);
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const through031 = files.filter((f) => f <= '031_tax_domain_foundation.sql');
      const only032 = files.filter((f) => f === '032_fisc11_payment_collection_fiscal_core.sql');
      expect(only032.length).toBe(1);

      const fresh = new pg.Pool({ connectionString: freshUrl });
      try {
        await fresh.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`);
        for (const file of through031) {
          const sql = readFileSync(join(dir, file), 'utf8');
          await fresh.query('BEGIN');
          await fresh.query(sql);
          await fresh.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
          await fresh.query('COMMIT');
        }
        const before = await fresh.query(
          `SELECT 1 FROM schema_migrations WHERE filename = '032_fisc11_payment_collection_fiscal_core.sql'`,
        );
        expect(before.rowCount).toBe(0);

        // Capture migrate stdout for 032 first apply
        const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));
        const out = execFileSync(
          process.execPath,
          ['--import', 'tsx', 'src/db/migrate.ts'],
          {
            cwd: apiRoot,
            env: { ...process.env, DATABASE_URL: freshUrl },
            encoding: 'utf8',
          },
        );
        expect(out).toMatch(/Applied migration: 032_fisc11_payment_collection_fiscal_core\.sql/);

        const after = await fresh.query(
          `SELECT filename FROM schema_migrations
           WHERE filename = '032_fisc11_payment_collection_fiscal_core.sql'`,
        );
        expect(after.rowCount).toBe(1);

        const tables = await fresh.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN (
               'payment_collection_event',
               'payment_cash_collection_evidence',
               'fiscal_policy',
               'fiscal_document'
             )`,
        );
        expect(tables.rowCount).toBe(4);

        // Rerun must be silent (idempotent)
        const out2 = execFileSync(
          process.execPath,
          ['--import', 'tsx', 'src/db/migrate.ts'],
          {
            cwd: apiRoot,
            env: { ...process.env, DATABASE_URL: freshUrl },
            encoding: 'utf8',
          },
        );
        expect(out2).not.toMatch(/Applied migration: 032/);
      } finally {
        await fresh.end();
      }
    } finally {
      const drop = new pg.Pool({ connectionString: adminUrl });
      try {
        await drop.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      } finally {
        await drop.end();
      }
    }
  });
});
