import { createHash } from 'node:crypto';
import { createMoney, type Money } from '@millq/domain';
import { CASH_SHIFT_OPERATION_TYPE, CashDomainError } from './errors.js';

export type OpenCashAuthMode = 'DIRECT_PERMISSION' | 'APPROVAL';

export type OpenCashFingerprintInput = {
  tenantId: string;
  outletId: string;
  terminalId: string;
  requesterUserId: string;
  openingCash: Money;
};

/** Canonical fingerprint object for ApprovalRequest matching (ADR-0036 §10.2). */
export function buildOpenCashShiftFingerprint(input: OpenCashFingerprintInput): Record<string, unknown> {
  return {
    operationType: CASH_SHIFT_OPERATION_TYPE,
    tenantId: input.tenantId,
    outletId: input.outletId,
    terminalId: input.terminalId,
    requesterUserId: input.requesterUserId,
    openingCash: {
      amountMinor: input.openingCash.amountMinor,
      currencyCode: input.openingCash.currencyCode,
      minorUnitExponent: input.openingCash.minorUnitExponent,
    },
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function fingerprintDigest(fp: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(fp)).digest('hex');
}

export function assertOpeningCashMoney(
  amountMinor: string,
  currencyCode: string,
  minorUnitExponent: number,
): Money {
  // Reject negatives / non-digit strings before createMoney (which allows leading '-').
  if (!/^[0-9]+$/.test(amountMinor)) {
    throw new CashDomainError('INVALID_OPENING_CASH', 'openingCash.amountMinor must be a non-negative integer string');
  }
  try {
    return createMoney(amountMinor, currencyCode, minorUnitExponent);
  } catch {
    throw new CashDomainError('INVALID_OPENING_CASH', 'Invalid opening cash Money');
  }
}

export function fingerprintsMatch(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return fingerprintDigest(a) === fingerprintDigest(b);
}
