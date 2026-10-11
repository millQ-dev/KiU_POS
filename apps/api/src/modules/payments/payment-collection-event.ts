/**
 * Payments-owned immutable PaymentCollectionEvent helpers (ADR-0014 D32–D38 / ADR-0038).
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainValidationError } from '../orders/errors.js';

export type CollectionEvidenceKind = 'CARD_PROVIDER_COLLECTION' | 'CASH_RECEIVE';

export type PaymentCollectionEventProjection = {
  paymentCollectionEventId: string;
  paymentId: string;
  settlementCheckId: string;
  settlementGroupId: string;
  instrumentFamily: string;
  collectedAt: string;
  collectionEvidenceKind: CollectionEvidenceKind;
  amountCollectedMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
};

type PceRow = {
  payment_collection_event_id: string;
  payment_id: string;
  settlement_check_id: string;
  settlement_group_id: string;
  instrument_family: string;
  collected_at: Date;
  collection_evidence_kind: CollectionEvidenceKind;
  amount_collected_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
};

export function mapPaymentCollectionEvent(row: PceRow): PaymentCollectionEventProjection {
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

/** CARD: collected_at = provider_occurred_at when provenance affirms COLLECTION_OR_CAPTURE. */
export async function insertCardPaymentCollectionEvent(
  client: PoolClient,
  input: {
    paymentId: string;
    tenantId: string;
    legalEntityId: string;
    settlementCheckId: string;
    settlementGroupId: string;
    instrumentFamily: string;
    collectedAt: string;
    paymentProviderOutcomeId: string;
    amountCollectedMinor: string;
    currencyCode: string;
    minorUnitExponent: number;
  },
): Promise<PaymentCollectionEventProjection> {
  if (!input.collectedAt) {
    throw new DomainValidationError(
      'COLLECTION_TIME_UNTRUSTED',
      'CARD PaymentCollectionEvent requires affirmed provider_occurred_at collection time',
    );
  }
  const id = randomUUID();
  try {
    const res = await client.query<PceRow>(
      `INSERT INTO payment_collection_event (
         payment_collection_event_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, instrument_family, collected_at,
         collection_evidence_kind, payment_provider_outcome_id,
         amount_collected_minor, currency_code, minor_unit_exponent
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CARD_PROVIDER_COLLECTION',$9,$10,$11,$12)
       RETURNING *`,
      [
        id,
        input.paymentId,
        input.tenantId,
        input.legalEntityId,
        input.settlementCheckId,
        input.settlementGroupId,
        input.instrumentFamily,
        input.collectedAt,
        input.paymentProviderOutcomeId,
        input.amountCollectedMinor,
        input.currencyCode,
        input.minorUnitExponent,
      ],
    );
    return mapPaymentCollectionEvent(res.rows[0]!);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === '23505') {
      throw new DomainValidationError(
        'COLLECTION_EVENT_CONFLICT',
        'PaymentCollectionEvent already exists for this Payment or Check',
      );
    }
    throw e;
  }
}

/** CASH: collected_at = server acceptance clock of successful ReceiveCash (never client-supplied). */
export async function insertCashPaymentCollectionEvent(
  client: PoolClient,
  input: {
    paymentId: string;
    tenantId: string;
    legalEntityId: string;
    settlementCheckId: string;
    settlementGroupId: string;
    collectedAt: string;
    paymentCashCollectionEvidenceId: string;
    amountCollectedMinor: string;
    currencyCode: string;
    minorUnitExponent: number;
  },
): Promise<PaymentCollectionEventProjection> {
  const id = randomUUID();
  try {
    const res = await client.query<PceRow>(
      `INSERT INTO payment_collection_event (
         payment_collection_event_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, instrument_family, collected_at,
         collection_evidence_kind, payment_cash_collection_evidence_id,
         amount_collected_minor, currency_code, minor_unit_exponent
       ) VALUES ($1,$2,$3,$4,$5,$6,'CASH',$7,'CASH_RECEIVE',$8,$9,$10,$11)
       RETURNING *`,
      [
        id,
        input.paymentId,
        input.tenantId,
        input.legalEntityId,
        input.settlementCheckId,
        input.settlementGroupId,
        input.collectedAt,
        input.paymentCashCollectionEvidenceId,
        input.amountCollectedMinor,
        input.currencyCode,
        input.minorUnitExponent,
      ],
    );
    return mapPaymentCollectionEvent(res.rows[0]!);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === '23505') {
      throw new DomainValidationError(
        'COLLECTION_EVENT_CONFLICT',
        'PaymentCollectionEvent already exists for this Payment or Check',
      );
    }
    throw e;
  }
}

export async function getPaymentCollectionEventByPayment(
  client: PoolClient,
  paymentId: string,
): Promise<PaymentCollectionEventProjection | null> {
  const res = await client.query<PceRow>(
    `SELECT * FROM payment_collection_event WHERE payment_id = $1`,
    [paymentId],
  );
  return res.rows[0] ? mapPaymentCollectionEvent(res.rows[0]) : null;
}
