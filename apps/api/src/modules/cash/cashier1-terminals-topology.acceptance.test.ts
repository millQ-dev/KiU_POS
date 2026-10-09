/**
 * CASHIER-1 — GET /cash/terminals server-derived Organization topology.
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
  loginPosSession,
  TEST_ORIGIN,
  TEST_PIN,
} from '../../test/financial-auth-harness.js';
import { resolvePinPepper } from '../../config.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_POS_OPERATE,
} from '../identity/index.js';
import { CashShiftService } from './cash-shift-service.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { registerCashRoutes } from '../../routes/cash.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
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
let terminalId: string;

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
  await registerCashRoutes(app, pool, {
    pepper: PEPPER,
    allowedOrigins: [TEST_ORIGIN],
    isProduction: false,
  });
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
  terminalId = randomUUID();
  await pool.query(
    `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
     VALUES ($1,$2,$3,'T1','Front')`,
    [terminalId, fx.tenantId, fx.outletId],
  );
  await identity.provisionUserWithPin({
    tenantId: fx.tenantId,
    displayName: 'Cashier',
    pin: TEST_PIN,
    grants: [
      { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
      { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
    ],
  });
});

describe('CASHIER-1 terminals topology', () => {
  it('returns server-derived brandId and legalEntityId for authorized terminals', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/terminals',
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      terminals: Array<{
        terminalId: string;
        outletId: string;
        brandId: string;
        brandName: string;
        legalEntityId: string;
        legalEntityName: string;
      }>;
    };
    expect(body.terminals).toHaveLength(1);
    const t = body.terminals[0]!;
    expect(t.terminalId).toBe(terminalId);
    expect(t.outletId).toBe(fx.outletId);
    expect(t.brandId).toBe(fx.brandId);
    expect(t.legalEntityId).toBe(fx.legalEntityId);
    expect(t.brandName).toBeTruthy();
    expect(t.legalEntityName).toBeTruthy();
    await app.close();
  });

  it('unauthenticated topology read is rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/terminals',
      headers: { origin: TEST_ORIGIN },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('cross-tenant terminal topology is not returned', async () => {
    const otherTenant = randomUUID();
    const otherLe = randomUUID();
    const otherBrand = randomUUID();
    const otherOutlet = randomUUID();
    const otherTerminal = randomUUID();
    const code = otherTenant.replace(/-/g, '').toUpperCase();
    await pool.query(
      `INSERT INTO tenant (tenant_id, name, company_code) VALUES ($1,'Other',$2)`,
      [otherTenant, code],
    );
    await pool.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code, tax_required)
       VALUES ($1,$2,'OLE','VN', FALSE)`,
      [otherLe, otherTenant],
    );
    await pool.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'OB')`, [
      otherBrand,
      otherTenant,
    ]);
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'OO')`,
      [otherOutlet, otherTenant, otherBrand, otherLe],
    );
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'TX','X')`,
      [otherTerminal, otherTenant, otherOutlet],
    );

    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/terminals',
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { terminals: Array<{ terminalId: string }> }).terminals.map(
      (t) => t.terminalId,
    );
    expect(ids).toContain(terminalId);
    expect(ids).not.toContain(otherTerminal);
    await app.close();
  });

  it('caller cannot inject brandId/legalEntityId via query — response is server-derived only', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const forgedBrand = randomUUID();
    const forgedLe = randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/terminals?brandId=${forgedBrand}&legalEntityId=${forgedLe}`,
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const t = (res.json() as { terminals: Array<{ brandId: string; legalEntityId: string }> })
      .terminals[0]!;
    expect(t.brandId).toBe(fx.brandId);
    expect(t.legalEntityId).toBe(fx.legalEntityId);
    expect(t.brandId).not.toBe(forgedBrand);
    expect(t.legalEntityId).not.toBe(forgedLe);
    await app.close();
  });

  it('listTerminalsForOpen service returns coherent Organization join', async () => {
    const cash = new CashShiftService(pool, identity);
    const userId = (
      await pool.query<{ user_id: string }>(
        `SELECT user_id FROM identity_user WHERE tenant_id = $1 LIMIT 1`,
        [fx.tenantId],
      )
    ).rows[0]!.user_id;
    const list = await cash.listTerminalsForOpen({
      tenantId: fx.tenantId,
      userId,
      employeeId: null,
      displayName: 'Cashier',
      channel: 'TERMINAL',
      sessionId: randomUUID(),
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.brandId).toBe(fx.brandId);
    expect(list[0]!.legalEntityId).toBe(fx.legalEntityId);
    expect(list[0]!.outletId).toBe(fx.outletId);
  });
});
