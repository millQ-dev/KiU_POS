/**
 * ADR-0050 allergen HTTP on POS routes: auth/tenant isolation, capture, offers, acks, kitchen ticket.
 * Disposable millq_ci_pos_* only.
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
import { AllergensService } from '../modules/allergens/index.js';
import { ModifiersService } from '../modules/modifiers/index.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import { seedAllergenFixture, type AllergenFixture } from '../test/allergen-fixture.js';
import { isPosDisposableDatabaseUrl } from '../test/disposable-database-url.js';
import {
  authInjectHeaders,
  loginPosSession,
  provisionPosOperator,
  TEST_ORIGIN,
} from '../test/financial-auth-harness.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { registerAllergenRoutes } from './allergens.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from './identity.js';
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

describeHttp('ADR-0050 allergen HTTP (disposable PG)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof Fastify>;
  let fx: BlockCFixture;
  let al: AllergenFixture;
  let token = '';
  let orderId = '';
  let lineId = '';

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    app = Fastify({ logger: false });
    await app.register(cookie);
    await registerCompanyIdentityRoutes(app, pool);
    await registerIdentityRoutes(app, pool, {
      pepper: PEPPER,
      cookieSecure: false,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await registerAllergenRoutes(app, pool, {
      pepper: PEPPER,
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
        sales_order_line, sales_order, catalog_item, warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
    al = await seedAllergenFixture(pool, fx);
    await provisionPosOperator(new IdentityService(pool, PEPPER), fx);
    token = await loginPosSession(app, pool, fx);

    const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    const opened = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    orderId = opened.orderId;
    const withLine = await orders.addOrderLine({
      orderId,
      catalogItemId: al.latteItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    lineId = withLine.lines[0]!.orderLineId;
    await new ModifiersService(pool).configureOrderLine({
      orderId,
      orderLineId: lineId,
      selections: [{ modifierGroupId: al.milkGroupId, modifierOptionId: al.oatOptionId }],
    });
  });

  const headers = () => authInjectHeaders(token);

  it('requires an authenticated POS session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      payload: { captureChoice: 'UNABLE_TO_CLARIFY' },
      headers: { origin: TEST_ORIGIN },
    });
    expect(res.statusCode).toBe(401);
  });

  it('captures context, resolves lines, offers options, acknowledges and serves the kitchen ticket', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
      payload: { captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as {
      context: { revision: number; allergenCodes: string[] };
      lines: Array<{ orderLineId: string; result: string }>;
    };
    expect(body.context).toMatchObject({ revision: 1, allergenCodes: ['MILK'] });
    expect(body.lines[0]).toMatchObject({ orderLineId: lineId, result: 'AVAILABLE_WITH_MODIFICATION' });

    const offers = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/allergen-offers`,
      headers: headers(),
      payload: { catalogItemIds: [al.latteItemId] },
    });
    expect(offers.statusCode).toBe(200);
    expect((offers.json() as { offers: Array<{ requiredOptions: unknown[] }> }).offers[0]!.requiredOptions).toEqual([
      { modifierGroupId: al.milkGroupId, modifierOptionId: al.oatOptionId },
    ]);

    const wrongAck = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/allergen-acknowledgements`,
      headers: headers(),
      payload: { kind: 'CASHIER_GUEST_INFORMED' },
    });
    expect(wrongAck.statusCode).toBe(409);

    const ack = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/allergen-acknowledgements`,
      headers: headers(),
      payload: { kind: 'KITCHEN_ACKNOWLEDGED' },
    });
    expect(ack.statusCode).toBe(200);

    const ticket = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/kitchen-allergen-ticket`,
      headers: headers(),
    });
    expect(ticket.statusCode).toBe(200);
    const t = ticket.json() as {
      lines: Array<{
        kitchenWarnings: Array<{ code: string }>;
        requiredAcknowledgements: Array<{ acknowledged: boolean }>;
      }>;
    };
    expect(t.lines[0]!.kitchenWarnings.map((w) => w.code)).toContain('ALLERGEN_MODIFICATION');
    expect(t.lines[0]!.requiredAcknowledgements).toEqual([{ kind: 'KITCHEN_ACKNOWLEDGED', acknowledged: true }]);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
    });
    expect((get.json() as { lines: Array<{ acknowledgedKinds: string[] }> }).lines[0]!.acknowledgedKinds).toEqual([
      'KITCHEN_ACKNOWLEDGED',
    ]);
  });

  it('maps validation and conflict errors; never invents a default context', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
      payload: { captureChoice: 'SELECT_ALLERGENS', allergenCodes: [] },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe('ALLERGEN_CODES_REQUIRED');

    const notArray = await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
      payload: { captureChoice: 'SELECT_ALLERGENS', allergenCodes: 'MILK' },
    });
    expect(notArray.statusCode).toBe(400);

    const offersNoContext = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/allergen-offers`,
      headers: headers(),
      payload: { catalogItemIds: [al.latteItemId] },
    });
    expect(offersNoContext.statusCode).toBe(409);
    expect((offersNoContext.json() as { error: string }).error).toBe('ALLERGEN_CONTEXT_MISSING');

    const emptyOffers = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/allergen-offers`,
      headers: headers(),
      payload: { catalogItemIds: [] },
    });
    expect(emptyOffers.statusCode).toBe(400);

    const missingKind = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/allergen-acknowledgements`,
      headers: headers(),
      payload: {},
    });
    expect(missingKind.statusCode).toBe(400);
  });

  it('UNABLE_TO_CLARIFY surfaces REQUIRES_CONFIRMATION over HTTP', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
      payload: { captureChoice: 'UNABLE_TO_CLARIFY' },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { lines: Array<{ result: string }> }).lines[0]!.result).toBe('REQUIRES_CONFIRMATION');
  });

  it('actor is the authenticated principal; spoofed actorId is ignored', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
      payload: { captureChoice: 'UNABLE_TO_CLARIFY', actorId: randomUUID() },
    });
    const row = await pool.query<{ actor_id: string; user_id: string }>(
      `SELECT e.actor_id, u.user_id FROM order_allergen_context_event e, identity_user u WHERE e.order_id = $1`,
      [orderId],
    );
    expect(row.rows[0]!.actor_id).toBe(row.rows[0]!.user_id);
  });

  it('another tenant cannot read or write the order allergen context (404)', async () => {
    const other = await pool.query<{ tenant_id: string }>(
      `INSERT INTO tenant (tenant_id, name, company_code) VALUES ($1,'Other',$2) RETURNING tenant_id`,
      [randomUUID(), 'OTHERTENANT1'],
    );
    expect(other.rowCount).toBe(1);
    await pool.query(`UPDATE sales_order SET tenant_id = $1 WHERE order_id = $2`, [
      other.rows[0]!.tenant_id,
      orderId,
    ]);
    for (const [method, url] of [
      ['GET', `/api/v1/orders/${orderId}/allergen-context`],
      ['GET', `/api/v1/orders/${orderId}/kitchen-allergen-ticket`],
    ] as const) {
      const res = await app.inject({ method, url, headers: headers() });
      expect(res.statusCode).toBe(404);
    }
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/orders/${orderId}/allergen-context`,
      headers: headers(),
      payload: { captureChoice: 'UNABLE_TO_CLARIFY' },
    });
    expect(put.statusCode).toBe(404);
  });

  it('commercial accept is gated by allergen readiness once a context exists', async () => {
    const accept = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/calculate-and-accept-commercial-terms`,
        headers: headers(),
        payload: {
          salesContext: {
            tenantId: fx.tenantId,
            brandId: fx.brandId,
            outletId: fx.outletId,
            orderChannel: 'DIRECT',
            businessDateTime: '2026-09-16T17:30:00.000Z',
          },
          idempotencyKey: `allergen-gate-${randomUUID()}`,
        },
      });
    const errorOf = async () => ((await accept()).json() as { error: string }).error;

    // Stale/unresolved after capture via service (no resolve) → revalidation required.
    await new AllergensService(pool).captureContext({
      orderId,
      captureChoice: 'SELECT_ALLERGENS',
      allergenCodes: ['MILK'],
    });
    expect(await errorOf()).toBe('ALLERGEN_REVALIDATION_REQUIRED');

    // Resolved, modification line needs kitchen acknowledgement.
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/allergen-resolution`,
      headers: headers(),
      payload: {},
    });
    expect(await errorOf()).toBe('ALLERGEN_ACK_REQUIRED');

    // Acknowledged → allergen gate passes (any later failure must not be an allergen error).
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/allergen-acknowledgements`,
      headers: headers(),
      payload: { kind: 'KITCHEN_ACKNOWLEDGED' },
    });
    expect(await errorOf()).not.toMatch(/^ALLERGEN_/);

    // Switching the line to dairy under a MILK allergy is BLOCKED.
    await new ModifiersService(pool).configureOrderLine({
      orderId,
      orderLineId: lineId,
      selections: [{ modifierGroupId: al.milkGroupId, modifierOptionId: al.dairyOptionId }],
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/allergen-resolution`,
      headers: headers(),
      payload: {},
    });
    expect(await errorOf()).toBe('ALLERGEN_LINE_BLOCKED');
  });
});
