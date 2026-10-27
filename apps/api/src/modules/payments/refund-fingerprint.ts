import { createHash } from 'node:crypto';
import { DomainValidationError } from '../orders/errors.js';

/** Canonical semantic fingerprint for refund authorize idempotency (ADR-0048). */
export type RefundAuthorizeSemantics = {
  originalPaymentId: string;
  settlementCheckId: string;
  amountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  outletId: string;
  tenderDefinitionId: string;
  instrumentFamily: string;
};

export function buildRefundSemanticFingerprint(s: RefundAuthorizeSemantics): string {
  const canonical = [
    s.originalPaymentId,
    s.settlementCheckId,
    s.amountMinor,
    s.currencyCode,
    String(s.minorUnitExponent),
    s.outletId,
    s.tenderDefinitionId,
    s.instrumentFamily.trim().toUpperCase(),
  ].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function assertDigits(label: string, v: string): void {
  if (!/^[0-9]+$/.test(v)) {
    throw new DomainValidationError('VALIDATION', `${label} must be non-negative integer digits`);
  }
}

export function assertPositiveDigits(label: string, v: string): void {
  if (!/^[1-9][0-9]*$/.test(v)) {
    throw new DomainValidationError('VALIDATION', `${label} must be positive integer digits`);
  }
}

export function cmpMinor(a: string, b: string): number {
  const aa = BigInt(a);
  const bb = BigInt(b);
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

export function addMinor(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function subMinor(a: string, b: string): string {
  const r = BigInt(a) - BigInt(b);
  if (r < 0n) {
    throw new DomainValidationError('VALIDATION', 'money underflow');
  }
  return r.toString();
}

export function computeRemainingCapacity(input: {
  qualifyingMinor: string;
  confirmedRefundsMinor: string;
  activeReservationsMinor: string;
}): string {
  assertDigits('qualifyingMinor', input.qualifyingMinor);
  assertDigits('confirmedRefundsMinor', input.confirmedRefundsMinor);
  assertDigits('activeReservationsMinor', input.activeReservationsMinor);
  return subMinor(
    subMinor(input.qualifyingMinor, input.confirmedRefundsMinor),
    input.activeReservationsMinor,
  );
}
