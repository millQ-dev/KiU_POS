/**
 * TAX1.1 — Minimal Vietnam direct-sale Tax runtime (ADR-0033 / ADR-0034 narrow / ADR-0037).
 * Resolution: OrderLine → CatalogItem → TaxClassificationAssignment → TaxClassification → TaxPolicyVersion.
 * Settlement freezes; Fiscalization must not invent VAT.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  allocateOrderMerchantDiscount,
  aggregateTaxLineResults,
  calculateTaxLine,
  type PricingTaxMode,
  type TaxableBaseRuleId,
  type TaxLineCalcResult,
  type TaxRoundingPolicySnapshot,
  type TaxTreatment,
} from '@millq/domain';
import { DomainValidationError, IdempotencyConflictError, NotFoundError } from '../orders/errors.js';

type RoundingRow = {
  rounding_policy_id: string;
  policy_version: number;
  calculation_context: string;
  rounding_mode: string;
  quantum_minor: string;
};

type PolicyVersionRow = {
  tax_policy_version_id: string;
  tax_policy_id: string;
  policy_version: number;
  pricing_tax_mode: PricingTaxMode;
  tax_treatment: TaxTreatment;
  rate_decimal: string | null;
  taxable_base_rule: TaxableBaseRuleId;
  tax_rounding_strategy: string;
  inclusive_extraction_rounding_policy_id: string | null;
  vat_amount_rounding_policy_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
};

type LineResolution = {
  soldCatalogItemId: string;
  assignmentId: string;
  classificationId: string;
  policyVersion: PolicyVersionRow;
  calc: TaxLineCalcResult;
};

export type TaxOrderSnapshotProjection = {
  taxOrderSnapshotId: string;
  orderId: string;
  legalEntityId: string;
  commercialFingerprint: string;
  taxPolicyId: string | null;
  taxPolicyVersionId: string | null;
  policyVersion: number | null;
  pricingTaxMode: PricingTaxMode | null;
  taxTreatment: TaxTreatment | null;
  rateDecimal: string | null;
  taxableBaseRule: TaxableBaseRuleId | null;
  algorithmId: string;
  currencyCode: string;
  minorUnitExponent: number;
  taxableBaseTotalMinor: string | null;
  vatTotalMinor: string | null;
  amountIncludingTaxTotalMinor: string | null;
  customerPayableMerchandiseMinor: string;
  customerPayableMinor: string;
  semanticFingerprint: string;
  acceptedAt: string;
  lines: Array<{
    orderLineId: string;
    lineNumber: number;
    soldCatalogItemId: string;
    taxClassificationAssignmentId: string;
    taxClassificationId: string;
    taxPolicyId: string;
    taxPolicyVersionId: string;
    policyVersion: number;
    gMinor: string;
    mMinor: string;
    rCfMinor: string;
    cMinor: string;
    xMinor: string;
    taxableBaseMinor: string | null;
    vatMinor: string | null;
    amountIncludingTaxMinor: string | null;
    lineMerchandisePayableMinor: string;
    rateDecimal: string | null;
    pricingTaxMode: PricingTaxMode;
  }>;
};

function toRoundingSnapshot(row: RoundingRow): TaxRoundingPolicySnapshot {
  if (
    row.calculation_context !== 'TAX_INCLUSIVE_EXTRACTION' &&
    row.calculation_context !== 'TAX_LINE_VAT_AMOUNT'
  ) {
    throw new DomainValidationError(
      'TAX_ROUNDING_POLICY_INVALID',
      `Unexpected tax rounding context ${row.calculation_context}`,
    );
  }
  return {
    roundingPolicyId: row.rounding_policy_id,
    policyVersion: row.policy_version,
    calculationContext: row.calculation_context,
    roundingMode: row.rounding_mode as TaxRoundingPolicySnapshot['roundingMode'],
    quantumMinor: row.quantum_minor,
  };
}

export class TaxService {
  constructor(private readonly pool: Pool) {}

  async isTaxRequired(legalEntityId: string): Promise<boolean> {
    const res = await this.pool.query<{ tax_required: boolean }>(
      `SELECT tax_required FROM legal_entity WHERE legal_entity_id = $1`,
      [legalEntityId],
    );
    return res.rows[0]?.tax_required === true;
  }

  async getAcceptedTaxSnapshotForCommercial(input: {
    orderId: string;
    commercialFingerprint: string;
  }): Promise<TaxOrderSnapshotProjection | null> {
    const head = await this.pool.query<{ tax_order_snapshot_id: string }>(
      `SELECT tax_order_snapshot_id FROM tax_order_snapshot
       WHERE order_id = $1 AND commercial_fingerprint = $2`,
      [input.orderId, input.commercialFingerprint],
    );
    if (head.rowCount !== 1) return null;
    return this.getTaxSnapshot(head.rows[0]!.tax_order_snapshot_id);
  }

  async getTaxSnapshot(taxOrderSnapshotId: string): Promise<TaxOrderSnapshotProjection> {
    const head = await this.pool.query(
      `SELECT * FROM tax_order_snapshot WHERE tax_order_snapshot_id = $1`,
      [taxOrderSnapshotId],
    );
    const row = head.rows[0];
    if (!row) throw new NotFoundError(`TaxOrderSnapshot not found: ${taxOrderSnapshotId}`);
    const lines = await this.pool.query(
      `SELECT * FROM tax_line_snapshot
       WHERE tax_order_snapshot_id = $1 ORDER BY line_number ASC`,
      [taxOrderSnapshotId],
    );
    return {
      taxOrderSnapshotId: row.tax_order_snapshot_id,
      orderId: row.order_id,
      legalEntityId: row.legal_entity_id,
      commercialFingerprint: row.commercial_fingerprint,
      taxPolicyId: row.tax_policy_id,
      taxPolicyVersionId: row.tax_policy_version_id,
      policyVersion: row.policy_version,
      pricingTaxMode: row.pricing_tax_mode,
      taxTreatment: row.tax_treatment,
      rateDecimal: row.rate_decimal,
      taxableBaseRule: row.taxable_base_rule,
      algorithmId: row.algorithm_id,
      currencyCode: row.currency_code,
      minorUnitExponent: row.minor_unit_exponent,
      taxableBaseTotalMinor: row.taxable_base_total_minor,
      vatTotalMinor: row.vat_total_minor,
      amountIncludingTaxTotalMinor: row.amount_including_tax_total_minor,
      customerPayableMerchandiseMinor: row.customer_payable_merchandise_minor,
      customerPayableMinor: row.customer_payable_minor,
      semanticFingerprint: row.semantic_fingerprint,
      acceptedAt: new Date(row.accepted_at).toISOString(),
      lines: lines.rows.map((l) => ({
        orderLineId: l.order_line_id,
        lineNumber: l.line_number,
        soldCatalogItemId: l.sold_catalog_item_id,
        taxClassificationAssignmentId: l.tax_classification_assignment_id,
        taxClassificationId: l.tax_classification_id,
        taxPolicyId: l.tax_policy_id,
        taxPolicyVersionId: l.tax_policy_version_id,
        policyVersion: l.policy_version,
        gMinor: l.g_minor,
        mMinor: l.m_minor,
        rCfMinor: l.r_cf_minor,
        cMinor: l.c_minor,
        xMinor: l.x_minor,
        taxableBaseMinor: l.taxable_base_minor,
        vatMinor: l.vat_minor,
        amountIncludingTaxMinor: l.amount_including_tax_minor,
        lineMerchandisePayableMinor: l.line_merchandise_payable_minor,
        rateDecimal: l.rate_decimal,
        pricingTaxMode: l.pricing_tax_mode,
      })),
    };
  }

  /**
   * Calculate + accept immutable TaxOrderSnapshot for current commercial terms.
   * Per-line ADR-0033 assignment chain. Fail closed on missing/ambiguous assignment.
   */
  async acceptTaxSnapshot(raw: {
    orderId: string;
    idempotencyKey: string;
    businessDateTime?: string | Date;
  }): Promise<TaxOrderSnapshotProjection> {
    const idempotencyKey = raw.idempotencyKey;
    if (!idempotencyKey || idempotencyKey.length < 1) {
      throw new DomainValidationError('VALIDATION', 'idempotencyKey is required');
    }
    const at = raw.businessDateTime ? new Date(raw.businessDateTime) : new Date();
    if (Number.isNaN(at.getTime())) {
      throw new DomainValidationError('VALIDATION', 'businessDateTime invalid');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orderRes = await client.query<{
        order_id: string;
        tenant_id: string;
        legal_entity_id: string;
        status: string;
      }>(
        `SELECT order_id, tenant_id, legal_entity_id, status
         FROM sales_order WHERE order_id = $1 FOR UPDATE`,
        [raw.orderId],
      );
      const order = orderRes.rows[0];
      if (!order) throw new NotFoundError(`Order not found: ${raw.orderId}`);
      if (order.status !== 'OPEN') {
        throw new DomainValidationError(
          'TAX_ORDER_NOT_OPEN',
          `Order must be OPEN to accept Tax; status=${order.status}`,
        );
      }

      const le = await client.query<{
        tax_required: boolean;
        jurisdiction_code: string;
      }>(
        `SELECT tax_required, jurisdiction_code
         FROM legal_entity WHERE legal_entity_id = $1`,
        [order.legal_entity_id],
      );
      if (!le.rows[0]) {
        throw new NotFoundError(`LegalEntity not found: ${order.legal_entity_id}`);
      }

      const commercial = await this.loadCommercial(client, raw.orderId);
      if (!commercial) {
        throw new DomainValidationError(
          'TAX_COMMERCIAL_REQUIRED',
          'Accepted commercial terms required before Tax accept',
        );
      }

      for (const line of commercial.lines) {
        if (line.thirdPartyMerchandiseFundingMinor !== '0') {
          throw new DomainValidationError(
            'TAX_THIRD_PARTY_FUNDING_UNSUPPORTED',
            'Third-party-funded promotions are unsupported in TAX1.1 C0 slice',
          );
        }
      }

      const priorIdem = await client.query(
        `SELECT tax_order_snapshot_id, commercial_fingerprint
         FROM tax_order_snapshot
         WHERE order_id = $1 AND accept_idempotency_key = $2
         FOR UPDATE`,
        [raw.orderId, idempotencyKey],
      );
      if (priorIdem.rowCount === 1) {
        const prior = priorIdem.rows[0]!;
        if (prior.commercial_fingerprint !== commercial.fingerprint) {
          throw new IdempotencyConflictError(
            idempotencyKey,
            'Tax accept idempotency key reused with different commercial fingerprint',
          );
        }
        await client.query('COMMIT');
        return this.getTaxSnapshot(prior.tax_order_snapshot_id);
      }

      const existingFp = await client.query(
        `SELECT tax_order_snapshot_id FROM tax_order_snapshot
         WHERE order_id = $1 AND commercial_fingerprint = $2`,
        [raw.orderId, commercial.fingerprint],
      );
      if (existingFp.rowCount === 1) {
        await client.query('COMMIT');
        return this.getTaxSnapshot(existingFp.rows[0]!.tax_order_snapshot_id);
      }

      const resolved: LineResolution[] = [];
      for (const line of commercial.lines) {
        const assignment = await this.resolveAssignment(client, {
          tenantId: order.tenant_id,
          legalEntityId: order.legal_entity_id,
          catalogItemId: line.soldCatalogItemId,
          at,
        });
        const policyVersion = await this.resolvePolicyVersion(client, {
          taxPolicyId: assignment.tax_policy_id,
          tenantId: order.tenant_id,
          legalEntityId: order.legal_entity_id,
          at,
        });
        const dims = await this.loadPolicyDims(client, policyVersion);
        let calc: TaxLineCalcResult;
        try {
          calc = calculateTaxLine(
            {
              orderLineId: line.orderLineId,
              lineNumber: line.lineNumber,
              grossMerchandiseMinor: line.grossMerchandiseMinor,
              merchantFundedDiscountMinor: (
                BigInt(line.lineMerchantFundedDiscountMinor) +
                BigInt(line.allocatedOrderMerchantDiscountMinor)
              ).toString(),
              thirdPartyMerchandiseFundingMinor: line.thirdPartyMerchandiseFundingMinor,
              platformSubsidyMinor: '0',
            },
            dims,
          );
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code) {
            throw new DomainValidationError(code, (err as Error).message);
          }
          throw err;
        }
        resolved.push({
          soldCatalogItemId: line.soldCatalogItemId,
          assignmentId: assignment.tax_classification_assignment_id,
          classificationId: assignment.tax_classification_id,
          policyVersion,
          calc,
        });
      }

      const calcOrder = aggregateTaxLineResults(resolved.map((r) => r.calc));
      const customerPayableMinor = calcOrder.customerPayableMerchandiseMinor;

      const uniquePolicyIds = new Set(resolved.map((r) => r.policyVersion.tax_policy_id));
      const uniqueVersionIds = new Set(resolved.map((r) => r.policyVersion.tax_policy_version_id));
      const uniqueModes = new Set(resolved.map((r) => r.policyVersion.pricing_tax_mode));
      const uniqueTreatments = new Set(resolved.map((r) => r.policyVersion.tax_treatment));
      const uniqueBaseRules = new Set(resolved.map((r) => r.policyVersion.taxable_base_rule));
      const homogeneousPolicy = uniquePolicyIds.size === 1 && uniqueVersionIds.size === 1;
      // ADR-0034 §11: same PricingTaxMode across lines → envelope mode even if rates/policies differ.
      const commonMode = uniqueModes.size === 1 ? [...uniqueModes][0]! : null;
      const envelope = homogeneousPolicy
        ? resolved[0]!.policyVersion
        : null;

      const semanticFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            orderId: raw.orderId,
            commercialFingerprint: commercial.fingerprint,
            resolvePath: 'TAX_CLASSIFICATION_ASSIGNMENT_V1',
            lines: resolved.map((r) => ({
              orderLineId: r.calc.orderLineId,
              lineNumber: r.calc.lineNumber,
              soldCatalogItemId: r.soldCatalogItemId,
              assignmentId: r.assignmentId,
              classificationId: r.classificationId,
              taxPolicyVersionId: r.policyVersion.tax_policy_version_id,
              rateDecimal: r.policyVersion.rate_decimal,
              pricingTaxMode: r.policyVersion.pricing_tax_mode,
              gMinor: r.calc.gMinor,
              mMinor: r.calc.mMinor,
              rCfMinor: r.calc.rCfMinor,
              cMinor: r.calc.cMinor,
              xMinor: r.calc.xMinor,
              taxableBaseMinor: r.calc.taxableBaseMinor,
              vatMinor: r.calc.vatMinor,
              amountIncludingTaxMinor: r.calc.amountIncludingTaxMinor,
              lineMerchandisePayableMinor: r.calc.lineMerchandisePayableMinor,
            })),
            customerPayableMinor,
          }),
        )
        .digest('hex');

      const snapshotId = randomUUID();
      await client.query(
        `INSERT INTO tax_order_snapshot (
           tax_order_snapshot_id, tenant_id, order_id, legal_entity_id,
           commercial_fingerprint, tax_policy_id, tax_policy_version_id, policy_version,
           pricing_tax_mode, tax_treatment, rate_decimal, taxable_base_rule,
           tax_rounding_strategy, algorithm_id, currency_code, minor_unit_exponent,
           taxable_base_total_minor, vat_total_minor, amount_including_tax_total_minor,
           customer_payable_merchandise_minor, customer_payable_minor,
           semantic_fingerprint, accept_idempotency_key, provenance_json
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb
         )`,
        [
          snapshotId,
          order.tenant_id,
          raw.orderId,
          order.legal_entity_id,
          commercial.fingerprint,
          envelope?.tax_policy_id ?? null,
          envelope?.tax_policy_version_id ?? null,
          envelope?.policy_version ?? null,
          commonMode,
          homogeneousPolicy && uniqueTreatments.size === 1
            ? resolved[0]!.policyVersion.tax_treatment
            : null,
          homogeneousPolicy ? (envelope?.rate_decimal ?? null) : null,
          homogeneousPolicy && uniqueBaseRules.size === 1
            ? resolved[0]!.policyVersion.taxable_base_rule
            : null,
          'LINE_ROUND_THEN_SUM',
          calcOrder.algorithmId,
          commercial.currencyCode,
          commercial.minorUnitExponent,
          calcOrder.taxableBaseTotalMinor,
          calcOrder.vatTotalMinor,
          calcOrder.amountIncludingTaxTotalMinor,
          calcOrder.customerPayableMerchandiseMinor,
          customerPayableMinor,
          semanticFingerprint,
          idempotencyKey,
          JSON.stringify({
            source: 'TAX1.1_ACCEPT',
            jurisdictionCode: le.rows[0]!.jurisdiction_code,
            taxRequired: le.rows[0]!.tax_required,
            businessDateTime: at.toISOString(),
            resolvePath: 'TAX_CLASSIFICATION_ASSIGNMENT_V1',
            homogeneousPolicy,
            commonPricingTaxMode: commonMode,
          }),
        ],
      );

      for (const r of resolved) {
        await client.query(
          `INSERT INTO tax_line_snapshot (
             tax_line_snapshot_id, tax_order_snapshot_id, order_line_id, line_number,
             sold_catalog_item_id, tax_classification_assignment_id, tax_classification_id,
             tax_policy_id, tax_policy_version_id, policy_version,
             g_minor, m_minor, r_cf_minor, c_minor, x_minor,
             taxable_base_minor, vat_minor, amount_including_tax_minor,
             line_merchandise_payable_minor, tax_treatment, rate_decimal,
             pricing_tax_mode, taxable_base_rule, algorithm_id,
             exact_taxable_base, exact_vat
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
           )`,
          [
            randomUUID(),
            snapshotId,
            r.calc.orderLineId,
            r.calc.lineNumber,
            r.soldCatalogItemId,
            r.assignmentId,
            r.classificationId,
            r.policyVersion.tax_policy_id,
            r.policyVersion.tax_policy_version_id,
            r.policyVersion.policy_version,
            r.calc.gMinor,
            r.calc.mMinor,
            r.calc.rCfMinor,
            r.calc.cMinor,
            r.calc.xMinor,
            r.calc.taxableBaseMinor,
            r.calc.vatMinor,
            r.calc.amountIncludingTaxMinor,
            r.calc.lineMerchandisePayableMinor,
            r.calc.taxTreatment,
            r.calc.rateDecimal,
            r.calc.pricingTaxMode,
            r.calc.taxableBaseRule,
            r.calc.algorithmId,
            r.calc.exactTaxableBase,
            r.calc.exactVat,
          ],
        );
      }

      await client.query('COMMIT');
      return this.getTaxSnapshot(snapshotId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Test/admin helper: create TaxPolicy + version + classification + assignments
   * for catalog items, and mark LegalEntity tax_required.
   */
  async upsertC0TaxPolicy(input: {
    tenantId: string;
    legalEntityId: string;
    jurisdictionCode: string;
    policyCode: string;
    pricingTaxMode: PricingTaxMode;
    taxTreatment: TaxTreatment;
    rateDecimal: string | null;
    taxableBaseRule: TaxableBaseRuleId;
    catalogItemIds: readonly string[];
    classificationCode?: string;
    classificationLabel?: string;
    inclusiveRounding?: {
      roundingMode: TaxRoundingPolicySnapshot['roundingMode'];
      quantumMinor: string;
    };
    exclusiveRounding?: {
      roundingMode: TaxRoundingPolicySnapshot['roundingMode'];
      quantumMinor: string;
    };
    effectiveFrom?: Date;
    setTaxRequired?: boolean;
  }): Promise<{
    taxPolicyId: string;
    taxPolicyVersionId: string;
    taxClassificationId: string;
    assignmentIds: string[];
  }> {
    if (input.catalogItemIds.length === 0) {
      throw new DomainValidationError(
        'TAX_CLASSIFICATION_REQUIRED',
        'upsertC0TaxPolicy requires catalogItemIds for assignment chain',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const taxPolicyId = randomUUID();
      await client.query(
        `INSERT INTO tax_policy (
           tax_policy_id, tenant_id, legal_entity_id, jurisdiction_code, policy_code
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          taxPolicyId,
          input.tenantId,
          input.legalEntityId,
          input.jurisdictionCode,
          input.policyCode,
        ],
      );

      let inclId: string | null = null;
      let vatId: string | null = null;
      const eff = input.effectiveFrom ?? new Date('2020-01-01T00:00:00Z');
      const findOrCreateRounding = async (
        calculationContext: 'TAX_INCLUSIVE_EXTRACTION' | 'TAX_LINE_VAT_AMOUNT',
        roundingMode: TaxRoundingPolicySnapshot['roundingMode'],
        quantumMinor: string,
      ): Promise<string> => {
        const existing = await client.query<{ rounding_policy_id: string }>(
          `SELECT rounding_policy_id
           FROM commercial_rounding_policy
           WHERE tenant_id = $1
             AND legal_entity_id = $2
             AND jurisdiction_code = $3
             AND calculation_context = $4
             AND policy_version = 1
           LIMIT 1`,
          [
            input.tenantId,
            input.legalEntityId,
            input.jurisdictionCode,
            calculationContext,
          ],
        );
        if (existing.rows[0]) {
          return existing.rows[0].rounding_policy_id;
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO commercial_rounding_policy (
             rounding_policy_id, tenant_id, legal_entity_id, jurisdiction_code,
             calculation_context, policy_version, rounding_mode, quantum_minor,
             effective_from
           ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
          [
            id,
            input.tenantId,
            input.legalEntityId,
            input.jurisdictionCode,
            calculationContext,
            roundingMode,
            quantumMinor,
            eff,
          ],
        );
        return id;
      };
      if (input.pricingTaxMode === 'TAX_INCLUSIVE') {
        inclId = await findOrCreateRounding(
          'TAX_INCLUSIVE_EXTRACTION',
          input.inclusiveRounding?.roundingMode ?? 'HALF_UP',
          input.inclusiveRounding?.quantumMinor ?? '1',
        );
      } else {
        vatId = await findOrCreateRounding(
          'TAX_LINE_VAT_AMOUNT',
          input.exclusiveRounding?.roundingMode ?? 'HALF_UP',
          input.exclusiveRounding?.quantumMinor ?? '1',
        );
      }

      const taxPolicyVersionId = randomUUID();
      await client.query(
        `INSERT INTO tax_policy_version (
           tax_policy_version_id, tax_policy_id, tenant_id, legal_entity_id,
           policy_version, pricing_tax_mode, tax_treatment, rate_decimal,
           taxable_base_rule, tax_rounding_strategy,
           inclusive_extraction_rounding_policy_id, vat_amount_rounding_policy_id,
           effective_from
         ) VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,'LINE_ROUND_THEN_SUM',$9,$10,$11)`,
        [
          taxPolicyVersionId,
          taxPolicyId,
          input.tenantId,
          input.legalEntityId,
          input.pricingTaxMode,
          input.taxTreatment,
          input.rateDecimal,
          input.taxableBaseRule,
          inclId,
          vatId,
          eff,
        ],
      );

      const taxClassificationId = randomUUID();
      const classCode = input.classificationCode ?? `cls-${input.policyCode}`;
      await client.query(
        `INSERT INTO tax_classification (
           tax_classification_id, tenant_id, classification_code, label
         ) VALUES ($1,$2,$3,$4)`,
        [
          taxClassificationId,
          input.tenantId,
          classCode,
          input.classificationLabel ?? classCode,
        ],
      );

      const assignmentIds: string[] = [];
      for (const catalogItemId of input.catalogItemIds) {
        const assignmentId = randomUUID();
        await client.query(
          `INSERT INTO tax_classification_assignment (
             tax_classification_assignment_id, tenant_id, legal_entity_id,
             catalog_item_id, tax_classification_id, tax_policy_id, effective_from
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            assignmentId,
            input.tenantId,
            input.legalEntityId,
            catalogItemId,
            taxClassificationId,
            taxPolicyId,
            eff,
          ],
        );
        assignmentIds.push(assignmentId);
      }

      if (input.setTaxRequired !== false) {
        await client.query(
          `UPDATE legal_entity SET tax_required = TRUE WHERE legal_entity_id = $1`,
          [input.legalEntityId],
        );
      }

      await client.query('COMMIT');
      return { taxPolicyId, taxPolicyVersionId, taxClassificationId, assignmentIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async resolveAssignment(
    client: PoolClient,
    input: {
      tenantId: string;
      legalEntityId: string;
      catalogItemId: string;
      at: Date;
    },
  ): Promise<{
    tax_classification_assignment_id: string;
    tax_classification_id: string;
    tax_policy_id: string;
  }> {
    const res = await client.query<{
      tax_classification_assignment_id: string;
      tax_classification_id: string;
      tax_policy_id: string;
    }>(
      `SELECT tax_classification_assignment_id, tax_classification_id, tax_policy_id
       FROM tax_classification_assignment
       WHERE tenant_id = $1
         AND legal_entity_id = $2
         AND catalog_item_id = $3
         AND effective_from <= $4
         AND (effective_to IS NULL OR effective_to > $4)
       ORDER BY effective_from DESC`,
      [input.tenantId, input.legalEntityId, input.catalogItemId, input.at],
    );
    if (res.rowCount === 0) {
      throw new DomainValidationError(
        'TAX_CLASSIFICATION_REQUIRED',
        `No effective TaxClassificationAssignment for catalog item ${input.catalogItemId}`,
      );
    }
    if ((res.rowCount ?? 0) > 1) {
      // Overlap exclusion should prevent this; still fail closed if present.
      throw new DomainValidationError(
        'TAX_CLASSIFICATION_AMBIGUOUS',
        `Multiple effective TaxClassificationAssignments for catalog item ${input.catalogItemId}`,
      );
    }
    return res.rows[0]!;
  }

  private async resolvePolicyVersion(
    client: PoolClient,
    input: {
      taxPolicyId: string;
      tenantId: string;
      legalEntityId: string;
      at: Date;
    },
  ): Promise<PolicyVersionRow> {
    const res = await client.query<PolicyVersionRow>(
      `SELECT tax_policy_version_id, tax_policy_id, policy_version, pricing_tax_mode,
              tax_treatment, rate_decimal, taxable_base_rule, tax_rounding_strategy,
              inclusive_extraction_rounding_policy_id, vat_amount_rounding_policy_id,
              effective_from, effective_to
       FROM tax_policy_version
       WHERE tax_policy_id = $1
         AND tenant_id = $2
         AND legal_entity_id = $3
         AND effective_from <= $4
         AND (effective_to IS NULL OR effective_to > $4)
       ORDER BY policy_version DESC`,
      [input.taxPolicyId, input.tenantId, input.legalEntityId, input.at],
    );
    if (res.rowCount === 0) {
      throw new DomainValidationError(
        'TAX_POLICY_VERSION_NOT_FOUND',
        'No effective TaxPolicyVersion for business time',
      );
    }
    if ((res.rowCount ?? 0) > 1) {
      // Multiple overlapping versions for same policy — fail closed.
      const versions = new Set(res.rows.map((r) => r.tax_policy_version_id));
      if (versions.size > 1) {
        throw new DomainValidationError(
          'TAX_POLICY_AMBIGUOUS',
          'Multiple effective TaxPolicyVersions for the same TaxPolicy',
        );
      }
    }
    const row = res.rows[0]!;
    if (row.tax_treatment === 'UNKNOWN' || row.tax_treatment === 'MISSING_CONFIGURATION') {
      throw new DomainValidationError(
        'TAX_TREATMENT_FAIL_CLOSED',
        `Tax treatment ${row.tax_treatment} cannot be accepted`,
      );
    }
    return row;
  }

  private async loadPolicyDims(client: PoolClient, version: PolicyVersionRow) {
    let inclusive: TaxRoundingPolicySnapshot | null = null;
    let vat: TaxRoundingPolicySnapshot | null = null;
    if (version.inclusive_extraction_rounding_policy_id) {
      const r = await client.query<RoundingRow>(
        `SELECT rounding_policy_id, policy_version, calculation_context, rounding_mode, quantum_minor
         FROM commercial_rounding_policy WHERE rounding_policy_id = $1`,
        [version.inclusive_extraction_rounding_policy_id],
      );
      if (r.rowCount !== 1) {
        throw new DomainValidationError('TAX_ROUNDING_POLICY_REQUIRED', 'Inclusive rounding missing');
      }
      inclusive = toRoundingSnapshot(r.rows[0]!);
    }
    if (version.vat_amount_rounding_policy_id) {
      const r = await client.query<RoundingRow>(
        `SELECT rounding_policy_id, policy_version, calculation_context, rounding_mode, quantum_minor
         FROM commercial_rounding_policy WHERE rounding_policy_id = $1`,
        [version.vat_amount_rounding_policy_id],
      );
      if (r.rowCount !== 1) {
        throw new DomainValidationError('TAX_ROUNDING_POLICY_REQUIRED', 'VAT rounding missing');
      }
      vat = toRoundingSnapshot(r.rows[0]!);
    }
    return {
      pricingTaxMode: version.pricing_tax_mode,
      taxTreatment: version.tax_treatment,
      rateDecimal: version.rate_decimal,
      taxableBaseRule: version.taxable_base_rule,
      inclusiveExtractionRounding: inclusive,
      vatAmountRounding: vat,
    };
  }

  private async loadCommercial(
    client: PoolClient,
    orderId: string,
  ): Promise<{
    fingerprint: string;
    currencyCode: string;
    minorUnitExponent: number;
    lines: Array<{
      orderLineId: string;
      lineNumber: number;
      soldCatalogItemId: string;
      grossMerchandiseMinor: string;
      lineMerchantFundedDiscountMinor: string;
      allocatedOrderMerchantDiscountMinor: string;
      thirdPartyMerchandiseFundingMinor: string;
    }>;
  } | null> {
    const head = await client.query<{
      currency_code: string;
      minor_unit_exponent: number;
      semantic_fingerprint: string;
      order_merchant_funded_discount_minor: string;
    }>(
      `SELECT currency_code, minor_unit_exponent, semantic_fingerprint,
              order_merchant_funded_discount_minor
       FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    if (head.rowCount !== 1) return null;
    const lines = await client.query<{
      order_line_id: string;
      line_number: number;
      sold_catalog_item_id: string;
      gross_merchandise_minor: string;
      line_merchant_funded_discount_minor: string;
      eligible_for_order_discount: boolean;
      third_party_merchandise_funding_minor: string;
    }>(
      `SELECT order_line_id, line_number, sold_catalog_item_id, gross_merchandise_minor,
              line_merchant_funded_discount_minor,
              eligible_for_order_discount,
              third_party_merchandise_funding_minor
       FROM sales_order_commercial_line_terms
       WHERE order_id = $1 ORDER BY line_number ASC`,
      [orderId],
    );
    if (lines.rowCount === 0) {
      throw new DomainValidationError('TAX_LINES_REQUIRED', 'Tax requires commercial lines');
    }
    const h = head.rows[0]!;
    const allocations = allocateOrderMerchantDiscount(
      h.order_merchant_funded_discount_minor,
      lines.rows
        .filter((l) => l.eligible_for_order_discount)
        .map((l) => ({
          orderLineId: l.order_line_id,
          lineNumber: l.line_number,
          basisMinor: (
            BigInt(l.gross_merchandise_minor) - BigInt(l.line_merchant_funded_discount_minor)
          ).toString(),
        })),
    );
    return {
      fingerprint: h.semantic_fingerprint,
      currencyCode: h.currency_code,
      minorUnitExponent: h.minor_unit_exponent,
      lines: lines.rows.map((l) => ({
        orderLineId: l.order_line_id,
        lineNumber: l.line_number,
        soldCatalogItemId: l.sold_catalog_item_id,
        grossMerchandiseMinor: l.gross_merchandise_minor,
        lineMerchantFundedDiscountMinor: l.line_merchant_funded_discount_minor,
        allocatedOrderMerchantDiscountMinor: allocations.get(l.order_line_id) ?? '0',
        thirdPartyMerchandiseFundingMinor: l.third_party_merchandise_funding_minor,
      })),
    };
  }
}
