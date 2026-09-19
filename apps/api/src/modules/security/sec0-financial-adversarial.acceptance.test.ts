/**
 * SEC-0 — permanent adversarial matrix for financial HTTP + Identity binding.
 * Covers auth/authz, tenant isolation, DEV registration gates, mass-assignment,
 * CompleteOrder bypass, and selected A–T scenarios at the HTTP boundary.
 * Domain A–T depth remains in PAY1.1 / S1.1 / golden suites; concurrency in pay11.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { resolvePinPepper } from '../../config.js';
import { runMigrations } from '../../db/migrate.js';
import {
  IdentityService,
  PERMISSION_POS_OPERATE,
  SESSION_COOKIE_NAME,
} from '../identity/index.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import { PaymentsService } from '../payments/payments-service.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import {
  authInjectHeaders,
  loginPosSession,
  provisionPosOperator,
  TEST_ORIGIN,
  TEST_PIN,
} from '../../test/financial-auth-harness.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import {
  registerDevCashierBootstrapRoutes,
  registerPosRoutes,
} from '../../routes/pos.js';
import {
  registerDevPaymentSimulatorRoutes,
  createWiredPaymentsAndSettlement,
} from '../../routes/payments.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_sec0_test';
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

let pool: pg.Pool;
let fx: BlockCFixture;
let identity: IdentityService;
let fxB: BlockCFixture;

async function truncate() {
  await pool.query(`
    TRUNCATE
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
      identity_network_throttle,
      identity_pin_credential, workforce_employee, identity_user, terminal,
      payment_allocation, payment_provider_outcome, payment, tender_definition,
      settlement_check_line_allocation, settlement_check, settlement_group,
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
      public_menu_link, outlet_capability_config, package_entitlement,
      catalog_item_presentation, presentation_media_asset,
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

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
  await registerPosRoutes(app, pool, {
    pepper: PEPPER,
    allowedOrigins: [TEST_ORIGIN],
    isProduction: false,
  });
  await registerDevCashierBootstrapRoutes(app, pool);
  await app.ready();
  return app;
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  identity = new IdentityService(pool, PEPPER);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate();
  fx = await seedBlockCFixture(pool);
  // Second tenant for cross-tenant IDOR
  fxB = await seedBlockCFixture(pool);
  await provisionPosOperator(identity, fx);
});

describe('SEC-0 DEV registration gates', () => {
  it('production NEVER registers payment simulator even with ALLOW_DEV_*=1', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_PAYMENT_SIMULATOR;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_PAYMENT_SIMULATOR = '1';
    const app = Fastify({ logger: false });
    const { payments } = createWiredPaymentsAndSettlement(pool, (p) => new SettlementService(pool, {
      coverageReader: p.createCoverageReader(),
      externalEffects: p.createExternalEffectProbe(),
    }));
    await registerDevPaymentSimulatorRoutes(app, payments);
    await app.ready();
    const routes = app.printRoutes();
    expect(routes).not.toMatch(/payment-simulator/);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/payment-simulator/outcome',
      payload: { paymentId: randomUUID(), scenario: 'SUCCESS' },
    });
    expect(res.statusCode).toBe(404);
    process.env.NODE_ENV = prevEnv;
    if (prevFlag === undefined) delete process.env.ALLOW_DEV_PAYMENT_SIMULATOR;
    else process.env.ALLOW_DEV_PAYMENT_SIMULATOR = prevFlag;
    await app.close();
  });

  it('production NEVER registers cashier bootstrap even with ALLOW_DEV_CASHIER_BOOTSTRAP=1', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_CASHIER_BOOTSTRAP;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_CASHIER_BOOTSTRAP = '1';
    const app = Fastify({ logger: false });
    await registerDevCashierBootstrapRoutes(app, pool);
    await app.ready();
    const routes = app.printRoutes();
    expect(routes).not.toMatch(/cashier-contexts/);
    const res = await app.inject({ method: 'GET', url: '/api/v1/dev/cashier-contexts' });
    expect(res.statusCode).toBe(404);
    process.env.NODE_ENV = prevEnv;
    if (prevFlag === undefined) delete process.env.ALLOW_DEV_CASHIER_BOOTSTRAP;
    else process.env.ALLOW_DEV_CASHIER_BOOTSTRAP = prevFlag;
    await app.close();
  });
});

describe('SEC-0 auth / tenant / mass-assignment (P, B, N, O)', () => {
  it('unauthenticated payments/orders/settlements rejected (401)', async () => {
    const app = await buildApp();
    const headers = { origin: TEST_ORIGIN };
    const cases = [
      { method: 'POST' as const, url: '/api/v1/payments/tenders', payload: {} },
      { method: 'POST' as const, url: '/api/v1/payments', payload: {} },
      { method: 'GET' as const, url: `/api/v1/payments/${randomUUID()}` },
      { method: 'POST' as const, url: '/api/v1/payments/allocations', payload: {} },
      {
        method: 'POST' as const,
        url: '/api/v1/orders',
        payload: {
          tenantId: fx.tenantId,
          legalEntityId: fx.legalEntityId,
          outletId: fx.outletId,
          channel: 'DIRECT',
        },
      },
      { method: 'POST' as const, url: `/api/v1/settlements/${randomUUID()}/reconcile-coverage` },
      {
        method: 'POST' as const,
        url: `/api/v1/settlements/${randomUUID()}/advance-checkout`,
        payload: {
          completeIdempotencyKey: 'x',
          businessDate: '2026-09-16',
          businessOrder: 1,
          paid: true,
          settlementSatisfied: true,
        },
      },
    ];
    for (const c of cases) {
      const res = await app.inject({ ...c, headers });
      expect(res.statusCode, c.url).toBe(401);
    }
    await app.close();
  });

  it('P — body tenantId switch rejected; Session tenant wins', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const headers = authInjectHeaders(token);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload: {
        tenantId: fxB.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
    await app.close();
  });

  it('B — Tenant A cannot GET Tenant B payment (IDOR → 404)', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const headers = authInjectHeaders(token);

    const payments = new PaymentsService(pool);
    const tender = await payments.createTenderDefinition({
      tenantId: fxB.tenantId,
      legalEntityId: fxB.legalEntityId,
      code: `tb_${randomUUID().slice(0, 6)}`,
      displayName: 'Foreign',
    });
    const foreignPay = await payments.createPayment({
      tenderDefinitionId: tender.tenderDefinitionId,
      createIdempotencyKey: randomUUID(),
      requestedAmountMinor: '1000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${foreignPay.paymentId}`,
      headers,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('N/O — caller cannot force SATISFIED / paid / providerVerified / fiscalAccepted', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const headers = authInjectHeaders(token);

    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
        paid: true,
        settlementSatisfied: true,
        providerVerified: true,
      },
    });
    expect(open.statusCode).toBe(400);

    const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
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
    // Stock egg for commercial accept path not required for open-settlement reject tests
    await acceptFinalMerchandiseTerms(orders, o.orderId, {
      idempotencyKey: randomUUID(),
      defaultGrossMinor: '5000',
    });

    const { settlements } = createWiredPaymentsAndSettlement(pool, (p) =>
      new SettlementService(pool, {
        coverageReader: p.createCoverageReader(),
        externalEffects: p.createExternalEffectProbe(),
      }),
    );
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: randomUUID(),
    });

    const recon = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${s.settlementGroupId}/reconcile-coverage`,
      headers,
      payload: { covered: true, settlementStatus: 'SATISFIED', coveredMinor: '99999' },
    });
    expect(recon.statusCode).toBe(400);

    const advance = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${s.settlementGroupId}/advance-checkout`,
      headers,
      payload: {
        completeIdempotencyKey: randomUUID(),
        businessDate: '2026-09-16',
        businessOrder: 1,
        paid: true,
        settlementSatisfied: true,
        providerVerified: true,
        fiscalAccepted: true,
      },
    });
    expect(advance.statusCode).toBe(400);

    // No direct CompleteOrder HTTP route
    const routes = app.printRoutes();
    expect(routes).not.toMatch(/completeOrder|\/complete['"]/);
    await app.close();
  });

  it('session without pos.operate AccessGrant is forbidden', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'NoGrant',
      pin: '654321',
      // no grants
    });
    const app = await buildApp();
    const row = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/pin/authenticate',
      payload: { companyCode: row.rows[0]!.company_code, pin: '654321', channel: 'TERMINAL' },
      headers: { origin: TEST_ORIGIN },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    const headers = authInjectHeaders(match![1]!);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('CSRF — mutating financial route without Origin rejected in production mode', async () => {
    const app = Fastify({ logger: false });
    await app.register(cookie);
    await registerIdentityRoutes(app, pool, {
      pepper: PEPPER,
      cookieSecure: false,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: true,
    });
    await registerPosRoutes(app, pool, {
      pepper: PEPPER,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: true,
    });
    await app.ready();
    const token = await loginPosSession(app, pool, fx, TEST_PIN);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CSRF_REJECTED');
    await app.close();
  });
});

describe('SEC-0 S — pathological money rejected at Money boundary', () => {
  it('rejects NaN/Infinity/float amountMinor on createPayment', async () => {
    const payments = new PaymentsService(pool);
    const tender = await payments.createTenderDefinition({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      code: `m_${randomUUID().slice(0, 6)}`,
      displayName: 'Money',
    });
    for (const bad of ['NaN', 'Infinity', '1.5', '1e3', '']) {
      await expect(
        payments.createPayment({
          tenderDefinitionId: tender.tenderDefinitionId,
          createIdempotencyKey: randomUUID(),
          requestedAmountMinor: bad,
          currencyCode: 'VND',
          minorUnitExponent: 0,
        }),
      ).rejects.toBeTruthy();
    }
  });
});

describe('SEC-0 permission catalog', () => {
  it('pos.operate permission exists after migration', async () => {
    const res = await pool.query(
      `SELECT 1 FROM identity_permission WHERE permission_key = $1`,
      [PERMISSION_POS_OPERATE],
    );
    expect(res.rowCount).toBe(1);
  });
});
