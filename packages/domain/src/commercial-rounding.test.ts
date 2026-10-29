import { describe, expect, it } from 'vitest';
import {
  calculateRoundedLineGross,
  roundConfiguredMerchandiseLine,
} from './commercial-rounding.js';
import { sumAdditivePriceAdjustmentsMinor } from './effective-recipe-delta.js';
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

describe('roundConfiguredMerchandiseLine (ADR-0052 M2)', () => {
  const policy = vnPolicy;

  function round(input: {
    base: string;
    delta: string;
    quantity: string;
    mode?: 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';
  }) {
    return roundConfiguredMerchandiseLine({
      baseUnitMinor: input.base,
      perUnitModifierMinor: input.delta,
      quantity: input.quantity,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      roundingPolicy: { ...policy, roundingMode: input.mode ?? 'HALF_UP' },
    });
  }

  it('quantity 1 applies a positive modifier inside the unit', () => {
    const r = round({ base: '20000', delta: '5000', quantity: '1' });
    expect(r.configuredUnitMinor).toBe('25000');
    expect(r.exactUnroundedMinorBasis).toBe('25000');
    expect(r.roundedGrossMoney.amountMinor).toBe('25000');
    expect(r.roundingDelta).toBe('0');
    expect(r.policyProvenance.calculationContext).toBe('BASE_LIST_LINE_GROSS');
  });

  it('quantity 2 applies the per-unit modifier twice before rounding', () => {
    const r = round({ base: '20000', delta: '5000', quantity: '2' });
    expect(r.configuredUnitMinor).toBe('25000');
    expect(r.exactUnroundedMinorBasis).toBe('50000');
    expect(r.roundedGrossMoney.amountMinor).toBe('50000');
    expect(r.roundingDelta).toBe('0');
  });

  it('sums multiple selected modifiers before the single round', () => {
    const delta = sumAdditivePriceAdjustmentsMinor(['3000', '2000']);
    const r = round({ base: '20000', delta, quantity: '2' });
    expect(r.configuredUnitMinor).toBe('25000');
    expect(r.roundedGrossMoney.amountMinor).toBe('50000');
  });

  it('zero adjustment matches base-only ADR-0030 rounding', () => {
    const configured = round({ base: '65000', delta: '0', quantity: '2' });
    const baseOnly = calculateRoundedLineGross({
      unitMoney: createMoney('65000', 'VND', 0),
      quantity: '2',
      roundingPolicy: policy,
    });
    expect(configured.exactUnroundedMinorBasis).toBe(baseOnly.exactUnroundedMinorBasis);
    expect(configured.roundedGrossMoney.amountMinor).toBe(baseOnly.roundedGrossMoney.amountMinor);
    expect(configured.roundingDelta).toBe(baseOnly.roundingDelta);
  });

  it('allows a negative adjustment while the effective unit stays non-negative', () => {
    const r = round({ base: '20000', delta: '-5000', quantity: '2' });
    expect(r.configuredUnitMinor).toBe('15000');
    expect(r.exactUnroundedMinorBasis).toBe('30000');
    expect(r.roundedGrossMoney.amountMinor).toBe('30000');
  });

  it('rejects a negative effective unit price', () => {
    expect(() => round({ base: '1000', delta: '-2000', quantity: '1' })).toThrow(
      /Configured unit price/,
    );
  });

  it('HALF_UP on a fractional MASS/VOLUME quantity keeps sub-minor provenance', () => {
    const r = round({ base: '10000', delta: '1', quantity: '0.5' });
    expect(r.exactUnroundedMinorBasis).toBe('5000.5');
    expect(r.roundedGrossMoney.amountMinor).toBe('5001');
    expect(r.roundingDelta).toBe('0.5');
    expect(r.policyProvenance.roundingMode).toBe('HALF_UP');
  });

  it('keeps two configurations of the same base price distinct', () => {
    const oat = round({ base: '20000', delta: '5000', quantity: '1' });
    const whole = round({ base: '20000', delta: '0', quantity: '1' });
    expect(oat.configuredUnitMinor).not.toBe(whole.configuredUnitMinor);
    expect(oat.roundedGrossMoney.amountMinor).toBe('25000');
    expect(whole.roundedGrossMoney.amountMinor).toBe('20000');
  });
});
