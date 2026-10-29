import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { roundConfiguredMerchandiseLine } from '@millq/domain';
import { buildCommercialStateFromCommand } from './commercial-terms.js';
import { DomainValidationError } from './errors.js';
import { assertModifierConfigurationMatchesTerms } from './orders-service.js';

const POLICY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';

const policy = {
  roundingPolicyId: POLICY_ID,
  policyVersion: 1,
  calculationContext: 'BASE_LIST_LINE_GROSS' as const,
  roundingMode: 'HALF_UP' as const,
  quantumMinor: '1',
};

function line(id: string, quantity: string, n = 1) {
  return {
    order_line_id: id,
    order_id: ORDER_ID,
    line_number: n,
    catalog_item_id: ITEM,
    quantity,
  };
}

function accept(input: {
  quantity: string;
  base: string;
  delta: string;
  currency?: string;
  provenanceExtra?: Record<string, unknown>;
  tamper?: Partial<{
    grossMerchandiseMinor: string;
    exactUnroundedMinorBasis: string;
    roundingDelta: string;
    roundingPolicyVersion: number;
  }>;
}) {
  const rounded = roundConfiguredMerchandiseLine({
    baseUnitMinor: input.base,
    perUnitModifierMinor: input.delta,
    quantity: input.quantity,
    currencyCode: input.currency ?? 'VND',
    minorUnitExponent: 0,
    roundingPolicy: policy,
  });
  const lineId = randomUUID();
  const state = buildCommercialStateFromCommand(
    {
      orderId: ORDER_ID,
      idempotencyKey: 'k1',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: '0',
      lineTerms: [
        {
          orderLineId: lineId,
          resolvedUnitPriceMinor: input.base,
          grossMerchandiseMinor: input.tamper?.grossMerchandiseMinor ?? rounded.roundedGrossMoney.amountMinor,
          lineMerchantFundedDiscountMinor: '0',
          eligibleForOrderDiscount: true,
          thirdPartyMerchandiseFundingMinor: '0',
          exactUnroundedMinorBasis:
            input.tamper?.exactUnroundedMinorBasis ?? rounded.exactUnroundedMinorBasis,
          roundingDelta: input.tamper?.roundingDelta ?? rounded.roundingDelta,
          roundingPolicyId: POLICY_ID,
          roundingPolicyVersion: input.tamper?.roundingPolicyVersion ?? 1,
          roundingMode: 'HALF_UP',
          quantumMinor: '1',
          calculationContext: 'BASE_LIST_LINE_GROSS',
          provenance: {
            additivePriceAdjustmentMinor: input.delta,
            configuredUnitPriceMinor: rounded.configuredUnitMinor,
            currencyCode: input.currency ?? 'VND',
            ...input.provenanceExtra,
          },
        },
      ],
    },
    [line(lineId, input.quantity)],
  );
  return { rounded, state };
}

describe('configured merchandise validation matches calculation', () => {
  it('quantity 2 positive modifier: validation keeps the single kernel result', () => {
    const { rounded, state } = accept({ quantity: '2', base: '20000', delta: '5000' });
    const lineState = state.lines[0]!;
    expect(lineState.grossMerchandiseMinor).toBe('50000');
    expect(lineState.exactUnroundedMinorBasis).toBe(rounded.exactUnroundedMinorBasis);
    expect(lineState.roundingDelta).toBe(rounded.roundingDelta);
    expect(lineState.roundingPolicyId).toBe(POLICY_ID);
    expect(lineState.calculationContext).toBe('BASE_LIST_LINE_GROSS');
    const prov = lineState.provenance as Record<string, unknown>;
    expect(prov.configuredUnitPriceMinor).toBe('25000');
    expect(prov.additivePriceAdjustmentMinor).toBe('5000');
  });

  it('rejects a stale rounding delta', () => {
    expect(() =>
      accept({
        quantity: '2',
        base: '20000',
        delta: '5000',
        tamper: { roundingDelta: '1' },
      }),
    ).toThrow(DomainValidationError);
  });

  it('rejects a mismatched provenance currency', () => {
    expect(() => accept({ quantity: '1', base: '20000', delta: '0', currency: 'USD' })).toThrow(
      /provenance currency/,
    );
  });

  it('rejects a configured unit that does not match the kernel', () => {
    expect(() =>
      accept({
        quantity: '1',
        base: '20000',
        delta: '5000',
        provenanceExtra: { configuredUnitPriceMinor: '20000' },
      }),
    ).toThrow(/configured unit price/);
  });

  it('two configurations of the same catalog item stay independent', () => {
    const oat = roundConfiguredMerchandiseLine({
      baseUnitMinor: '20000',
      perUnitModifierMinor: '5000',
      quantity: '1',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      roundingPolicy: policy,
    });
    const plain = roundConfiguredMerchandiseLine({
      baseUnitMinor: '20000',
      perUnitModifierMinor: '0',
      quantity: '1',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      roundingPolicy: policy,
    });
    const oatId = randomUUID();
    const plainId = randomUUID();
    const state = buildCommercialStateFromCommand(
      {
        orderId: ORDER_ID,
        idempotencyKey: 'k2',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '0',
        lineTerms: [
          {
            orderLineId: oatId,
            resolvedUnitPriceMinor: '20000',
            grossMerchandiseMinor: oat.roundedGrossMoney.amountMinor,
            lineMerchantFundedDiscountMinor: '0',
            eligibleForOrderDiscount: true,
            thirdPartyMerchandiseFundingMinor: '0',
            exactUnroundedMinorBasis: oat.exactUnroundedMinorBasis,
            roundingDelta: oat.roundingDelta,
            roundingPolicyId: POLICY_ID,
            roundingPolicyVersion: 1,
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
            calculationContext: 'BASE_LIST_LINE_GROSS',
            provenance: {
              additivePriceAdjustmentMinor: '5000',
              configuredUnitPriceMinor: oat.configuredUnitMinor,
            },
          },
          {
            orderLineId: plainId,
            resolvedUnitPriceMinor: '20000',
            grossMerchandiseMinor: plain.roundedGrossMoney.amountMinor,
            lineMerchantFundedDiscountMinor: '0',
            eligibleForOrderDiscount: true,
            thirdPartyMerchandiseFundingMinor: '0',
            exactUnroundedMinorBasis: plain.exactUnroundedMinorBasis,
            roundingDelta: plain.roundingDelta,
            roundingPolicyId: POLICY_ID,
            roundingPolicyVersion: 1,
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
            calculationContext: 'BASE_LIST_LINE_GROSS',
            provenance: {
              additivePriceAdjustmentMinor: '0',
              configuredUnitPriceMinor: plain.configuredUnitMinor,
            },
          },
        ],
      },
      [line(oatId, '1', 1), line(plainId, '1', 2)],
    );
    expect(state.lines.map((l) => l.grossMerchandiseMinor).sort()).toEqual(['20000', '25000']);
    expect(state.grossMerchandiseMinor).toBe('45000');
  });

  it('rejects a missing or stale stored configuration', async () => {
    const lineId = randomUUID();
    const client = {
      query: async () => ({
        rows: [
          {
            order_line_id: lineId,
            additive_price_adjustment_minor: '5000',
            configuration_fingerprint: 'fp-live',
          },
        ],
      }),
    };
    await expect(
      assertModifierConfigurationMatchesTerms(client as never, {
        orderId: ORDER_ID,
        lineTerms: [
          {
            orderLineId: lineId,
            provenance: { additivePriceAdjustmentMinor: '0', configurationFingerprint: 'fp-live' },
          },
        ],
      }),
    ).rejects.toThrow(/does not match the stored configuration/);
    await expect(
      assertModifierConfigurationMatchesTerms(client as never, {
        orderId: ORDER_ID,
        lineTerms: [
          {
            orderLineId: lineId,
            provenance: { additivePriceAdjustmentMinor: '5000', configurationFingerprint: 'fp-old' },
          },
        ],
      }),
    ).rejects.toThrow(/stale/);
  });
});
