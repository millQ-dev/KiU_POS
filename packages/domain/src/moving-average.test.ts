import { describe, expect, it } from 'vitest';
import {
  applyPositiveInbound,
  applyCompensatingOutbound,
  emptyCostStream,
  costQuoteFromStream,
  createCostValue,
  compareBusinessPosition,
  packageToBaseQuantity,
  variableWeightToBase,
  createQuantity,
  mergeCertainty,
  mergeReportingCertainty,
} from './index.js';

describe('moving weighted average', () => {
  it('computes 10@100 + 10@200 → 20 @ 150', () => {
    let state = emptyCostStream('VND', 0);
    state = applyPositiveInbound(state, '10', createCostValue('1000', 'VND', 0));
    state = applyPositiveInbound(state, '10', createCostValue('2000', 'VND', 0));
    expect(state.quantity).toBe('20');
    expect(state.carryingValueMinor).toBe('3000');
    const quote = costQuoteFromStream(state, '2026-01-15', 2);
    expect(quote.amountMinorUnits).toBe('150');
    expect(quote.certainty).toBe('FINAL');
  });

  it('compensating outbound restores prior stream', () => {
    let state = emptyCostStream('VND', 0);
    state = applyPositiveInbound(state, '10', createCostValue('1000', 'VND', 0));
    state = applyPositiveInbound(state, '10', createCostValue('2000', 'VND', 0));
    state = applyCompensatingOutbound(state, '10', createCostValue('2000', 'VND', 0));
    expect(state.quantity).toBe('10');
    expect(state.carryingValueMinor).toBe('1000');
    expect(costQuoteFromStream(state, '2026-01-15', 1).amountMinorUnits).toBe('100');
  });

  it('UNKNOWN certainty when quantity is zero', () => {
    const quote = costQuoteFromStream(emptyCostStream('VND', 0), '2026-01-01', 0);
    expect(quote.certainty).toBe('UNKNOWN');
  });
});

describe('business chronology compare', () => {
  it('orders by businessDate then businessOrder', () => {
    expect(
      compareBusinessPosition(
        { businessDate: '2026-01-01', businessOrder: 2 },
        { businessDate: '2026-01-01', businessOrder: 1 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareBusinessPosition(
        { businessDate: '2026-01-01', businessOrder: 1 },
        { businessDate: '2026-01-02', businessOrder: 0 },
      ),
    ).toBeLessThan(0);
  });
});

describe('Block C package examples', () => {
  it('6 × 1 L milk → 6 L', () => {
    const q = packageToBaseQuantity(6, {
      packageId: 'milk',
      versionId: 'v1',
      packCount: 1,
      unitQuantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
      toBaseUnit: 'L',
      factorPerUnit: '1',
    });
    expect(q.value).toBe('6');
  });

  it('1 case of 12 × 0.75 L oil → 9 L', () => {
    const q = packageToBaseQuantity(12, {
      packageId: 'oil',
      versionId: 'v1',
      packCount: 12,
      unitQuantity: '0.75',
      unit: 'L',
      dimension: 'VOLUME',
      toBaseUnit: 'L',
      factorPerUnit: '1',
    });
    expect(q.value).toBe('9');
  });

  it('variable weight meat stays 18.7 kg', () => {
    expect(
      variableWeightToBase({
        packCount: 4,
        acceptedBaseQuantity: '18.7',
        dimension: 'MASS',
        baseUnit: 'kg',
      }).value,
    ).toBe('18.7');
  });

  it('24 eggs as COUNT ea', () => {
    expect(createQuantity('24', 'COUNT', 'ea').value).toBe('24');
  });
});

describe('certainty merge helpers', () => {
  it('inventory mergeCertainty ranks UNKNOWN above ORDER_UNRESOLVED', () => {
    expect(mergeCertainty('FINAL', 'UNKNOWN')).toBe('UNKNOWN');
    expect(mergeCertainty('ORDER_UNRESOLVED', 'UNKNOWN')).toBe('UNKNOWN');
  });

  it('ADR-0026 mergeReportingCertainty ranks ORDER_UNRESOLVED above UNKNOWN', () => {
    expect(mergeReportingCertainty('FINAL', 'ESTIMATED_FROM_LAST_KNOWN')).toBe(
      'ESTIMATED_FROM_LAST_KNOWN',
    );
    expect(mergeReportingCertainty('UNKNOWN', 'ORDER_UNRESOLVED')).toBe('ORDER_UNRESOLVED');
    expect(mergeReportingCertainty('FINAL', 'ORDER_UNRESOLVED')).toBe('ORDER_UNRESOLVED');
  });
});
