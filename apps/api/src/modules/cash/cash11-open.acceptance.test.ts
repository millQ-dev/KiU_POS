/**
 * CASH1.1 — CashShift Open acceptance + adversarial suite (ADR-0036 / ADR-0002 / SEC-0).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { createMoney } from '@millq/domain';
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
  ApprovalRequestService,
  OutboxNotificationPort,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_CASH_SHIFT_OPEN_APPROVE,
  PERMISSION_POS_OPERATE,
  SESSION_COOKIE_NAME,
} from '../identity/index.js';
import { CASH_SHIFT_OPERATION_TYPE } from './errors.js';
import { CashShiftService } from './cash-shift-service.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { registerCashRoutes } from '../../routes/cash.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_cash11_test';
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
let cash: CashShiftService;
let terminalId: string;
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

async function createTerminal(code = 'T1') {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, fx.tenantId, fx.outletId, code, `Terminal ${code}`],
  );
  return id;
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

async function provisionCashier() {
  return identity.provisionUserWithPin({
    tenantId: fx.tenantId,
    displayName: 'Cashier',
    pin: TEST_PIN,
    grants: [
      { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
      { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
    ],
  });
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  identity = new IdentityService(pool, PEPPER);
  cash = new CashShiftService(pool, identity);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate();
  fx = await seedBlockCFixture(pool);
  terminalId = await createTerminal();
  const row = await pool.query<{ company_code: string }>(
    `SELECT company_code FROM tenant WHERE tenant_id = $1`,
    [fx.tenantId],
  );
  companyCode = row.rows[0]!.company_code;
  await provisionCashier();
});

describe('CASH1.1 OpenCashShift', () => {
  it('1 authorized direct open succeeds; Money exact; no Payment/Settlement writes', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const headers = authInjectHeaders(token);
    const beforePay = await pool.query(`SELECT count(*)::int AS c FROM payment`);
    const beforeSettle = await pool.query(`SELECT count(*)::int AS c FROM settlement_group`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/open',
      headers,
      payload: {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: `open-${randomUUID()}`,
        openingCash: { amountMinor: '500000', currencyCode: 'VND', minorUnitExponent: 0 },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('OPEN');
    expect(body.openingAmountMinor).toBe('500000');
    expect(body.currencyCode).toBe('VND');
    expect(body.authMode).toBe('DIRECT_PERMISSION');
    expect(body.deviceId).toBeUndefined();
    expect((await pool.query(`SELECT count(*)::int AS c FROM payment`)).rows[0]!.c).toBe(
      beforePay.rows[0]!.c,
    );
    expect((await pool.query(`SELECT count(*)::int AS c FROM settlement_group`)).rows[0]!.c).toBe(
      beforeSettle.rows[0]!.c,
    );
    await app.close();
  });

  it('2/3 no session / no cash_shift.open => APPROVAL_REQUIRED', async () => {
    const app = await buildApp();
    const unauth = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/open',
      headers: { origin: TEST_ORIGIN },
      payload: {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: randomUUID(),
        openingCash: { amountMinor: '1', currencyCode: 'VND', minorUnitExponent: 0 },
      },
    });
    expect(unauth.statusCode).toBe(401);

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'NoGrant',
      pin: '654321',
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/pin/authenticate',
      payload: { companyCode, pin: '654321', channel: 'TERMINAL' },
      headers: { origin: TEST_ORIGIN },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/open',
      headers: authInjectHeaders(match![1]!),
      payload: {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: randomUUID(),
        openingCash: { amountMinor: '1', currencyCode: 'VND', minorUnitExponent: 0 },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('APPROVAL_REQUIRED');
    await app.close();
  });

  it('6/26 body tenant / authoritative mass-assignment rejected', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const headers = authInjectHeaders(token);
    const tenantInject = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/open',
      headers,
      payload: {
        tenantId: randomUUID(),
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: randomUUID(),
        openingCash: { amountMinor: '1', currencyCode: 'VND', minorUnitExponent: 0 },
      },
    });
    expect(tenantInject.statusCode).toBe(403);
    const mass = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/open',
      headers,
      payload: {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: randomUUID(),
        openingCash: { amountMinor: '1', currencyCode: 'VND', minorUnitExponent: 0 },
        status: 'ACCEPTED',
        deviceId: randomUUID(),
        openedByUserId: randomUUID(),
      },
    });
    expect(mass.statusCode).toBe(400);
    await app.close();
  });

  it('8/24 pathological Money rejected', async () => {
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const principal = await identity.resolveSession(auth.sessionToken);
    for (const bad of [
      { amountMinor: '-1', currencyCode: 'VND', minorUnitExponent: 0 },
      { amountMinor: '1.5', currencyCode: 'VND', minorUnitExponent: 0 },
      { amountMinor: '1e3', currencyCode: 'VND', minorUnitExponent: 0 },
      { amountMinor: 'NaN', currencyCode: 'VND', minorUnitExponent: 0 },
      { amountMinor: 'Infinity', currencyCode: 'VND', minorUnitExponent: 0 },
      { amountMinor: '', currencyCode: 'VND', minorUnitExponent: 0 },
      { amountMinor: '10', currencyCode: 'vnd', minorUnitExponent: 0 },
      { amountMinor: '10', currencyCode: 'VND', minorUnitExponent: 9 },
    ]) {
      await expect(
        cash.openShift(principal, {
          outletId: fx.outletId,
          terminalId,
          openIdempotencyKey: randomUUID(),
          openingCash: bad,
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_OPENING_CASH|VALIDATION/) });
    }
  });

  it('9/10 concurrent same-Terminal one OPEN; different terminals independent', async () => {
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const p = await identity.resolveSession(auth.sessionToken);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        cash.openShift(p, {
          outletId: fx.outletId,
          terminalId,
          openIdempotencyKey: randomUUID(),
          openingCash: { amountMinor: '1000', currencyCode: 'VND', minorUnitExponent: 0 },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const openCount = await pool.query(
      `SELECT count(*)::int AS c FROM cash_shift WHERE terminal_id = $1 AND status = 'OPEN'`,
      [terminalId],
    );
    expect(openCount.rows[0]!.c).toBe(1);

    const t2 = await createTerminal('T2');
    const other = await cash.openShift(p, {
      outletId: fx.outletId,
      terminalId: t2,
      openIdempotencyKey: randomUUID(),
      openingCash: { amountMinor: '2000', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    expect(other.terminalId).toBe(t2);
  });

  it('11/12 idempotency same semantics retry-safe; different semantics conflict', async () => {
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const p = await identity.resolveSession(auth.sessionToken);
    const key = `idem-${randomUUID()}`;
    const a = await cash.openShift(p, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: key,
      openingCash: { amountMinor: '111', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    const b = await cash.openShift(p, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: key,
      openingCash: { amountMinor: '111', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    expect(b.cashShiftId).toBe(a.cashShiftId);
    await expect(
      cash.openShift(p, {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: key,
        openingCash: { amountMinor: '999', currencyCode: 'VND', minorUnitExponent: 0 },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('11b concurrent same idempotency key => one effect', async () => {
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const p = await identity.resolveSession(auth.sessionToken);
    const key = `concurrent-idem-${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        cash.openShift(p, {
          outletId: fx.outletId,
          terminalId,
          openIdempotencyKey: key,
          openingCash: { amountMinor: '777', currencyCode: 'VND', minorUnitExponent: 0 },
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      cashShiftId: string;
    }>[];
    expect(ok.length).toBe(8);
    expect(new Set(ok.map((r) => r.value.cashShiftId)).size).toBe(1);
  });

  it('opening history immutable via trigger', async () => {
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const p = await identity.resolveSession(auth.sessionToken);
    const opened = await cash.openShift(p, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: randomUUID(),
      openingCash: { amountMinor: '50', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    await expect(
      pool.query(`UPDATE cash_shift SET opening_amount_minor = '999' WHERE cash_shift_id = $1`, [
        opened.cashShiftId,
      ]),
    ).rejects.toThrow(/immutable/i);
  });

  it('13-18 approval fingerprint / self-approval / replay / concurrent consume', async () => {
    await truncate();
    fx = await seedBlockCFixture(pool);
    terminalId = await createTerminal();
    const row = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    companyCode = row.rows[0]!.company_code;

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Requester',
      pin: '111111',
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Boss',
      pin: '222222',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN_APPROVE, outletId: fx.outletId },
      ],
    });

    const reqAuth = await identity.authenticatePin(
      { companyCode, pin: '111111', channel: 'TERMINAL' },
      '10.0.0.1',
    );
    const requester = await identity.resolveSession(reqAuth.sessionToken);
    const bossAuth = await identity.authenticatePin(
      { companyCode, pin: '222222', channel: 'MOBILE' },
      '10.0.0.2',
    );
    const boss = await identity.resolveSession(bossAuth.sessionToken);

    const approvals = new ApprovalRequestService(pool, identity, new OutboxNotificationPort(pool));
    const openingCash = createMoney('500000', 'VND', 0);

    const selfReq = await approvals.createRequest(requester, {
      outletId: fx.outletId,
      terminalId,
      operationType: CASH_SHIFT_OPERATION_TYPE,
      operationFingerprint: {
        openingCash: {
          amountMinor: openingCash.amountMinor,
          currencyCode: openingCash.currencyCode,
          minorUnitExponent: openingCash.minorUnitExponent,
        },
      },
    });
    await expect(
      approvals.decide(requester, selfReq.approvalRequestId, { decision: 'APPROVE' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const created = await approvals.createRequest(requester, {
      outletId: fx.outletId,
      terminalId,
      operationType: CASH_SHIFT_OPERATION_TYPE,
      operationFingerprint: {
        openingCash: {
          amountMinor: openingCash.amountMinor,
          currencyCode: openingCash.currencyCode,
          minorUnitExponent: openingCash.minorUnitExponent,
        },
      },
    });
    await approvals.decide(boss, created.approvalRequestId, { decision: 'APPROVE' });

    await expect(
      cash.openShift(requester, {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: randomUUID(),
        approvalRequestId: created.approvalRequestId,
        openingCash: { amountMinor: '5000000', currencyCode: 'VND', minorUnitExponent: 0 },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_EVIDENCE_INVALID' });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        cash.openShift(requester, {
          outletId: fx.outletId,
          terminalId,
          openIdempotencyKey: randomUUID(),
          approvalRequestId: created.approvalRequestId,
          openingCash: {
            amountMinor: openingCash.amountMinor,
            currencyCode: openingCash.currencyCode,
            minorUnitExponent: openingCash.minorUnitExponent,
          },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);

    await expect(
      cash.openShift(requester, {
        outletId: fx.outletId,
        terminalId: await createTerminal('T3'),
        openIdempotencyKey: randomUUID(),
        approvalRequestId: created.approvalRequestId,
        openingCash: {
          amountMinor: openingCash.amountMinor,
          currencyCode: openingCash.currencyCode,
          minorUnitExponent: openingCash.minorUnitExponent,
        },
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/AUTH_EVIDENCE_INVALID|NOT_FOUND/) });
  });

  it('19 Session expiry does not erase historical actor evidence', async () => {
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const p = await identity.resolveSession(auth.sessionToken);
    const opened = await cash.openShift(p, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: randomUUID(),
      openingCash: { amountMinor: '42', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    await identity.revokeSession(p);
    const row = await pool.query<{ opened_by_user_id: string }>(
      `SELECT opened_by_user_id FROM cash_shift WHERE cash_shift_id = $1`,
      [opened.cashShiftId],
    );
    expect(row.rows[0]!.opened_by_user_id).toBe(p.userId);
  });

  it('23 cross-tenant terminal open rejected', async () => {
    const fxB = await seedBlockCFixture(pool);
    const termB = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'XB','Foreign')`,
      [termB, fxB.tenantId, fxB.outletId],
    );
    const auth = await identity.authenticatePin(
      { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const p = await identity.resolveSession(auth.sessionToken);
    await expect(
      cash.openShift(p, {
        outletId: fx.outletId,
        terminalId: termB,
        openIdempotencyKey: randomUUID(),
        openingCash: { amountMinor: '1', currencyCode: 'VND', minorUnitExponent: 0 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('27 migration is canonical cash_shift without device_id', async () => {
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'cash_shift'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain('terminal_id');
    expect(names).not.toContain('device_id');
    expect(names).toContain('opening_amount_minor');
  });
});
