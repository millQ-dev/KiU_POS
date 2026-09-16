import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { DomainValidationError, NotFoundError } from '../orders/errors.js';

const ensureDevCashShiftSchema = z
  .object({
    tenantId: z.string().uuid(),
    legalEntityId: z.string().uuid(),
    outletId: z.string().uuid(),
    openingCashMinor: z.string().regex(/^\d+$/).default('0'),
    currencyCode: z.string().length(3).default('VND'),
    minorUnitExponent: z.number().int().min(0).max(4).default(0),
    cashierId: z.string().uuid().optional(),
    deviceId: z.string().uuid().optional(),
  })
  .strict();

export type CashShiftContext = {
  cashShiftId: string;
  cashierId: string;
  deviceId: string;
  status: 'OPEN';
  openingCashMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
};

export class CashShiftService {
  constructor(private readonly pool: pg.Pool) {}

  async ensureDevOpenShift(raw: unknown): Promise<CashShiftContext> {
    const cmd = ensureDevCashShiftSchema.parse(raw);
    const cashierId = cmd.cashierId ?? randomUUID();
    const deviceId = cmd.deviceId ?? randomUUID();
    const outlet = await this.pool.query<{
      tenant_id: string;
      legal_entity_id: string;
    }>(`SELECT tenant_id, legal_entity_id FROM outlet WHERE outlet_id = $1`, [cmd.outletId]);
    const outletRow = outlet.rows[0];
    if (!outletRow || outletRow.tenant_id !== cmd.tenantId || outletRow.legal_entity_id !== cmd.legalEntityId) {
      throw new NotFoundError('Outlet not found for cashier context');
    }

    const existing = await this.pool.query<{
      cash_shift_id: string;
      cashier_id: string;
      device_id: string;
      status: 'OPEN';
      opening_cash_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
    }>(
      `SELECT cash_shift_id, cashier_id, device_id, status, opening_cash_minor,
              currency_code, minor_unit_exponent
       FROM cash_shift
       WHERE outlet_id = $1 AND device_id = $2 AND status = 'OPEN'
       ORDER BY opened_at DESC LIMIT 1`,
      [cmd.outletId, deviceId],
    );
    const row = existing.rows[0];
    if (row) return this.toContext(row);

    const cashShiftId = randomUUID();
    await this.pool.query(
      `INSERT INTO cash_shift (
         cash_shift_id, tenant_id, legal_entity_id, outlet_id, cashier_id, device_id,
         business_date, status, opening_cash_minor, currency_code, minor_unit_exponent
       ) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,'OPEN',$7,$8,$9)`,
      [
        cashShiftId,
        cmd.tenantId,
        cmd.legalEntityId,
        cmd.outletId,
        cashierId,
        deviceId,
        cmd.openingCashMinor,
        cmd.currencyCode.toUpperCase(),
        cmd.minorUnitExponent,
      ],
    );
    return {
      cashShiftId,
      cashierId,
      deviceId,
      status: 'OPEN',
      openingCashMinor: cmd.openingCashMinor,
      currencyCode: cmd.currencyCode.toUpperCase(),
      minorUnitExponent: cmd.minorUnitExponent,
    };
  }

  private toContext(row: {
    cash_shift_id: string;
    cashier_id: string;
    device_id: string;
    status: 'OPEN';
    opening_cash_minor: string;
    currency_code: string;
    minor_unit_exponent: number;
  }): CashShiftContext {
    if (row.status !== 'OPEN') throw new DomainValidationError('CASH_SHIFT_NOT_OPEN', 'CashShift is not OPEN');
    return {
      cashShiftId: row.cash_shift_id,
      cashierId: row.cashier_id,
      deviceId: row.device_id,
      status: 'OPEN',
      openingCashMinor: row.opening_cash_minor,
      currencyCode: row.currency_code,
      minorUnitExponent: row.minor_unit_exponent,
    };
  }
}
