import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertExactCheckPayableConservation,
  assertExactLineAllocationConservation,
  evaluateCheckCoverage,
  presentOrAbsent,
  type PayableComponent,
} from './settlement-coverage.js';

describe('settlement-coverage kernel', () => {
  it('zero allocations → full outstanding', () => {
    const r = evaluateCheckCoverage({
      checkPayableMinor: '100000',
      qualifyingAllocationMinors: [],
    });
    expect(r.allocatedAmountMinor).toBe('0');
    expect(r.outstandingAmountMinor).toBe('100000');
    expect(r.satisfied).toBe(false);
  });

  it('partial coverage', () => {
    const r = evaluateCheckCoverage({
      checkPayableMinor: '100000',
      qualifyingAllocationMinors: ['60000'],
    });
    expect(r.allocatedAmountMinor).toBe('60000');
    expect(r.outstandingAmountMinor).toBe('40000');
    expect(r.satisfied).toBe(false);
  });

  it('exact coverage', () => {
    const r = evaluateCheckCoverage({
      checkPayableMinor: '100000',
      qualifyingAllocationMinors: ['60000', '40000'],
    });
    expect(r.allocatedAmountMinor).toBe('100000');
    expect(r.outstandingAmountMinor).toBe('0');
    expect(r.satisfied).toBe(true);
  });

  it('zero payable satisfied without allocations', () => {
    const r = evaluateCheckCoverage({
      checkPayableMinor: '0',
      qualifyingAllocationMinors: [],
    });
    expect(r.satisfied).toBe(true);
    expect(r.outstandingAmountMinor).toBe('0');
  });

  it('over-allocation rejected', () => {
    expect(() =>
      evaluateCheckCoverage({
        checkPayableMinor: '100000',
        qualifyingAllocationMinors: ['100001'],
      }),
    ).toThrow(/exceed/);
  });

  it('exact check conservation', () => {
    assertExactCheckPayableConservation('100000', ['60000', '40000']);
    expect(() => assertExactCheckPayableConservation('100000', ['60000', '30000'])).toThrow();
  });

  it('exact line allocation conservation', () => {
    assertExactLineAllocationConservation('50000', ['50000']);
    expect(() => assertExactLineAllocationConservation('50000', ['49999'])).toThrow();
  });

  it('ABSENT != PRESENT zero', () => {
    const absent = presentOrAbsent(null);
    const zero = presentOrAbsent('0');
    expect(absent).toEqual({ presence: 'ABSENT' });
    expect(zero).toEqual({ presence: 'PRESENT', amountMinor: '0' });
  });

  it('deterministic fingerprint helper shape', () => {
    const components: Record<string, PayableComponent> = {
      merchandiseGross: { presence: 'PRESENT', amountMinor: '100' },
      tax: { presence: 'ABSENT' },
    };
    const fp = createHash('sha256').update(JSON.stringify(components)).digest('hex');
    expect(fp).toHaveLength(64);
  });
});
