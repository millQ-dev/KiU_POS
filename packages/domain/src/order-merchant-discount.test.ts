import { describe, expect, it } from 'vitest';
import {
  MerchantDiscountPolicyError,
  parsePercentToBasisPoints,
  resolveOrderMerchantDiscount,
} from './order-merchant-discount.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof MerchantDiscountPolicyError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('parsePercentToBasisPoints', () => {
  it('parses whole and two-decimal percentages', () => {
    expect(parsePercentToBasisPoints('10')).toBe(1000);
    expect(parsePercentToBasisPoints('12.5')).toBe(1250);
    expect(parsePercentToBasisPoints('0.01')).toBe(1);
    expect(parsePercentToBasisPoints('20')).toBe(2000);
  });

  it('rejects zero, negatives, exponents and excess precision', () => {
    for (const bad of ['0', '0.00', '-5', '1e1', '5.123', '', 'abc', ' ']) {
      expect(codeOf(() => parsePercentToBasisPoints(bad))).toBe('DISCOUNT_PERCENT_INVALID');
    }
  });
});

describe('resolveOrderMerchantDiscount (ADR-0051 D3/D4)', () => {
  it('accepts a fixed amount at exactly 20% of basis', () => {
    const r = resolveOrderMerchantDiscount({
      request: { mode: 'FIXED_MINOR', amountMinor: '20000' },
      eligibleBasisMinor: '100000',
      reason: ' loyal guest ',
    });
    expect(r.discountMinor).toBe('20000');
    expect(r.reason).toBe('loyal guest');
    expect(r.percentBasisPoints).toBeNull();
  });

  it('rejects a fixed amount one minor unit above 20%', () => {
    expect(
      codeOf(() =>
        resolveOrderMerchantDiscount({
          request: { mode: 'FIXED_MINOR', amountMinor: '20001' },
          eligibleBasisMinor: '100000',
          reason: 'x',
        }),
      ),
    ).toBe('DISCOUNT_EXCEEDS_CAP');
  });

  it('caps fractional boundary exactly (basis 7 → max discount 1)', () => {
    const ok = resolveOrderMerchantDiscount({
      request: { mode: 'FIXED_MINOR', amountMinor: '1' },
      eligibleBasisMinor: '7',
      reason: 'x',
    });
    expect(ok.discountMinor).toBe('1');
    expect(
      codeOf(() =>
        resolveOrderMerchantDiscount({
          request: { mode: 'FIXED_MINOR', amountMinor: '2' },
          eligibleBasisMinor: '7',
          reason: 'x',
        }),
      ),
    ).toBe('DISCOUNT_EXCEEDS_CAP');
  });

  it('rejects zero, negative and non-integer fixed amounts', () => {
    for (const amountMinor of ['0', '-1', '1.5', '01', '', '1e3']) {
      expect(
        codeOf(() =>
          resolveOrderMerchantDiscount({
            request: { mode: 'FIXED_MINOR', amountMinor },
            eligibleBasisMinor: '100000',
            reason: 'x',
          }),
        ),
      ).toBe('DISCOUNT_AMOUNT_INVALID');
    }
  });

  it('percent rounds down to whole minor units', () => {
    const r = resolveOrderMerchantDiscount({
      request: { mode: 'PERCENT', percent: '15' },
      eligibleBasisMinor: '12345',
      reason: 'x',
    });
    // 12345 * 15% = 1851.75 → 1851
    expect(r.discountMinor).toBe('1851');
    expect(r.percentBasisPoints).toBe(1500);
  });

  it('accepts 20% and rejects above 20%', () => {
    expect(
      resolveOrderMerchantDiscount({
        request: { mode: 'PERCENT', percent: '20' },
        eligibleBasisMinor: '50000',
        reason: 'x',
      }).discountMinor,
    ).toBe('10000');
    for (const percent of ['20.01', '21', '100']) {
      expect(
        codeOf(() =>
          resolveOrderMerchantDiscount({
            request: { mode: 'PERCENT', percent },
            eligibleBasisMinor: '50000',
            reason: 'x',
          }),
        ),
      ).toBe('DISCOUNT_EXCEEDS_CAP');
    }
  });

  it('rejects percent that rounds to zero minor units', () => {
    expect(
      codeOf(() =>
        resolveOrderMerchantDiscount({
          request: { mode: 'PERCENT', percent: '1' },
          eligibleBasisMinor: '50',
          reason: 'x',
        }),
      ),
    ).toBe('DISCOUNT_AMOUNT_INVALID');
  });

  it('rejects empty or whitespace reason', () => {
    for (const reason of ['', '   ', '\n\t']) {
      expect(
        codeOf(() =>
          resolveOrderMerchantDiscount({
            request: { mode: 'FIXED_MINOR', amountMinor: '1' },
            eligibleBasisMinor: '100',
            reason,
          }),
        ),
      ).toBe('DISCOUNT_REASON_REQUIRED');
    }
  });

  it('rejects empty or invalid eligible basis', () => {
    expect(
      codeOf(() =>
        resolveOrderMerchantDiscount({
          request: { mode: 'FIXED_MINOR', amountMinor: '1' },
          eligibleBasisMinor: '0',
          reason: 'x',
        }),
      ),
    ).toBe('DISCOUNT_BASIS_EMPTY');
    expect(
      codeOf(() =>
        resolveOrderMerchantDiscount({
          request: { mode: 'FIXED_MINOR', amountMinor: '1' },
          eligibleBasisMinor: '-5',
          reason: 'x',
        }),
      ),
    ).toBe('DISCOUNT_BASIS_INVALID');
  });
});
