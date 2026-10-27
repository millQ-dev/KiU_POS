import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  IdentityService,
  PERMISSION_PAYMENTS_REFUND_CASH,
  PERMISSION_POS_OPERATE,
  type AuthenticatedPrincipal,
} from '../identity/index.js';
import { DomainValidationError } from '../orders/errors.js';
import {
  addMinor,
  assertPositiveDigits,
  buildRefundSemanticFingerprint,
  cmpMinor,
  computeRemainingCapacity,
} from './refund-fingerprint.js';
import {
  ACTIVE_RESERVATION_STATUSES,
  CASH_HANDOVER_CONFIRM_EVIDENCE,
  DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
  type FinancialRefundStatus,
  type NonPaymentProofEvidence,
  type PaymentRefundProjection,
  type RefundCapacitySnapshot,
  type VerifiedMoneyEffectEvidence,
} from './refund-types.js';

type RefundRow = {
  payment_refund_id: string;
  tenant_id: string;
  legal_entity_id: string;
  original_payment_id: string;
  settlement_check_id: string;
  settlement_group_id: string;
  outlet_id: string;
  tender_definition_id: string;
  instrument_family: string;
  amount_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
  financial_status: FinancialRefundStatus;
  reservation_holds_capacity: boolean;
  non_payment_proven: boolean;
  refund_idempotency_key: string;
  semantic_fingerprint: string;
  reason_text: string;
  authorized_by_user_id: string | null;
  payout_attempt_id: string | null;
  cash_shift_id: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapRefund(r: RefundRow, duplicate?: boolean): PaymentRefundProjection {
  const base: PaymentRefundProjection = {
    paymentRefundId: r.payment_refund_id,
    tenantId: r.tenant_id,
    legalEntityId: r.legal_entity_id,
    originalPaymentId: r.original_payment_id,
    settlementCheckId: r.settlement_check_id,
    settlementGroupId: r.settlement_group_id,
    outletId: r.outlet_id,
    tenderDefinitionId: r.tender_definition_id,
    instrumentFamily: r.instrument_family,
    amountMinor: r.amount_minor,
    currencyCode: r.currency_code,
    minorUnitExponent: r.minor_unit_exponent,
    financialStatus: r.financial_status,
    reservationHoldsCapacity: r.reservation_holds_capacity,
    nonPaymentProven: r.non_payment_proven,
    refundIdempotencyKey: r.refund_idempotency_key,
    semanticFingerprint: r.semantic_fingerprint,
    reasonText: r.reason_text,
    authorizedByUserId: r.authorized_by_user_id,
    payoutAttemptId: r.payout_attempt_id,
    cashShiftId: r.cash_shift_id,
    confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
  if (duplicate === true) base.duplicate = true;
  return base;
}

export type RefundServiceOptions = {
  /**
   * When true, `confirmMoneyReturned` may accept DISPOSABLE_TEST_MONEY_EFFECT_PROOF.
   * Must stay false outside disposable test harnesses. Not a production payout path.
   */
  allowDisposableTestMoneyProof?: boolean;
  identity?: IdentityService;
};

/**
 * ADR-0048 refund reservation (B1) + CASH human handover confirmation (B2).
 * No public HTTP payout API. No fictitious MONEY_RETURNED without evidence gate.
 */
export class RefundService {
  constructor(
    private readonly pool: Pool,
    private readonly options: RefundServiceOptions = {},
  ) {}

  async getRefund(paymentRefundId: string): Promise<PaymentRefundProjection | null> {
    const r = await this.pool.query<RefundRow>(
      `SELECT * FROM payment_refund WHERE payment_refund_id = $1`,
      [paymentRefundId],
    );
    return r.rows[0] ? mapRefund(r.rows[0]) : null;
  }

  /**
   * Atomically authorize + reserve under Payment FOR UPDATE.
   * Same key + same fingerprint → replay. Same key + different semantics → IDEMPOTENCY_CONFLICT.
   */
  async authorizeAndReserve(input: {
    tenantId: string;
    legalEntityId: string;
    originalPaymentId: string;
    settlementCheckId: string;
    outletId: string;
    amountMinor: string;
    reasonText: string;
    refundIdempotencyKey: string;
    authorizedByUserId?: string | null;
  }): Promise<PaymentRefundProjection> {
    assertPositiveDigits('amountMinor', input.amountMinor);
    if (!input.reasonText.trim()) {
      throw new DomainValidationError('VALIDATION', 'reasonText required');
    }
    if (!input.refundIdempotencyKey.trim()) {
      throw new DomainValidationError('VALIDATION', 'refundIdempotencyKey required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock order: Payment (and related refunds) first — then idempotency row.
      const capacity = await this.loadQualifyingLocked(client, {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        originalPaymentId: input.originalPaymentId,
        settlementCheckId: input.settlementCheckId,
        outletId: input.outletId,
        lockPayment: true,
      });

      const existing = await client.query<RefundRow>(
        `SELECT * FROM payment_refund
         WHERE legal_entity_id = $1 AND refund_idempotency_key = $2
         FOR UPDATE`,
        [input.legalEntityId, input.refundIdempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        const requestFp = buildRefundSemanticFingerprint({
          originalPaymentId: input.originalPaymentId,
          settlementCheckId: input.settlementCheckId,
          amountMinor: input.amountMinor,
          currencyCode: capacity.currencyCode,
          minorUnitExponent: capacity.minorUnitExponent,
          outletId: input.outletId,
          tenderDefinitionId: capacity.tenderDefinitionId,
          instrumentFamily: capacity.instrumentFamily,
        });
        if (
          row.semantic_fingerprint !== requestFp ||
          row.original_payment_id !== input.originalPaymentId ||
          row.settlement_check_id !== input.settlementCheckId ||
          row.amount_minor !== input.amountMinor ||
          row.outlet_id !== input.outletId ||
          row.tenant_id !== input.tenantId ||
          row.legal_entity_id !== input.legalEntityId
        ) {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'Refund idempotency key reused with different semantics',
          );
        }
        await client.query('COMMIT');
        return mapRefund(row, true);
      }

      if (cmpMinor(input.amountMinor, capacity.remainingCapacityMinor) > 0) {
        throw new DomainValidationError(
          'REFUND_CAPACITY_EXCEEDED',
          `amount ${input.amountMinor} exceeds remaining_capacity ${capacity.remainingCapacityMinor}`,
        );
      }

      const fingerprint = buildRefundSemanticFingerprint({
        originalPaymentId: input.originalPaymentId,
        settlementCheckId: input.settlementCheckId,
        amountMinor: input.amountMinor,
        currencyCode: capacity.currencyCode,
        minorUnitExponent: capacity.minorUnitExponent,
        outletId: capacity.outletId,
        tenderDefinitionId: capacity.tenderDefinitionId,
        instrumentFamily: capacity.instrumentFamily,
      });

      const paymentRefundId = randomUUID();
      await client.query('SAVEPOINT refund_authorize_insert');
      try {
        await client.query(
          `INSERT INTO payment_refund (
             payment_refund_id, tenant_id, legal_entity_id, original_payment_id,
             settlement_check_id, settlement_group_id, outlet_id, tender_definition_id,
             instrument_family, amount_minor, currency_code, minor_unit_exponent,
             financial_status, reservation_holds_capacity, non_payment_proven,
             refund_idempotency_key, semantic_fingerprint, reason_text,
             authorized_by_user_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             'AUTHORIZED', TRUE, FALSE,
             $13,$14,$15,$16
           )`,
          [
            paymentRefundId,
            capacity.tenantId,
            capacity.legalEntityId,
            capacity.originalPaymentId,
            capacity.settlementCheckId,
            capacity.settlementGroupId,
            capacity.outletId,
            capacity.tenderDefinitionId,
            capacity.instrumentFamily,
            input.amountMinor,
            capacity.currencyCode,
            capacity.minorUnitExponent,
            input.refundIdempotencyKey,
            fingerprint,
            input.reasonText.trim(),
            input.authorizedByUserId ?? null,
          ],
        );
        await client.query('RELEASE SAVEPOINT refund_authorize_insert');
      } catch (e: unknown) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505') {
          // Aborted statement → must leave aborted subxact via ROLLBACK TO SAVEPOINT.
          await client.query('ROLLBACK TO SAVEPOINT refund_authorize_insert');
          const expectedConstraint =
            err.constraint == null ||
            String(err.constraint) === 'payment_refund_legal_entity_id_refund_idempotency_key_key';
          if (!expectedConstraint) throw e;
          const winner = await client.query<RefundRow>(
            `SELECT * FROM payment_refund
             WHERE legal_entity_id = $1 AND refund_idempotency_key = $2
             FOR UPDATE`,
            [input.legalEntityId, input.refundIdempotencyKey],
          );
          const row = winner.rows[0];
          if (!row) throw e;
          if (
            row.semantic_fingerprint !== fingerprint ||
            row.original_payment_id !== input.originalPaymentId ||
            row.settlement_check_id !== input.settlementCheckId ||
            row.amount_minor !== input.amountMinor ||
            row.outlet_id !== input.outletId ||
            row.tenant_id !== input.tenantId ||
            row.legal_entity_id !== input.legalEntityId
          ) {
            throw new DomainValidationError(
              'IDEMPOTENCY_CONFLICT',
              'Refund idempotency key reused with different semantics',
            );
          }
          await client.query('COMMIT');
          return mapRefund(row, true);
        }
        throw e;
      }

      await this.appendEvidence(client, {
        paymentRefundId,
        tenantId: capacity.tenantId,
        legalEntityId: capacity.legalEntityId,
        evidenceKind: 'AUTHORIZATION',
        fromStatus: null,
        toStatus: 'AUTHORIZED',
        recordedByActorId: input.authorizedByUserId ?? null,
        payload: {
          amountMinor: input.amountMinor,
          remainingCapacityAfter: computeRemainingCapacity({
            qualifyingMinor: capacity.qualifyingMinor,
            confirmedRefundsMinor: capacity.confirmedRefundsMinor,
            activeReservationsMinor: addMinor(
              capacity.activeReservationsMinor,
              input.amountMinor,
            ),
          }),
        },
      });

      const inserted = await client.query<RefundRow>(
        `SELECT * FROM payment_refund WHERE payment_refund_id = $1`,
        [paymentRefundId],
      );
      await client.query('COMMIT');
      return mapRefund(inserted.rows[0]!);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async beginExecutionPending(paymentRefundId: string): Promise<PaymentRefundProjection> {
    return this.transitionHolding(paymentRefundId, 'AUTHORIZED', 'EXECUTION_PENDING', true);
  }

  async markExecutionUnknown(paymentRefundId: string): Promise<PaymentRefundProjection> {
    return this.transitionHolding(
      paymentRefundId,
      ['EXECUTION_PENDING', 'AUTHORIZED'],
      'EXECUTION_UNKNOWN',
      true,
    );
  }

  async markReconcileBlocked(paymentRefundId: string): Promise<PaymentRefundProjection> {
    return this.transitionHolding(
      paymentRefundId,
      ['EXECUTION_PENDING', 'EXECUTION_UNKNOWN', 'AUTHORIZED'],
      'RECONCILE_BLOCKED',
      true,
    );
  }

  /**
   * FAILED releases capacity only with proven non-payment evidence.
   * Without proof → RECONCILE_BLOCKED (reserve held).
   */
  async markExecutionFailed(
    paymentRefundId: string,
    proof: NonPaymentProofEvidence | null,
  ): Promise<PaymentRefundProjection> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lockRefund(client, paymentRefundId);
      if (!ACTIVE_RESERVATION_STATUSES.has(row.financial_status) && row.financial_status !== 'EXECUTION_FAILED') {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          `Cannot fail from ${row.financial_status}`,
        );
      }
      if (row.financial_status === 'EXECUTION_FAILED') {
        await client.query('COMMIT');
        return mapRefund(row, true);
      }
      if (!proof || proof.evidenceKind !== 'NON_PAYMENT_PROVEN') {
        await this.applyStatus(client, row, 'RECONCILE_BLOCKED', {
          reservationHoldsCapacity: true,
          nonPaymentProven: false,
          evidenceKind: 'FAILED_WITHOUT_PROOF',
          recordedByActorId: proof?.recordedByActorId ?? null,
          payload: { note: 'reserve held until proven non-payment' },
        });
        const blocked = await this.lockRefund(client, paymentRefundId);
        await client.query('COMMIT');
        return mapRefund(blocked);
      }
      await this.ensureAttempt(client, row, 'EXECUTION_FAILED');
      await this.applyStatus(client, row, 'EXECUTION_FAILED', {
        reservationHoldsCapacity: false,
        nonPaymentProven: true,
        evidenceKind: 'NON_PAYMENT_PROVEN',
        recordedByActorId: proof.recordedByActorId,
        payload: proof.payload ?? {},
      });
      const failed = await this.lockRefund(client, paymentRefundId);
      await client.query('COMMIT');
      return mapRefund(failed);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Convert reservation → MONEY_RETURNED atomically. Requires verified evidence.
   * Disposable test proof only when `allowDisposableTestMoneyProof` is enabled.
   * CASH instrument family must use `confirmCashHandover` (no disposable proof path).
   */
  async confirmMoneyReturned(
    paymentRefundId: string,
    evidence: VerifiedMoneyEffectEvidence,
  ): Promise<PaymentRefundProjection> {
    if (evidence.evidenceKind !== DISPOSABLE_TEST_MONEY_EFFECT_PROOF) {
      throw new DomainValidationError(
        'MONEY_EFFECT_EVIDENCE_REQUIRED',
        'Unsupported money-effect evidence kind for B1',
      );
    }
    if (!evidence.recordedByActorId) {
      throw new DomainValidationError('VALIDATION', 'recordedByActorId required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock order matches authorize: Payment first, then refund row (avoid deadlock).
      const peek = await client.query<{ original_payment_id: string; instrument_family: string }>(
        `SELECT original_payment_id, instrument_family FROM payment_refund WHERE payment_refund_id = $1`,
        [paymentRefundId],
      );
      if (!peek.rows[0]) throw new DomainValidationError('NOT_FOUND', 'PaymentRefund not found');
      // CASH never accepts disposable proof — even if the test harness flag is on.
      if (peek.rows[0].instrument_family.toUpperCase() === 'CASH') {
        throw new DomainValidationError(
          'CASH_HANDOVER_REQUIRED',
          'CASH refunds require confirmCashHandover (no disposable money-effect proof)',
        );
      }
      if (!this.options.allowDisposableTestMoneyProof) {
        throw new DomainValidationError(
          'MONEY_EFFECT_EVIDENCE_FORBIDDEN',
          'Disposable test money-effect proof is disabled (no fictitious MONEY_RETURNED)',
        );
      }
      await client.query(`SELECT payment_id FROM payment WHERE payment_id = $1 FOR UPDATE`, [
        peek.rows[0].original_payment_id,
      ]);
      const row = await this.lockRefund(client, paymentRefundId);
      if (row.financial_status === 'MONEY_RETURNED') {
        await client.query('COMMIT');
        return mapRefund(row, true);
      }
      if (!row.reservation_holds_capacity || !ACTIVE_RESERVATION_STATUSES.has(row.financial_status)) {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          `Cannot confirm money returned from ${row.financial_status}`,
        );
      }
      if (row.financial_status === 'EXECUTION_UNKNOWN' || row.financial_status === 'RECONCILE_BLOCKED') {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          `${row.financial_status} forbids automatic money-return confirmation`,
        );
      }
      await this.ensureAttempt(client, row, 'MONEY_RETURNED');
      const clock = await client.query<{ now: Date }>(`SELECT NOW() AS now`);
      const confirmedAt = clock.rows[0]!.now;
      await client.query(
        `UPDATE payment_refund SET
           financial_status = 'MONEY_RETURNED',
           reservation_holds_capacity = FALSE,
           confirmed_at = $2,
           updated_at = $2
         WHERE payment_refund_id = $1`,
        [paymentRefundId, confirmedAt],
      );
      if (row.payout_attempt_id) {
        await client.query(
          `UPDATE payment_refund_payout_attempt SET status = 'MONEY_RETURNED', updated_at = $2
           WHERE payout_attempt_id = $1`,
          [row.payout_attempt_id, confirmedAt],
        );
      }
      await this.appendEvidence(client, {
        paymentRefundId,
        tenantId: row.tenant_id,
        legalEntityId: row.legal_entity_id,
        evidenceKind: DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
        fromStatus: row.financial_status,
        toStatus: 'MONEY_RETURNED',
        recordedByActorId: evidence.recordedByActorId,
        payload: evidence.payload ?? {},
      });
      const done = await this.lockRefund(client, paymentRefundId);
      await client.query('COMMIT');
      return mapRefund(done);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * C0-REFUND-B2 — human CASH handover confirmation.
   * Flow: AUTHORIZED → EXECUTION_PENDING → confirmCashHandover → MONEY_RETURNED.
   *
   * Lock order (compatible with CloseCashShift):
   *   1) cash_shift FOR UPDATE
   *   2) payment FOR UPDATE
   *   3) payment_refund FOR UPDATE
   * Close takes cash_shift FOR UPDATE then payment_refund FOR SHARE — same CashShift-first order.
   *
   * Expected cash decreases once at Close via Σ MONEY_RETURNED CASH bound to cash_shift_id.
   * No CashDrawerMovement twin. No disposable proof in production path.
   */
  async confirmCashHandover(input: {
    paymentRefundId: string;
    cashShiftId: string;
    amountMinor: string;
    currencyCode: string;
    minorUnitExponent: number;
    outletId: string;
    confirmIdempotencyKey: string;
    humanConfirmation: true;
    principal: AuthenticatedPrincipal;
  }): Promise<PaymentRefundProjection> {
    if (input.humanConfirmation !== true) {
      throw new DomainValidationError(
        'HUMAN_CONFIRMATION_REQUIRED',
        'CASH handover requires explicit humanConfirmation=true (actual cash handed to guest)',
      );
    }
    assertPositiveDigits('amountMinor', input.amountMinor);
    if (!input.confirmIdempotencyKey.trim()) {
      throw new DomainValidationError('VALIDATION', 'confirmIdempotencyKey required');
    }
    if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
      throw new DomainValidationError('VALIDATION', 'currencyCode must be ISO-4217 alpha-3');
    }
    if (input.minorUnitExponent < 0 || input.minorUnitExponent > 4) {
      throw new DomainValidationError('VALIDATION', 'minorUnitExponent out of range');
    }
    const identity = this.options.identity;
    if (!identity) {
      throw new DomainValidationError(
        'IDENTITY_REQUIRED',
        'RefundService requires IdentityService for CASH handover confirmation',
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1) CashShift first — serialize vs Close / concurrent confirm on same drawer.
      const shiftRes = await client.query<{
        cash_shift_id: string;
        tenant_id: string;
        outlet_id: string;
        terminal_id: string;
        status: string;
        currency_code: string;
        minor_unit_exponent: number;
      }>(
        `SELECT cash_shift_id, tenant_id, outlet_id, terminal_id, status,
                currency_code, minor_unit_exponent
         FROM cash_shift
         WHERE cash_shift_id = $1
         FOR UPDATE`,
        [input.cashShiftId],
      );
      const shift = shiftRes.rows[0];
      if (!shift) throw new DomainValidationError('NOT_FOUND', 'CashShift not found');
      if (shift.status === 'CLOSED') {
        throw new DomainValidationError(
          'CASH_SHIFT_ALREADY_CLOSED',
          'CLOSED CashShift cannot be mutated for CASH refund payout',
        );
      }
      if (shift.status !== 'OPEN') {
        throw new DomainValidationError(
          'CASH_SHIFT_NOT_OPEN',
          `CashShift status ${shift.status} cannot confirm CASH handover`,
        );
      }
      if (shift.tenant_id !== input.principal.tenantId) {
        throw new DomainValidationError('CROSS_ENTITY', 'CashShift tenant mismatch');
      }
      if (shift.outlet_id !== input.outletId) {
        throw new DomainValidationError(
          'OUTLET_MISMATCH',
          'CashShift outlet must equal confirmation outlet (sale outlet)',
        );
      }
      if (
        shift.currency_code !== input.currencyCode ||
        shift.minor_unit_exponent !== input.minorUnitExponent
      ) {
        throw new DomainValidationError(
          'CURRENCY_MISMATCH',
          'Confirmation currency/exponent must match OPEN CashShift',
        );
      }

      const posOk = await identity.hasPermission(
        client,
        input.principal.tenantId,
        input.principal.userId,
        PERMISSION_POS_OPERATE,
        shift.outlet_id,
        shift.terminal_id,
      );
      const cashOk = await identity.hasPermission(
        client,
        input.principal.tenantId,
        input.principal.userId,
        PERMISSION_PAYMENTS_REFUND_CASH,
        shift.outlet_id,
        shift.terminal_id,
      );
      if (!posOk || !cashOk) {
        throw new DomainValidationError('FORBIDDEN', 'Permission denied for CASH refund handover');
      }

      // Idempotent confirm by LE + key (before mutating refund).
      const priorHandover = await client.query<{
        payment_refund_id: string;
        amount_minor: string;
        cash_shift_id: string;
        confirmed_by_user_id: string;
      }>(
        `SELECT payment_refund_id, amount_minor, cash_shift_id, confirmed_by_user_id
         FROM payment_refund_cash_handover_evidence
         WHERE legal_entity_id = (
           SELECT legal_entity_id FROM payment_refund WHERE payment_refund_id = $1
         )
           AND confirm_idempotency_key = $2
         FOR SHARE`,
        [input.paymentRefundId, input.confirmIdempotencyKey],
      );
      if (priorHandover.rows[0]) {
        const h = priorHandover.rows[0];
        if (
          h.payment_refund_id !== input.paymentRefundId ||
          h.amount_minor !== input.amountMinor ||
          h.cash_shift_id !== input.cashShiftId ||
          h.confirmed_by_user_id !== input.principal.userId
        ) {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'confirmIdempotencyKey reused with different CASH handover semantics',
          );
        }
        const replay = await this.lockRefund(client, input.paymentRefundId);
        await client.query('COMMIT');
        return mapRefund(replay, true);
      }

      // 2) Payment then 3) Refund — capacity / status under Payment lock.
      const peek = await client.query<{
        original_payment_id: string;
        tenant_id: string;
        legal_entity_id: string;
      }>(
        `SELECT original_payment_id, tenant_id, legal_entity_id
         FROM payment_refund WHERE payment_refund_id = $1`,
        [input.paymentRefundId],
      );
      if (!peek.rows[0]) throw new DomainValidationError('NOT_FOUND', 'PaymentRefund not found');
      if (peek.rows[0].tenant_id !== input.principal.tenantId) {
        throw new DomainValidationError('CROSS_ENTITY', 'Principal tenant mismatch');
      }
      if (peek.rows[0].tenant_id !== shift.tenant_id) {
        throw new DomainValidationError('CROSS_ENTITY', 'CashShift tenant mismatch');
      }

      await client.query(`SELECT payment_id FROM payment WHERE payment_id = $1 FOR UPDATE`, [
        peek.rows[0].original_payment_id,
      ]);
      const row = await this.lockRefund(client, input.paymentRefundId);

      if (row.financial_status === 'MONEY_RETURNED') {
        if (row.cash_shift_id === input.cashShiftId && row.amount_minor === input.amountMinor) {
          await client.query('COMMIT');
          return mapRefund(row, true);
        }
        throw new DomainValidationError(
          'REFUND_ALREADY_RETURNED',
          'Refund already MONEY_RETURNED under a different confirmation',
        );
      }
      if (row.financial_status === 'EXECUTION_UNKNOWN' || row.financial_status === 'RECONCILE_BLOCKED') {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          `${row.financial_status} forbids CASH handover confirmation (no automatic re-payout)`,
        );
      }
      if (row.financial_status !== 'EXECUTION_PENDING') {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          `CASH handover requires EXECUTION_PENDING; got ${row.financial_status}`,
        );
      }
      if (!row.reservation_holds_capacity) {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          'Refund reservation no longer holds capacity',
        );
      }
      if (row.instrument_family.toUpperCase() !== 'CASH') {
        throw new DomainValidationError(
          'TENDER_MISMATCH',
          'confirmCashHandover is only for CASH instrument family',
        );
      }
      if (row.outlet_id !== input.outletId || row.outlet_id !== shift.outlet_id) {
        throw new DomainValidationError(
          'OUTLET_MISMATCH',
          'Refund outlet must equal sale outlet and CashShift outlet',
        );
      }
      if (row.legal_entity_id !== peek.rows[0]!.legal_entity_id) {
        throw new DomainValidationError('CROSS_ENTITY', 'Refund LegalEntity inconsistent');
      }
      if (row.tenant_id !== input.principal.tenantId) {
        throw new DomainValidationError('CROSS_ENTITY', 'Refund tenant mismatch');
      }
      if (
        row.amount_minor !== input.amountMinor ||
        row.currency_code !== input.currencyCode ||
        row.minor_unit_exponent !== input.minorUnitExponent
      ) {
        throw new DomainValidationError(
          'AMOUNT_MISMATCH',
          'Confirmation amount/currency must exactly equal Refund',
        );
      }

      const attemptId = await this.ensureAttempt(client, row, 'MONEY_RETURNED');
      const clock = await client.query<{ now: Date }>(`SELECT NOW() AS now`);
      const confirmedAt = clock.rows[0]!.now;

      await client.query(
        `UPDATE payment_refund SET
           financial_status = 'MONEY_RETURNED',
           reservation_holds_capacity = FALSE,
           cash_shift_id = $2,
           confirmed_at = $3,
           updated_at = $3
         WHERE payment_refund_id = $1
           AND financial_status = 'EXECUTION_PENDING'
           AND reservation_holds_capacity = TRUE`,
        [input.paymentRefundId, input.cashShiftId, confirmedAt],
      );
      const updated = await client.query<{ financial_status: string }>(
        `SELECT financial_status FROM payment_refund WHERE payment_refund_id = $1`,
        [input.paymentRefundId],
      );
      if (updated.rows[0]?.financial_status !== 'MONEY_RETURNED') {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          'Concurrent transition prevented CASH handover confirmation',
        );
      }

      await client.query(
        `UPDATE payment_refund_payout_attempt SET status = 'MONEY_RETURNED', updated_at = $2
         WHERE payout_attempt_id = $1`,
        [attemptId, confirmedAt],
      );

      await client.query('SAVEPOINT cash_handover_evidence');
      try {
        await client.query(
          `INSERT INTO payment_refund_cash_handover_evidence (
             payment_refund_cash_handover_evidence_id, payment_refund_id, payout_attempt_id,
             tenant_id, legal_entity_id, original_payment_id,
             amount_minor, currency_code, minor_unit_exponent,
             outlet_id, cash_shift_id, confirmed_by_user_id, confirmed_at,
             human_confirmation, confirm_idempotency_key
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14)`,
          [
            randomUUID(),
            input.paymentRefundId,
            attemptId,
            row.tenant_id,
            row.legal_entity_id,
            row.original_payment_id,
            row.amount_minor,
            row.currency_code,
            row.minor_unit_exponent,
            row.outlet_id,
            input.cashShiftId,
            input.principal.userId,
            confirmedAt,
            input.confirmIdempotencyKey,
          ],
        );
        await client.query('RELEASE SAVEPOINT cash_handover_evidence');
      } catch (e: unknown) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505') {
          await client.query('ROLLBACK TO SAVEPOINT cash_handover_evidence');
          // Unique on payment_refund_id or confirm key — treat as concurrent duplicate if same semantics.
          const existing = await client.query<{
            payment_refund_id: string;
            amount_minor: string;
            cash_shift_id: string;
            confirmed_by_user_id: string;
          }>(
            `SELECT payment_refund_id, amount_minor, cash_shift_id, confirmed_by_user_id
             FROM payment_refund_cash_handover_evidence
             WHERE payment_refund_id = $1`,
            [input.paymentRefundId],
          );
          const h = existing.rows[0];
          if (
            h &&
            h.amount_minor === input.amountMinor &&
            h.cash_shift_id === input.cashShiftId &&
            h.confirmed_by_user_id === input.principal.userId
          ) {
            const doneDup = await this.lockRefund(client, input.paymentRefundId);
            await client.query('COMMIT');
            return mapRefund(doneDup, true);
          }
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'CASH handover evidence conflict',
          );
        }
        throw e;
      }

      await this.appendEvidence(client, {
        paymentRefundId: input.paymentRefundId,
        tenantId: row.tenant_id,
        legalEntityId: row.legal_entity_id,
        evidenceKind: CASH_HANDOVER_CONFIRM_EVIDENCE,
        fromStatus: 'EXECUTION_PENDING',
        toStatus: 'MONEY_RETURNED',
        recordedByActorId: input.principal.userId,
        payload: {
          cashShiftId: input.cashShiftId,
          payoutAttemptId: attemptId,
          amountMinor: row.amount_minor,
          currencyCode: row.currency_code,
          outletId: row.outlet_id,
          humanConfirmation: true,
          confirmIdempotencyKey: input.confirmIdempotencyKey,
        },
      });

      // Re-assert shift still OPEN under same FOR UPDATE (concurrent close cannot have slipped).
      const shiftAfter = await client.query<{ status: string }>(
        `SELECT status FROM cash_shift WHERE cash_shift_id = $1`,
        [input.cashShiftId],
      );
      if (shiftAfter.rows[0]?.status !== 'OPEN') {
        throw new DomainValidationError(
          'CASH_SHIFT_ALREADY_CLOSED',
          'CashShift closed during CASH handover confirmation',
        );
      }

      const done = await this.lockRefund(client, input.paymentRefundId);
      await client.query('COMMIT');
      return mapRefund(done);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async getCapacity(input: {
    tenantId: string;
    legalEntityId: string;
    originalPaymentId: string;
    settlementCheckId: string;
    outletId: string;
  }): Promise<RefundCapacitySnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const snap = await this.loadQualifyingLocked(client, { ...input, lockPayment: true });
      await client.query('COMMIT');
      return snap;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadQualifyingLocked(
    client: PoolClient,
    input: {
      tenantId: string;
      legalEntityId: string;
      originalPaymentId: string;
      settlementCheckId: string;
      outletId: string;
      lockPayment: boolean;
    },
  ): Promise<RefundCapacitySnapshot> {
    const pay = await client.query<{
      payment_id: string;
      tenant_id: string;
      legal_entity_id: string;
      tender_definition_id: string;
      currency_code: string;
      minor_unit_exponent: number;
      requested_amount_minor: string;
      lifecycle_state: string;
      intended_settlement_check_id: string | null;
    }>(
      `SELECT payment_id, tenant_id, legal_entity_id, tender_definition_id,
              currency_code, minor_unit_exponent, requested_amount_minor,
              lifecycle_state, intended_settlement_check_id
       FROM payment WHERE payment_id = $1 ${input.lockPayment ? 'FOR UPDATE' : ''}`,
      [input.originalPaymentId],
    );
    const p = pay.rows[0];
    if (!p) throw new DomainValidationError('NOT_FOUND', 'Payment not found');
    if (p.tenant_id !== input.tenantId || p.legal_entity_id !== input.legalEntityId) {
      throw new DomainValidationError('CROSS_ENTITY', 'Payment tenant/LegalEntity mismatch');
    }
    if (p.lifecycle_state !== 'SUCCEEDED') {
      throw new DomainValidationError(
        'PAYMENT_NOT_SUCCEEDED',
        'Refund requires SUCCEEDED Payment',
      );
    }
    if (
      p.intended_settlement_check_id != null &&
      p.intended_settlement_check_id !== input.settlementCheckId
    ) {
      throw new DomainValidationError(
        'SETTLEMENT_MISMATCH',
        'Payment intended SettlementCheck does not match refund target',
      );
    }

    const tender = await client.query<{
      tender_definition_id: string;
      instrument_family: string | null;
      tenant_id: string;
      legal_entity_id: string;
    }>(`SELECT * FROM tender_definition WHERE tender_definition_id = $1`, [
      p.tender_definition_id,
    ]);
    const t = tender.rows[0];
    if (!t) throw new DomainValidationError('NOT_FOUND', 'TenderDefinition not found');
    if (t.tenant_id !== p.tenant_id || t.legal_entity_id !== p.legal_entity_id) {
      throw new DomainValidationError('CROSS_ENTITY', 'TenderDefinition scope mismatch');
    }
    const instrumentFamily = (t.instrument_family ?? '').trim();
    if (!instrumentFamily) {
      throw new DomainValidationError('TENDER_AMBIGUOUS', 'Tender instrument_family required');
    }

    const allocs = await client.query<{
      payment_allocation_id: string;
      settlement_check_id: string;
      settlement_group_id: string;
      amount_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
    }>(
      `SELECT payment_allocation_id, settlement_check_id, settlement_group_id,
              amount_minor, currency_code, minor_unit_exponent
       FROM payment_allocation
       WHERE payment_id = $1 AND active = TRUE
       FOR UPDATE`,
      [input.originalPaymentId],
    );
    if (allocs.rows.length !== 1) {
      throw new DomainValidationError(
        'ALLOCATION_AMBIGUOUS',
        `Expected exactly one active PaymentAllocation; found ${allocs.rows.length}`,
      );
    }
    const alloc = allocs.rows[0]!;
    if (alloc.settlement_check_id !== input.settlementCheckId) {
      throw new DomainValidationError(
        'SETTLEMENT_MISMATCH',
        'Allocation SettlementCheck does not match refund target',
      );
    }

    const pce = await client.query<{
      payment_collection_event_id: string;
      settlement_check_id: string;
      amount_collected_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
      instrument_family: string;
    }>(
      `SELECT payment_collection_event_id, settlement_check_id, amount_collected_minor,
              currency_code, minor_unit_exponent, instrument_family
       FROM payment_collection_event
       WHERE payment_id = $1
       FOR UPDATE`,
      [input.originalPaymentId],
    );
    if (pce.rows.length !== 1) {
      throw new DomainValidationError(
        'COLLECTION_AMBIGUOUS',
        `Expected exactly one PaymentCollectionEvent; found ${pce.rows.length}`,
      );
    }
    const collected = pce.rows[0]!;
    if (collected.settlement_check_id !== input.settlementCheckId) {
      throw new DomainValidationError(
        'SETTLEMENT_MISMATCH',
        'PCE SettlementCheck does not match refund target',
      );
    }
    if (
      collected.currency_code !== p.currency_code ||
      collected.minor_unit_exponent !== p.minor_unit_exponent ||
      alloc.currency_code !== p.currency_code ||
      alloc.minor_unit_exponent !== p.minor_unit_exponent
    ) {
      throw new DomainValidationError('CURRENCY_MISMATCH', 'Payment/PCE/allocation currency mismatch');
    }
    // Qualifying = confirmed collected amount (PCE), NEVER requested_amount_minor alone.
    const qualifying = collected.amount_collected_minor;
    if (cmpMinor(alloc.amount_minor, qualifying) !== 0) {
      throw new DomainValidationError(
        'ALLOCATION_AMBIGUOUS',
        'Active allocation amount does not equal confirmed collected amount',
      );
    }
    // requested_amount_minor is never qualifying. If it exceeds confirmed collected, fail closed
    // so operators cannot treat requested as money-in-hand for refund capacity.
    if (cmpMinor(p.requested_amount_minor, qualifying) > 0) {
      throw new DomainValidationError(
        'REQUESTED_EXCEEDS_COLLECTED',
        'Payment.requested_amount_minor exceeds confirmed PaymentCollectionEvent; refund capacity fail closed',
      );
    }

    const orderOutlet = await client.query<{ outlet_id: string; tenant_id: string; legal_entity_id: string }>(
      `SELECT so.outlet_id, so.tenant_id, so.legal_entity_id
       FROM settlement_check sc
       INNER JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
       INNER JOIN sales_order so ON so.order_id = sg.order_id
       WHERE sc.settlement_check_id = $1
       FOR SHARE`,
      [input.settlementCheckId],
    );
    const oo = orderOutlet.rows[0];
    if (!oo) throw new DomainValidationError('NOT_FOUND', 'SettlementCheck/Order not found');
    if (oo.tenant_id !== input.tenantId || oo.legal_entity_id !== input.legalEntityId) {
      throw new DomainValidationError('CROSS_ENTITY', 'Order tenant/LegalEntity mismatch');
    }
    if (oo.outlet_id !== input.outletId) {
      throw new DomainValidationError(
        'OUTLET_MISMATCH',
        'Refund outlet must equal original sale Outlet',
      );
    }

    // Interview #37: tender path identity from original payment tender
    if (collected.instrument_family.trim().toUpperCase() !== instrumentFamily.toUpperCase()) {
      throw new DomainValidationError(
        'TENDER_MISMATCH',
        'PCE instrument_family must match TenderDefinition',
      );
    }

    const prior = await client.query<{
      amount_minor: string;
      financial_status: FinancialRefundStatus;
      reservation_holds_capacity: boolean;
    }>(
      `SELECT amount_minor, financial_status, reservation_holds_capacity
       FROM payment_refund
       WHERE original_payment_id = $1
       FOR UPDATE`,
      [input.originalPaymentId],
    );
    let confirmed = '0';
    let reserved = '0';
    for (const pr of prior.rows) {
      if (pr.financial_status === 'MONEY_RETURNED') {
        confirmed = addMinor(confirmed, pr.amount_minor);
      }
      if (pr.reservation_holds_capacity) {
        reserved = addMinor(reserved, pr.amount_minor);
      }
    }
    const remaining = computeRemainingCapacity({
      qualifyingMinor: qualifying,
      confirmedRefundsMinor: confirmed,
      activeReservationsMinor: reserved,
    });

    return {
      originalPaymentId: input.originalPaymentId,
      settlementCheckId: input.settlementCheckId,
      settlementGroupId: alloc.settlement_group_id,
      qualifyingMinor: qualifying,
      confirmedRefundsMinor: confirmed,
      activeReservationsMinor: reserved,
      remainingCapacityMinor: remaining,
      currencyCode: p.currency_code,
      minorUnitExponent: p.minor_unit_exponent,
      outletId: oo.outlet_id,
      tenderDefinitionId: p.tender_definition_id,
      instrumentFamily,
      tenantId: p.tenant_id,
      legalEntityId: p.legal_entity_id,
    };
  }

  private async lockRefund(client: PoolClient, paymentRefundId: string): Promise<RefundRow> {
    const r = await client.query<RefundRow>(
      `SELECT * FROM payment_refund WHERE payment_refund_id = $1 FOR UPDATE`,
      [paymentRefundId],
    );
    if (!r.rows[0]) throw new DomainValidationError('NOT_FOUND', 'PaymentRefund not found');
    return r.rows[0];
  }

  private async transitionHolding(
    paymentRefundId: string,
    from: FinancialRefundStatus | FinancialRefundStatus[],
    to: FinancialRefundStatus,
    createAttempt: boolean,
  ): Promise<PaymentRefundProjection> {
    const allowed = new Set(Array.isArray(from) ? from : [from]);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lockRefund(client, paymentRefundId);
      if (row.financial_status === to) {
        await client.query('COMMIT');
        return mapRefund(row, true);
      }
      if (!allowed.has(row.financial_status)) {
        throw new DomainValidationError(
          'REFUND_STATUS_INVALID',
          `Cannot transition ${row.financial_status} → ${to}`,
        );
      }
      if (!ACTIVE_RESERVATION_STATUSES.has(to)) {
        throw new DomainValidationError('REFUND_STATUS_INVALID', `Target ${to} is not holding`);
      }
      if (createAttempt && to === 'EXECUTION_PENDING') {
        await this.ensureAttempt(client, row, 'EXECUTION_PENDING');
      } else if (row.payout_attempt_id) {
        await client.query(
          `UPDATE payment_refund_payout_attempt SET status = $2, updated_at = NOW()
           WHERE payout_attempt_id = $1`,
          [row.payout_attempt_id, to],
        );
      }
      await this.applyStatus(client, row, to, {
        reservationHoldsCapacity: true,
        nonPaymentProven: false,
        evidenceKind: `TRANSITION_${to}`,
        recordedByActorId: null,
        payload: {},
      });
      const next = await this.lockRefund(client, paymentRefundId);
      await client.query('COMMIT');
      return mapRefund(next);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async ensureAttempt(
    client: PoolClient,
    row: RefundRow,
    status: 'EXECUTION_PENDING' | 'EXECUTION_UNKNOWN' | 'RECONCILE_BLOCKED' | 'EXECUTION_FAILED' | 'MONEY_RETURNED',
  ): Promise<string> {
    if (row.payout_attempt_id) {
      await client.query(
        `UPDATE payment_refund_payout_attempt SET status = $2, updated_at = NOW()
         WHERE payout_attempt_id = $1`,
        [row.payout_attempt_id, status],
      );
      return row.payout_attempt_id;
    }
    const attemptId = randomUUID();
    await client.query(
      `INSERT INTO payment_refund_payout_attempt (
         payout_attempt_id, payment_refund_id, tenant_id, legal_entity_id,
         attempt_number, status
       ) VALUES ($1,$2,$3,$4,1,$5)`,
      [attemptId, row.payment_refund_id, row.tenant_id, row.legal_entity_id, status],
    );
    await client.query(
      `UPDATE payment_refund SET payout_attempt_id = $2, updated_at = NOW()
       WHERE payment_refund_id = $1`,
      [row.payment_refund_id, attemptId],
    );
    row.payout_attempt_id = attemptId;
    return attemptId;
  }

  private async applyStatus(
    client: PoolClient,
    row: RefundRow,
    to: FinancialRefundStatus,
    opts: {
      reservationHoldsCapacity: boolean;
      nonPaymentProven: boolean;
      evidenceKind: string;
      recordedByActorId: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE payment_refund SET
         financial_status = $2,
         reservation_holds_capacity = $3,
         non_payment_proven = $4,
         updated_at = NOW()
       WHERE payment_refund_id = $1`,
      [row.payment_refund_id, to, opts.reservationHoldsCapacity, opts.nonPaymentProven],
    );
    await this.appendEvidence(client, {
      paymentRefundId: row.payment_refund_id,
      tenantId: row.tenant_id,
      legalEntityId: row.legal_entity_id,
      evidenceKind: opts.evidenceKind,
      fromStatus: row.financial_status,
      toStatus: to,
      recordedByActorId: opts.recordedByActorId,
      payload: opts.payload,
    });
  }

  private async appendEvidence(
    client: PoolClient,
    input: {
      paymentRefundId: string;
      tenantId: string;
      legalEntityId: string;
      evidenceKind: string;
      fromStatus: string | null;
      toStatus: string | null;
      recordedByActorId: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_refund_evidence (
         payment_refund_evidence_id, payment_refund_id, tenant_id, legal_entity_id,
         evidence_kind, from_status, to_status, payload, recorded_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        randomUUID(),
        input.paymentRefundId,
        input.tenantId,
        input.legalEntityId,
        input.evidenceKind,
        input.fromStatus,
        input.toStatus,
        JSON.stringify(input.payload),
        input.recordedByActorId,
      ],
    );
  }
}
