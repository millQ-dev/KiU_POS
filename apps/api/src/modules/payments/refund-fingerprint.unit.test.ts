import { describe, expect, it } from 'vitest';
import {
  buildRefundSemanticFingerprint,
  computeRemainingCapacity,
  cmpMinor,
} from './refund-fingerprint.js';

describe('refund-fingerprint / capacity (unit)', () => {
  it('fingerprint is stable for same semantics and changes when amount differs', () => {
    const base = {
      originalPaymentId: '11111111-1111-1111-1111-111111111111',
      settlementCheckId: '22222222-2222-2222-2222-222222222222',
      amountMinor: '1000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      outletId: '33333333-3333-3333-3333-333333333333',
      tenderDefinitionId: '44444444-4444-4444-4444-444444444444',
      instrumentFamily: 'CASH',
    };
    const a = buildRefundSemanticFingerprint(base);
    const b = buildRefundSemanticFingerprint(base);
    expect(a).toBe(b);
    expect(buildRefundSemanticFingerprint({ ...base, amountMinor: '1001' })).not.toBe(a);
    expect(buildRefundSemanticFingerprint({ ...base, instrumentFamily: 'cash' })).toBe(a);
  });

  it('remaining = qualifying − confirmed − reserved; never negative', () => {
    expect(
      computeRemainingCapacity({
        qualifyingMinor: '10000',
        confirmedRefundsMinor: '3000',
        activeReservationsMinor: '2000',
      }),
    ).toBe('5000');
    expect(() =>
      computeRemainingCapacity({
        qualifyingMinor: '100',
        confirmedRefundsMinor: '60',
        activeReservationsMinor: '50',
      }),
    ).toThrow();
    expect(cmpMinor('100', '99')).toBe(1);
  });
});
