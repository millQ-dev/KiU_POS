import { describe, expect, it } from 'vitest';
import { calculateRoundedLineGross } from './commercial-rounding.js';
import { createMoney } from './money.js';

const vnPolicy = {
  roundingPolicyId: '11111111-1111-4111-8111-111111111111',
  policyVersion: 1,
  calculationContext: 'BASE_LIST_LINE_GROSS' as const,
  roundingMode: 'HALF_UP' as const,
  quantumMinor: '1',
};

describe('calculateRoundedLineGross (ADR-0030)', () => {
  it('COUNT exact case retains provenance with delta 0', () => {
    const r = calculateRoundedLineGross({
      unitMoney: createMoney('65000', 'VND', 0),
      quantity: '2',
      roundingPolicy: vnPolicy,
    });
    expect(r.exactUnroundedMinorBasis).toBe('130000');
    expect(r.roundedGrossMoney.amountMinor).toBe('130000');
    expect(r.roundingDelta).toBe('0');
    expect(r.policyProvenance.roundingMode).toBe('HALF_UP');
    expect(r.policyProvenance.policyVersion).toBe(1);
  });

  it('HALF_UP below / exact / above half quantum', () => {
    const below = calculateRoundedLineGross({
      unitMoney: createMoney('10001', 'VND', 0),
      quantity: '0.4',
      roundingPolicy: vnPolicy,
    });
    // 4000.4 → 4000
    expect(below.exactUnroundedMinorBasis).toBe('4000.4');
    expect(below.roundedGrossMoney.amountMinor).toBe('4000');
    expect(below.roundingDelta).toBe('-0.4');

    const half = calculateRoundedLineGross({
      unitMoney: createMoney('10001', 'VND', 0),
      quantity: '0.5',
      roundingPolicy: vnPolicy,
    });
    // 5000.5 → 5001 (HALF_UP)
    expect(half.exactUnroundedMinorBasis).toBe('5000.5');
    expect(half.roundedGrossMoney.amountMinor).toBe('5001');
    expect(half.roundingDelta).toBe('0.5');

    const above = calculateRoundedLineGross({
      unitMoney: createMoney('10001', 'VND', 0),
      quantity: '0.6',
      roundingPolicy: vnPolicy,
    });
    // 6000.6 → 6001
    expect(above.exactUnroundedMinorBasis).toBe('6000.6');
    expect(above.roundedGrossMoney.amountMinor).toBe('6001');
    expect(above.roundingDelta).toBe('0.4');
  });

  it('MASS exact fractional quantity', () => {
    const r = calculateRoundedLineGross({
      unitMoney: createMoney('450000', 'VND', 0),
      quantity: '0.25',
      roundingPolicy: vnPolicy,
    });
    expect(r.exactUnroundedMinorBasis).toBe('112500');
    expect(r.roundedGrossMoney.amountMinor).toBe('112500');
    expect(r.roundingDelta).toBe('0');
  });

  it('VOLUME fractional basis requiring rounding', () => {
    const r = calculateRoundedLineGross({
      unitMoney: createMoney('10001', 'VND', 0),
      quantity: '0.333',
      roundingPolicy: vnPolicy,
    });
    // 10001 * 0.333 = 3330.333 → HALF_UP → 3330
    expect(r.exactUnroundedMinorBasis).toBe('3330.333');
    expect(r.roundedGrossMoney.amountMinor).toBe('3330');
    expect(r.roundingDelta).toBe('-0.333');
  });

  it('preserves currency and exponent; is deterministic', () => {
    const a = calculateRoundedLineGross({
      unitMoney: createMoney('12345', 'USD', 2),
      quantity: '1.5',
      roundingPolicy: vnPolicy,
    });
    const b = calculateRoundedLineGross({
      unitMoney: createMoney('12345', 'USD', 2),
      quantity: '1.5',
      roundingPolicy: vnPolicy,
    });
    expect(a).toEqual(b);
    expect(a.roundedGrossMoney.currencyCode).toBe('USD');
    expect(a.roundedGrossMoney.minorUnitExponent).toBe(2);
    // 18517.5 → 18518
    expect(a.roundedGrossMoney.amountMinor).toBe('18518');
  });
});
