import { describe, expect, it } from 'vitest';
import {
  allocateOrderMerchantDiscount,
  commercialSnapshotSemanticHash,
  computeLineNetMerchandiseSalesMinor,
} from './order-commercial.js';

describe('allocateOrderMerchantDiscount (largest remainder)', () => {
  it('conserves exact order discount across uneven bases', () => {
    const alloc = allocateOrderMerchantDiscount('10', [
      { orderLineId: 'a', lineNumber: 1, basisMinor: '100' },
      { orderLineId: 'b', lineNumber: 2, basisMinor: '200' },
      { orderLineId: 'c', lineNumber: 3, basisMinor: '300' },
    ]);
    // 10*100/600=1 rem 400; 10*200/600=3 rem 200; 10*300/600=5 rem 0 → base 1+3+5=9; residual 1 → line with rem 400 (a)
    expect(alloc.get('a')).toBe('2');
    expect(alloc.get('b')).toBe('3');
    expect(alloc.get('c')).toBe('5');
    expect([...alloc.values()].reduce((s, v) => s + BigInt(v), 0n)).toBe(10n);
  });

  it('ties on remainder break by lineNumber ASC', () => {
    // bases equal → remainders equal → residual goes to lower line_number first
    const alloc = allocateOrderMerchantDiscount('1', [
      { orderLineId: 'b', lineNumber: 2, basisMinor: '10' },
      { orderLineId: 'a', lineNumber: 1, basisMinor: '10' },
    ]);
    expect(alloc.get('a')).toBe('1');
    expect(alloc.get('b')).toBe('0');
  });

  it('rejects discount exceeding total basis', () => {
    expect(() =>
      allocateOrderMerchantDiscount('5', [{ orderLineId: 'a', lineNumber: 1, basisMinor: '3' }]),
    ).toThrow(/exceeds/);
  });

  it('zero basis lines get zero; nonzero order discount with no basis rejects', () => {
    expect(() =>
      allocateOrderMerchantDiscount('1', [{ orderLineId: 'a', lineNumber: 1, basisMinor: '0' }]),
    ).toThrow(/positive eligible/);
    const alloc = allocateOrderMerchantDiscount('0', [
      { orderLineId: 'a', lineNumber: 1, basisMinor: '0' },
    ]);
    expect(alloc.get('a')).toBe('0');
  });
});

describe('computeLineNetMerchandiseSalesMinor', () => {
  it('applies line + order discount and third-party funding', () => {
    expect(
      computeLineNetMerchandiseSalesMinor({
        grossMerchandiseMinor: '100',
        lineMerchantFundedDiscountMinor: '10',
        allocatedOrderMerchantDiscountMinor: '5',
        thirdPartyMerchandiseFundingMinor: '20',
      }),
    ).toBe('105');
  });
});

describe('commercialSnapshotSemanticHash', () => {
  it('is independent of line array order', () => {
    const base = {
      orderId: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      legalEntityId: '33333333-3333-3333-3333-333333333333',
      outletId: '44444444-4444-4444-4444-444444444444',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-03-10',
      businessOrder: 1,
      businessTime: null,
      certainty: 'FINAL' as const,
      grossMerchandiseMinor: '100',
      merchantFundedDiscountMinor: '0',
      thirdPartyMerchandiseFundingMinor: '0',
      netMerchandiseSalesMinor: '100',
      taxMinor: null,
      nonMerchandiseChargesMinor: null,
      tipMinor: null,
      customerPayableMinor: null,
    };
    const lineA = {
      lineNumber: 1,
      orderLineId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      soldCatalogItemId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      quantity: '1',
      resolvedUnitPriceMinor: '100',
      grossMerchandiseMinor: '100',
      lineMerchantFundedDiscountMinor: '0',
      allocatedOrderMerchantDiscountMinor: '0',
      thirdPartyMerchandiseFundingMinor: '0',
      netMerchandiseSalesMinor: '100',
      taxMinor: null,
      certainty: 'FINAL' as const,
      fundingProvenance: null,
    };
    const lineB = { ...lineA, lineNumber: 2, orderLineId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
    const h1 = commercialSnapshotSemanticHash({ ...base, lines: [lineA, lineB] });
    const h2 = commercialSnapshotSemanticHash({ ...base, lines: [lineB, lineA] });
    expect(h1).toBe(h2);
  });
});
