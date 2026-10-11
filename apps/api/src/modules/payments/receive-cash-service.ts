/**
 * ReceiveCash — authenticated CASH tender acceptance (ADR-0038 A2–A4 / A6–A8).
 * Server-authored Money; OPEN CashShift; immutable evidence + PaymentCollectionEvent.
 * Cash accepted ≠ FiscalCheckoutGate SATISFIED. No fake fiscal success.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthenticatedPrincipal } from '../identity/index.js';
import { DomainValidationError } from '../orders/errors.js';
import { insertCashPaymentCollectionEvent } from './payment-collection-event.js';
import type { PaymentProjection } from './payments-service.js';
import type { PaymentCollectionEventProjection } from './payment-collection-event.js';

function assertDigits(label: string, v: string): void {
  if (!/^[0-9]+$/.test(v)) {
    throw new DomainValidationError('VALIDATION', `${label} must be non-negative integer digits`);
  }
}

function cmpMinor(a: string, b: string): number {
  const aa = BigInt(a);
  const bb = BigInt(b);
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function subMinor(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString();
}

export type CashCollectionEvidenceProjection = {
  paymentCashCollectionEvidenceId: string;
  paymentId: string;
  settlementCheckId: string;
  cashShiftId: string;
  amountDueMinor: string;
  amountTenderedMinor: string;
  changeMinor: string;
  currencyCode: string;
  acceptedAt: string;
};

export type ReceiveCashResult = {
  payment: PaymentProjection;
  evidence: CashCollectionEvidenceProjection;
  collectionEvent: PaymentCollectionEventProjection;
  duplicate: boolean;
};

export type ReceiveCashDeps = {
  onCoverageChanged?: (settlementGroupId: string) => Promise<void>;
};

/**
 * Level B binding of Accepted ADR-0038 ReceiveCash.
 * OPEN items deferred (not silently invented as product policy):
 * - exact overpay upper bounds / denomination UX (A4 OPEN) — no artificial cap;
 * - tips in same command (A4 OPEN) — tip fields rejected;
 * - partial cash (A4 OPEN) — rejected (tendered < due).
 */
export class ReceiveCashService {
  constructor(
    private readonly pool: Pool,
    private readonly deps: ReceiveCashDeps = {},
  ) {}

  async receiveCash(input: {
    principal: AuthenticatedPrincipal;
    /** Session/Organization Terminal — validated against OPEN CashShift (not client-trusted clock). */
    terminalId: string;
    settlementCheckId: string;
    tenderDefinitionId: string;
    receiveIdempotencyKey: string;
    amountTenderedMinor: string;
    humanConfirmation: boolean;
    /** Rejected if present — tips OPEN / out of FISC1.1. */
    tipAmountMinor?: string | null;
    /** Client must not supply collected_at — rejected if present. */
    collectedAt?: string | null;
  }): Promise<ReceiveCashResult> {
    if (!input.receiveIdempotencyKey.trim()) {
      throw new DomainValidationError('VALIDATION', 'receiveIdempotencyKey is required');
    }
    if (input.tipAmountMinor != null && input.tipAmountMinor !== '') {
      throw new DomainValidationError(
        'TIPS_NOT_SUPPORTED',
        'Tips in ReceiveCash are RELEASE-BLOCKING OPEN (ADR-0038 A4); not accepted in FISC1.1',
      );
    }
    if (input.collectedAt != null && input.collectedAt !== '') {
      throw new DomainValidationError(
        'CLIENT_COLLECTED_AT_FORBIDDEN',
        'Client cannot supply collected_at; server acceptance clock is authoritative',
      );
    }
    if (input.humanConfirmation !== true) {
      throw new DomainValidationError(
        'HUMAN_CONFIRMATION_REQUIRED',
        'ReceiveCash requires authenticated human confirmation of cash received and change handled',
      );
    }
    assertDigits('amountTenderedMinor', input.amountTenderedMinor);
    if (!input.terminalId?.trim()) {
      throw new DomainValidationError(
        'TERMINAL_REQUIRED',
        'ReceiveCash requires terminalId bound to an OPEN CashShift',
      );
    }
    const terminalId = input.terminalId.trim();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Semantic idempotency (LE + key)
      const prior = await client.query<{
        payment_id: string;
        payment_cash_collection_evidence_id: string;
      }>(
        `SELECT e.payment_id, e.payment_cash_collection_evidence_id
         FROM payment_cash_collection_evidence e
         WHERE e.legal_entity_id = (
           SELECT sg.legal_entity_id
           FROM settlement_check sc
           INNER JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
           WHERE sc.settlement_check_id = $1
         )
         AND e.receive_idempotency_key = $2
         FOR UPDATE`,
        [input.settlementCheckId, input.receiveIdempotencyKey],
      );
      // If check missing, LE subquery null — handle below via check lock

      const checkRes = await client.query<{
        settlement_check_id: string;
        settlement_group_id: string;
        tenant_id: string;
        customer_payable_minor: string;
        currency_code: string;
        minor_unit_exponent: number;
        legal_entity_id: string;
        group_state: string;
        outlet_id: string;
        order_id: string;
      }>(
        `SELECT sc.settlement_check_id, sc.settlement_group_id, sc.tenant_id,
                sc.customer_payable_minor, sc.currency_code, sc.minor_unit_exponent,
                sg.legal_entity_id, sg.state AS group_state, so.outlet_id, sg.order_id
         FROM settlement_check sc
         INNER JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
         INNER JOIN sales_order so ON so.order_id = sg.order_id
         WHERE sc.settlement_check_id = $1
         FOR UPDATE OF sg, sc`,
        [input.settlementCheckId],
      );
      const check = checkRes.rows[0];
      if (!check) throw new DomainValidationError('NOT_FOUND', 'SettlementCheck not found');
      if (check.tenant_id !== input.principal.tenantId) {
        throw new DomainValidationError('CROSS_ENTITY', 'SettlementCheck tenant mismatch');
      }
      if (check.group_state !== 'COLLECTING' && check.group_state !== 'SATISFIED') {
        throw new DomainValidationError(
          'SETTLEMENT_NOT_COLLECTING',
          `Cannot ReceiveCash for Settlement in state ${check.group_state}`,
        );
      }

      const idem = await client.query<{
        payment_cash_collection_evidence_id: string;
        payment_id: string;
        settlement_check_id: string;
        cash_shift_id: string;
        amount_due_minor: string;
        amount_tendered_minor: string;
        change_minor: string;
        currency_code: string;
        accepted_at: Date;
      }>(
        `SELECT * FROM payment_cash_collection_evidence
         WHERE legal_entity_id = $1 AND receive_idempotency_key = $2
         FOR UPDATE`,
        [check.legal_entity_id, input.receiveIdempotencyKey],
      );
      if (idem.rows[0]) {
        if (idem.rows[0].settlement_check_id !== input.settlementCheckId) {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'receiveIdempotencyKey already used for a different Check',
          );
        }
        const payment = await loadPayment(client, idem.rows[0].payment_id);
        const pce = await client.query(
          `SELECT * FROM payment_collection_event WHERE payment_id = $1`,
          [idem.rows[0].payment_id],
        );
        await client.query('COMMIT');
        return {
          payment,
          evidence: {
            paymentCashCollectionEvidenceId: idem.rows[0].payment_cash_collection_evidence_id,
            paymentId: idem.rows[0].payment_id,
            settlementCheckId: idem.rows[0].settlement_check_id,
            cashShiftId: idem.rows[0].cash_shift_id,
            amountDueMinor: idem.rows[0].amount_due_minor,
            amountTenderedMinor: idem.rows[0].amount_tendered_minor,
            changeMinor: idem.rows[0].change_minor,
            currencyCode: idem.rows[0].currency_code,
            acceptedAt: idem.rows[0].accepted_at.toISOString(),
          },
          collectionEvent: mapPce(pce.rows[0]),
          duplicate: true,
        };
      }
      void prior;

      // Concurrent distinct keys → unique on check fails closed
      const existingCash = await client.query(
        `SELECT payment_cash_collection_evidence_id FROM payment_cash_collection_evidence
         WHERE settlement_check_id = $1 FOR UPDATE`,
        [input.settlementCheckId],
      );
      if (existingCash.rows[0]) {
        throw new DomainValidationError(
          'CASH_COLLECTION_ALREADY_EXISTS',
          'Check already has qualifying CASH collection; concurrent ReceiveCash fail closed',
        );
      }

      const shift = await client.query<{
        cash_shift_id: string;
        terminal_id: string;
        outlet_id: string;
        status: string;
        currency_code: string;
        minor_unit_exponent: number;
      }>(
        `SELECT cash_shift_id, terminal_id, outlet_id, status, currency_code, minor_unit_exponent
         FROM cash_shift
         WHERE tenant_id = $1 AND terminal_id = $2 AND status = 'OPEN'
         FOR SHARE`,
        [input.principal.tenantId, terminalId],
      );
      if (!shift.rows[0]) {
        throw new DomainValidationError(
          'CASH_SHIFT_NOT_OPEN',
          'ReceiveCash requires an OPEN CashShift for the Session Terminal',
        );
      }
      if (shift.rows[0].outlet_id !== check.outlet_id) {
        throw new DomainValidationError(
          'CROSS_ENTITY',
          'CashShift outlet must match Order outlet',
        );
      }
      if (
        shift.rows[0].currency_code !== check.currency_code ||
        shift.rows[0].minor_unit_exponent !== check.minor_unit_exponent
      ) {
        throw new DomainValidationError(
          'CURRENCY_MISMATCH',
          'CashShift currency/exponent must match SettlementCheck',
        );
      }

      // A6 / no double Revenue: Check must not already have qualifying coverage.
      const existingCov = await client.query<{ s: string | null }>(
        `SELECT COALESCE(SUM(pa.amount_minor::numeric), 0)::text AS s
         FROM payment_allocation pa
         INNER JOIN payment p ON p.payment_id = pa.payment_id
         WHERE pa.settlement_check_id = $1
           AND pa.active = TRUE
           AND p.lifecycle_state = 'SUCCEEDED'`,
        [input.settlementCheckId],
      );
      const alreadyCovered = existingCov.rows[0]?.s ?? '0';
      if (cmpMinor(alreadyCovered, '0') > 0) {
        throw new DomainValidationError(
          'CHECK_ALREADY_COVERED',
          'ReceiveCash forbidden: Check already has qualifying Payment coverage (no double Revenue)',
        );
      }

      const tender = await client.query<{
        tender_definition_id: string;
        tenant_id: string;
        legal_entity_id: string;
        enabled: boolean;
        instrument_family: string | null;
      }>(
        `SELECT * FROM tender_definition WHERE tender_definition_id = $1 FOR SHARE`,
        [input.tenderDefinitionId],
      );
      const t = tender.rows[0];
      if (!t) throw new DomainValidationError('NOT_FOUND', 'TenderDefinition not found');
      if (!t.enabled) {
        throw new DomainValidationError('TENDER_DISABLED', 'Disabled TenderDefinition');
      }
      if (t.tenant_id !== check.tenant_id || t.legal_entity_id !== check.legal_entity_id) {
        throw new DomainValidationError('CROSS_ENTITY', 'TenderDefinition scope mismatch');
      }
      if ((t.instrument_family ?? '').toUpperCase() !== 'CASH') {
        throw new DomainValidationError(
          'TENDER_NOT_CASH',
          'ReceiveCash requires TenderDefinition.instrument_family = CASH',
        );
      }

      const due = check.customer_payable_minor;
      const tendered = input.amountTenderedMinor;
      if (cmpMinor(tendered, due) < 0) {
        throw new DomainValidationError(
          'PARTIAL_CASH_REJECTED',
          'tendered < due rejected for FISC1.1 one-Payment shape (ADR-0038 A4)',
        );
      }
      const change = subMinor(tendered, due);

      // Server acceptance clock — never client, never payment.created_at fallback chain
      const clock = await client.query<{ now: Date }>(`SELECT NOW() AS now`);
      const acceptedAt = clock.rows[0]!.now.toISOString();

      const paymentId = randomUUID();
      const merchantRef = `cash:${paymentId}`;
      try {
        await client.query(
          `INSERT INTO payment (
             payment_id, tenant_id, legal_entity_id, tender_definition_id,
             currency_code, minor_unit_exponent, requested_amount_minor,
             lifecycle_state, create_idempotency_key, merchant_payment_reference,
             reconciliation_state, intended_settlement_group_id, intended_settlement_check_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'SUCCEEDED',$8,$9,'RECONCILED',$10,$11)`,
          [
            paymentId,
            check.tenant_id,
            check.legal_entity_id,
            t.tender_definition_id,
            check.currency_code,
            check.minor_unit_exponent,
            due, // net qualifying = due, NOT tendered gross (A2)
            input.receiveIdempotencyKey,
            merchantRef,
            check.settlement_group_id,
            check.settlement_check_id,
          ],
        );
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code === '23505') {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'Payment create idempotency conflict for ReceiveCash',
          );
        }
        throw e;
      }

      const evidenceId = randomUUID();
      await client.query(
        `INSERT INTO payment_cash_collection_evidence (
           payment_cash_collection_evidence_id, payment_id, tenant_id, legal_entity_id,
           settlement_check_id, settlement_group_id, cash_shift_id, terminal_id, outlet_id,
           collected_by_user_id, amount_due_minor, amount_tendered_minor, change_minor,
           currency_code, minor_unit_exponent, human_confirmation, receive_idempotency_key,
           accepted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,$16,$17)`,
        [
          evidenceId,
          paymentId,
          check.tenant_id,
          check.legal_entity_id,
          check.settlement_check_id,
          check.settlement_group_id,
          shift.rows[0].cash_shift_id,
          terminalId,
          check.outlet_id,
          input.principal.userId,
          due,
          tendered,
          change,
          check.currency_code,
          check.minor_unit_exponent,
          input.receiveIdempotencyKey,
          acceptedAt,
        ],
      );

      const allocId = randomUUID();
      await client.query(
        `INSERT INTO payment_allocation (
           payment_allocation_id, payment_id, settlement_check_id, settlement_group_id,
           tenant_id, legal_entity_id, amount_minor, currency_code, minor_unit_exponent,
           allocation_idempotency_key, active
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)`,
        [
          allocId,
          paymentId,
          check.settlement_check_id,
          check.settlement_group_id,
          check.tenant_id,
          check.legal_entity_id,
          due,
          check.currency_code,
          check.minor_unit_exponent,
          input.receiveIdempotencyKey,
        ],
      );

      const collectionEvent = await insertCashPaymentCollectionEvent(client, {
        paymentId,
        tenantId: check.tenant_id,
        legalEntityId: check.legal_entity_id,
        settlementCheckId: check.settlement_check_id,
        settlementGroupId: check.settlement_group_id,
        collectedAt: acceptedAt,
        paymentCashCollectionEvidenceId: evidenceId,
        amountCollectedMinor: due,
        currencyCode: check.currency_code,
        minorUnitExponent: check.minor_unit_exponent,
      });

      const payment = await loadPayment(client, paymentId);
      await client.query('COMMIT');

      await this.deps.onCoverageChanged?.(check.settlement_group_id);

      return {
        payment,
        evidence: {
          paymentCashCollectionEvidenceId: evidenceId,
          paymentId,
          settlementCheckId: check.settlement_check_id,
          cashShiftId: shift.rows[0].cash_shift_id,
          amountDueMinor: due,
          amountTenderedMinor: tendered,
          changeMinor: change,
          currencyCode: check.currency_code,
          acceptedAt,
        },
        collectionEvent,
        duplicate: false,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

async function loadPayment(
  client: import('pg').PoolClient,
  paymentId: string,
): Promise<PaymentProjection> {
  const res = await client.query<{
    payment_id: string;
    tenant_id: string;
    legal_entity_id: string;
    tender_definition_id: string;
    currency_code: string;
    minor_unit_exponent: number;
    requested_amount_minor: string;
    lifecycle_state: PaymentProjection['lifecycleState'];
    create_idempotency_key: string;
    merchant_payment_reference: string;
    provider_transaction_reference: string | null;
    reconciliation_state: string;
    version: number;
    intended_settlement_group_id: string | null;
    intended_settlement_check_id: string | null;
  }>(`SELECT * FROM payment WHERE payment_id = $1`, [paymentId]);
  const p = res.rows[0];
  if (!p) throw new DomainValidationError('NOT_FOUND', 'Payment not found');
  return {
    paymentId: p.payment_id,
    tenantId: p.tenant_id,
    legalEntityId: p.legal_entity_id,
    tenderDefinitionId: p.tender_definition_id,
    currencyCode: p.currency_code,
    minorUnitExponent: p.minor_unit_exponent,
    requestedAmountMinor: p.requested_amount_minor,
    lifecycleState: p.lifecycle_state,
    createIdempotencyKey: p.create_idempotency_key,
    merchantPaymentReference: p.merchant_payment_reference,
    providerTransactionReference: p.provider_transaction_reference,
    reconciliationState: p.reconciliation_state,
    version: p.version,
    intendedSettlementGroupId: p.intended_settlement_group_id,
    intendedSettlementCheckId: p.intended_settlement_check_id,
  };
}

function mapPce(row: {
  payment_collection_event_id: string;
  payment_id: string;
  settlement_check_id: string;
  settlement_group_id: string;
  instrument_family: string;
  collected_at: Date;
  collection_evidence_kind: 'CARD_PROVIDER_COLLECTION' | 'CASH_RECEIVE';
  amount_collected_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
}): PaymentCollectionEventProjection {
  return {
    paymentCollectionEventId: row.payment_collection_event_id,
    paymentId: row.payment_id,
    settlementCheckId: row.settlement_check_id,
    settlementGroupId: row.settlement_group_id,
    instrumentFamily: row.instrument_family,
    collectedAt: row.collected_at.toISOString(),
    collectionEvidenceKind: row.collection_evidence_kind,
    amountCollectedMinor: row.amount_collected_minor,
    currencyCode: row.currency_code,
    minorUnitExponent: row.minor_unit_exponent,
  };
}
