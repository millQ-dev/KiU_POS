import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DomainValidationError } from '../orders/errors.js';
import type {
  QualifyingPaymentCoverageReader,
  SettlementExternalEffectProbe,
} from '../settlement/settlement-ports.js';
import {
  applyNormalizedOutcomeToLifecycle,
  isQualifyingSuccess,
  presentationCapabilityAllowed,
  type NormalizedProviderOutcome,
  type PaymentLifecycleState,
  type ReconciliationOrigin,
  type VerificationStatus,
} from './payment-lifecycle.js';

type Queryable = Pool | PoolClient;

function assertDigits(label: string, v: string): void {
  if (!/^[0-9]+$/.test(v)) {
    throw new DomainValidationError('VALIDATION', `${label} must be non-negative integer digits`);
  }
}

function assertPositiveOrZeroDigits(label: string, v: string): void {
  assertDigits(label, v);
}

function cmpMinor(a: string, b: string): number {
  const aa = BigInt(a);
  const bb = BigInt(b);
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function addMinor(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export type TenderDefinitionRow = {
  tenderDefinitionId: string;
  tenantId: string;
  legalEntityId: string;
  code: string;
  displayName: string;
  enabled: boolean;
  providerIdentity: string | null;
  railIdentity: string | null;
  instrumentFamily: string | null;
  presentationCapability: string | null;
  externalConfigRef: string | null;
};

export type PaymentProjection = {
  paymentId: string;
  tenantId: string;
  legalEntityId: string;
  tenderDefinitionId: string;
  currencyCode: string;
  minorUnitExponent: number;
  requestedAmountMinor: string;
  lifecycleState: PaymentLifecycleState;
  createIdempotencyKey: string;
  merchantPaymentReference: string;
  providerTransactionReference: string | null;
  reconciliationState: string;
  version: number;
  intendedSettlementGroupId: string | null;
  intendedSettlementCheckId: string | null;
};

export type PaymentProviderOutcomeProjection = {
  paymentProviderOutcomeId: string;
  paymentId: string;
  providerEventIdentity: string;
  rawProviderStatus: string;
  normalizedOutcome: NormalizedProviderOutcome;
  verificationStatus: VerificationStatus;
  reconciliationOrigin: ReconciliationOrigin;
  evidenceAmountMinor: string | null;
  evidenceCurrencyCode: string | null;
  receivedAt: string;
};

export type PaymentAllocationProjection = {
  paymentAllocationId: string;
  paymentId: string;
  settlementCheckId: string;
  settlementGroupId: string;
  amountMinor: string;
  currencyCode: string;
  active: boolean;
};

type TenderDb = {
  tender_definition_id: string;
  tenant_id: string;
  legal_entity_id: string;
  code: string;
  display_name: string;
  enabled: boolean;
  provider_identity: string | null;
  rail_identity: string | null;
  instrument_family: string | null;
  presentation_capability: string | null;
  external_config_ref: string | null;
};

type PaymentDb = {
  payment_id: string;
  tenant_id: string;
  legal_entity_id: string;
  tender_definition_id: string;
  currency_code: string;
  minor_unit_exponent: number;
  requested_amount_minor: string;
  lifecycle_state: PaymentLifecycleState;
  create_idempotency_key: string;
  merchant_payment_reference: string;
  provider_transaction_reference: string | null;
  reconciliation_state: string;
  version: number;
  intended_settlement_group_id: string | null;
  intended_settlement_check_id: string | null;
};

function mapTender(r: TenderDb): TenderDefinitionRow {
  return {
    tenderDefinitionId: r.tender_definition_id,
    tenantId: r.tenant_id,
    legalEntityId: r.legal_entity_id,
    code: r.code,
    displayName: r.display_name,
    enabled: r.enabled,
    providerIdentity: r.provider_identity,
    railIdentity: r.rail_identity,
    instrumentFamily: r.instrument_family,
    presentationCapability: r.presentation_capability,
    externalConfigRef: r.external_config_ref,
  };
}

function mapPayment(r: PaymentDb): PaymentProjection {
  return {
    paymentId: r.payment_id,
    tenantId: r.tenant_id,
    legalEntityId: r.legal_entity_id,
    tenderDefinitionId: r.tender_definition_id,
    currencyCode: r.currency_code,
    minorUnitExponent: r.minor_unit_exponent,
    requestedAmountMinor: r.requested_amount_minor,
    lifecycleState: r.lifecycle_state,
    createIdempotencyKey: r.create_idempotency_key,
    merchantPaymentReference: r.merchant_payment_reference,
    providerTransactionReference: r.provider_transaction_reference,
    reconciliationState: r.reconciliation_state,
    version: r.version,
    intendedSettlementGroupId: r.intended_settlement_group_id,
    intendedSettlementCheckId: r.intended_settlement_check_id,
  };
}

export type PaymentsServiceDeps = {
  /** Called after qualifying payment/allocation changes so Settlement can re-evaluate. */
  onCoverageChanged?: (settlementGroupId: string) => Promise<void>;
};

export class PaymentsService {
  constructor(
    private readonly pool: Pool,
    private readonly deps: PaymentsServiceDeps = {},
  ) {}

  async createTenderDefinition(input: {
    tenantId: string;
    legalEntityId: string;
    code: string;
    displayName: string;
    enabled?: boolean;
    providerIdentity?: string | null;
    railIdentity?: string | null;
    instrumentFamily?: string | null;
    presentationCapability?: string | null;
    externalConfigRef?: string | null;
  }): Promise<TenderDefinitionRow> {
    if (!input.code.trim()) {
      throw new DomainValidationError('VALIDATION', 'code is required');
    }
    if (!presentationCapabilityAllowed(input.presentationCapability ?? null)) {
      throw new DomainValidationError(
        'VALIDATION',
        'presentationCapability must be MERCHANT_PRESENTED|CUSTOMER_PRESENTED|DEVICE_INTERACTION|REDIRECT_OR_DEEPLINK',
      );
    }
    const le = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM legal_entity WHERE legal_entity_id = $1`,
      [input.legalEntityId],
    );
    if (!le.rows[0] || le.rows[0].tenant_id !== input.tenantId) {
      throw new DomainValidationError('VALIDATION', 'legalEntityId does not belong to tenantId');
    }
    const id = randomUUID();
    try {
      const res = await this.pool.query<TenderDb>(
        `INSERT INTO tender_definition (
           tender_definition_id, tenant_id, legal_entity_id, code, display_name, enabled,
           provider_identity, rail_identity, instrument_family, presentation_capability, external_config_ref
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          id,
          input.tenantId,
          input.legalEntityId,
          input.code.trim(),
          input.displayName.trim(),
          input.enabled !== false,
          input.providerIdentity ?? null,
          input.railIdentity ?? null,
          input.instrumentFamily ?? null,
          input.presentationCapability ?? null,
          input.externalConfigRef ?? null,
        ],
      );
      return mapTender(res.rows[0]!);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        throw new DomainValidationError('IDEMPOTENCY_CONFLICT', 'TenderDefinition code already exists');
      }
      throw e;
    }
  }

  async getTenderDefinition(id: string): Promise<TenderDefinitionRow | null> {
    const res = await this.pool.query<TenderDb>(
      `SELECT * FROM tender_definition WHERE tender_definition_id = $1`,
      [id],
    );
    return res.rows[0] ? mapTender(res.rows[0]) : null;
  }

  async setTenderEnabled(tenderDefinitionId: string, enabled: boolean): Promise<TenderDefinitionRow> {
    const res = await this.pool.query<TenderDb>(
      `UPDATE tender_definition SET enabled = $2 WHERE tender_definition_id = $1 RETURNING *`,
      [tenderDefinitionId, enabled],
    );
    if (!res.rows[0]) {
      throw new DomainValidationError('NOT_FOUND', 'TenderDefinition not found');
    }
    return mapTender(res.rows[0]);
  }

  async createPayment(input: {
    tenderDefinitionId: string;
    createIdempotencyKey: string;
    merchantPaymentReference?: string;
    requestedAmountMinor: string;
    currencyCode: string;
    minorUnitExponent: number;
    /** Bind Payment intent to a live Settlement Check (required for abort/external-effect integrity). */
    settlementCheckId?: string;
  }): Promise<PaymentProjection> {
    if (!input.createIdempotencyKey.trim()) {
      throw new DomainValidationError('VALIDATION', 'createIdempotencyKey is required');
    }
    assertPositiveOrZeroDigits('requestedAmountMinor', input.requestedAmountMinor);
    if (cmpMinor(input.requestedAmountMinor, '0') <= 0) {
      throw new DomainValidationError('VALIDATION', 'requestedAmountMinor must be > 0');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tenderRes = await client.query<TenderDb>(
        `SELECT * FROM tender_definition WHERE tender_definition_id = $1 FOR SHARE`,
        [input.tenderDefinitionId],
      );
      const tender = tenderRes.rows[0];
      if (!tender) {
        throw new DomainValidationError('NOT_FOUND', 'TenderDefinition not found');
      }
      if (!tender.enabled) {
        throw new DomainValidationError('TENDER_DISABLED', 'Disabled TenderDefinition cannot create Payment');
      }

      let intendedGroupId: string | null = null;
      let intendedCheckId: string | null = null;
      if (input.settlementCheckId) {
        const checkRes = await client.query<{
          settlement_check_id: string;
          settlement_group_id: string;
          tenant_id: string;
          legal_entity_id: string;
          group_state: string;
          currency_code: string;
          minor_unit_exponent: number;
        }>(
          `SELECT sc.settlement_check_id, sc.settlement_group_id, sc.tenant_id, sg.legal_entity_id,
                  sg.state AS group_state, sc.currency_code, sc.minor_unit_exponent
           FROM settlement_check sc
           INNER JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
           WHERE sc.settlement_check_id = $1
           FOR UPDATE OF sg`,
          [input.settlementCheckId],
        );
        const check = checkRes.rows[0];
        if (!check) throw new DomainValidationError('NOT_FOUND', 'SettlementCheck not found');
        if (check.group_state !== 'COLLECTING') {
          throw new DomainValidationError(
            'SETTLEMENT_NOT_COLLECTING',
            `Cannot bind Payment to Settlement in state ${check.group_state}`,
          );
        }
        if (check.tenant_id !== tender.tenant_id || check.legal_entity_id !== tender.legal_entity_id) {
          throw new DomainValidationError('CROSS_ENTITY', 'Payment Check must match Tender LegalEntity');
        }
        if (
          check.currency_code !== input.currencyCode ||
          check.minor_unit_exponent !== input.minorUnitExponent
        ) {
          throw new DomainValidationError('CURRENCY_MISMATCH', 'Payment currency must match Check');
        }
        intendedGroupId = check.settlement_group_id;
        intendedCheckId = check.settlement_check_id;
      }

      const existing = await client.query<PaymentDb>(
        `SELECT * FROM payment WHERE legal_entity_id = $1 AND create_idempotency_key = $2`,
        [tender.legal_entity_id, input.createIdempotencyKey],
      );
      if (existing.rows[0]) {
        const prev = existing.rows[0];
        if (
          prev.tender_definition_id !== input.tenderDefinitionId ||
          prev.requested_amount_minor !== input.requestedAmountMinor ||
          prev.currency_code !== input.currencyCode ||
          prev.minor_unit_exponent !== input.minorUnitExponent ||
          (input.settlementCheckId &&
            prev.intended_settlement_check_id != null &&
            prev.intended_settlement_check_id !== input.settlementCheckId)
        ) {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'createIdempotencyKey reused with different Payment semantics',
          );
        }
        await client.query('COMMIT');
        return mapPayment(prev);
      }

      const paymentId = randomUUID();
      const merchantRef =
        input.merchantPaymentReference?.trim() ||
        `pay_${createHash('sha256').update(`${paymentId}:${input.createIdempotencyKey}`).digest('hex').slice(0, 24)}`;

      try {
        const inserted = await client.query<PaymentDb>(
          `INSERT INTO payment (
             payment_id, tenant_id, legal_entity_id, tender_definition_id,
             currency_code, minor_unit_exponent, requested_amount_minor,
             lifecycle_state, create_idempotency_key, merchant_payment_reference,
             reconciliation_state, intended_settlement_group_id, intended_settlement_check_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'INITIATED',$8,$9,'AWAITING',$10,$11)
           RETURNING *`,
          [
            paymentId,
            tender.tenant_id,
            tender.legal_entity_id,
            tender.tender_definition_id,
            input.currencyCode,
            input.minorUnitExponent,
            input.requestedAmountMinor,
            input.createIdempotencyKey,
            merchantRef,
            intendedGroupId,
            intendedCheckId,
          ],
        );
        await client.query('COMMIT');
        return mapPayment(inserted.rows[0]!);
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code === '23505') {
          const again = await client.query<PaymentDb>(
            `SELECT * FROM payment WHERE legal_entity_id = $1 AND create_idempotency_key = $2`,
            [tender.legal_entity_id, input.createIdempotencyKey],
          );
          if (again.rows[0]) {
            await client.query('COMMIT');
            return mapPayment(again.rows[0]);
          }
        }
        throw e;
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getPayment(paymentId: string): Promise<PaymentProjection | null> {
    const res = await this.pool.query<PaymentDb>(`SELECT * FROM payment WHERE payment_id = $1`, [
      paymentId,
    ]);
    return res.rows[0] ? mapPayment(res.rows[0]) : null;
  }

  /**
   * Record verified (or explicitly UNVERIFIED) provider outcome evidence.
   * Adapters must verify signatures before calling with VERIFIED.
   * Client redirect must NOT call this as VERIFIED SUCCESS.
   */
  async recordVerifiedProviderOutcome(input: {
    paymentId: string;
    providerEventIdentity: string;
    rawProviderStatus: string;
    normalizedOutcome: NormalizedProviderOutcome;
    verificationStatus: VerificationStatus;
    reconciliationOrigin: ReconciliationOrigin;
    merchantRequestIdentity?: string | null;
    providerOccurredAt?: string | null;
    evidenceAmountMinor?: string | null;
    evidenceCurrencyCode?: string | null;
    providerTransactionReference?: string | null;
    diagnosticMetadata?: Record<string, unknown>;
    /** Optional auto-allocate to a check after SUCCESS. */
    allocateToCheckId?: string | null;
    allocationIdempotencyKey?: string | null;
  }): Promise<{
    payment: PaymentProjection;
    outcome: PaymentProviderOutcomeProjection;
    allocation: PaymentAllocationProjection | null;
    duplicate: boolean;
  }> {
    if (!input.providerEventIdentity.trim()) {
      throw new DomainValidationError('VALIDATION', 'providerEventIdentity is required');
    }

    const client = await this.pool.connect();
    const touchedGroups = new Set<string>();
    try {
      await client.query('BEGIN');
      const payRes = await client.query<PaymentDb>(
        `SELECT * FROM payment WHERE payment_id = $1 FOR UPDATE`,
        [input.paymentId],
      );
      const pay = payRes.rows[0];
      if (!pay) {
        throw new DomainValidationError('NOT_FOUND', 'Payment not found');
      }

      const dup = await client.query<{ payment_provider_outcome_id: string }>(
        `SELECT payment_provider_outcome_id FROM payment_provider_outcome
         WHERE payment_id = $1 AND provider_event_identity = $2`,
        [input.paymentId, input.providerEventIdentity],
      );
      if (dup.rows[0]) {
        const outcome = await this.loadOutcome(client, dup.rows[0].payment_provider_outcome_id);
        await client.query('COMMIT');
        return {
          payment: mapPayment(pay),
          outcome,
          allocation: null,
          duplicate: true,
        };
      }

      // Unverified success never qualifies
      let normalized = input.normalizedOutcome;
      let verification = input.verificationStatus;
      let reconciliationState = pay.reconciliation_state;

      if (verification === 'UNVERIFIED' && normalized === 'SUCCEEDED') {
        normalized = 'UNVERIFIED';
      }

      // Amount / currency mismatch quarantine
      if (
        verification === 'VERIFIED' &&
        normalized === 'SUCCEEDED' &&
        input.evidenceAmountMinor != null &&
        input.evidenceAmountMinor !== pay.requested_amount_minor
      ) {
        normalized = 'AMOUNT_MISMATCH';
        reconciliationState = 'QUARANTINED';
      }
      if (
        verification === 'VERIFIED' &&
        (normalized === 'SUCCEEDED' || normalized === 'AMOUNT_MISMATCH') &&
        input.evidenceCurrencyCode != null &&
        input.evidenceCurrencyCode !== pay.currency_code
      ) {
        normalized = 'CURRENCY_MISMATCH';
        reconciliationState = 'QUARANTINED';
      }
      if (normalized === 'AMOUNT_MISMATCH' || normalized === 'CURRENCY_MISMATCH') {
        reconciliationState = 'QUARANTINED';
      }

      const outcomeId = randomUUID();
      await client.query(
        `INSERT INTO payment_provider_outcome (
           payment_provider_outcome_id, payment_id, tenant_id, legal_entity_id,
           provider_event_identity, merchant_request_identity, provider_occurred_at,
           raw_provider_status, normalized_outcome, evidence_amount_minor, evidence_currency_code,
           verification_status, reconciliation_origin, diagnostic_metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          outcomeId,
          pay.payment_id,
          pay.tenant_id,
          pay.legal_entity_id,
          input.providerEventIdentity,
          input.merchantRequestIdentity ?? pay.merchant_payment_reference,
          input.providerOccurredAt ?? null,
          input.rawProviderStatus,
          normalized,
          input.evidenceAmountMinor ?? null,
          input.evidenceCurrencyCode ?? null,
          verification,
          input.reconciliationOrigin,
          JSON.stringify(input.diagnosticMetadata ?? {}),
        ],
      );

      const nextLifecycle = applyNormalizedOutcomeToLifecycle(pay.lifecycle_state, normalized);
      let providerTxRef = pay.provider_transaction_reference;
      if (input.providerTransactionReference && !providerTxRef) {
        providerTxRef = input.providerTransactionReference;
      } else if (
        input.providerTransactionReference &&
        providerTxRef &&
        input.providerTransactionReference !== providerTxRef
      ) {
        throw new DomainValidationError(
          'PROVIDER_REFERENCE_COLLISION',
          'providerTransactionReference conflicts with existing Payment reference',
        );
      }

      if (nextLifecycle === 'SUCCEEDED' && verification === 'VERIFIED' && normalized === 'SUCCEEDED') {
        reconciliationState = 'RECONCILED';
      } else if (normalized === 'PENDING' || nextLifecycle === 'PENDING' || nextLifecycle === 'INITIATED') {
        if (reconciliationState !== 'QUARANTINED') reconciliationState = 'AWAITING';
      }

      const updated = await client.query<PaymentDb>(
        `UPDATE payment SET
           lifecycle_state = $2,
           provider_transaction_reference = $3,
           reconciliation_state = $4,
           version = version + 1,
           updated_at = NOW()
         WHERE payment_id = $1
         RETURNING *`,
        [pay.payment_id, nextLifecycle, providerTxRef, reconciliationState],
      );
      const payment = mapPayment(updated.rows[0]!);

      let allocation: PaymentAllocationProjection | null = null;
      if (
        isQualifyingSuccess(payment.lifecycleState) &&
        input.allocateToCheckId &&
        input.allocationIdempotencyKey
      ) {
        allocation = await this.allocatePaymentToCheckTx(client, {
          paymentId: payment.paymentId,
          settlementCheckId: input.allocateToCheckId,
          amountMinor: payment.requestedAmountMinor,
          allocationIdempotencyKey: input.allocationIdempotencyKey,
        });
        touchedGroups.add(allocation.settlementGroupId);
      }

      const outcome = await this.loadOutcome(client, outcomeId);
      await client.query('COMMIT');

      for (const gid of touchedGroups) {
        await this.deps.onCoverageChanged?.(gid);
      }

      return { payment, outcome, allocation, duplicate: false };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Client/browser redirect signal — NEVER creates qualifying success.
   * May only mark UNKNOWN/AWAITING for inquiry; does not allocate.
   */
  async recordClientRedirectSignal(paymentId: string): Promise<PaymentProjection> {
    const pay = await this.getPayment(paymentId);
    if (!pay) throw new DomainValidationError('NOT_FOUND', 'Payment not found');
    // Explicitly non-authoritative: store diagnostic evidence as UNVERIFIED PENDING, no lifecycle SUCCESS.
    await this.recordVerifiedProviderOutcome({
      paymentId,
      providerEventIdentity: `client_redirect:${randomUUID()}`,
      rawProviderStatus: 'CLIENT_REDIRECT_SUCCESS_CLAIM',
      normalizedOutcome: 'PENDING',
      verificationStatus: 'UNVERIFIED',
      reconciliationOrigin: 'SYSTEM',
      diagnosticMetadata: { redirectIsNotAuthoritative: true },
    });
    return (await this.getPayment(paymentId))!;
  }

  async allocatePaymentToCheck(input: {
    paymentId: string;
    settlementCheckId: string;
    amountMinor: string;
    allocationIdempotencyKey: string;
  }): Promise<PaymentAllocationProjection> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const alloc = await this.allocatePaymentToCheckTx(client, input);
      await client.query('COMMIT');
      await this.deps.onCoverageChanged?.(alloc.settlementGroupId);
      return alloc;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async allocatePaymentToCheckTx(
    client: PoolClient,
    input: {
      paymentId: string;
      settlementCheckId: string;
      amountMinor: string;
      allocationIdempotencyKey: string;
    },
  ): Promise<PaymentAllocationProjection> {
    assertPositiveOrZeroDigits('amountMinor', input.amountMinor);
    if (cmpMinor(input.amountMinor, '0') <= 0) {
      throw new DomainValidationError('VALIDATION', 'allocation amount must be > 0');
    }
    if (!input.allocationIdempotencyKey.trim()) {
      throw new DomainValidationError('VALIDATION', 'allocationIdempotencyKey is required');
    }

    const existing = await client.query<{
      payment_allocation_id: string;
      payment_id: string;
      settlement_check_id: string;
      settlement_group_id: string;
      amount_minor: string;
      currency_code: string;
      active: boolean;
    }>(
      `SELECT * FROM payment_allocation
       WHERE payment_id = $1 AND allocation_idempotency_key = $2`,
      [input.paymentId, input.allocationIdempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (
        row.settlement_check_id !== input.settlementCheckId ||
        row.amount_minor !== input.amountMinor
      ) {
        throw new DomainValidationError(
          'IDEMPOTENCY_CONFLICT',
          'allocationIdempotencyKey reused with different semantics',
        );
      }
      return {
        paymentAllocationId: row.payment_allocation_id,
        paymentId: row.payment_id,
        settlementCheckId: row.settlement_check_id,
        settlementGroupId: row.settlement_group_id,
        amountMinor: row.amount_minor,
        currencyCode: row.currency_code,
        active: row.active,
      };
    }

    const payRes = await client.query<PaymentDb>(
      `SELECT * FROM payment WHERE payment_id = $1 FOR UPDATE`,
      [input.paymentId],
    );
    const pay = payRes.rows[0];
    if (!pay) throw new DomainValidationError('NOT_FOUND', 'Payment not found');
    if (!isQualifyingSuccess(pay.lifecycle_state)) {
      throw new DomainValidationError(
        'PAYMENT_NOT_QUALIFYING',
        `Payment lifecycle ${pay.lifecycle_state} cannot allocate qualifying coverage`,
      );
    }

    const checkRes = await client.query<{
      settlement_check_id: string;
      settlement_group_id: string;
      tenant_id: string;
      legal_entity_id: string;
      currency_code: string;
      minor_unit_exponent: number;
      customer_payable_minor: string;
      group_state: string;
    }>(
      `SELECT sc.settlement_check_id, sc.settlement_group_id, sc.tenant_id, sg.legal_entity_id,
              sc.currency_code, sc.minor_unit_exponent, sc.customer_payable_minor,
              sg.state AS group_state
       FROM settlement_check sc
       INNER JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
       WHERE sc.settlement_check_id = $1
       FOR UPDATE OF sc, sg`,
      [input.settlementCheckId],
    );
    const check = checkRes.rows[0];
    if (!check) throw new DomainValidationError('NOT_FOUND', 'SettlementCheck not found');
    if (check.group_state !== 'COLLECTING') {
      throw new DomainValidationError(
        'SETTLEMENT_NOT_COLLECTING',
        `Cannot allocate to Settlement in state ${check.group_state}`,
      );
    }
    if (check.tenant_id !== pay.tenant_id || check.legal_entity_id !== pay.legal_entity_id) {
      throw new DomainValidationError('CROSS_ENTITY', 'PaymentAllocation cross-tenant/LegalEntity forbidden');
    }
    if (check.currency_code !== pay.currency_code || check.minor_unit_exponent !== pay.minor_unit_exponent) {
      throw new DomainValidationError('CURRENCY_MISMATCH', 'Allocation currency must match Check and Payment');
    }
    if (cmpMinor(input.amountMinor, pay.requested_amount_minor) > 0) {
      throw new DomainValidationError('ALLOCATION_EXCEEDS_PAYMENT', 'Allocation exceeds Payment amount');
    }

    // Bind intent if missing (late allocate path)
    if (!pay.intended_settlement_group_id) {
      await client.query(
        `UPDATE payment SET
           intended_settlement_group_id = $2,
           intended_settlement_check_id = COALESCE(intended_settlement_check_id, $3),
           updated_at = NOW()
         WHERE payment_id = $1`,
        [pay.payment_id, check.settlement_group_id, check.settlement_check_id],
      );
    } else if (pay.intended_settlement_group_id !== check.settlement_group_id) {
      throw new DomainValidationError(
        'SETTLEMENT_INTENT_MISMATCH',
        'Payment already bound to a different SettlementGroup',
      );
    }

    const sumPayAlloc = await client.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(amount_minor::numeric), 0)::text AS s
       FROM payment_allocation WHERE payment_id = $1 AND active`,
      [pay.payment_id],
    );
    const alreadyOnPayment = sumPayAlloc.rows[0]?.s ?? '0';
    if (cmpMinor(addMinor(alreadyOnPayment, input.amountMinor), pay.requested_amount_minor) > 0) {
      throw new DomainValidationError(
        'ALLOCATION_EXCEEDS_PAYMENT',
        'SUM(PaymentAllocation) would exceed Payment amount',
      );
    }

    // Non-cash overpay forbidden: use payable conservation, not stale outstanding alone.
    const sumCheckAlloc = await client.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(pa.amount_minor::numeric), 0)::text AS s
       FROM payment_allocation pa
       INNER JOIN payment p ON p.payment_id = pa.payment_id
       WHERE pa.settlement_check_id = $1 AND pa.active AND p.lifecycle_state = 'SUCCEEDED'`,
      [check.settlement_check_id],
    );
    const alreadyOnCheck = sumCheckAlloc.rows[0]?.s ?? '0';
    if (cmpMinor(addMinor(alreadyOnCheck, input.amountMinor), check.customer_payable_minor) > 0) {
      throw new DomainValidationError(
        'CHECK_OVERCOVERAGE',
        'Non-cash overpay forbidden: allocation would exceed Check customer payable',
      );
    }

    const id = randomUUID();
    const ins = await client.query<{
      payment_allocation_id: string;
      payment_id: string;
      settlement_check_id: string;
      settlement_group_id: string;
      amount_minor: string;
      currency_code: string;
      active: boolean;
    }>(
      `INSERT INTO payment_allocation (
         payment_allocation_id, payment_id, settlement_check_id, settlement_group_id,
         tenant_id, legal_entity_id, amount_minor, currency_code, minor_unit_exponent,
         allocation_idempotency_key, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
       RETURNING payment_allocation_id, payment_id, settlement_check_id, settlement_group_id,
                 amount_minor, currency_code, active`,
      [
        id,
        pay.payment_id,
        check.settlement_check_id,
        check.settlement_group_id,
        pay.tenant_id,
        pay.legal_entity_id,
        input.amountMinor,
        pay.currency_code,
        pay.minor_unit_exponent,
        input.allocationIdempotencyKey,
      ],
    );
    const row = ins.rows[0]!;
    return {
      paymentAllocationId: row.payment_allocation_id,
      paymentId: row.payment_id,
      settlementCheckId: row.settlement_check_id,
      settlementGroupId: row.settlement_group_id,
      amountMinor: row.amount_minor,
      currencyCode: row.currency_code,
      active: row.active,
    };
  }

  private async loadOutcome(
    q: Queryable,
    outcomeId: string,
  ): Promise<PaymentProviderOutcomeProjection> {
    const res = await q.query<{
      payment_provider_outcome_id: string;
      payment_id: string;
      provider_event_identity: string;
      raw_provider_status: string;
      normalized_outcome: NormalizedProviderOutcome;
      verification_status: VerificationStatus;
      reconciliation_origin: ReconciliationOrigin;
      evidence_amount_minor: string | null;
      evidence_currency_code: string | null;
      received_at: Date;
    }>(`SELECT * FROM payment_provider_outcome WHERE payment_provider_outcome_id = $1`, [
      outcomeId,
    ]);
    const r = res.rows[0]!;
    return {
      paymentProviderOutcomeId: r.payment_provider_outcome_id,
      paymentId: r.payment_id,
      providerEventIdentity: r.provider_event_identity,
      rawProviderStatus: r.raw_provider_status,
      normalizedOutcome: r.normalized_outcome,
      verificationStatus: r.verification_status,
      reconciliationOrigin: r.reconciliation_origin,
      evidenceAmountMinor: r.evidence_amount_minor,
      evidenceCurrencyCode: r.evidence_currency_code,
      receivedAt: r.received_at.toISOString(),
    };
  }

  /** Qualifying coverage reader for Settlement (S1.1 port). */
  createCoverageReader(): QualifyingPaymentCoverageReader {
    const pool = this.pool;
    return {
      async listQualifyingAllocations(input) {
        if (input.settlementCheckIds.length === 0) return [];
        const res = await pool.query<{
          payment_allocation_id: string;
          settlement_check_id: string;
          amount_minor: string;
        }>(
          `SELECT pa.payment_allocation_id, pa.settlement_check_id, pa.amount_minor
           FROM payment_allocation pa
           INNER JOIN payment p ON p.payment_id = pa.payment_id
           WHERE pa.settlement_group_id = $1
             AND pa.settlement_check_id = ANY($2::uuid[])
             AND pa.active = TRUE
             AND p.lifecycle_state = 'SUCCEEDED'`,
          [input.settlementGroupId, [...input.settlementCheckIds]],
        );
        return res.rows.map((r) => ({
          allocationIdentity: r.payment_allocation_id,
          settlementCheckId: r.settlement_check_id,
          amountMinor: r.amount_minor,
          qualifies: true as const,
        }));
      },
    };
  }

  /** External-effect probe: qualifying SUCCESS for this Settlement (allocation OR intended bind). */
  createExternalEffectProbe(): SettlementExternalEffectProbe {
    const pool = this.pool;
    return {
      async hasQualifyingPaymentExternalEffect(settlementGroupId: string): Promise<boolean> {
        const res = await pool.query(
          `SELECT 1 FROM payment p
           WHERE p.lifecycle_state = 'SUCCEEDED'
             AND (
               p.intended_settlement_group_id = $1
               OR EXISTS (
                 SELECT 1 FROM payment_allocation pa
                 WHERE pa.payment_id = p.payment_id
                   AND pa.settlement_group_id = $1
               )
             )
           LIMIT 1`,
          [settlementGroupId],
        );
        return (res.rowCount ?? 0) > 0;
      },
      async hasFiscalExternalEffect() {
        return false;
      },
    };
  }
}
