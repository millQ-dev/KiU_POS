/**
 * P0 POS/Orders/Settlement HTTP actor attribution.
 * Requires a disposable DATABASE_URL (never shared millq_dev).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { resolvePinPepper } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { IdentityService } from '../modules/identity/index.js';
import { GoodsIssueService } from '../modules/inventory/goods-issue-service.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import { acceptFinalMerchandiseTerms } from '../test/commercial-terms.js';
import {
  authInjectHeaders,
  loginPosSession,
  provisionPosOperator,
  TEST_ORIGIN,
} from '../test/financial-auth-harness.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from './identity.js';
import { registerPosRoutes } from './pos.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL || /\/millq_dev(\?|$)/.test(DATABASE_URL)) {
  throw new Error(
    'pos-actor-http.p0 requires disposable DATABASE_URL (not millq_dev / shared). Example: postgresql://millq:millq@localhost:5432/millq_pos_actor_p0_<ts>',
  );
}

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
let authenticatedUserId: string;

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
  await app.ready();
  return app;
}

describe('POS HTTP actor integrity (P0)', () => {
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
    const user = await provisionPosOperator(identity, fx, { displayName: 'POS Actor A' });
    authenticatedUserId = user.userId;
  });

  it('route source binds principal.userId on all former client actorId sites', () => {
    const srcPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pos.ts');
    const src = readFileSync(srcPath, 'utf8');
    expect(src).not.toMatch(/actorId:\s*body\.actorId/);
    expect(src).not.toMatch(/\.\.\.\(body\.actorId\s*\?/);
    expect(src).toContain('actorId: principal.userId');
    // openOrder + cancel + commercial ×2 + openSettlement + advanceCheckout
    expect((src.match(/actorId: principal\.userId/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('POST /orders ignores spoofed actorId (principal wins)', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const spoof = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authInjectHeaders(token),
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
        actorId: spoof,
      },
    });
    expect(res.statusCode).toBe(201);
    const orderId = (res.json() as { orderId: string }).orderId;
    const row = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM sales_order WHERE order_id = $1`,
      [orderId],
    );
    expect(row.rows[0]?.actor_id).toBe(authenticatedUserId);
    expect(row.rows[0]?.actor_id).not.toBe(spoof);
    await app.close();
  });

  it('POST /orders/:id/cancel ignores spoofed actorId', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authInjectHeaders(token),
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    const orderId = (open.json() as { orderId: string }).orderId;
    const spoof = randomUUID();
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/cancel`,
      headers: authInjectHeaders(token),
      payload: { reason: 'guest left', actorId: spoof },
    });
    expect(cancel.statusCode).toBe(200);
    const row = await pool.query<{ actor_id: string | null; status: string }>(
      `SELECT actor_id, status FROM sales_order WHERE order_id = $1`,
      [orderId],
    );
    expect(row.rows[0]?.status).toBe('CANCELLED');
    expect(row.rows[0]?.actor_id).toBe(authenticatedUserId);
    expect(row.rows[0]?.actor_id).not.toBe(spoof);
    await app.close();
  });

  it('POST open-settlement ignores spoofed actorId', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authInjectHeaders(token),
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    const orderId = (open.json() as { orderId: string }).orderId;
    const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    await orders.addOrderLine({
      orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    await acceptFinalMerchandiseTerms(orders, orderId, {
      idempotencyKey: randomUUID(),
      defaultGrossMinor: '5000',
    });

    const spoof = randomUUID();
    const settle = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/open-settlement`,
      headers: authInjectHeaders(token),
      payload: { idempotencyKey: randomUUID(), actorId: spoof },
    });
    expect(settle.statusCode).toBe(200);
    const sg = (settle.json() as { settlementGroupId: string }).settlementGroupId;
    const row = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM settlement_group WHERE settlement_group_id = $1`,
      [sg],
    );
    expect(row.rows[0]?.actor_id).toBe(authenticatedUserId);
    expect(row.rows[0]?.actor_id).not.toBe(spoof);
    await app.close();
  });

  it('positive: open order without body actorId still attributes principal', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authInjectHeaders(token),
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    expect(res.statusCode).toBe(201);
    const orderId = (res.json() as { orderId: string }).orderId;
    const row = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM sales_order WHERE order_id = $1`,
      [orderId],
    );
    expect(row.rows[0]?.actor_id).toBe(authenticatedUserId);
    await app.close();
  });
});
