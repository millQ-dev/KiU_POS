/**
 * ID1.1 Identity / POS Auth Foundation — acceptance & adversarial tests (ADR-0036).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  IdentityService,
  LoginChallengeService,
  ApprovalRequestService,
  OutboxNotificationPort,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_CASH_SHIFT_OPEN_APPROVE,
  SESSION_COOKIE_NAME,
  PIN_MAX_ATTEMPTS,
  sha256Hex,
  requirePepper,
} from './index.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { resolvePinPepper } from '../../config.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_id11_test';
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: 'http://localhost:5173',
} as never);

let pool: pg.Pool;
let fx: BlockCFixture;
let identity: IdentityService;
let companyCode: string;
let terminalId: string;

async function truncate() {
  await pool.query(`
    TRUNCATE
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
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
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function createTerminal() {
  terminalId = randomUUID();
  await pool.query(
    `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
     VALUES ($1,$2,$3,'T1','Front POS')`,
    [terminalId, fx.tenantId, fx.outletId],
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerCompanyIdentityRoutes(app, pool);
  await registerIdentityRoutes(app, pool, {
    pepper: PEPPER,
    cookieSecure: false,
    allowedOrigins: ['http://localhost:5173'],
    isProduction: false,
  });
  await app.ready();
  return app;
}

beforeAll(async () => {
  requirePepper(PEPPER);
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
  await createTerminal();
  const row = await pool.query<{ company_code: string }>(
    `SELECT company_code FROM tenant WHERE tenant_id = $1`,
    [fx.tenantId],
  );
  companyCode = row.rows[0]!.company_code;
});

describe('Company locator', () => {
  it('resolves known companyCode without tenantId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/company/${companyCode.toLowerCase()}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['companyCode', 'displayName']);
    expect(body.companyCode).toBe(companyCode);
    expect(body.tenantId).toBeUndefined();
    await app.close();
  });

  it('uniform 404 for unknown and malformed', async () => {
    const app = await buildApp();
    const a = await app.inject({ method: 'GET', url: '/api/v1/public/company/NOTEXIST99' });
    const b = await app.inject({ method: 'GET', url: '/api/v1/public/company/!!' });
    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(a.json().error).toBe('COMPANY_NOT_FOUND');
    expect(b.json().error).toBe('COMPANY_NOT_FOUND');
    await app.close();
  });
});

describe('PIN auth + session cookie', () => {
  it('authenticates with companyCode+PIN; sets HttpOnly cookie; no bearer in body', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
      grants: [{ permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId }],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/pin/authenticate',
      payload: { companyCode, pin: '123456', channel: 'TERMINAL' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayName).toBe('Ana');
    expect(body.sessionToken).toBeUndefined();
    expect(body.tenantId).toBeUndefined();
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookieStr).toContain(SESSION_COOKIE_NAME);
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('samesite=lax');

    const hashRows = await pool.query(`SELECT token_hash FROM identity_session`);
    expect(hashRows.rowCount).toBe(1);
    expect(hashRows.rows[0]!.token_hash).toHaveLength(64);

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/identity/session',
      cookies: { [SESSION_COOKIE_NAME]: cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))![1]! },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().displayName).toBe('Ana');
    await app.close();
  });

  it('invalid PIN is generic; concurrent failures lock throttle atomically', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
    });
    const app = await buildApp();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/pin/authenticate',
      payload: { companyCode, pin: '999999' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('AUTH_FAILED');

    await Promise.all(
      Array.from({ length: PIN_MAX_ATTEMPTS + 2 }, async () => {
        const c = await pool.connect();
        try {
          await identity.bumpThrottle(c, fx.tenantId, 'COMPANY_IP', 'concurrent-test-key');
        } finally {
          c.release();
        }
      }),
    );

    // Parallel auth failures against same company+IP must not bypass durable throttle.
    await Promise.all(
      Array.from({ length: 6 }, () =>
        identity.authenticatePin({ companyCode, pin: '000000' }, 'concurrent-ip').catch(() => null),
      ),
    );
    const throttle = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
      `SELECT failed_attempts, locked_until FROM identity_auth_throttle
       WHERE tenant_id = $1 AND dimension = 'COMPANY_IP' AND dim_key = $2`,
      [fx.tenantId, 'concurrent-test-key'],
    );
    expect(throttle.rows[0]!.failed_attempts).toBeGreaterThanOrEqual(PIN_MAX_ATTEMPTS);
    expect(throttle.rows[0]!.locked_until).toBeTruthy();

    // After lock via auth path:
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await identity.authenticatePin({ companyCode, pin: '111111' }, 'lock-ip').catch(() => null);
    }
    await expect(
      identity.authenticatePin({ companyCode, pin: '123456' }, 'lock-ip'),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await app.close();
  });

  it('pepper is required', () => {
    expect(() => new IdentityService(pool, undefined)).toThrow(/PEPPER/);
    expect(() => new IdentityService(pool, 'short')).toThrow(/PEPPER/);
  });

  it('logout revokes; fixation cookie ignored', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
    });
    const app = await buildApp();
    const forged = 'forged-session-token-value-xxxxxxxxxxxx';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/pin/authenticate',
      cookies: { [SESSION_COOKIE_NAME]: forged },
      payload: { companyCode, pin: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const cookieStr = String(res.headers['set-cookie']);
    const token = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))![1]!;
    expect(token).not.toBe(forged);
    expect(sha256Hex(token)).not.toBe(sha256Hex(forged));

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/session/logout',
      headers: { origin: 'http://localhost:5173' },
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(logout.statusCode).toBe(200);
    const again = await app.inject({
      method: 'GET',
      url: '/api/v1/identity/session',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(again.statusCode).toBe(401);
    await app.close();
  });

  it('caller-supplied tenantId cannot switch authority; grants fail closed', async () => {
    const otherTenant = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'Other')`, [otherTenant]);
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
      grants: [{ permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId }],
    });
    const auth = await identity.authenticatePin({ companyCode, pin: '123456' }, '127.0.0.1');
    const principal = await identity.resolveSession(auth.sessionToken);
    expect(principal.tenantId).toBe(fx.tenantId);
    await expect(
      identity.assertPermission(
        { ...principal, tenantId: otherTenant },
        PERMISSION_CASH_SHIFT_OPEN,
        fx.outletId,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('LoginChallenge + Approval (no CashShift)', () => {
  it('confirm requires mobile principal; QR alone does not authenticate', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
    });
    const term = await identity.authenticatePin(
      { companyCode, pin: '123456', channel: 'TERMINAL' },
      '1.1.1.1',
    );
    const termPrincipal = await identity.resolveSession(term.sessionToken);
    const challenges = new LoginChallengeService(pool, identity);
    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });

    await expect(
      challenges.confirmChallenge(termPrincipal, { qrToken: created.qrToken }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const mobile = await identity.authenticatePin(
      { companyCode, pin: '123456', channel: 'MOBILE' },
      '2.2.2.2',
    );
    const mobilePrincipal = await identity.resolveSession(mobile.sessionToken);
    const ok = await challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken });
    expect(ok.confirmed).toBe(true);
    // Replay rejected
    await expect(
      challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('self-approval forbidden; no cash_shift table writes', async () => {
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Boss',
      pin: '654321',
      grants: [{ permissionKey: PERMISSION_CASH_SHIFT_OPEN_APPROVE, outletId: fx.outletId }],
    });
    const ana = await identity.authenticatePin({ companyCode, pin: '123456' }, '1.1.1.1');
    const anaP = await identity.resolveSession(ana.sessionToken);
    const approvals = new ApprovalRequestService(pool, identity, new OutboxNotificationPort(pool));
    const req = await approvals.createRequest(anaP, {
      outletId: fx.outletId,
      terminalId,
      operationType: 'cash_shift.open',
      operationFingerprint: {
        openingCash: { amountMinor: '100000', currencyCode: 'VND', minorUnitExponent: 0 },
      },
    });
    await expect(approvals.decide(anaP, req.approvalRequestId, { decision: 'APPROVE' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const boss = await identity.authenticatePin({ companyCode, pin: '654321' }, '3.3.3.3');
    const bossP = await identity.resolveSession(boss.sessionToken);
    const decided = await approvals.decide(bossP, req.approvalRequestId, { decision: 'APPROVE' });
    expect(decided.status).toBe('APPROVED');

    const cash = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'cash_shift'`,
    );
    expect(cash.rowCount).toBe(0);
  });
});

describe('Employee ≠ User tenant coherence', () => {
  it('rejects cross-tenant Employee→User link at DB', async () => {
    const otherTenant = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'Other')`, [otherTenant]);
    const { userId } = await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Ana',
      pin: '123456',
    });
    await expect(
      pool.query(
        `INSERT INTO workforce_employee (employee_id, tenant_id, display_name, user_id)
         VALUES ($1,$2,'X',$3)`,
        [randomUUID(), otherTenant, userId],
      ),
    ).rejects.toThrow();
  });
});
