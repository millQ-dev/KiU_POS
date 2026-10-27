/**
 * C0-REFUND-B1 — reservation schema + financial invariants (ADR-0048).
 * Destructive — requires disposable DATABASE_URL matching /millq_ci_pos(_…)?/
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  assertPosDisposableDatabaseUrl,
  isPosDisposableDatabaseUrl,
} from '../../test/disposable-database-url.js';
import { DomainValidationError } from '../orders/errors.js';
import {
  PERMISSION_PAYMENTS_REFUND_APPROVE,
  PERMISSION_PAYMENTS_REFUND_CASH,
  PERMISSION_PAYMENTS_REFUND_RECONCILE,
  PERMISSION_PAYMENTS_REFUND_VIETQR,
} from '../identity/errors.js';
import { DISPOSABLE_TEST_MONEY_EFFECT_PROOF } from './refund-types.js';
import { RefundService } from './refund-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN = isPosDisposableDatabaseUrl(DATABASE_URL);
const describeB1 = RUN ? describe : describe.skip;

describeB1('C0-REFUND-B1 reservation + capacity (disposable PostgreSQL)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let refunds: RefundService;
  let otherOutletId: string;

  beforeAll(async () => {
    assertPosDisposableDatabaseUrl(DATABASE_URL);
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
    refunds = new RefundService(pool, { allowDisposableTestMoneyProof: true });
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    assertPosDisposableDatabaseUrl(DATABASE_URL);
    await pool.query(`
      TRUNCATE
        payment_refund_evidence, payment_refund_payout_attempt, payment_refund,
        payment_collection_event, payment_cash_collection_evidence,
        payment_allocation, payment_provider_outcome, payment, tender_definition,
        settlement_check_line_allocation, settlement_check, settlement_group,
        settlement_payable_snapshot,
        sales_order_line, sales_order,
        warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
    otherOutletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Other Outlet')`,
      [otherOutletId, fx.tenantId, fx.brandId, fx.legalEntityId],
    );
  });

  it('declares ADR-0048 grant key constants', () => {
    expect(PERMISSION_PAYMENTS_REFUND_CASH).toBe('payments.refund_cash');
    expect(PERMISSION_PAYMENTS_REFUND_VIETQR).toBe('payments.refund_vietqr');
    expect(PERMISSION_PAYMENTS_REFUND_APPROVE).toBe('payments.refund.approve');
    expect(PERMISSION_PAYMENTS_REFUND_RECONCILE).toBe('payments.refund.reconcile');
  });

  /** Seed SUCCEEDED Payment + single PCE + single active allocation (qualifying = PCE). */
  async function seedCollectedPayment(opts?: {
    collectedMinor?: string;
    requestedMinor?: string;
    allocationMinor?: string;
    secondAllocation?: boolean;
    instrumentFamily?: string;
  }) {
    const collected = opts?.collectedMinor ?? '100000';
    const requested = opts?.requestedMinor ?? collected;
    const allocationMinor = opts?.allocationMinor ?? collected;
    const instrumentFamily = opts?.instrumentFamily ?? 'VIETQR';
    const orderId = randomUUID();
    const snapId = randomUUID();
    const groupId = randomUUID();
    const checkId = randomUUID();
    const tenderId = randomUUID();
    const paymentId = randomUUID();
    const outcomeId = randomUUID();
    const pceId = randomUUID();
    const actor = fx.actorId;

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
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        tenderId,
        fx.tenantId,
        fx.legalEntityId,
        `T-${randomUUID().slice(0, 8)}`,
        instrumentFamily,
        instrumentFamily,
      ],
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
        requested,
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
        allocationMinor,
        `alloc-${randomUUID()}`,
      ],
    );
    if (opts?.secondAllocation) {
      const check2 = randomUUID();
      await pool.query(
        `INSERT INTO settlement_check (
           settlement_check_id, settlement_group_id, tenant_id, state,
           customer_payable_minor, currency_code, minor_unit_exponent, check_number
         ) VALUES ($1,$2,$3,'SATISFIED','1','VND',0,2)`,
        [check2, groupId, fx.tenantId],
      );
      await pool.query(
        `INSERT INTO payment_allocation (
           payment_allocation_id, payment_id, settlement_check_id, settlement_group_id,
           tenant_id, legal_entity_id, amount_minor, currency_code, minor_unit_exponent,
           allocation_idempotency_key, active
         ) VALUES ($1,$2,$3,$4,$5,$6,'1','VND',0,$7,TRUE)`,
        [
          randomUUID(),
          paymentId,
          check2,
          groupId,
          fx.tenantId,
          fx.legalEntityId,
          `alloc2-${randomUUID()}`,
        ],
      );
    }
    await pool.query(
      `INSERT INTO payment_provider_outcome (
         payment_provider_outcome_id, payment_id, tenant_id, legal_entity_id,
         provider_event_identity, raw_provider_status, normalized_outcome,
         verification_status, reconciliation_origin, evidence_amount_minor,
         evidence_currency_code, collection_time_provenance
       ) VALUES ($1,$2,$3,$4,$5,'OK','SUCCEEDED','VERIFIED','DEV_SIMULATOR',$6,'VND','COLLECTION_OR_CAPTURE')`,
      [outcomeId, paymentId, fx.tenantId, fx.legalEntityId, `evt-${randomUUID()}`, collected],
    );
    await pool.query(
      `INSERT INTO payment_collection_event (
         payment_collection_event_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, instrument_family, collected_at,
         collection_evidence_kind, payment_provider_outcome_id,
         amount_collected_minor, currency_code, minor_unit_exponent
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'CARD_PROVIDER_COLLECTION',$8,$9,'VND',0)`,
      [
        pceId,
        paymentId,
        fx.tenantId,
        fx.legalEntityId,
        checkId,
        groupId,
        instrumentFamily,
        outcomeId,
        collected,
      ],
    );

    return { paymentId, checkId, tenderId, collected, actor };
  }

  it('authorize reserves; capacity uses PCE collected not requested', async () => {
    const seeded = await seedCollectedPayment({ collectedMinor: '50000' });
    const cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.qualifyingMinor).toBe('50000');
    expect(cap.remainingCapacityMinor).toBe('50000');

    const r = await refunds.authorizeAndReserve({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
      amountMinor: '20000',
      reasonText: 'partial guest return',
      refundIdempotencyKey: `k-${randomUUID()}`,
      authorizedByUserId: seeded.actor,
    });
    expect(r.financialStatus).toBe('AUTHORIZED');
    expect(r.reservationHoldsCapacity).toBe(true);

    const cap2 = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap2.activeReservationsMinor).toBe('20000');
    expect(cap2.remainingCapacityMinor).toBe('30000');
  });

  it('same-key replay returns existing; same-key semantic conflict fails', async () => {
    const seeded = await seedCollectedPayment();
    const key = `idem-${randomUUID()}`;
    const a = await refunds.authorizeAndReserve({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
      amountMinor: '10000',
      reasonText: 'r1',
      refundIdempotencyKey: key,
    });
    const b = await refunds.authorizeAndReserve({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
      amountMinor: '10000',
      reasonText: 'r1',
      refundIdempotencyKey: key,
    });
    expect(b.paymentRefundId).toBe(a.paymentRefundId);
    expect(b.duplicate).toBe(true);

    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: seeded.paymentId,
        settlementCheckId: seeded.checkId,
        outletId: fx.outletId,
        amountMinor: '10001',
        reasonText: 'r1',
        refundIdempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('16 parallel distinct keys respect total capacity; overflow rejected', async () => {
    const seeded = await seedCollectedPayment({ collectedMinor: '16000' });
    const ok = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        refunds.authorizeAndReserve({
          tenantId: fx.tenantId,
          legalEntityId: fx.legalEntityId,
          originalPaymentId: seeded.paymentId,
          settlementCheckId: seeded.checkId,
          outletId: fx.outletId,
          amountMinor: '1000',
          reasonText: `p-${i}`,
          refundIdempotencyKey: `par-${randomUUID()}`,
        }),
      ),
    );
    expect(ok).toHaveLength(16);
    const cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.remainingCapacityMinor).toBe('0');
    expect(cap.activeReservationsMinor).toBe('16000');

    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: seeded.paymentId,
        settlementCheckId: seeded.checkId,
        outletId: fx.outletId,
        amountMinor: '1',
        reasonText: 'overflow',
        refundIdempotencyKey: `ov-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_CAPACITY_EXCEEDED' });
  });

  it('concurrent create with shared capacity: at most capacity winners', async () => {
    const seeded = await seedCollectedPayment({ collectedMinor: '10000' });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        refunds.authorizeAndReserve({
          tenantId: fx.tenantId,
          legalEntityId: fx.legalEntityId,
          originalPaymentId: seeded.paymentId,
          settlementCheckId: seeded.checkId,
          outletId: fx.outletId,
          amountMinor: '2500',
          reasonText: 'race',
          refundIdempotencyKey: `race-${randomUUID()}`,
        }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(4);
    expect(rejected.length).toBe(4);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        code: 'REFUND_CAPACITY_EXCEEDED',
      });
    }
  });

  it('UNKNOWN holds reserve; FAILED without proof does not release; proven FAILED releases', async () => {
    const seeded = await seedCollectedPayment({ collectedMinor: '10000' });
    const r = await refunds.authorizeAndReserve({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
      amountMinor: '4000',
      reasonText: 'hold',
      refundIdempotencyKey: `u-${randomUUID()}`,
    });
    await refunds.beginExecutionPending(r.paymentRefundId);
    const unk = await refunds.markExecutionUnknown(r.paymentRefundId);
    expect(unk.financialStatus).toBe('EXECUTION_UNKNOWN');
    expect(unk.reservationHoldsCapacity).toBe(true);
    let cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.activeReservationsMinor).toBe('4000');

    const blocked = await refunds.markExecutionFailed(r.paymentRefundId, null);
    expect(blocked.financialStatus).toBe('RECONCILE_BLOCKED');
    expect(blocked.reservationHoldsCapacity).toBe(true);

    const failed = await refunds.markExecutionFailed(r.paymentRefundId, {
      evidenceKind: 'NON_PAYMENT_PROVEN',
      recordedByActorId: seeded.actor,
      payload: { note: 'never paid out' },
    });
    expect(failed.financialStatus).toBe('EXECUTION_FAILED');
    expect(failed.reservationHoldsCapacity).toBe(false);
    cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.activeReservationsMinor).toBe('0');
    expect(cap.remainingCapacityMinor).toBe('10000');
  });

  it('MONEY_RETURNED converts reservation without double-count; proof gate enforced', async () => {
    const seeded = await seedCollectedPayment({ collectedMinor: '10000' });
    const r = await refunds.authorizeAndReserve({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
      amountMinor: '3000',
      reasonText: 'confirm',
      refundIdempotencyKey: `m-${randomUUID()}`,
    });
    await refunds.beginExecutionPending(r.paymentRefundId);
    const done = await refunds.confirmMoneyReturned(r.paymentRefundId, {
      evidenceKind: DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
      recordedByActorId: seeded.actor,
    });
    expect(done.financialStatus).toBe('MONEY_RETURNED');
    expect(done.reservationHoldsCapacity).toBe(false);
    const replay = await refunds.confirmMoneyReturned(r.paymentRefundId, {
      evidenceKind: DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
      recordedByActorId: seeded.actor,
    });
    expect(replay.duplicate).toBe(true);

    const cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.confirmedRefundsMinor).toBe('3000');
    expect(cap.activeReservationsMinor).toBe('0');
    expect(cap.remainingCapacityMinor).toBe('7000');

    const locked = new RefundService(pool, { allowDisposableTestMoneyProof: false });
    await expect(
      locked.confirmMoneyReturned(r.paymentRefundId, {
        evidenceKind: DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
        recordedByActorId: seeded.actor,
      }),
    ).rejects.toMatchObject({ code: 'MONEY_EFFECT_EVIDENCE_FORBIDDEN' });
  });

  it('rejects wrong outlet / LE; ambiguous allocations; requested > collected', async () => {
    const seeded = await seedCollectedPayment();
    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: seeded.paymentId,
        settlementCheckId: seeded.checkId,
        outletId: otherOutletId,
        amountMinor: '1000',
        reasonText: 'wrong outlet',
        refundIdempotencyKey: `wo-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'OUTLET_MISMATCH' });

    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.otherLegalEntityId,
        originalPaymentId: seeded.paymentId,
        settlementCheckId: seeded.checkId,
        outletId: fx.outletId,
        amountMinor: '1000',
        reasonText: 'wrong le',
        refundIdempotencyKey: `le-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ENTITY' });

    const amb = await seedCollectedPayment({ secondAllocation: true });
    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: amb.paymentId,
        settlementCheckId: amb.checkId,
        outletId: fx.outletId,
        amountMinor: '1000',
        reasonText: 'amb',
        refundIdempotencyKey: `amb-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'ALLOCATION_AMBIGUOUS' });

    const over = await seedCollectedPayment({
      collectedMinor: '10000',
      requestedMinor: '15000',
    });
    await expect(
      refunds.getCapacity({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: over.paymentId,
        settlementCheckId: over.checkId,
        outletId: fx.outletId,
      }),
    ).rejects.toMatchObject({ code: 'REQUESTED_EXCEEDS_COLLECTED' });
  });

  it('failed authorize rolls back — no reservation row left', async () => {
    const seeded = await seedCollectedPayment({ collectedMinor: '5000' });
    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: seeded.paymentId,
        settlementCheckId: seeded.checkId,
        outletId: fx.outletId,
        amountMinor: '999999',
        reasonText: 'too big',
        refundIdempotencyKey: `rb-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    const cap = await refunds.getCapacity({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      originalPaymentId: seeded.paymentId,
      settlementCheckId: seeded.checkId,
      outletId: fx.outletId,
    });
    expect(cap.activeReservationsMinor).toBe('0');
    const count = await pool.query(
      `SELECT count(*)::int AS c FROM payment_refund WHERE original_payment_id = $1`,
      [seeded.paymentId],
    );
    expect(count.rows[0].c).toBe(0);
  });

  it('allocation amount ≠ collected fails closed', async () => {
    const seeded = await seedCollectedPayment({
      collectedMinor: '10000',
      allocationMinor: '9000',
    });
    await expect(
      refunds.authorizeAndReserve({
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        originalPaymentId: seeded.paymentId,
        settlementCheckId: seeded.checkId,
        outletId: fx.outletId,
        amountMinor: '1000',
        reasonText: 'mismatch',
        refundIdempotencyKey: `mm-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'ALLOCATION_AMBIGUOUS' });
  });
});
