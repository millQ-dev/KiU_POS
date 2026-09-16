import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  assertExactCheckPayableConservation,
  assertExactLineAllocationConservation,
  evaluateCheckCoverage,
  presentOrAbsent,
  type PayableComponent,
} from '@millq/domain';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
} from '../orders/errors.js';
import type {
  FiscalCheckoutGate,
  QualifyingPaymentCoverageReader,
  SettlementExternalEffectProbe,
} from './settlement-ports.js';
import {
  emptyExternalEffectProbe,
  databasePaymentCoverageReader,
  unavailableFiscalCheckoutGate,
} from './settlement-ports.js';

export type SettlementGroupState = 'COLLECTING' | 'SATISFIED' | 'ABORTED';
export type SettlementCheckState = 'COLLECTING' | 'SATISFIED';

type OrderRow = {
  order_id: string;
  tenant_id: string;
  legal_entity_id: string;
  outlet_id: string;
  status: string;
};

type CommercialHead = {
  currency_code: string;
  minor_unit_exponent: number;
  semantic_fingerprint: string;
};

type CommercialLine = {
  order_line_id: string;
  line_number: number;
  gross_merchandise_minor: string;
};

export type SettlementProjection = {
  settlementGroupId: string;
  orderId: string;
  tenantId: string;
  legalEntityId: string;
  state: SettlementGroupState;
  currencyCode: string;
  minorUnitExponent: number;
  commercialFingerprint: string;
  version: number;
  merchandiseGrossMinor: string;
  customerPayableMinor: string;
  allocatedAmountMinor: string;
  outstandingAmountMinor: string;
  payableSnapshot: {
    settlementPayableSnapshotId: string;
    merchandiseGross: { presence: 'PRESENT'; amountMinor: string };
    customerBorneDiscountOrReduction: PayableComponent;
    tax: PayableComponent;
    serviceCharges: PayableComponent;
    tips: PayableComponent;
    otherExplicitCustomerFacingCharges: PayableComponent;
    customerPayableMinor: string;
    semanticFingerprint: string;
  };
  checks: Array<{
    settlementCheckId: string;
    checkNumber: number;
    state: SettlementCheckState;
    customerPayableMinor: string;
    allocatedAmountMinor: string;
    outstandingAmountMinor: string;
    version: number;
  }>;
};

function componentToDb(c: PayableComponent): string | null {
  return c.presence === 'ABSENT' ? null : c.amountMinor;
}

function componentFromDb(v: string | null): PayableComponent {
  return presentOrAbsent(v);
}

function payableSnapshotFingerprint(input: {
  commercialFingerprint: string;
  merchandiseGrossMinor: string;
  customerBorneDiscountOrReduction: PayableComponent;
  tax: PayableComponent;
  serviceCharges: PayableComponent;
  tips: PayableComponent;
  otherExplicitCustomerFacingCharges: PayableComponent;
  customerPayableMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        commercialFingerprint: input.commercialFingerprint,
        merchandiseGrossMinor: input.merchandiseGrossMinor,
        customerBorneDiscountOrReduction: input.customerBorneDiscountOrReduction,
        tax: input.tax,
        serviceCharges: input.serviceCharges,
        tips: input.tips,
        otherExplicitCustomerFacingCharges: input.otherExplicitCustomerFacingCharges,
        customerPayableMinor: input.customerPayableMinor,
        currencyCode: input.currencyCode,
        minorUnitExponent: input.minorUnitExponent,
      }),
    )
    .digest('hex');
}

export type SettlementServiceDeps = {
  coverageReader?: QualifyingPaymentCoverageReader;
  fiscalGate?: FiscalCheckoutGate;
  externalEffects?: SettlementExternalEffectProbe;
};

export class SettlementService {
  private readonly coverage: QualifyingPaymentCoverageReader;
  private readonly fiscalGate: FiscalCheckoutGate;
  private readonly externalEffects: SettlementExternalEffectProbe;

  constructor(
    private readonly pool: Pool,
    deps: SettlementServiceDeps = {},
  ) {
    this.coverage = deps.coverageReader ?? databasePaymentCoverageReader(pool);
    this.fiscalGate = deps.fiscalGate ?? unavailableFiscalCheckoutGate();
    this.externalEffects = deps.externalEffects ?? emptyExternalEffectProbe();
  }

  withDeps(deps: SettlementServiceDeps): SettlementService {
    return new SettlementService(this.pool, {
      coverageReader: deps.coverageReader ?? this.coverage,
      fiscalGate: deps.fiscalGate ?? this.fiscalGate,
      externalEffects: deps.externalEffects ?? this.externalEffects,
    });
  }

  async hasLiveSettlement(orderId: string, client?: PoolClient): Promise<boolean> {
    const q = client ?? this.pool;
    const res = await q.query(
      `SELECT 1 FROM settlement_group
       WHERE order_id = $1 AND state IN ('COLLECTING', 'SATISFIED')
       LIMIT 1`,
      [orderId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async assertOrderEditableForMutation(orderId: string, client: PoolClient): Promise<void> {
    if (await this.hasLiveSettlement(orderId, client)) {
      throw new DomainValidationError(
        'SETTLEMENT_EDIT_LOCKED',
        'Order commercial content cannot mutate while a live Settlement exists',
      );
    }
  }

  async getLiveSettlementForOrder(orderId: string): Promise<SettlementProjection | null> {
    const res = await this.pool.query<{ settlement_group_id: string }>(
      `SELECT settlement_group_id FROM settlement_group
       WHERE order_id = $1 AND state IN ('COLLECTING', 'SATISFIED')
       LIMIT 1`,
      [orderId],
    );
    const id = res.rows[0]?.settlement_group_id;
    if (!id) return null;
    return this.getSettlement(id);
  }

  async openSettlement(raw: {
    orderId: string;
    idempotencyKey: string;
    actorId?: string | null;
    deviceId?: string | null;
  }): Promise<SettlementProjection> {
    const orderId = raw.orderId;
    const idempotencyKey = raw.idempotencyKey;
    if (!idempotencyKey || idempotencyKey.length < 1) {
      throw new DomainValidationError('VALIDATION', 'idempotencyKey is required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, orderId);
      if (order.status !== 'OPEN') {
        throw new DomainValidationError(
          'SETTLEMENT_COMMERCIAL_TERMS_NOT_CURRENT',
          `Order must be OPEN to open Settlement; status=${order.status}`,
        );
      }

      const commercial = await this.loadAcceptedCommercial(client, orderId);
      if (!commercial) {
        throw new DomainValidationError(
          'SETTLEMENT_COMMERCIAL_TERMS_NOT_CURRENT',
          'Accepted current commercial terms are required before OpenSettlement',
        );
      }

      const openSemantic = createHash('sha256')
        .update(
          JSON.stringify({
            orderId,
            commercialFingerprint: commercial.head.semantic_fingerprint,
            currencyCode: commercial.head.currency_code,
            minorUnitExponent: commercial.head.minor_unit_exponent,
            merchandiseGrossMinor: commercial.merchandiseGrossMinor,
            customerPayableMinor: commercial.customerPayableMinor,
          }),
        )
        .digest('hex');

      const priorIdem = await client.query<{
        settlement_group_id: string;
        open_semantic_fingerprint: string;
        state: string;
      }>(
        `SELECT settlement_group_id, open_semantic_fingerprint, state
         FROM settlement_group
         WHERE order_id = $1 AND open_idempotency_key = $2
           AND state IN ('COLLECTING', 'SATISFIED')
         FOR UPDATE`,
        [orderId, idempotencyKey],
      );
      if (priorIdem.rowCount === 1) {
        const row = priorIdem.rows[0]!;
        if (row.open_semantic_fingerprint !== openSemantic) {
          throw new IdempotencyConflictError(
            idempotencyKey,
            'OpenSettlement idempotency key reused with different commercial semantics',
          );
        }
        await client.query('COMMIT');
        return this.getSettlement(row.settlement_group_id);
      }

      const live = await client.query(
        `SELECT settlement_group_id FROM settlement_group
         WHERE order_id = $1 AND state IN ('COLLECTING', 'SATISFIED')
         FOR UPDATE`,
        [orderId],
      );
      if ((live.rowCount ?? 0) > 0) {
        throw new DomainValidationError(
          'SETTLEMENT_ALREADY_OPEN',
          'A live SettlementGroup already exists for this Order',
        );
      }

      if (commercial.lines.length === 0 && commercial.merchandiseGrossMinor !== '0') {
        throw new DomainValidationError(
          'SETTLEMENT_PAYABLE_UNAVAILABLE',
          'Merchandise gross unavailable for Settlement',
        );
      }

      const merchandiseGross: PayableComponent = {
        presence: 'PRESENT',
        amountMinor: commercial.merchandiseGrossMinor,
      };
      const absent = presentOrAbsent(null);
      // MVP: unsupported components ABSENT; customerPayable = merchandiseGross numerically
      const customerPayableMinor = commercial.merchandiseGrossMinor;

      const snapFp = payableSnapshotFingerprint({
        commercialFingerprint: commercial.head.semantic_fingerprint,
        merchandiseGrossMinor: commercial.merchandiseGrossMinor,
        customerBorneDiscountOrReduction: absent,
        tax: absent,
        serviceCharges: absent,
        tips: absent,
        otherExplicitCustomerFacingCharges: absent,
        customerPayableMinor,
        currencyCode: commercial.head.currency_code,
        minorUnitExponent: commercial.head.minor_unit_exponent,
      });

      const snapshotId = randomUUID();
      await client.query(
        `INSERT INTO settlement_payable_snapshot (
           settlement_payable_snapshot_id, tenant_id, order_id, legal_entity_id,
           currency_code, minor_unit_exponent, commercial_fingerprint,
           merchandise_gross_minor,
           customer_borne_discount_or_reduction_minor, tax_minor, service_charges_minor,
           tips_minor, other_explicit_customer_facing_charges_minor,
           customer_payable_minor, semantic_fingerprint, provenance_json
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb
         )`,
        [
          snapshotId,
          order.tenant_id,
          orderId,
          order.legal_entity_id,
          commercial.head.currency_code,
          commercial.head.minor_unit_exponent,
          commercial.head.semantic_fingerprint,
          commercial.merchandiseGrossMinor,
          componentToDb(absent),
          componentToDb(absent),
          componentToDb(absent),
          componentToDb(absent),
          componentToDb(absent),
          customerPayableMinor,
          snapFp,
          JSON.stringify({
            source: 'S1.1_OPEN_SETTLEMENT',
            merchandiseGrossPresence: merchandiseGross.presence,
            mvpAbsentExtras: true,
          }),
        ],
      );

      const groupId = randomUUID();
      // Zero-payable stays COLLECTING until reconcile/Checkout advance (safe Abort remains possible).
      const groupState: SettlementGroupState = 'COLLECTING';

      await client.query(
        `INSERT INTO settlement_group (
           settlement_group_id, tenant_id, order_id, legal_entity_id, state,
           currency_code, minor_unit_exponent, commercial_fingerprint,
           settlement_payable_snapshot_id, customer_payable_minor, version,
           open_idempotency_key, open_semantic_fingerprint, actor_id, device_id,
           satisfied_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,
           NULL
         )`,
        [
          groupId,
          order.tenant_id,
          orderId,
          order.legal_entity_id,
          groupState,
          commercial.head.currency_code,
          commercial.head.minor_unit_exponent,
          commercial.head.semantic_fingerprint,
          snapshotId,
          customerPayableMinor,
          idempotencyKey,
          openSemantic,
          raw.actorId ?? null,
          raw.deviceId ?? null,
        ],
      );

      const checkId = randomUUID();
      const checkState: SettlementCheckState = 'COLLECTING';
      await client.query(
        `INSERT INTO settlement_check (
           settlement_check_id, settlement_group_id, tenant_id, state,
           customer_payable_minor, currency_code, minor_unit_exponent, check_number, version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1)`,
        [
          checkId,
          groupId,
          order.tenant_id,
          checkState,
          customerPayableMinor,
          commercial.head.currency_code,
          commercial.head.minor_unit_exponent,
        ],
      );

      assertExactCheckPayableConservation(customerPayableMinor, [customerPayableMinor]);

      for (const line of commercial.lines) {
        await client.query(
          `INSERT INTO settlement_check_line_allocation (
             settlement_check_line_allocation_id, settlement_check_id, settlement_group_id,
             order_line_id, allocated_merchandise_gross_minor
           ) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), checkId, groupId, line.order_line_id, line.gross_merchandise_minor],
        );
        assertExactLineAllocationConservation(line.gross_merchandise_minor, [
          line.gross_merchandise_minor,
        ]);
      }

      await client.query('COMMIT');
      return this.getSettlement(groupId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async abortSettlement(raw: {
    settlementGroupId: string;
    expectedVersion?: number;
  }): Promise<SettlementProjection> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await this.lockGroup(client, raw.settlementGroupId);
      if (group.state === 'ABORTED') {
        await client.query('COMMIT');
        return this.getSettlement(group.settlement_group_id);
      }
      if (group.state === 'SATISFIED') {
        throw new DomainValidationError(
          'SETTLEMENT_ABORT_FORBIDDEN',
          'Cannot abort a SATISFIED SettlementGroup',
        );
      }
      if (raw.expectedVersion != null && group.version !== raw.expectedVersion) {
        throw new DomainValidationError(
          'SETTLEMENT_STALE_VERSION',
          `Settlement version mismatch: expected ${raw.expectedVersion}, actual ${group.version}`,
        );
      }

      await this.lockOrder(client, group.order_id);

      if (await this.externalEffects.hasQualifyingPaymentExternalEffect(group.settlement_group_id)) {
        throw new DomainValidationError(
          'SETTLEMENT_ABORT_FORBIDDEN',
          'Abort forbidden: qualifying Payment external effect exists',
        );
      }
      if (await this.externalEffects.hasFiscalExternalEffect(group.settlement_group_id)) {
        throw new DomainValidationError(
          'SETTLEMENT_ABORT_FORBIDDEN',
          'Abort forbidden: Fiscal external effect exists',
        );
      }

      await client.query(
        `UPDATE settlement_group
         SET state = 'ABORTED', aborted_at = NOW(), version = version + 1
         WHERE settlement_group_id = $1`,
        [group.settlement_group_id],
      );
      await client.query('COMMIT');
      return this.getSettlement(group.settlement_group_id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async reconcileSettlementCoverage(settlementGroupId: string): Promise<SettlementProjection> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await this.lockGroup(client, settlementGroupId);
      if (group.state === 'ABORTED') {
        throw new DomainValidationError(
          'SETTLEMENT_NOT_SATISFIED',
          'Cannot reconcile coverage on an ABORTED SettlementGroup',
        );
      }

      const checks = await client.query<{
        settlement_check_id: string;
        customer_payable_minor: string;
        state: string;
        version: number;
      }>(
        `SELECT settlement_check_id, customer_payable_minor, state, version
         FROM settlement_check WHERE settlement_group_id = $1
         ORDER BY check_number ASC FOR UPDATE`,
        [settlementGroupId],
      );

      const checkIds = checks.rows.map((c) => c.settlement_check_id);
      const allocations = await this.coverage.listQualifyingAllocations({
        settlementGroupId,
        settlementCheckIds: checkIds,
      });

      let allSatisfied = true;
      for (const check of checks.rows) {
        const mins = allocations
          .filter((a) => a.settlementCheckId === check.settlement_check_id)
          .map((a) => a.amountMinor);
        let coverage;
        try {
          coverage = evaluateCheckCoverage({
            checkPayableMinor: check.customer_payable_minor,
            qualifyingAllocationMinors: mins,
          });
        } catch (err) {
          const code =
            err && typeof err === 'object' && 'code' in err
              ? String((err as { code: unknown }).code)
              : null;
          if (code === 'SETTLEMENT_OVERALLOCATION') {
            throw new DomainValidationError(
              'SETTLEMENT_OVERALLOCATION',
              err instanceof Error ? err.message : 'Over-allocation',
            );
          }
          throw err;
        }
        const nextState: SettlementCheckState = coverage.satisfied ? 'SATISFIED' : 'COLLECTING';
        if (!coverage.satisfied) allSatisfied = false;
        if (check.state !== nextState) {
          await client.query(
            `UPDATE settlement_check SET state = $2, version = version + 1
             WHERE settlement_check_id = $1`,
            [check.settlement_check_id, nextState],
          );
        }
      }

      if (allSatisfied && group.state !== 'SATISFIED') {
        await client.query(
          `UPDATE settlement_group
           SET state = 'SATISFIED', satisfied_at = NOW(), version = version + 1
           WHERE settlement_group_id = $1`,
          [settlementGroupId],
        );
      } else if (!allSatisfied && group.state === 'SATISFIED') {
        // Coverage regression should not silently reopen — treat as invalid coverage set
        throw new DomainValidationError(
          'SETTLEMENT_NOT_SATISFIED',
          'Settlement was SATISFIED but current qualifying coverage no longer covers all Checks',
        );
      }

      await client.query('COMMIT');
      return this.getSettlement(settlementGroupId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSettlement(settlementGroupId: string): Promise<SettlementProjection> {
    const groupRes = await this.pool.query<{
      settlement_group_id: string;
      order_id: string;
      tenant_id: string;
      legal_entity_id: string;
      state: SettlementGroupState;
      currency_code: string;
      minor_unit_exponent: number;
      commercial_fingerprint: string;
      settlement_payable_snapshot_id: string;
      customer_payable_minor: string;
      version: number;
    }>(`SELECT * FROM settlement_group WHERE settlement_group_id = $1`, [settlementGroupId]);
    const group = groupRes.rows[0];
    if (!group) throw new NotFoundError(`SettlementGroup not found: ${settlementGroupId}`);

    const snapRes = await this.pool.query<{
      settlement_payable_snapshot_id: string;
      merchandise_gross_minor: string;
      customer_borne_discount_or_reduction_minor: string | null;
      tax_minor: string | null;
      service_charges_minor: string | null;
      tips_minor: string | null;
      other_explicit_customer_facing_charges_minor: string | null;
      customer_payable_minor: string;
      semantic_fingerprint: string;
    }>(
      `SELECT * FROM settlement_payable_snapshot WHERE settlement_payable_snapshot_id = $1`,
      [group.settlement_payable_snapshot_id],
    );
    const snap = snapRes.rows[0]!;

    const checksRes = await this.pool.query<{
      settlement_check_id: string;
      check_number: number;
      state: SettlementCheckState;
      customer_payable_minor: string;
      version: number;
    }>(
      `SELECT settlement_check_id, check_number, state, customer_payable_minor, version
       FROM settlement_check WHERE settlement_group_id = $1 ORDER BY check_number ASC`,
      [settlementGroupId],
    );

    const checkIds = checksRes.rows.map((c) => c.settlement_check_id);
    const allocations =
      group.state === 'ABORTED'
        ? []
        : await this.coverage.listQualifyingAllocations({
            settlementGroupId,
            settlementCheckIds: checkIds,
          });

    let allocatedTotal = 0n;
    let outstandingTotal = 0n;
    const checks = checksRes.rows.map((c) => {
      const mins = allocations
        .filter((a) => a.settlementCheckId === c.settlement_check_id)
        .map((a) => a.amountMinor);
      const coverage = evaluateCheckCoverage({
        checkPayableMinor: c.customer_payable_minor,
        qualifyingAllocationMinors: mins,
      });
      allocatedTotal += BigInt(coverage.allocatedAmountMinor);
      outstandingTotal += BigInt(coverage.outstandingAmountMinor);
      return {
        settlementCheckId: c.settlement_check_id,
        checkNumber: c.check_number,
        state: c.state,
        customerPayableMinor: c.customer_payable_minor,
        allocatedAmountMinor: coverage.allocatedAmountMinor,
        outstandingAmountMinor: coverage.outstandingAmountMinor,
        version: c.version,
      };
    });

    return {
      settlementGroupId: group.settlement_group_id,
      orderId: group.order_id,
      tenantId: group.tenant_id,
      legalEntityId: group.legal_entity_id,
      state: group.state,
      currencyCode: group.currency_code,
      minorUnitExponent: group.minor_unit_exponent,
      commercialFingerprint: group.commercial_fingerprint,
      version: group.version,
      merchandiseGrossMinor: snap.merchandise_gross_minor,
      customerPayableMinor: group.customer_payable_minor,
      allocatedAmountMinor: allocatedTotal.toString(),
      outstandingAmountMinor: outstandingTotal.toString(),
      payableSnapshot: {
        settlementPayableSnapshotId: snap.settlement_payable_snapshot_id,
        merchandiseGross: {
          presence: 'PRESENT',
          amountMinor: snap.merchandise_gross_minor,
        },
        customerBorneDiscountOrReduction: componentFromDb(
          snap.customer_borne_discount_or_reduction_minor,
        ),
        tax: componentFromDb(snap.tax_minor),
        serviceCharges: componentFromDb(snap.service_charges_minor),
        tips: componentFromDb(snap.tips_minor),
        otherExplicitCustomerFacingCharges: componentFromDb(
          snap.other_explicit_customer_facing_charges_minor,
        ),
        customerPayableMinor: snap.customer_payable_minor,
        semanticFingerprint: snap.semantic_fingerprint,
      },
      checks,
    };
  }

  async splitChecksExact(raw: {
    settlementGroupId: string;
    expectedVersion: number;
    checks: Array<{
      customerPayableMinor: string;
      lineAllocations: Array<{ orderLineId: string; allocatedMerchandiseGrossMinor: string }>;
    }>;
  }): Promise<SettlementProjection> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await this.lockGroup(client, raw.settlementGroupId);
      if (group.state !== 'COLLECTING') {
        throw new DomainValidationError(
          'SETTLEMENT_NOT_SATISFIED',
          'Exact split only allowed while Settlement is COLLECTING',
        );
      }
      if (group.version !== raw.expectedVersion) {
        throw new DomainValidationError(
          'SETTLEMENT_STALE_VERSION',
          `Settlement version mismatch: expected ${raw.expectedVersion}, actual ${group.version}`,
        );
      }

      // External effects forbid structural change
      if (await this.externalEffects.hasQualifyingPaymentExternalEffect(group.settlement_group_id)) {
        throw new DomainValidationError(
          'SETTLEMENT_ABORT_FORBIDDEN',
          'Cannot split after qualifying Payment external effect',
        );
      }

      const payables = raw.checks.map((c) => c.customerPayableMinor);
      try {
        assertExactCheckPayableConservation(group.customer_payable_minor, payables);
      } catch (err) {
        throw new DomainValidationError(
          'SETTLEMENT_SPLIT_NOT_CONSERVING',
          err instanceof Error ? err.message : 'Split not conserving',
        );
      }

      for (const c of raw.checks) {
        if (!/^[0-9]+$/.test(c.customerPayableMinor)) {
          throw new DomainValidationError(
            'SETTLEMENT_SPLIT_NOT_CONSERVING',
            'Check payable must be integer minor string',
          );
        }
      }

      // Line conservation across all new checks
      const byLine = new Map<string, string[]>();
      for (const check of raw.checks) {
        for (const la of check.lineAllocations) {
          const arr = byLine.get(la.orderLineId) ?? [];
          arr.push(la.allocatedMerchandiseGrossMinor);
          byLine.set(la.orderLineId, arr);
        }
      }
      const lines = await client.query<{
        order_line_id: string;
        gross_merchandise_minor: string;
      }>(
        `SELECT cl.order_line_id, cl.gross_merchandise_minor
         FROM sales_order_commercial_line_terms cl
         WHERE cl.order_id = $1`,
        [group.order_id],
      );
      // Live settlement freezes commercial terms; lines still present for conservation proof.
      const lineGross = new Map(
        lines.rows.map((r) => [r.order_line_id, r.gross_merchandise_minor]),
      );
      for (const [lineId, gross] of lineGross) {
        const parts = byLine.get(lineId) ?? [];
        try {
          assertExactLineAllocationConservation(gross, parts);
        } catch (err) {
          throw new DomainValidationError(
            'SETTLEMENT_SPLIT_NOT_CONSERVING',
            err instanceof Error ? err.message : 'Line split not conserving',
          );
        }
      }
      for (const lineId of byLine.keys()) {
        if (!lineGross.has(lineId)) {
          throw new DomainValidationError(
            'SETTLEMENT_SPLIT_NOT_CONSERVING',
            `Unknown order line in split: ${lineId}`,
          );
        }
      }

      await client.query(
        `DELETE FROM settlement_check_line_allocation WHERE settlement_group_id = $1`,
        [group.settlement_group_id],
      );
      await client.query(`DELETE FROM settlement_check WHERE settlement_group_id = $1`, [
        group.settlement_group_id,
      ]);

      let n = 1;
      for (const check of raw.checks) {
        const checkId = randomUUID();
        await client.query(
          `INSERT INTO settlement_check (
             settlement_check_id, settlement_group_id, tenant_id, state,
             customer_payable_minor, currency_code, minor_unit_exponent, check_number, version
           ) VALUES ($1,$2,$3,'COLLECTING',$4,$5,$6,$7,1)`,
          [
            checkId,
            group.settlement_group_id,
            group.tenant_id,
            check.customerPayableMinor,
            group.currency_code,
            group.minor_unit_exponent,
            n++,
          ],
        );
        for (const la of check.lineAllocations) {
          await client.query(
            `INSERT INTO settlement_check_line_allocation (
               settlement_check_line_allocation_id, settlement_check_id, settlement_group_id,
               order_line_id, allocated_merchandise_gross_minor
             ) VALUES ($1,$2,$3,$4,$5)`,
            [
              randomUUID(),
              checkId,
              group.settlement_group_id,
              la.orderLineId,
              la.allocatedMerchandiseGrossMinor,
            ],
          );
        }
      }

      await client.query(
        `UPDATE settlement_group SET version = version + 1 WHERE settlement_group_id = $1`,
        [group.settlement_group_id],
      );
      await client.query('COMMIT');
      return this.getSettlement(group.settlement_group_id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  observeFiscalGate(settlementGroupId: string) {
    return this.getSettlement(settlementGroupId).then((s) =>
      this.fiscalGate.observe({
        settlementGroupId: s.settlementGroupId,
        orderId: s.orderId,
        legalEntityId: s.legalEntityId,
      }),
    );
  }

  private async loadAcceptedCommercial(
    client: PoolClient,
    orderId: string,
  ): Promise<{
    head: CommercialHead;
    lines: CommercialLine[];
    merchandiseGrossMinor: string;
    customerPayableMinor: string;
  } | null> {
    const head = await client.query<CommercialHead>(
      `SELECT currency_code, minor_unit_exponent, semantic_fingerprint
       FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    if (head.rowCount !== 1) return null;
    const lines = await client.query<CommercialLine>(
      `SELECT order_line_id, line_number, gross_merchandise_minor
       FROM sales_order_commercial_line_terms
       WHERE order_id = $1 ORDER BY line_number ASC`,
      [orderId],
    );
    let gross = 0n;
    for (const l of lines.rows) {
      if (!/^[0-9]+$/.test(l.gross_merchandise_minor)) {
        throw new DomainValidationError(
          'SETTLEMENT_PAYABLE_UNAVAILABLE',
          'Authoritative merchandise gross unavailable',
        );
      }
      gross += BigInt(l.gross_merchandise_minor);
    }
    return {
      head: head.rows[0]!,
      lines: lines.rows,
      merchandiseGrossMinor: gross.toString(),
      customerPayableMinor: gross.toString(),
    };
  }

  private async lockOrder(client: PoolClient, orderId: string): Promise<OrderRow> {
    const res = await client.query<OrderRow>(
      `SELECT order_id, tenant_id, legal_entity_id, outlet_id, status
       FROM sales_order WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`Order not found: ${orderId}`);
    return row;
  }

  private async lockGroup(
    client: PoolClient,
    settlementGroupId: string,
  ): Promise<{
    settlement_group_id: string;
    order_id: string;
    tenant_id: string;
    legal_entity_id: string;
    state: SettlementGroupState;
    version: number;
    customer_payable_minor: string;
    currency_code: string;
    minor_unit_exponent: number;
  }> {
    const res = await client.query(
      `SELECT settlement_group_id, order_id, tenant_id, legal_entity_id, state, version,
              customer_payable_minor, currency_code, minor_unit_exponent
       FROM settlement_group WHERE settlement_group_id = $1 FOR UPDATE`,
      [settlementGroupId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`SettlementGroup not found: ${settlementGroupId}`);
    return row;
  }
}
