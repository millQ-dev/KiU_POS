import type { PoolClient } from 'pg';
import { DomainValidationError } from './errors.js';
import type { PresentationContextInput } from './types.js';

export type ValidatedPresentationContext = {
  readonly tenantId: string;
  readonly brandId: string;
  readonly outletId: string;
  readonly legalEntityId: string;
  readonly terminalGroupId: null;
  readonly terminalId: null;
};

export async function validatePresentationContext(
  client: PoolClient,
  raw: PresentationContextInput,
): Promise<ValidatedPresentationContext> {
  if (raw.terminalGroupId != null || raw.terminalId != null) {
    throw new DomainValidationError(
      'INVALID_PRESENTATION_CONTEXT',
      'Terminal / TerminalGroup specificity runtime is DEFERRED until Organization entities exist',
    );
  }

  const outlet = await client.query<{
    tenant_id: string;
    brand_id: string;
    legal_entity_id: string;
  }>(`SELECT tenant_id, brand_id, legal_entity_id FROM outlet WHERE outlet_id = $1`, [raw.outletId]);
  if (outlet.rowCount !== 1) {
    throw new DomainValidationError('INVALID_PRESENTATION_CONTEXT', 'Outlet not found');
  }
  const o = outlet.rows[0]!;
  if (o.tenant_id !== raw.tenantId) {
    throw new DomainValidationError(
      'INVALID_PRESENTATION_CONTEXT',
      'Outlet does not belong to PresentationContext tenant',
    );
  }
  if (o.brand_id !== raw.brandId) {
    throw new DomainValidationError(
      'INVALID_PRESENTATION_CONTEXT',
      'PresentationContext brandId does not match outlet brand',
    );
  }

  const brand = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM brand WHERE brand_id = $1`,
    [raw.brandId],
  );
  if (brand.rowCount !== 1 || brand.rows[0]!.tenant_id !== raw.tenantId) {
    throw new DomainValidationError('INVALID_PRESENTATION_CONTEXT', 'Brand not found for tenant');
  }

  return {
    tenantId: raw.tenantId,
    brandId: raw.brandId,
    outletId: raw.outletId,
    legalEntityId: o.legal_entity_id,
    terminalGroupId: null,
    terminalId: null,
  };
}
