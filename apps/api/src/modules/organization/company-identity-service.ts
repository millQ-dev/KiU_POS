import type { Pool } from 'pg';
import { z } from 'zod';
import { CompanyIdentityError } from '../identity/errors.js';

/** Normalized Company ID (stored uppercase). Locator only — not a secret. */
export const COMPANY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

const resolveSchema = z
  .object({
    companyCode: z.string().trim().min(1).max(64),
  })
  .strict();

/** Public DTO — NEVER includes tenantId (ADR-0036). */
export type PublicCompanyIdentity = {
  readonly companyCode: string;
  readonly displayName: string;
};

export function normalizeCompanyCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export class CompanyIdentityService {
  constructor(private readonly pool: Pool) {}

  /**
   * Resolve Company ID → public display identity only.
   * No outlet/cashier/shift side effects. Does not authenticate.
   */
  async resolvePublicByCompanyCode(raw: unknown): Promise<PublicCompanyIdentity> {
    let companyCodeRaw: string;
    try {
      companyCodeRaw = resolveSchema.parse(raw).companyCode;
    } catch {
      throw new CompanyIdentityError('COMPANY_NOT_FOUND', 'Company not found');
    }
    const companyCode = normalizeCompanyCode(companyCodeRaw);
    if (!COMPANY_CODE_PATTERN.test(companyCode)) {
      throw new CompanyIdentityError('COMPANY_NOT_FOUND', 'Company not found');
    }

    const res = await this.pool.query<{ name: string; company_code: string }>(
      `SELECT name, company_code FROM tenant WHERE company_code = $1`,
      [companyCode],
    );

    if (res.rowCount !== 1) {
      throw new CompanyIdentityError('COMPANY_NOT_FOUND', 'Company not found');
    }

    const row = res.rows[0]!;
    return {
      companyCode: row.company_code,
      displayName: row.name,
    };
  }

  /** Internal only — never expose via public API. */
  async resolveTenantIdByCompanyCode(companyCodeRaw: string): Promise<string | null> {
    const companyCode = normalizeCompanyCode(companyCodeRaw);
    if (!COMPANY_CODE_PATTERN.test(companyCode)) return null;
    const res = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM tenant WHERE company_code = $1`,
      [companyCode],
    );
    return res.rows[0]?.tenant_id ?? null;
  }
}
