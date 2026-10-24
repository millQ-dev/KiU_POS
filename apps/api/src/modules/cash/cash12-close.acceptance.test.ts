/**
 * CASH1.2 — CloseCashShift acceptance (ADR-0046).
 * Destructive — millq_ci_pos_* only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  assertPosDisposableDatabaseUrl,
  isPosDisposableDatabaseUrl,
} from '../../test/disposable-database-url.js';
import {
  authInjectHeaders,
  loginPosSession,
  TEST_ORIGIN,
  TEST_PIN,
} from '../../test/financial-auth-harness.js';
import { resolvePinPepper } from '../../config.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_POS_OPERATE,
} from '../identity/index.js';
import { CashDomainError } from './errors.js';
import { CashShiftService } from './cash-shift-service.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { registerCashRoutes } from '../../routes/cash.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN_DISPOSABLE = isPosDisposableDatabaseUrl(DATABASE_URL);
const describeClose = RUN_DISPOSABLE ? describe : describe.skip;

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
  assertPosDisposableDatabaseUrl(DATABASE_URL);
  await pool.query(`
    TRUNCATE
      payment_collection_event, payment_cash_collection_evidence,
      payment_allocation, payment_provider_outcome, payment, tender_definition,
      settlement_check_line_allocation, settlement_check, settlement_group,
      settlement_payable_snapshot,
      cash_shift,
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
      identity_network_throttle,
      identity_pin_credential, workforce_employee, identity_user, terminal,
      operational_fact_feed, audit_record,
      sales_order_line, sales_order,
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

async function provisionCashier(extra: Array<{ permissionKey: string; outletId: string }> = []) {
  return identity.provisionUserWithPin({
    tenantId: fx.tenantId,
    displayName: 'Cashier',
    pin: TEST_PIN,
    grants: [
      { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
      { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
      ...extra,
    ],
  });
}

async function openShift(principal: Awaited<ReturnType<IdentityService['resolveSession']>>, opening = '100000') {
  return cash.openShift(principal, {
    outletId: fx.outletId,
    terminalId,
    openIdempotencyKey: `open-${randomUUID()}`,
    openingCash: { amountMinor: opening, currencyCode: 'VND', minorUnitExponent: 0 },
  });
}

/** Minimal Payments-owned CASH PCE bound to a CashShift (test fixture; not a product API). */
async function seedCashPceForShift(opts: {
  cashShiftId: string;
  amountCollectedMinor: string;
  amountTenderedMinor?: string;
}) {
  const orderId = randomUUID();
  const snapId = randomUUID();
  const groupId = randomUUID();
  const checkId = randomUUID();
  const tenderId = randomUUID();
  const paymentId = randomUUID();
  const evidenceId = randomUUID();
  const pceId = randomUUID();
  const collected = opts.amountCollectedMinor;
  const tendered = opts.amountTenderedMinor ?? collected;
  const change = (BigInt(tendered) - BigInt(collected)).toString();

  await pool.query(
    `INSERT INTO sales_order (order_id, tenant_id, legal_entity_id, outlet_id, status, channel)
     VALUES ($1,$2,$3,$4,'OPEN','DIRECT')`,
    [orderId, fx.tenantId, fx.legalEntityId, fx.outletId],
  );
  await pool.query(
    `INSERT INTO settlement_payable_snapshot (
       settlement_payable_snapshot_id, tenant_id, order_id, legal_entity_id,
       currency_code, minor_unit_exponent, commercial_fingerprint,
       merchandise_gross_minor, customer_payable_minor, semantic_fingerprint
     ) VALUES ($1,$2,$3,$4,'VND',0,'fp',$5,$5,'sem')`,
    [snapId, fx.tenantId, orderId, fx.legalEntityId, collected],
  );
  await pool.query(
    `INSERT INTO settlement_group (
       settlement_group_id, tenant_id, order_id, legal_entity_id, state,
       currency_code, minor_unit_exponent, commercial_fingerprint,
       settlement_payable_snapshot_id, customer_payable_minor,
       open_idempotency_key, open_semantic_fingerprint
     ) VALUES ($1,$2,$3,$4,'COLLECTING','VND',0,'fp',$5,$6,$7,'sem')`,
    [groupId, fx.tenantId, orderId, fx.legalEntityId, snapId, collected, `sg-${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO settlement_check (
       settlement_check_id, settlement_group_id, tenant_id, state,
       customer_payable_minor, currency_code, minor_unit_exponent, check_number
     ) VALUES ($1,$2,$3,'COLLECTING',$4,'VND',0,1)`,
    [checkId, groupId, fx.tenantId, collected],
  );
  await pool.query(
    `INSERT INTO tender_definition (
       tender_definition_id, tenant_id, legal_entity_id, code, display_name, instrument_family
     ) VALUES ($1,$2,$3,$4,'Cash','CASH')`,
    [tenderId, fx.tenantId, fx.legalEntityId, `CASH-${randomUUID().slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO payment (
       payment_id, tenant_id, legal_entity_id, tender_definition_id,
       currency_code, minor_unit_exponent, requested_amount_minor, lifecycle_state,
       create_idempotency_key, merchant_payment_reference
     ) VALUES ($1,$2,$3,$4,'VND',0,$5,'SUCCEEDED',$6,$7)`,
    [
      paymentId,
      fx.tenantId,
      fx.legalEntityId,
      tenderId,
      collected,
      `pay-${randomUUID()}`,
      `mref-${randomUUID()}`,
    ],
  );
  const opener = await pool.query<{ opened_by_user_id: string }>(
    `SELECT opened_by_user_id FROM cash_shift WHERE cash_shift_id = $1`,
    [opts.cashShiftId],
  );
  await pool.query(
    `INSERT INTO payment_cash_collection_evidence (
       payment_cash_collection_evidence_id, payment_id, tenant_id, legal_entity_id,
       settlement_check_id, settlement_group_id, cash_shift_id, terminal_id, outlet_id,
       collected_by_user_id, amount_due_minor, amount_tendered_minor, change_minor,
       currency_code, minor_unit_exponent, human_confirmation, receive_idempotency_key, accepted_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'VND',0,TRUE,$14,NOW()
     )`,
    [
      evidenceId,
      paymentId,
      fx.tenantId,
      fx.legalEntityId,
      checkId,
      groupId,
      opts.cashShiftId,
      terminalId,
      fx.outletId,
      opener.rows[0]!.opened_by_user_id,
      collected,
      tendered,
      change,
      `rcv-${randomUUID()}`,
    ],
  );
  await pool.query(
    `INSERT INTO payment_collection_event (
       payment_collection_event_id, payment_id, tenant_id, legal_entity_id,
       settlement_check_id, settlement_group_id, instrument_family, collected_at,
       collection_evidence_kind, payment_cash_collection_evidence_id,
       amount_collected_minor, currency_code, minor_unit_exponent
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'CASH',NOW(),'CASH_RECEIVE',$7,$8,'VND',0
     )`,
    [
      pceId,
      paymentId,
      fx.tenantId,
      fx.legalEntityId,
      checkId,
      groupId,
      evidenceId,
      collected,
    ],
  );
  return { pceId, paymentId, tendered };
}

describeClose('CASH1.2 CloseCashShift', () => {
  beforeAll(async () => {
    assertPosDisposableDatabaseUrl(DATABASE_URL);
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

  it('1 balanced close: expected=opening; immutable evidence; no Payment mutation', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const headers = authInjectHeaders(token);
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/open',
      headers,
      payload: {
        outletId: fx.outletId,
        terminalId,
        openIdempotencyKey: `open-${randomUUID()}`,
        openingCash: { amountMinor: '100000', currencyCode: 'VND', minorUnitExponent: 0 },
      },
    });
    expect(open.statusCode).toBe(201);
    const shiftId = open.json().cashShiftId as string;
    const beforePay = await pool.query(`SELECT count(*)::int AS c FROM payment`);

    const close = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/shifts/close',
      headers,
      payload: {
        cashShiftId: shiftId,
        closeIdempotencyKey: `close-${randomUUID()}`,
        actualAmountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      },
    });
    expect(close.statusCode).toBe(200);
    const body = close.json();
    expect(body.status).toBe('CLOSED');
    expect(body.expectedAmountMinor).toBe('100000');
    expect(body.actualAmountMinor).toBe('100000');
    expect(body.differenceMinor).toBe('0');
    expect(body.varianceKind).toBe('BALANCED');
    expect(body.closedAt).toBeTruthy();
    expect(body.expectedSourceRefs).toEqual([]);
    expect((await pool.query(`SELECT count(*)::int AS c FROM payment`)).rows[0]!.c).toBe(
      beforePay.rows[0]!.c,
    );

    await expect(
      pool.query(`UPDATE cash_shift SET actual_amount_minor = '1' WHERE cash_shift_id = $1`, [shiftId]),
    ).rejects.toThrow(/immutable/i);
  });

  it('2 expected sums CASH PCE amount_collected_minor (not tendered); CARD ignored', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const principal = await identity.resolveSession(token);
    const shift = await openShift(principal, '50000');
    const seeded = await seedCashPceForShift({
      cashShiftId: shift.cashShiftId,
      amountCollectedMinor: '25000',
      amountTenderedMinor: '30000',
    });
    expect(seeded.tendered).toBe('30000');

    const closed = await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '75000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(closed.expectedAmountMinor).toBe('75000');
    expect(closed.expectedSourceRefs).toEqual([seeded.pceId]);
    expect(closed.varianceKind).toBe('BALANCED');
  });

  it('3 surplus requires reason + cash_shift.close; shortage rejects cashier close grant', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const principal = await identity.resolveSession(token);
    const shift = await openShift(principal, '100000');

    await expect(
      cash.closeShift(principal, {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey: `close-${randomUUID()}`,
        actualAmountMinor: '110000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

    const surplus = await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '110000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      reasonText: 'Found extra notes in drawer',
    });
    expect(surplus.varianceKind).toBe('SURPLUS');
    expect(surplus.differenceMinor).toBe('10000');

    const shift2 = await openShift(principal, '100000');
    await expect(
      cash.closeShift(principal, {
        cashShiftId: shift2.cashShiftId,
        closeIdempotencyKey: `close-${randomUUID()}`,
        actualAmountMinor: '90000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        reasonText: 'Missing cash',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('4 shortage succeeds only with cash_shift.close.shortage (no pos.operate required)', async () => {
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
      displayName: 'Opener',
      pin: '111111',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Manager',
      pin: '222222',
      grants: [{ permissionKey: PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE, outletId: fx.outletId }],
    });

    const openerAuth = await identity.authenticatePin(
      { companyCode, pin: '111111', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const opener = await identity.resolveSession(openerAuth.sessionToken);
    const shift = await openShift(opener, '100000');

    const mgrAuth = await identity.authenticatePin(
      { companyCode, pin: '222222', channel: 'TERMINAL' },
      '127.0.0.1',
    );
    const manager = await identity.resolveSession(mgrAuth.sessionToken);
    const closed = await cash.closeShift(manager, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '80000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      reasonText: 'Manager counted shortage',
    });
    expect(closed.varianceKind).toBe('SHORTAGE');
    expect(closed.differenceMinor).toBe('-20000');
    expect(closed.closedByUserId).toBe(manager.userId);
  });

  it('5 idempotent close replay; conflicting key → IDEMPOTENCY_CONFLICT', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const principal = await identity.resolveSession(token);
    const shift = await openShift(principal, '100000');
    const key = `close-${randomUUID()}`;
    const first = await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: key,
      actualAmountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    const replay = await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: key,
      actualAmountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(replay.cashShiftId).toBe(first.cashShiftId);
    expect(replay.closedAt).toBe(first.closedAt);

    await expect(
      cash.closeShift(principal, {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey: key,
        actualAmountMinor: '99999',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        reasonText: 'different',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('6 client expected mismatch → EXPECTED_MISMATCH; second close → ALREADY_CLOSED', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const principal = await identity.resolveSession(token);
    const shift = await openShift(principal, '100000');

    await expect(
      cash.closeShift(principal, {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey: `close-${randomUUID()}`,
        actualAmountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        expectedAmountMinor: '1',
      }),
    ).rejects.toMatchObject({ code: 'EXPECTED_MISMATCH' });

    await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });

    await expect(
      cash.closeShift(principal, {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey: `close-${randomUUID()}`,
        actualAmountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      }),
    ).rejects.toMatchObject({ code: 'CASH_SHIFT_ALREADY_CLOSED' });
  });

  it('7 race: ReceiveCash FOR SHARE blocks until close; after CLOSED open-shift gone', async () => {
    const app = await buildApp();
    const token = await loginPosSession(app, pool, fx);
    const principal = await identity.resolveSession(token);
    const shift = await openShift(principal, '100000');

    const shareClient = await pool.connect();
    await shareClient.query('BEGIN');
    await shareClient.query(
      `SELECT cash_shift_id FROM cash_shift
       WHERE cash_shift_id = $1 AND status = 'OPEN' FOR SHARE`,
      [shift.cashShiftId],
    );

    let closeDone = false;
    const closePromise = cash
      .closeShift(principal, {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey: `close-${randomUUID()}`,
        actualAmountMinor: '100000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      })
      .then((r) => {
        closeDone = true;
        return r;
      });

    await new Promise((r) => setTimeout(r, 150));
    expect(closeDone).toBe(false);

    await shareClient.query('COMMIT');
    shareClient.release();

    const closed = await closePromise;
    expect(closed.status).toBe('CLOSED');
    expect(closeDone).toBe(true);

    const stillOpen = await cash.getOpenShiftForTerminal(principal, terminalId);
    expect(stillOpen).toBeNull();
  });
});

describe('CASH1.2 CloseCashShift gate', () => {
  it('skips destructive suite unless millq_ci_pos_*', () => {
    if (!RUN_DISPOSABLE) {
      expect(CashDomainError).toBeDefined();
    } else {
      expect(isPosDisposableDatabaseUrl(DATABASE_URL)).toBe(true);
    }
  });
});
