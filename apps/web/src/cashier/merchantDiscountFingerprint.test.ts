import { describe, expect, it } from 'vitest';
import {
  buildMerchantDiscountApprovalFingerprint,
  parsePercentToBasisPoints,
} from './merchantDiscountFingerprint.js';

describe('merchantDiscountFingerprint', () => {
  it('parses percent to basis points like the domain helper', () => {
    expect(parsePercentToBasisPoints('10')).toBe(1000);
    expect(parsePercentToBasisPoints('12.5')).toBe(1250);
    expect(parsePercentToBasisPoints('20')).toBe(2000);
  });

  it('builds FIXED and PERCENT approval fingerprints with trimmed reason', () => {
    expect(
      buildMerchantDiscountApprovalFingerprint({
        orderId: 'o1',
        mode: 'FIXED_MINOR',
        amountMinor: '5000',
        reason: '  guest  ',
      }),
    ).toEqual({
      orderId: 'o1',
      mode: 'FIXED_MINOR',
      amountMinor: '5000',
      reason: 'guest',
    });

    expect(
      buildMerchantDiscountApprovalFingerprint({
        orderId: 'o1',
        mode: 'PERCENT',
        percent: '12.5',
        reason: 'promo',
      }),
    ).toEqual({
      orderId: 'o1',
      mode: 'PERCENT',
      percentBasisPoints: 1250,
      reason: 'promo',
    });
  });
});
