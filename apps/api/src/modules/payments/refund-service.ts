import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
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
  DISPOSABLE_TEST_MONEY_EFFECT_PROOF,
  type FinancialRefundStatus,
  type NonPaymentProofEvidence,
  type PaymentRefundProjection,
  type RefundCapacitySnapshot,
  type VerifiedMoneyEffectEvidence,
} from './refund-types.js';

type Queryable = Pool | PoolClient;

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
};

/**
 * C0-REFUND-B1 — reservation + financial invariants (ADR-0048).
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
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code === '23505') {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'Concurrent refund idempotency insert conflict',
          );
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
    if (!this.options.allowDisposableTestMoneyProof) {
      throw new DomainValidationError(
        'MONEY_EFFECT_EVIDENCE_FORBIDDEN',
        'Disposable test money-effect proof is disabled (no fictitious MONEY_RETURNED)',
      );
    }
    if (!evidence.recordedByActorId) {
      throw new DomainValidationError('VALIDATION', 'recordedByActorId required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
      // Re-lock payment to prevent double confirmed effect under races
      await client.query(`SELECT payment_id FROM payment WHERE payment_id = $1 FOR UPDATE`, [
        row.original_payment_id,
      ]);
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
