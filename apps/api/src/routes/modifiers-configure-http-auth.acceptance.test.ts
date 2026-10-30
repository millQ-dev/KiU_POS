/**
 * ADR-0052 M7 — HTTP auth regression for POST …/configure-modifiers.
 * Disposable millq_ci_pos_* only. Level A tests-only; no production code changes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { isPosDisposableDatabaseUrl } from '../test/disposable-database-url.js';
import {
  authInjectHeaders,
  loginPosSession,
  TEST_ORIGIN,
  TEST_PIN,
} from '../test/financial-auth-harness.js';
import { resolvePinPepper } from '../config.js';
import {
  IdentityService,
  PERMISSION_ORDERS_LINE_CONFIGURE,
  PERMISSION_POS_OPERATE,
} from '../modules/identity/index.js';
import { sha256Hex } from '../modules/identity/crypto.js';
import { GoodsIssueService } from '../modules/inventory/goods-issue-service.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import { registerIdentityRoutes } from './identity.js';
import { registerPosRoutes } from './pos.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeAuth = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL: DATABASE_URL || 'postgresql://x/millq_ci_pos_x',
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

const MENU_MODIFIERS_CONFIGURE = 'menu.modifiers.configure';

describeAuth('ADR-0052 M7 configure-modifiers HTTP auth (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let fxB: BlockCFixture;
  let otherOutletId: string;
  let identity: IdentityService;
  let orders: OrdersService;
  let app: ReturnType<typeof Fastify>;
  let groupId = '';
  let optOat = '';
  let optWhole = '';

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    identity = new IdentityService(pool, PEPPER);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    app = Fastify({ logger: false });
    await app.register(cookie);
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
      databaseUrl: DATABASE_URL,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE
        identity_notification_outbox, identity_audit_event,
        identity_approval_request, identity_login_challenge,
        identity_session, identity_access_grant, identity_auth_throttle,
        identity_network_throttle,
        identity_pin_credential, workforce_employee, identity_user, terminal,
        order_line_modifier_selection, order_line_configuration,
        modifier_option_recipe_delta, catalog_item_modifier_group,
        modifier_option, modifier_group,
        order_line_commercial_snapshot, order_commercial_snapshot,
        sales_order_commercial_line_terms, sales_order_commercial_terms,
        sales_order_line, sales_order,
        catalog_item, warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
    fxB = await seedBlockCFixture(pool);
    otherOutletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Other Outlet')`,
      [otherOutletId, fx.tenantId, fx.brandId, fx.legalEntityId],
    );

    groupId = randomUUID();
    optOat = randomUUID();
    optWhole = randomUUID();
    await pool.query(
      `INSERT INTO modifier_group (
         modifier_group_id, tenant_id, code, name, selection_mode, min_select, max_select, ask_every_time
       ) VALUES ($1,$2,'milk','Milk','SINGLE',1,1,TRUE)`,
      [groupId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO modifier_option (
         modifier_option_id, tenant_id, modifier_group_id, code, name, sort_order, is_default,
         price_adjustment_minor, kitchen_instruction_code
       ) VALUES
         ($1,$3,$4,'oat','Oat milk',1,FALSE,'5000','MILK_OAT'),
         ($2,$3,$4,'whole','Whole milk',2,TRUE,'0','MILK_WHOLE')`,
      [optOat, optWhole, fx.tenantId, groupId],
    );
    await pool.query(
      `INSERT INTO catalog_item_modifier_group (
         catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
       ) VALUES ($1,$2,$3,$4,TRUE,1)`,
      [randomUUID(), fx.tenantId, fx.milkItemId, groupId],
    );
  });

  async function loginAs(pin: string, fixture: BlockCFixture = fx): Promise<string> {
    return loginPosSession(app, pool, fixture, pin);
  }

  async function openOrderWithLine(fixture: BlockCFixture = fx): Promise<{
    orderId: string;
    lineId: string;
  }> {
    const opened = await orders.openOrder({
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      outletId: fixture.outletId,
      channel: 'DIRECT',
    });
    const withLine = await orders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: fixture.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    return { orderId: opened.orderId, lineId: withLine.lines[0]!.orderLineId };
  }

  function configureUrl(orderId: string, lineId: string): string {
    return `/api/v1/orders/${orderId}/lines/${lineId}/configure-modifiers`;
  }

  async function configure(
    cookie: string,
    orderId: string,
    lineId: string,
    optionId: string = optOat,
  ) {
    return app.inject({
      method: 'POST',
      url: configureUrl(orderId, lineId),
      headers: authInjectHeaders(cookie),
      payload: {
        selections: [{ modifierGroupId: groupId, modifierOptionId: optionId }],
      },
    });
  }

  async function configCount(orderLineId: string): Promise<number> {
    const r = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM order_line_configuration WHERE order_line_id = $1`,
      [orderLineId],
    );
    return r.rows[0]!.c;
  }

  async function commercialCount(orderId: string): Promise<number> {
    const r = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    return r.rows[0]!.c;
  }

  async function configFingerprint(orderLineId: string): Promise<string | null> {
    const r = await pool.query<{ configuration_fingerprint: string }>(
      `SELECT configuration_fingerprint FROM order_line_configuration WHERE order_line_id = $1`,
      [orderLineId],
    );
    return r.rows[0]?.configuration_fingerprint ?? null;
  }

  it('1 — pos.operate without orders.line_configure is denied', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'OperateOnly',
      pin: TEST_PIN,
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });
    const cookie = await loginAs(TEST_PIN);
    const { orderId, lineId } = await openOrderWithLine();
    const res = await configure(cookie, orderId, lineId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await configCount(lineId)).toBe(0);
  });

  it('2 — both grants on the correct outlet can configure', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'FullCashier',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: fx.outletId },
      ],
    });
    const cookie = await loginAs(TEST_PIN);
    const { orderId, lineId } = await openOrderWithLine();
    const res = await configure(cookie, orderId, lineId);
    expect(res.statusCode).toBe(200);
    expect(await configCount(lineId)).toBe(1);
    const body = res.json() as {
      configuration: { additivePriceAdjustmentMinor: string };
    };
    expect(body.configuration.additivePriceAdjustmentMinor).toBe('5000');
  });

  it('3 — menu.modifiers.configure alone (even with pos.operate) does not authorize', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'MenuOnly',
      pin: '111111',
      grants: [{ permissionKey: MENU_MODIFIERS_CONFIGURE, outletId: null }],
    });
    const menuOnlyCookie = await loginAs('111111');
    const { orderId, lineId } = await openOrderWithLine();
    const noOperate = await configure(menuOnlyCookie, orderId, lineId);
    expect(noOperate.statusCode).toBe(403);
    expect(noOperate.json()).toMatchObject({ error: 'FORBIDDEN' });

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'MenuPlusOperate',
      pin: '222222',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: MENU_MODIFIERS_CONFIGURE, outletId: null },
      ],
    });
    const cookie = await loginAs('222222');
    const res = await configure(cookie, orderId, lineId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await configCount(lineId)).toBe(0);
  });

  it('4 — grant for another outlet does not authorize this outlet', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'WrongOutlet',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: otherOutletId },
      ],
    });
    const cookie = await loginAs(TEST_PIN);
    const { orderId, lineId } = await openOrderWithLine();
    const res = await configure(cookie, orderId, lineId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await configCount(lineId)).toBe(0);
  });

  it('5 — grant for another tenant does not authorize', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'TenantA',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: fx.outletId },
      ],
    });
    const cookieA = await loginAs(TEST_PIN);
    const foreign = await openOrderWithLine(fxB);
    const cross = await configure(cookieA, foreign.orderId, foreign.lineId);
    expect(cross.statusCode).toBe(404);

    await identity.provisionUserWithPin({
      tenantId: fxB.tenantId,
      displayName: 'TenantB',
      pin: '333333',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fxB.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: fxB.outletId },
      ],
    });
    // Publish milk modifiers for tenant B catalog item so a successful cross-tenant
    // attempt would otherwise write — auth must fail first.
    const foreignGroup = randomUUID();
    const foreignOpt = randomUUID();
    await pool.query(
      `INSERT INTO modifier_group (
         modifier_group_id, tenant_id, code, name, selection_mode, min_select, max_select, ask_every_time
       ) VALUES ($1,$2,'milk_b','Milk B','SINGLE',1,1,TRUE)`,
      [foreignGroup, fxB.tenantId],
    );
    await pool.query(
      `INSERT INTO modifier_option (
         modifier_option_id, tenant_id, modifier_group_id, code, name, sort_order, is_default,
         price_adjustment_minor
       ) VALUES ($1,$2,$3,'oat','Oat',1,FALSE,'5000')`,
      [foreignOpt, fxB.tenantId, foreignGroup],
    );
    await pool.query(
      `INSERT INTO catalog_item_modifier_group (
         catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
       ) VALUES ($1,$2,$3,$4,TRUE,1)`,
      [randomUUID(), fxB.tenantId, fxB.milkItemId, foreignGroup],
    );
    const cookieB = await loginAs('333333', fxB);
    const local = await openOrderWithLine(fx);
    const reverse = await configure(cookieB, local.orderId, local.lineId);
    expect(reverse.statusCode).toBe(404);
    expect(await configCount(local.lineId)).toBe(0);
    expect(await configCount(foreign.lineId)).toBe(0);
  });

  it('6 — revoked or expired orders.line_configure grant is denied', async () => {
    const { userId } = await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Revocable',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: fx.outletId },
      ],
    });
    const cookie = await loginAs(TEST_PIN);
    const { orderId, lineId } = await openOrderWithLine();

    await pool.query(
      `UPDATE identity_access_grant
       SET revoked_at = NOW()
       WHERE user_id = $1 AND permission_key = $2`,
      [userId, PERMISSION_ORDERS_LINE_CONFIGURE],
    );
    const revoked = await configure(cookie, orderId, lineId);
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await configCount(lineId)).toBe(0);

    await pool.query(
      `UPDATE identity_access_grant
       SET revoked_at = NULL, expires_at = NOW() - INTERVAL '1 second'
       WHERE user_id = $1 AND permission_key = $2`,
      [userId, PERMISSION_ORDERS_LINE_CONFIGURE],
    );
    const expired = await configure(cookie, orderId, lineId);
    expect(expired.statusCode).toBe(403);
    expect(expired.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await configCount(lineId)).toBe(0);
  });

  it('7 — revoked or expired Identity session is denied', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'SessionUser',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: fx.outletId },
      ],
    });
    const cookie = await loginAs(TEST_PIN);
    const { orderId, lineId } = await openOrderWithLine();
    const principal = await identity.resolveSession(cookie);
    await identity.revokeSession(principal);
    const revoked = await configure(cookie, orderId, lineId);
    expect(revoked.statusCode).toBe(401);

    const cookie2 = await loginAs(TEST_PIN);
    await pool.query(
      `UPDATE identity_session SET expires_at = NOW() - INTERVAL '1 second'
       WHERE token_hash = $1`,
      [sha256Hex(cookie2)],
    );
    const expired = await configure(cookie2, orderId, lineId);
    expect(expired.statusCode).toBe(401);
    expect(await configCount(lineId)).toBe(0);
  });

  it('8 — denied mutation leaves configuration and commercial state unchanged', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Authorized',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_LINE_CONFIGURE, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Denied',
      pin: '444444',
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });

    const authCookie = await loginAs(TEST_PIN);
    const { orderId, lineId } = await openOrderWithLine();
    const ok = await configure(authCookie, orderId, lineId, optOat);
    expect(ok.statusCode).toBe(200);
    const fingerprintBefore = await configFingerprint(lineId);
    expect(fingerprintBefore).toBeTruthy();

    const { setOrderCommercialTermsWithRounding } = await import('../test/commercial-terms.js');
    await setOrderCommercialTermsWithRounding(orders, {
      orderId,
      idempotencyKey: `auth-commercial-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '0',
      commercialResolution: 'auth regression baseline',
      lineTerms: [
        {
          orderLineId: lineId,
          resolvedUnitPriceMinor: '20000',
          grossMerchandiseMinor: '25000',
          lineMerchantFundedDiscountMinor: '0',
          eligibleForOrderDiscount: true,
          thirdPartyMerchandiseFundingMinor: '0',
          certainty: 'FINAL',
          provenance: {
            additivePriceAdjustmentMinor: '5000',
            configurationFingerprint: fingerprintBefore,
          },
        },
      ],
    });
    expect(await commercialCount(orderId)).toBe(1);

    const deniedCookie = await loginAs('444444');
    const denied = await configure(deniedCookie, orderId, lineId, optWhole);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await configFingerprint(lineId)).toBe(fingerprintBefore);
    expect(await configCount(lineId)).toBe(1);
    expect(await commercialCount(orderId)).toBe(1);
    const additive = await pool.query<{ additive_price_adjustment_minor: string }>(
      `SELECT additive_price_adjustment_minor FROM order_line_configuration WHERE order_line_id = $1`,
      [lineId],
    );
    expect(additive.rows[0]!.additive_price_adjustment_minor).toBe('5000');
  });
});
