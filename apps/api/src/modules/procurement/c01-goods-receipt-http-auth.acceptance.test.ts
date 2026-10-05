/**
 * C0.1 — Goods Receipt / inventory HTTP SEC-0 auth adversarial suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  authInjectHeaders,
  TEST_ORIGIN,
  TEST_PIN,
} from '../../test/financial-auth-harness.js';
import { resolvePinPepper } from '../../config.js';
import {
  IdentityService,
  PERMISSION_POS_OPERATE,
  PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
  SESSION_COOKIE_NAME,
} from '../identity/index.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { registerGoodsReceiptRoutes } from '../../routes/goods-receipts.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_c01_test';
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

let pool: pg.Pool;
let fx: BlockCFixture;
let fxB: BlockCFixture;
let identity: IdentityService;
let companyCode: string;

async function truncate() {
  await pool.query(`
    TRUNCATE
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
      public_menu_link, outlet_capability_config, package_entitlement,
      catalog_item_presentation, presentation_media_asset,
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      payment_allocation, payment_provider_outcome, payment, tender_definition,
      settlement_check_line_allocation, settlement_check, settlement_group,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function buildApp(isProduction = false) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerCompanyIdentityRoutes(app, pool);
  await registerIdentityRoutes(app, pool, {
    pepper: PEPPER,
    cookieSecure: false,
    allowedOrigins: [TEST_ORIGIN],
    isProduction,
  });
  await registerGoodsReceiptRoutes(app, pool, {
    pepper: PEPPER,
    allowedOrigins: [TEST_ORIGIN],
    isProduction,
  });
  await app.ready();
  return app;
}

async function loginWithPin(app: Awaited<ReturnType<typeof buildApp>>, pin: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/identity/pin/authenticate',
    payload: { companyCode, pin, channel: 'TERMINAL' },
    headers: { origin: TEST_ORIGIN },
  });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) throw new Error('session cookie missing');
  return match[1];
}

function milkLine(fxLocal: BlockCFixture) {
  return {
    lineNumber: 1,
    catalogItemId: fxLocal.milkItemId,
    supplierItemId: fxLocal.milkSupplierItemId,
    inputKind: 'FIXED_PACKAGE' as const,
    packageCount: 2,
    acceptedBaseQuantity: '2',
    baseUnit: 'L',
    dimension: 'VOLUME' as const,
    unitPriceMinor: '10000',
    lineAcquisitionCostMinor: '20000',
  };
}

function draftPayload(fxLocal: BlockCFixture, overrides: Record<string, unknown> = {}) {
  return {
    tenantId: fxLocal.tenantId,
    legalEntityId: fxLocal.legalEntityId,
    warehouseId: fxLocal.warehouseId,
    supplierId: fxLocal.supplierId,
    supplierDocumentNumber: 'C01-1',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-03-01',
    businessOrder: 1,
    lines: [milkLine(fxLocal)],
    ...overrides,
  };
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
  fxB = await seedBlockCFixture(pool);
  const row = await pool.query<{ company_code: string }>(
    `SELECT company_code FROM tenant WHERE tenant_id = $1`,
    [fx.tenantId],
  );
  companyCode = row.rows[0]!.company_code;
  await identity.provisionUserWithPin({
    tenantId: fx.tenantId,
    displayName: 'Buyer',
    pin: TEST_PIN,
    grants: [
      {
        permissionKey: PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
        outletId: null,
        terminalId: null,
      },
    ],
  });
});

describe('C0.1 Goods Receipt HTTP auth', () => {
  it('no session → 401', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: { origin: TEST_ORIGIN },
      payload: draftPayload(fx),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('Session without procurement grant → 403; pos.operate alone insufficient', async () => {
    const app = await buildApp();
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'CashierOnly',
      pin: '654321',
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: null }],
    });
    const token = await loginWithPin(app, '654321');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: authInjectHeaders(token),
      payload: draftPayload(fx),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('tenant-wide procurement grant → create/get/post allowed', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app, TEST_PIN);
    const headers = authInjectHeaders(token);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers,
      payload: draftPayload(fx, { supplierDocumentNumber: 'OK-1' }),
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { goodsReceiptId: string }).goodsReceiptId;
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/goods-receipts/${id}`,
      headers,
    });
    expect(get.statusCode).toBe(200);
    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${id}/post`,
      headers,
      payload: { idempotencyKey: 'c01-post-1' },
    });
    expect(post.statusCode).toBe(200);
    const bal = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?legalEntityId=${fx.legalEntityId}&warehouseId=${fx.warehouseId}&catalogItemId=${fx.milkItemId}`,
      headers,
    });
    expect(bal.statusCode).toBe(200);
    expect((bal.json() as { quantity: string }).quantity).toBe('2');
    await app.close();
  });

  it('body tenantId from another tenant rejected', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app, TEST_PIN);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: authInjectHeaders(token),
      payload: draftPayload(fx, { tenantId: fxB.tenantId }),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('foreign GoodsReceipt UUID get/patch/validate/post/reverse → 404', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app, TEST_PIN);
    const headers = authInjectHeaders(token);
    // Create GR under tenant B via service (bypass HTTP)
    const { GoodsReceiptService } = await import('./goods-receipt-service.js');
    const svc = new GoodsReceiptService(pool);
    const foreign = await svc.createDraft(
      draftPayload(fxB, { supplierDocumentNumber: 'FOREIGN', actorId: fxB.actorId }),
    );

    for (const [method, url, payload] of [
      ['GET', `/api/v1/goods-receipts/${foreign!.goodsReceiptId}`, undefined],
      ['PATCH', `/api/v1/goods-receipts/${foreign!.goodsReceiptId}`, { supplierDocumentNumber: 'X' }],
      ['POST', `/api/v1/goods-receipts/${foreign!.goodsReceiptId}/validate`, {}],
      ['POST', `/api/v1/goods-receipts/${foreign!.goodsReceiptId}/post`, { idempotencyKey: 'x' }],
      [
        'POST',
        `/api/v1/goods-receipts/${foreign!.goodsReceiptId}/reverse`,
        { idempotencyKey: 'y' },
      ],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers,
        ...(payload !== undefined ? { payload } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    await app.close();
  });

  it('inventory balance / costing quote foreign tenant resources → 404', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app, TEST_PIN);
    const headers = authInjectHeaders(token);
    const bal = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?legalEntityId=${fxB.legalEntityId}&warehouseId=${fxB.warehouseId}&catalogItemId=${fxB.milkItemId}`,
      headers,
    });
    expect(bal.statusCode).toBe(404);
    const quote = await app.inject({
      method: 'GET',
      url: `/api/v1/costing/quote?legalEntityId=${fxB.legalEntityId}&warehouseId=${fxB.warehouseId}&catalogItemId=${fxB.milkItemId}`,
      headers,
    });
    expect(quote.statusCode).toBe(404);
    await app.close();
  });

  it('CSRF: invalid Origin rejected on mutation', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app, TEST_PIN);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: 'https://evil.example',
      },
      payload: draftPayload(fx),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'CSRF_REJECTED' });
    await app.close();
  });

  it('CSRF: production missing Origin/Referer rejected', async () => {
    const app = await buildApp(true);
    const token = await loginWithPin(app, TEST_PIN);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      payload: draftPayload(fx),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'CSRF_REJECTED' });
    await app.close();
  });

  it('revoked session rejected', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app, TEST_PIN);
    const principal = await identity.resolveSession(token);
    await identity.revokeSession(principal);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?legalEntityId=${fx.legalEntityId}&warehouseId=${fx.warehouseId}&catalogItemId=${fx.milkItemId}`,
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
