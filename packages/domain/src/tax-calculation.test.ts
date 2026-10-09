import { describe, expect, it } from 'vitest';
import {
  aggregateTaxLineResults,
  calculateTaxLine,
  calculateTaxOrder,
  resolveGuestMerchandiseCharge,
  type TaxPolicyCalcDims,
  type TaxRoundingPolicySnapshot,
} from './tax-calculation.js';

const inclRound: TaxRoundingPolicySnapshot = {
  roundingPolicyId: '11111111-1111-4111-8111-111111111111',
  policyVersion: 1,
  calculationContext: 'TAX_INCLUSIVE_EXTRACTION',
  roundingMode: 'HALF_UP',
  quantumMinor: '1',
};

const exclRound: TaxRoundingPolicySnapshot = {
  roundingPolicyId: '22222222-2222-4222-8222-222222222222',
  policyVersion: 1,
  calculationContext: 'TAX_LINE_VAT_AMOUNT',
  roundingMode: 'HALF_UP',
  quantumMinor: '1',
};

const inclusivePolicy: TaxPolicyCalcDims = {
  pricingTaxMode: 'TAX_INCLUSIVE',
  taxTreatment: 'STANDARD_RATE',
  rateDecimal: '0.08',
  taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
  inclusiveExtractionRounding: inclRound,
  vatAmountRounding: null,
};

const exclusivePolicy: TaxPolicyCalcDims = {
  pricingTaxMode: 'TAX_EXCLUSIVE',
  taxTreatment: 'STANDARD_RATE',
  rateDecimal: '0.08',
  taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
  inclusiveExtractionRounding: null,
  vatAmountRounding: exclRound,
};

describe('TAX1.1 domain calculation', () => {
  it('TAX_INCLUSIVE HALF_UP: X=19, r=0.08 → base 18, VAT 1', () => {
    const r = calculateTaxLine(
      {
        orderLineId: 'l1',
        lineNumber: 1,
        grossMerchandiseMinor: '19',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      inclusivePolicy,
    );
    expect(r.taxableBaseMinor).toBe('18');
    expect(r.vatMinor).toBe('1');
    expect(r.amountIncludingTaxMinor).toBe('19');
    expect(r.lineMerchandisePayableMinor).toBe('19');
  });

  it('TAX_INCLUSIVE DOWN: X=19 → base 17, VAT 2', () => {
    const r = calculateTaxLine(
      {
        orderLineId: 'l1',
        lineNumber: 1,
        grossMerchandiseMinor: '19',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      {
        ...inclusivePolicy,
        inclusiveExtractionRounding: { ...inclRound, roundingMode: 'DOWN' },
      },
    );
    expect(r.taxableBaseMinor).toBe('17');
    expect(r.vatMinor).toBe('2');
  });

  it('TAX_EXCLUSIVE HALF_UP: X=12, r=0.08 → VAT 1, payable 13', () => {
    const r = calculateTaxLine(
      {
        orderLineId: 'l1',
        lineNumber: 1,
        grossMerchandiseMinor: '12',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      exclusivePolicy,
    );
    expect(r.taxableBaseMinor).toBe('12');
    expect(r.vatMinor).toBe('1');
    expect(r.amountIncludingTaxMinor).toBe('13');
    expect(r.lineMerchandisePayableMinor).toBe('13');
  });

  it('merchant-funded discount: G=100 M=20 → C=80; inclusive payable 80', () => {
    const r = calculateTaxLine(
      {
        orderLineId: 'l1',
        lineNumber: 1,
        grossMerchandiseMinor: '100',
        merchantFundedDiscountMinor: '20',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      inclusivePolicy,
    );
    expect(r.cMinor).toBe('80');
    expect(r.xMinor).toBe('80');
    expect(r.lineMerchandisePayableMinor).toBe('80');
    expect(BigInt(r.taxableBaseMinor!) + BigInt(r.vatMinor!)).toBe(80n);
  });

  it('rejects third-party funding', () => {
    expect(() =>
      resolveGuestMerchandiseCharge({
        gMinor: '100',
        mMinor: '0',
        thirdPartyMerchandiseFundingMinor: '20',
      }),
    ).toThrow(/unsupported/i);
  });

  it('ZERO_RATE stores vat 0; EXEMPT stores vat absent', () => {
    const zero = calculateTaxLine(
      {
        orderLineId: 'l1',
        lineNumber: 1,
        grossMerchandiseMinor: '100',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      {
        ...inclusivePolicy,
        taxTreatment: 'ZERO_RATE',
        rateDecimal: '0',
      },
    );
    expect(zero.vatMinor).toBe('0');
    expect(zero.taxableBaseMinor).toBe('100');

    const exempt = calculateTaxLine(
      {
        orderLineId: 'l2',
        lineNumber: 2,
        grossMerchandiseMinor: '100',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      {
        pricingTaxMode: 'TAX_INCLUSIVE',
        taxTreatment: 'EXEMPT',
        rateDecimal: null,
        taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
        inclusiveExtractionRounding: null,
        vatAmountRounding: null,
      },
    );
    expect(exempt.vatMinor).toBeNull();
    expect(exempt.lineMerchandisePayableMinor).toBe('100');
  });

  it('order aggregate sums line payables', () => {
    const order = calculateTaxOrder(
      [
        {
          orderLineId: 'a',
          lineNumber: 2,
          grossMerchandiseMinor: '100',
          merchantFundedDiscountMinor: '0',
          thirdPartyMerchandiseFundingMinor: '0',
        },
        {
          orderLineId: 'b',
          lineNumber: 1,
          grossMerchandiseMinor: '50',
          merchantFundedDiscountMinor: '0',
          thirdPartyMerchandiseFundingMinor: '0',
        },
      ],
      exclusivePolicy,
    );
    expect(order.lines[0]!.lineNumber).toBe(1);
    expect(order.pricingTaxMode).toBe('TAX_EXCLUSIVE');
    expect(order.customerPayableMerchandiseMinor).toBe(
      (BigInt(order.lines[0]!.lineMerchandisePayableMinor) +
        BigInt(order.lines[1]!.lineMerchandisePayableMinor)).toString(),
    );
  });

  it('mixed PricingTaxModes aggregate to null envelope mode', () => {
    const inclusive = calculateTaxLine(
      {
        orderLineId: 'inc',
        lineNumber: 1,
        grossMerchandiseMinor: '108',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      inclusivePolicy,
    );
    const exclusive = calculateTaxLine(
      {
        orderLineId: 'exc',
        lineNumber: 2,
        grossMerchandiseMinor: '100',
        merchantFundedDiscountMinor: '0',
        thirdPartyMerchandiseFundingMinor: '0',
      },
      exclusivePolicy,
    );
    const mixed = aggregateTaxLineResults([inclusive, exclusive]);
    expect(mixed.pricingTaxMode).toBeNull();
    expect(mixed.lines).toHaveLength(2);
    expect(mixed.lines[0]!.pricingTaxMode).toBe('TAX_INCLUSIVE');
    expect(mixed.lines[1]!.pricingTaxMode).toBe('TAX_EXCLUSIVE');
  });
});
