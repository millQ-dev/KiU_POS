/**
 * C0-REFUND-B2 — CASH human handover confirmation (ADR-0048).
 * Destructive — requires disposable DATABASE_URL matching /millq_ci_pos(_…)?/
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolvePinPepper } from '../../config.js';
import { runMigrations } from '../../db/migrate.js';
import {
  assertPosDisposableDatabaseUrl,
  isPosDisposableDatabaseUrl,
} from '../../test/disposable-database-url.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { TEST_ORIGIN, TEST_PIN } from '../../test/financial-auth-harness.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_PAYMENTS_REFUND_CASH,
  PERMISSION_POS_OPERATE,
  type AuthenticatedPrincipal,
} from '../identity/index.js';
import { CashShiftService } from '../cash/cash-shift-service.js';
import { DomainValidationError } from '../orders/errors.js';
import { DISPOSABLE_TEST_MONEY_EFFECT_PROOF } from './refund-types.js';
import { RefundService } from './refund-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN = isPosDisposableDatabaseUrl(DATABASE_URL);
const describeB2 = RUN ? describe : describe.skip;

const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

describeB2('C0-REFUND-B2 CASH handover confirmation (disposable PostgreSQL)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let identity: IdentityService;
  let cash: CashShiftService;
  let refunds: RefundService;
  let terminalId: string;
  let otherOutletId: string;
  let otherTerminalId: string;
  let principal: AuthenticatedPrincipal;
  let userId: string;
  let employeeId: string;

  beforeAll(async () => {
    assertPosDisposableDatabaseUrl(DATABASE_URL);
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
    identity = new IdentityService(pool, PEPPER);
    cash = new CashShiftService(pool, identity);
    refunds = new RefundService(pool, {
      allowDisposableTestMoneyProof: false,
      identity,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    assertPosDisposableDatabaseUrl(DATABASE_URL);
    await pool.query(`
      TRUNCATE
        payment_refund_cash_handover_evidence, payment_refund_evidence,
        payment_refund_payout_attempt, payment_refund,
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
        sales_order_line, sales_order,
        warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
    terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'T1','Front')`,
      [terminalId, fx.tenantId, fx.outletId],
    );
    otherOutletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Other Outlet')`,
      [otherOutletId, fx.tenantId, fx.brandId, fx.legalEntityId],
    );
    otherTerminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'T2','Other')`,
      [otherTerminalId, fx.tenantId, otherOutletId],
    );

    const provisioned = await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Cash Refunder',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
        { permissionKey: PERMISSION_PAYMENTS_REFUND_CASH, outletId: fx.outletId },
      ],
    });
    userId = provisioned.userId;
    employeeId = provisioned.employeeId;
    principal = {
      sessionId: randomUUID(),
      tenantId: fx.tenantId,
      userId,
      employeeId,
      displayName: 'Cash Refunder',
      channel: 'TERMINAL',
    };
  });

  async function openShift(opening = '100000') {
    return cash.openShift(principal, {
      outletId: fx.outletId,
      terminalId,
      openIdempotencyKey: `open-${randomUUID()}`,
      openingCash: {
        amountMinor: opening,
        currencyCode: 'VND',
        minorUnitExponent: 0,
      },
    });
  }

  async function seedCashCollected(opts?: { collectedMinor?: string; outletId?: string }) {
    const collected = opts?.collectedMinor ?? '50000';
    const outletId = opts?.outletId ?? fx.outletId;
    const orderId = randomUUID();
    const snapId = randomUUID();
    const groupId = randomUUID();
    const checkId = randomUUID();
    const tenderId = randomUUID();
    const paymentId = randomUUID();
    const evidenceId = randomUUID();
    const pceId = randomUUID();

    await pool.query(
      `INSERT INTO sales_order (order_id, tenant_id, legal_entity_id, outlet_id, status, channel)
       VALUES ($1,$2,$3,$4,'OPEN','DIRECT')`,
      [orderId, fx.tenantId, fx.legalEntityId, outletId],
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
       ) VALUES ($1,$2,$3,$4,'SATISFIED','VND',0,'fp',$5,$6,$7,'sem')`,
      [groupId, fx.tenantId, orderId, fx.legalEntityId, snapId, collected, `sg-${randomUUID()}`],
    );
    await pool.query(
      `INSERT INTO settlement_check (
         settlement_check_id, settlement_group_id, tenant_id, state,
         customer_payable_minor, currency_code, minor_unit_exponent, check_number
       ) VALUES ($1,$2,$3,'SATISFIED',$4,'VND',0,1)`,
      [checkId, groupId, fx.tenantId, collected],
    );
    await pool.query(
      `INSERT INTO tender_definition (
         tender_definition_id, tenant_id, legal_entity_id, code, display_name, instrument_family
       ) VALUES ($1,$2,$3,$4,'CASH','CASH')`,
      [tenderId, fx.tenantId, fx.legalEntityId, `CASH-${randomUUID().slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO payment (
         payment_id, tenant_id, legal_entity_id, tender_definition_id,
         currency_code, minor_unit_exponent, requested_amount_minor, lifecycle_state,
         create_idempotency_key, merchant_payment_reference,
         intended_settlement_group_id, intended_settlement_check_id
       ) VALUES ($1,$2,$3,$4,'VND',0,$5,'SUCCEEDED',$6,$7,$8,$9)`,
      [
        paymentId,
        fx.tenantId,
        fx.legalEntityId,
        tenderId,
        collected,
        `pay-${randomUUID()}`,
        `mref-${randomUUID()}`,
        groupId,
        checkId,
      ],
    );
    await pool.query(
      `INSERT INTO payment_allocation (
         payment_allocation_id, payment_id, settlement_check_id, settlement_group_id,
         tenant_id, legal_entity_id, amount_minor, currency_code, minor_unit_exponent,
         allocation_idempotency_key, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'VND',0,$8,TRUE)`,
      [
        randomUUID(),
        paymentId,
        checkId,
        groupId,
        fx.tenantId,
        fx.legalEntityId,
        collected,
        `alloc-${randomUUID()}`,
      ],
    );
    const shiftPeek = await pool.query<{ cash_shift_id: string }>(
      `SELECT cash_shift_id FROM cash_shift
       WHERE tenant_id = $1 AND outlet_id = $2 AND status = 'OPEN'
       ORDER BY opened_at DESC LIMIT 1`,
      [fx.tenantId, outletId],
    );
    const cashShiftId = shiftPeek.rows[0]?.cash_shift_id;
    if (!cashShiftId) {
      throw new Error('seedCashCollected requires an OPEN CashShift for the outlet');
    }
    const term = await pool.query<{ terminal_id: string }>(
      `SELECT terminal_id FROM cash_shift WHERE cash_shift_id = $1`,
      [cashShiftId],
    );
    await pool.query(
      `INSERT INTO payment_cash_collection_evidence (
         payment_cash_collection_evidence_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, cash_shift_id, terminal_id, outlet_id,
         collected_by_user_id, amount_due_minor, amount_tendered_minor, change_minor,
         currency_code, minor_unit_exponent, human_confirmation, receive_idempotency_key, accepted_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'0','VND',0,TRUE,$12,NOW()
       )`,
      [
        evidenceId,
        paymentId,
        fx.tenantId,
        fx.legalEntityId,
        checkId,
        groupId,
        cashShiftId,
        term.rows[0]!.terminal_id,
        outletId,
        userId,
        collected,
        `rcv-${randomUUID()}`,
      ],
    );
    await pool.query(
      `INSERT INTO payment_collection_event (
         payment_collection_event_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, instrument_family, collected_at,
         collection_evidence_kind, payment_cash_collection_evidence_id,
         amount_collected_minor, currency_code, minor_unit_exponent
       ) VALUES ($1,$2,$3,$4,$5,$6,'CASH',NOW(),'CASH_RECEIVE',$7,$8,'VND',0)`,
      [pceId, paymentId, fx.tenantId, fx.legalEntityId, checkId, groupId, evidenceId, collected],
    );

    return { paymentId, checkId, collected, tenderId };
  }

  async function authorizePending(amountMinor: string, paymentId: string, checkId: string) {
    const r = await refunds.authorizeAndReserve({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: paymentId,
      settlementCheckId: checkId,
      outletId: fx.outletId,
      amountMinor,
      reasonText: 'cash guest return',
      refundIdempotencyKey: `r-${randomUUID()}`,
      authorizedByUserId: userId,
    });
    return refunds.beginExecutionPending(r.paymentRefundId);
  }

  function confirmArgs(
    pending: Awaited<ReturnType<typeof authorizePending>>,
    cashShiftId: string,
    overrides: Partial<{
      amountMinor: string;
      outletId: string;
      confirmIdempotencyKey: string;
      principal: AuthenticatedPrincipal;
    }> = {},
  ) {
    return {
      paymentRefundId: pending.paymentRefundId,
      cashShiftId,
      amountMinor: overrides.amountMinor ?? pending.amountMinor,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      outletId: overrides.outletId ?? fx.outletId,
      confirmIdempotencyKey: overrides.confirmIdempotencyKey ?? `c-${randomUUID()}`,
      humanConfirmation: true as const,
      principal: overrides.principal ?? principal,
    };
  }

  it('successful CASH refund + partial + expected cash once; no drawer twin', async () => {
    const shift = await openShift('100000');
    const seeded = await seedCashCollected({ collectedMinor: '50000' });
    const pending = await authorizePending('20000', seeded.paymentId, seeded.checkId);
    expect(pending.financialStatus).toBe('EXECUTION_PENDING');

    const done = await refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId));
    expect(done.financialStatus).toBe('MONEY_RETURNED');
    expect(done.reservationHoldsCapacity).toBe(false);
    expect(done.cashShiftId).toBe(shift.cashShiftId);
    expect(done.confirmedAt).toBeTruthy();

    const handover = await pool.query(
      `SELECT human_confirmation, amount_minor, cash_shift_id, confirmed_by_user_id
       FROM payment_refund_cash_handover_evidence WHERE payment_refund_id = $1`,
      [done.paymentRefundId],
    );
    expect(handover.rowCount).toBe(1);
    expect(handover.rows[0].human_confirmation).toBe(true);
    expect(handover.rows[0].amount_minor).toBe('20000');

    const drawer = await pool.query(
      `SELECT to_regclass('public.cash_drawer_movement') AS t`,
    );
    expect(drawer.rows[0].t).toBeNull();

    const cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.confirmedRefundsMinor).toBe('20000');
    expect(cap.activeReservationsMinor).toBe('0');
    expect(cap.remainingCapacityMinor).toBe('30000');
    expect(cap.qualifyingMinor).toBe('50000');

    // Partial second refund
    const pending2 = await authorizePending('10000', seeded.paymentId, seeded.checkId);
    await refunds.confirmCashHandover(confirmArgs(pending2, shift.cashShiftId));

    const closed = await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '120000', // 100000 + 50000 - 20000 - 10000
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(closed.expectedAmountMinor).toBe('120000');
    expect(closed.status).toBe('CLOSED');
    const refs = closed.expectedSourceRefs ?? [];
    expect(refs.some((r) => typeof r === 'object' && r && (r as { kind?: string }).kind === 'CASH_REFUND')).toBe(
      true,
    );
  });

  it('duplicate confirmation is idempotent (no second financial effect)', async () => {
    const shift = await openShift();
    const seeded = await seedCashCollected({ collectedMinor: '30000' });
    const pending = await authorizePending('5000', seeded.paymentId, seeded.checkId);
    const key = `dup-${randomUUID()}`;
    const a = await refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId, { confirmIdempotencyKey: key }));
    const b = await refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId, { confirmIdempotencyKey: key }));
    expect(a.paymentRefundId).toBe(b.paymentRefundId);
    expect(b.duplicate).toBe(true);
    const count = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM payment_refund_cash_handover_evidence WHERE payment_refund_id = $1`,
      [a.paymentRefundId],
    );
    expect(count.rows[0]!.c).toBe(1);
    const cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.confirmedRefundsMinor).toBe('5000');
  });

  it('concurrent confirmations → single MONEY_RETURNED + single evidence', async () => {
    const shift = await openShift();
    const seeded = await seedCashCollected({ collectedMinor: '40000' });
    const pending = await authorizePending('7000', seeded.paymentId, seeded.checkId);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId)),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const money = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM payment_refund
       WHERE payment_refund_id = $1 AND financial_status = 'MONEY_RETURNED'`,
      [pending.paymentRefundId],
    );
    expect(money.rows[0]!.c).toBe(1);
    const evidence = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM payment_refund_cash_handover_evidence WHERE payment_refund_id = $1`,
      [pending.paymentRefundId],
    );
    expect(evidence.rows[0]!.c).toBe(1);
  });

  it('rejects wrong amount / outlet / LE / missing permissions / CLOSED shift', async () => {
    const shift = await openShift();
    const seeded = await seedCashCollected({ collectedMinor: '25000' });
    const pending = await authorizePending('8000', seeded.paymentId, seeded.checkId);

    await expect(
      refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId, { amountMinor: '7999' })),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });

    await expect(
      refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId, { outletId: otherOutletId })),
    ).rejects.toMatchObject({ code: 'OUTLET_MISMATCH' });

    const noPerm = await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'NoRefund',
      pin: '654321',
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
      ],
    });
    await expect(
      refunds.confirmCashHandover(
        confirmArgs(pending, shift.cashShiftId, {
          principal: {
            sessionId: randomUUID(),
            tenantId: fx.tenantId,
            userId: noPerm.userId,
            employeeId: noPerm.employeeId,
            displayName: 'NoRefund',
            channel: 'TERMINAL',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Wrong LE: principal from another tenant cannot confirm
    const otherTenant = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name, company_code) VALUES ($1,'X',$2)`, [
      otherTenant,
      otherTenant.replace(/-/g, '').toUpperCase(),
    ]);
    await expect(
      refunds.confirmCashHandover(
        confirmArgs(pending, shift.cashShiftId, {
          principal: { ...principal, tenantId: otherTenant, userId: randomUUID() },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CROSS_ENTITY' });

    await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '125000', // opening 100000 + collection 25000, no refund yet
      currencyCode: 'VND',
      minorUnitExponent: 0,
      expectedAmountMinor: '125000',
    });
    await expect(
      refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId)),
    ).rejects.toMatchObject({ code: 'CASH_SHIFT_ALREADY_CLOSED' });
  });

  it('UNKNOWN and RECONCILE_BLOCKED forbid confirmation; disposable proof blocked for CASH', async () => {
    const shift = await openShift();
    const seeded = await seedCashCollected({ collectedMinor: '15000' });
    const pending = await authorizePending('3000', seeded.paymentId, seeded.checkId);
    await refunds.markExecutionUnknown(pending.paymentRefundId);
    await expect(
      refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId)),
    ).rejects.toMatchObject({ code: 'REFUND_STATUS_INVALID' });

    const pending2 = await authorizePending('3000', seeded.paymentId, seeded.checkId);
    await refunds.markReconcileBlocked(pending2.paymentRefundId);
    await expect(
      refunds.confirmCashHandover(confirmArgs(pending2, shift.cashShiftId)),
    ).rejects.toMatchObject({ code: 'REFUND_STATUS_INVALID' });

    const pending3 = await authorizePending('2000', seeded.paymentId, seeded.checkId);
    await expect(
      refunds.confirmMoneyReturned(pending3.paymentRefundId, {
        evidenceKind: DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
        recordedByActorId: userId,
      }),
    ).rejects.toMatchObject({ code: 'CASH_HANDOVER_REQUIRED' });
  });

  it('concurrent CashShift close vs confirm — no CLOSED mutation; at most one payout', async () => {
    const shift = await openShift('200000');
    const seeded = await seedCashCollected({ collectedMinor: '10000' });
    const pending = await authorizePending('4000', seeded.paymentId, seeded.checkId);

    const results = await Promise.allSettled([
      refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId)),
      cash.closeShift(principal, {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey: `race-close-${randomUUID()}`,
        actualAmountMinor: '210000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
      }),
    ]);

    const shiftRow = await pool.query<{ status: string; expected_amount_minor: string | null }>(
      `SELECT status, expected_amount_minor FROM cash_shift WHERE cash_shift_id = $1`,
      [shift.cashShiftId],
    );
    expect(['OPEN', 'CLOSED']).toContain(shiftRow.rows[0]!.status);

    const refundRow = await pool.query<{ financial_status: string; cash_shift_id: string | null }>(
      `SELECT financial_status, cash_shift_id FROM payment_refund WHERE payment_refund_id = $1`,
      [pending.paymentRefundId],
    );
    if (refundRow.rows[0]!.financial_status === 'MONEY_RETURNED') {
      expect(refundRow.rows[0]!.cash_shift_id).toBe(shift.cashShiftId);
      if (shiftRow.rows[0]!.status === 'CLOSED') {
        // expected = 200000 + 10000 - 4000
        expect(shiftRow.rows[0]!.expected_amount_minor).toBe('206000');
      }
    } else {
      expect(refundRow.rows[0]!.financial_status).toBe('EXECUTION_PENDING');
      // Close won first — confirm must have failed closed
      const confirmRejected = results.find(
        (r) => r.status === 'rejected' && r.reason instanceof DomainValidationError,
      );
      expect(confirmRejected).toBeTruthy();
      if (shiftRow.rows[0]!.status === 'CLOSED') {
        expect(shiftRow.rows[0]!.expected_amount_minor).toBe('210000');
      }
    }

    // CLOSED shift never mutated after close by a late confirm
    if (shiftRow.rows[0]!.status === 'CLOSED') {
      await expect(
        refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId)),
      ).rejects.toMatchObject({ code: 'CASH_SHIFT_ALREADY_CLOSED' });
      const after = await pool.query<{ expected_amount_minor: string }>(
        `SELECT expected_amount_minor FROM cash_shift WHERE cash_shift_id = $1`,
        [shift.cashShiftId],
      );
      expect(after.rows[0]!.expected_amount_minor).toBe(shiftRow.rows[0]!.expected_amount_minor);
    }
  });

  it('rollback after error leaves no MONEY_RETURNED / no evidence / expected unchanged', async () => {
    const shift = await openShift('50000');
    const seeded = await seedCashCollected({ collectedMinor: '20000' });
    const pending = await authorizePending('6000', seeded.paymentId, seeded.checkId);

    await expect(
      refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId, { amountMinor: '1' })),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });

    const row = await pool.query<{ financial_status: string }>(
      `SELECT financial_status FROM payment_refund WHERE payment_refund_id = $1`,
      [pending.paymentRefundId],
    );
    expect(row.rows[0]!.financial_status).toBe('EXECUTION_PENDING');
    const ev = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM payment_refund_cash_handover_evidence WHERE payment_refund_id = $1`,
      [pending.paymentRefundId],
    );
    expect(ev.rows[0]!.c).toBe(0);

    const closed = await cash.closeShift(principal, {
      cashShiftId: shift.cashShiftId,
      closeIdempotencyKey: `close-${randomUUID()}`,
      actualAmountMinor: '70000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(closed.expectedAmountMinor).toBe('70000'); // opening + PCE, no refund
  });

  it('handover evidence is append-only; permissions keys exact', async () => {
    expect(PERMISSION_PAYMENTS_REFUND_CASH).toBe('payments.refund_cash');
    const shift = await openShift();
    const seeded = await seedCashCollected({ collectedMinor: '12000' });
    const pending = await authorizePending('2000', seeded.paymentId, seeded.checkId);
    await refunds.confirmCashHandover(confirmArgs(pending, shift.cashShiftId));
    const id = (
      await pool.query<{ payment_refund_cash_handover_evidence_id: string }>(
        `SELECT payment_refund_cash_handover_evidence_id FROM payment_refund_cash_handover_evidence
         WHERE payment_refund_id = $1`,
        [pending.paymentRefundId],
      )
    ).rows[0]!.payment_refund_cash_handover_evidence_id;
    await expect(
      pool.query(
        `UPDATE payment_refund_cash_handover_evidence SET amount_minor = '1'
         WHERE payment_refund_cash_handover_evidence_id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(
        `DELETE FROM payment_refund_cash_handover_evidence WHERE payment_refund_cash_handover_evidence_id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
  });
});
