import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { CommercialRoundingMode } from '@millq/domain';
import { DomainValidationError, IdempotencyConflictError, NotFoundError } from '../orders/errors.js';

type Pool = pg.Pool;
type Client = pg.PoolClient;

export const CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS = 'BASE_LIST_LINE_GROSS' as const;

export type RoundingPolicyRow = {
  roundingPolicyId: string;
  tenantId: string;
  legalEntityId: string;
  jurisdictionCode: string;
  calculationContext: typeof CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS;
  policyVersion: number;
  roundingMode: CommercialRoundingMode;
  quantumMinor: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const createPolicySchema = z
  .object({
    tenantId: z.string().uuid(),
    legalEntityId: z.string().uuid(),
    jurisdictionCode: z.string().regex(/^[A-Z]{2}$/),
    calculationContext: z.literal(CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS),
    roundingMode: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']),
    quantumMinor: z.string().regex(/^[1-9]\d*$/),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
    policyVersion: z.number().int().positive().optional(),
    createdBy: z.string().uuid().optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();

function mapRow(r: {
  rounding_policy_id: string;
  tenant_id: string;
  legal_entity_id: string;
  jurisdiction_code: string;
  calculation_context: string;
  policy_version: number;
  rounding_mode: string;
  quantum_minor: string;
  effective_from: Date | string;
  effective_to: Date | string | null;
}): RoundingPolicyRow {
  return {
    roundingPolicyId: r.rounding_policy_id,
    tenantId: r.tenant_id,
    legalEntityId: r.legal_entity_id,
    jurisdictionCode: r.jurisdiction_code,
    calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
    policyVersion: r.policy_version,
    roundingMode: r.rounding_mode as CommercialRoundingMode,
    quantumMinor: r.quantum_minor,
    effectiveFrom:
      typeof r.effective_from === 'string'
        ? r.effective_from
        : r.effective_from.toISOString(),
    effectiveTo:
      r.effective_to == null
        ? null
        : typeof r.effective_to === 'string'
          ? r.effective_to
          : r.effective_to.toISOString(),
  };
}

/**
 * Commercial RoundingPolicy persistence + resolver (ADR-0030).
 * No production default policy. No Menu inheritance.
 */
export class CommercialRoundingPolicyService {
  constructor(private readonly pool: Pool) {}

  async createPolicy(raw: unknown): Promise<RoundingPolicyRow> {
    const cmd = createPolicySchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const le = await client.query<{
        legal_entity_id: string;
        tenant_id: string;
        jurisdiction_code: string;
      }>(
        `SELECT legal_entity_id, tenant_id, jurisdiction_code FROM legal_entity WHERE legal_entity_id = $1 FOR UPDATE`,
        [cmd.legalEntityId],
      );
      if (le.rowCount !== 1) throw new NotFoundError('LegalEntity not found');
      const entity = le.rows[0]!;
      if (entity.tenant_id !== cmd.tenantId) {
        throw new DomainValidationError(
          'COMMERCIAL_ROUNDING_POLICY_INVALID',
          'LegalEntity does not belong to tenant',
        );
      }
      if (entity.jurisdiction_code !== cmd.jurisdictionCode) {
        throw new DomainValidationError(
          'COMMERCIAL_ROUNDING_POLICY_INVALID',
          'jurisdictionCode must match LegalEntity.jurisdiction_code',
        );
      }

      const maxVer = await client.query<{ max: number | null }>(
        `SELECT MAX(policy_version) AS max FROM commercial_rounding_policy
         WHERE tenant_id = $1 AND legal_entity_id = $2
           AND jurisdiction_code = $3 AND calculation_context = $4`,
        [cmd.tenantId, cmd.legalEntityId, cmd.jurisdictionCode, cmd.calculationContext],
      );
      const nextVersion = cmd.policyVersion ?? (maxVer.rows[0]?.max ?? 0) + 1;
      if (cmd.policyVersion !== undefined && cmd.policyVersion <= (maxVer.rows[0]?.max ?? 0)) {
        throw new DomainValidationError(
          'COMMERCIAL_ROUNDING_POLICY_INVALID',
          'policyVersion must be greater than existing max for selection key',
        );
      }

      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO commercial_rounding_policy (
             rounding_policy_id, tenant_id, legal_entity_id, jurisdiction_code,
             calculation_context, policy_version, rounding_mode, quantum_minor,
             effective_from, effective_to, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            cmd.tenantId,
            cmd.legalEntityId,
            cmd.jurisdictionCode,
            cmd.calculationContext,
            nextVersion,
            cmd.roundingMode,
            cmd.quantumMinor,
            cmd.effectiveFrom,
            cmd.effectiveTo ?? null,
            cmd.createdBy ?? null,
          ],
        );
      } catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
        if (code === '23P01') {
          throw new DomainValidationError(
            'COMMERCIAL_ROUNDING_POLICY_AMBIGUOUS',
            'Overlapping RoundingPolicy effective interval for selection key',
          );
        }
        if (code === '23505') {
          throw new IdempotencyConflictError(
            cmd.idempotencyKey ?? `policy-version:${nextVersion}`,
            'RoundingPolicy version conflict',
          );
        }
        throw e;
      }
      await client.query('COMMIT');
      return (await this.getPolicy(id))!;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getPolicy(roundingPolicyId: string): Promise<RoundingPolicyRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM commercial_rounding_policy WHERE rounding_policy_id = $1`,
      [roundingPolicyId],
    );
    if (res.rowCount !== 1) return null;
    return mapRow(res.rows[0]!);
  }

  /**
   * Exactly one winning policy for LegalEntity + jurisdiction + context + business instant.
   */
  async resolveRoundingPolicy(input: {
    tenantId: string;
    legalEntityId: string;
    jurisdictionCode: string;
    calculationContext: typeof CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS;
    businessDateTime: string;
  }): Promise<RoundingPolicyRow> {
    if (input.calculationContext !== CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS) {
      throw new DomainValidationError(
        'COMMERCIAL_ROUNDING_POLICY_INVALID',
        'Unsupported calculationContext',
      );
    }
    const instant = new Date(input.businessDateTime);
    if (Number.isNaN(instant.getTime())) {
      throw new DomainValidationError(
        'COMMERCIAL_ROUNDING_POLICY_INVALID',
        'Invalid businessDateTime',
      );
    }

    const res = await this.pool.query(
      `SELECT * FROM commercial_rounding_policy
       WHERE tenant_id = $1
         AND legal_entity_id = $2
         AND jurisdiction_code = $3
         AND calculation_context = $4
         AND effective_from <= $5::timestamptz
         AND (effective_to IS NULL OR effective_to > $5::timestamptz)
       ORDER BY policy_version ASC`,
      [
        input.tenantId,
        input.legalEntityId,
        input.jurisdictionCode,
        input.calculationContext,
        instant.toISOString(),
      ],
    );

    if (res.rowCount === 0) {
      throw new DomainValidationError(
        'COMMERCIAL_ROUNDING_POLICY_REQUIRED',
        'No RoundingPolicy for LegalEntity/jurisdiction/context at business instant',
      );
    }
    if (res.rowCount! > 1) {
      throw new DomainValidationError(
        'COMMERCIAL_ROUNDING_POLICY_AMBIGUOUS',
        'Multiple RoundingPolicies apply at business instant',
      );
    }
    return mapRow(res.rows[0]!);
  }

  async resolveForOrder(
    client: Client | Pool,
    orderId: string,
    businessDateTime: string,
  ): Promise<RoundingPolicyRow & { orderTenantId: string; orderLegalEntityId: string }> {
    const order = await client.query<{
      order_id: string;
      tenant_id: string;
      legal_entity_id: string;
      status: string;
    }>(`SELECT order_id, tenant_id, legal_entity_id, status FROM sales_order WHERE order_id = $1`, [
      orderId,
    ]);
    if (order.rowCount !== 1) throw new NotFoundError('Order not found');
    const o = order.rows[0]!;
    const le = await client.query<{ jurisdiction_code: string }>(
      `SELECT jurisdiction_code FROM legal_entity WHERE legal_entity_id = $1`,
      [o.legal_entity_id],
    );
    if (le.rowCount !== 1) throw new NotFoundError('LegalEntity not found for Order');
    const policy = await this.resolveRoundingPolicy({
      tenantId: o.tenant_id,
      legalEntityId: o.legal_entity_id,
      jurisdictionCode: le.rows[0]!.jurisdiction_code,
      calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
      businessDateTime,
    });
    return {
      ...policy,
      orderTenantId: o.tenant_id,
      orderLegalEntityId: o.legal_entity_id,
    };
  }
}
