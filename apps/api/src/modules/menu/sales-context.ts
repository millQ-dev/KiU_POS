import type { PoolClient } from 'pg';
import { DomainValidationError } from './errors.js';
import { assertIanaTimezone } from './effective-time.js';
import type { SalesContextInput } from './types.js';

export type ValidatedSalesContext = {
  readonly tenantId: string;
  readonly brandId: string;
  readonly outletId: string;
  readonly legalEntityId: string;
  readonly orderChannel: string;
  readonly businessDateTime: Date;
  readonly outletTimezone: string;
  readonly terminalGroupId: string | null;
  readonly terminalId: string | null;
  readonly serviceMode: string | null;
};

/**
 * Validate SalesContext topology against Organization truth (ADR-0029).
 * Brand must match the outlet's brand. Terminal* runtime deferred — non-null rejected.
 */
export async function validateSalesContext(
  client: PoolClient,
  raw: SalesContextInput,
): Promise<ValidatedSalesContext> {
  if (raw.terminalGroupId != null || raw.terminalId != null) {
    throw new DomainValidationError(
      'INVALID_SALES_CONTEXT',
      'Terminal / TerminalGroup specificity runtime is DEFERRED until Organization entities exist',
    );
  }

  const outlet = await client.query<{
    tenant_id: string;
    brand_id: string;
    legal_entity_id: string;
    timezone: string | null;
  }>(
    `SELECT tenant_id, brand_id, legal_entity_id, timezone
     FROM outlet WHERE outlet_id = $1`,
    [raw.outletId],
  );
  if (outlet.rowCount !== 1) {
    throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Outlet not found for SalesContext');
  }
  const o = outlet.rows[0]!;
  if (o.tenant_id !== raw.tenantId) {
    throw new DomainValidationError(
      'INVALID_SALES_CONTEXT',
      'Outlet does not belong to SalesContext tenant',
    );
  }
  if (o.brand_id !== raw.brandId) {
    throw new DomainValidationError(
      'INVALID_SALES_CONTEXT',
      'SalesContext brandId does not match outlet brand (Organization truth)',
    );
  }
  if (!o.timezone) {
    throw new DomainValidationError(
      'OUTLET_TIMEZONE_REQUIRED',
      'Outlet authoritative IANA timezone is required for commercial schedule resolution',
    );
  }
  try {
    assertIanaTimezone(o.timezone);
  } catch {
    throw new DomainValidationError(
      'OUTLET_TIMEZONE_REQUIRED',
      `Outlet timezone is not a valid IANA timezone: ${o.timezone}`,
    );
  }

  const brand = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM brand WHERE brand_id = $1`,
    [raw.brandId],
  );
  if (brand.rowCount !== 1 || brand.rows[0]!.tenant_id !== raw.tenantId) {
    throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Brand not found for tenant');
  }

  const businessDateTime = new Date(raw.businessDateTime);
  if (Number.isNaN(businessDateTime.getTime())) {
    throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Invalid businessDateTime');
  }

  return {
    tenantId: raw.tenantId,
    brandId: raw.brandId,
    outletId: raw.outletId,
    legalEntityId: o.legal_entity_id,
    orderChannel: raw.orderChannel,
    businessDateTime,
    outletTimezone: o.timezone,
    terminalGroupId: null,
    terminalId: null,
    serviceMode: raw.serviceMode ?? null,
  };
}
