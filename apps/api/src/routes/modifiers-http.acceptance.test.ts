/**
 * NEXT-04 PR B — modifier HTTP + commercial accept fail-closed.
 * Disposable millq_ci_pos_* only.
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
  provisionPosOperator,
  TEST_ORIGIN,
} from '../test/financial-auth-harness.js';
import { resolvePinPepper } from '../config.js';
import { IdentityService } from '../modules/identity/index.js';
import { GoodsIssueService } from '../modules/inventory/goods-issue-service.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import { registerIdentityRoutes } from './identity.js';
import { registerPosRoutes } from './pos.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeHttp = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL: DATABASE_URL || 'postgresql://x/millq_ci_pos_x',
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

describeHttp('NEXT-04 modifier HTTP (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let app: ReturnType<typeof Fastify>;
  let cookieHeader = '';
  let groupId = '';
  let optOat = '';

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
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
    const identity = new IdentityService(pool, PEPPER);
    await provisionPosOperator(identity, fx);
    cookieHeader = await loginPosSession(app, pool, fx);

    groupId = randomUUID();
    optOat = randomUUID();
    await pool.query(
      `INSERT INTO modifier_group (
         modifier_group_id, tenant_id, code, name, selection_mode, min_select, max_select, ask_every_time
       ) VALUES ($1,$2,'milk','Milk','SINGLE',1,1,TRUE)`,
      [groupId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO modifier_option (
         modifier_option_id, tenant_id, modifier_group_id, code, name, sort_order, is_default, price_adjustment_minor,
         kitchen_instruction_code
       ) VALUES ($1,$2,$3,'oat','Oat milk',1,FALSE,'5000','MILK_OAT')`,
      [optOat, fx.tenantId, groupId],
    );
    await pool.query(
      `INSERT INTO catalog_item_modifier_group (
         catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
       ) VALUES ($1,$2,$3,$4,TRUE,1)`,
      [randomUUID(), fx.tenantId, fx.milkItemId, groupId],
    );
  });

  it('lists groups, configures line, and blocks commercial accept until configured', async () => {
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog-items/${fx.milkItemId}/modifier-groups`,
      headers: authInjectHeaders(cookieHeader),
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json() as { groups: Array<{ modifierGroupId: string }> };
    expect(listedBody.groups).toHaveLength(1);
    expect(listedBody.groups[0]!.modifierGroupId).toBe(groupId);

    const opened = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authInjectHeaders(cookieHeader),
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    expect(opened.statusCode).toBe(201);
    const orderId = (opened.json() as { orderId: string }).orderId;

    const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    const withLine = await orders.addOrderLine({
      orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const lineId = withLine.lines[0]!.orderLineId;

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/calculate-and-accept-commercial-terms`,
      headers: authInjectHeaders(cookieHeader),
      payload: {
        salesContext: {
          tenantId: fx.tenantId,
          brandId: fx.brandId,
          outletId: fx.outletId,
          orderChannel: 'DIRECT',
          businessDateTime: '2026-09-16T17:30:00.000Z',
        },
        idempotencyKey: `mod-block-${randomUUID()}`,
      },
    });
    expect(blocked.statusCode).toBe(400);
    expect((blocked.json() as { error: string }).error).toBe('MODIFIER_CONFIGURATION_MISSING');

    const configured = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/configure-modifiers`,
      headers: authInjectHeaders(cookieHeader),
      payload: {
        selections: [{ modifierGroupId: groupId, modifierOptionId: optOat }],
        guestNote: 'extra hot',
      },
    });
    expect(configured.statusCode).toBe(200);
    const cfgBody = configured.json() as {
      configuration: { additivePriceAdjustmentMinor: string; kitchenInstructions: string[] };
      order: {
        lines: Array<{ modifierConfiguration: { additivePriceAdjustmentMinor: string } | null }>;
      };
    };
    expect(cfgBody.configuration.additivePriceAdjustmentMinor).toBe('5000');
    expect(cfgBody.configuration.kitchenInstructions).toContain('MILK_OAT');
    expect(cfgBody.configuration.kitchenInstructions).toContain(
      'GUEST_NOTE_NON_AUTHORITATIVE:extra hot',
    );
    expect(cfgBody.order.lines[0]?.modifierConfiguration?.additivePriceAdjustmentMinor).toBe('5000');
  });
});
