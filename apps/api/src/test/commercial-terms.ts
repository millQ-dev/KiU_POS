/**
 * Test helper: accept FINAL merchandise commercial terms with ADR-0030 RoundingPolicy provenance.
 * Derives unit Money from desired gross ÷ quantity when exact; attaches kernel-validated provenance.
 * Does not invent Pricing engine behavior — tests supply intended gross minors.
 */
import {
  calculateRoundedLineGross,
  createMoney,
  Decimal,
  parseCanonicalDecimal,
  toCanonicalDecimal,
} from '@millq/domain';

const FIXTURE_POLICY = {
  roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  policyVersion: 1,
  calculationContext: 'BASE_LIST_LINE_GROSS' as const,
  roundingMode: 'HALF_UP' as const,
  quantumMinor: '1',
};

/** Find integer unit Money such that HALF_UP(unit × qty) === target gross. */
function unitPriceForTargetGross(grossMinor: string, quantity: string): string {
  const gross = parseCanonicalDecimal(grossMinor);
  const qty = parseCanonicalDecimal(quantity);
  if (qty.isZero()) {
    throw new Error('acceptFinalMerchandiseTerms: quantity must be non-zero');
  }
  const exact = gross.div(qty);
  const seed = exact.isInteger()
    ? exact
    : exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  for (let delta = 0; delta <= 100_000; delta++) {
    const candidates =
      delta === 0 ? [seed] : [seed.plus(delta), seed.minus(delta)];
    for (const candidate of candidates) {
      if (candidate.isNegative()) continue;
      const unit = toCanonicalDecimal(candidate);
      if (!/^\d+$/.test(unit)) continue;
      const rounded = calculateRoundedLineGross({
        unitMoney: createMoney(unit, 'VND', 0),
        quantity,
        roundingPolicy: FIXTURE_POLICY,
      });
      if (rounded.roundedGrossMoney.amountMinor === grossMinor) {
        return unit;
      }
    }
  }
  throw new Error(
    `acceptFinalMerchandiseTerms: cannot derive integer unit Money for gross=${grossMinor} qty=${quantity}`,
  );
}

export async function acceptFinalMerchandiseTerms(
  orders: {
    setOrderCommercialTerms: (raw: unknown) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getOrder: (orderId: string) => Promise<any>;
  },
  orderId: string,
  opts?: {
    currencyCode?: string;
    minorUnitExponent?: number;
    /** Per catalogItemId or orderLineId gross; default '0' */
    grossByCatalogItemId?: Record<string, string>;
    grossByOrderLineId?: Record<string, string>;
    defaultGrossMinor?: string;
    orderMerchantFundedDiscountMinor?: string;
    lineDiscountsByOrderLineId?: Record<string, string>;
    thirdPartyFundingByOrderLineId?: Record<string, string>;
    tipMinor?: string | null;
    taxMinor?: string | null;
    nonMerchandiseChargesMinor?: string | null;
    customerPayableMinor?: string | null;
    certainty?: 'FINAL' | 'UNKNOWN';
    idempotencyKey?: string;
    /** Optional override unit prices (canonical minor). */
    unitPriceByOrderLineId?: Record<string, string>;
  },
) {
  const order = await orders.getOrder(orderId);
  const defaultGross = opts?.defaultGrossMinor ?? '0';
  const currencyCode = opts?.currencyCode ?? 'VND';
  const minorUnitExponent = opts?.minorUnitExponent ?? 0;
  const policy = { ...FIXTURE_POLICY };

  const lineTerms = order.lines.map(
    (l: { orderLineId: string; catalogItemId: string; quantity: string }) => {
      const gross =
        opts?.grossByOrderLineId?.[l.orderLineId] ??
        opts?.grossByCatalogItemId?.[l.catalogItemId] ??
        defaultGross;
      const unit =
        opts?.unitPriceByOrderLineId?.[l.orderLineId] ?? unitPriceForTargetGross(gross, l.quantity);
      const rounded = calculateRoundedLineGross({
        unitMoney: createMoney(unit, currencyCode, minorUnitExponent),
        quantity: l.quantity,
        roundingPolicy: policy,
      });
      if (rounded.roundedGrossMoney.amountMinor !== gross) {
        throw new Error(
          `acceptFinalMerchandiseTerms: kernel gross ${rounded.roundedGrossMoney.amountMinor} != requested ${gross}`,
        );
      }
      return {
        orderLineId: l.orderLineId,
        resolvedUnitPriceMinor: unit,
        grossMerchandiseMinor: rounded.roundedGrossMoney.amountMinor,
        lineMerchantFundedDiscountMinor:
          opts?.lineDiscountsByOrderLineId?.[l.orderLineId] ?? '0',
        thirdPartyMerchandiseFundingMinor:
          opts?.thirdPartyFundingByOrderLineId?.[l.orderLineId] ?? '0',
        eligibleForOrderDiscount: true,
        exactUnroundedMinorBasis: rounded.exactUnroundedMinorBasis,
        roundingDelta: rounded.roundingDelta,
        roundingPolicyId: policy.roundingPolicyId,
        roundingPolicyVersion: policy.policyVersion,
        roundingMode: policy.roundingMode,
        quantumMinor: policy.quantumMinor,
        calculationContext: policy.calculationContext,
        provenance: {
          source: 'TEST_HELPER_C1_1',
          commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
        },
      };
    },
  );

  return orders.setOrderCommercialTerms({
    orderId,
    idempotencyKey: opts?.idempotencyKey ?? `commercial:${orderId}`,
    currencyCode,
    minorUnitExponent,
    certainty: opts?.certainty ?? 'FINAL',
    orderMerchantFundedDiscountMinor: opts?.orderMerchantFundedDiscountMinor ?? '0',
    taxMinor: opts?.taxMinor ?? null,
    nonMerchandiseChargesMinor: opts?.nonMerchandiseChargesMinor ?? null,
    tipMinor: opts?.tipMinor ?? null,
    customerPayableMinor: opts?.customerPayableMinor ?? null,
    commercialResolution: 'C1.1 test helper — kernel-validated BASE_LIST_LINE_GROSS',
    provenance: {
      source: 'TEST_HELPER_C1_1',
      commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
    },
    lineTerms,
  });
}

/**
 * Wrap a SetOrderCommercialTerms payload that still uses bare gross minors:
 * attach ADR-0030 kernel-validated RoundingPolicy provenance for every line.
 */
export async function setOrderCommercialTermsWithRounding(
  orders: {
    setOrderCommercialTerms: (raw: unknown) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getOrder: (orderId: string) => Promise<any>;
  },
  raw: Record<string, unknown> & {
    orderId: string;
    lineTerms: Array<Record<string, unknown> & { orderLineId: string; grossMerchandiseMinor: string }>;
  },
) {
  const order = await orders.getOrder(raw.orderId);
  const currencyCode = String(raw.currencyCode ?? 'VND');
  const minorUnitExponent = Number(raw.minorUnitExponent ?? 0);
  const policy = { ...FIXTURE_POLICY };

  const lineTerms = raw.lineTerms.map((lt) => {
    if (lt.roundingPolicyId != null) return lt;
    const live = order.lines.find(
      (l: { orderLineId: string }) => l.orderLineId === lt.orderLineId,
    );
    if (!live) {
      // Let Orders domain reject FOREIGN_ORDER_LINE with synthetic provenance placeholders.
      return {
        ...lt,
        resolvedUnitPriceMinor: (lt.resolvedUnitPriceMinor as string | undefined) ?? lt.grossMerchandiseMinor,
        exactUnroundedMinorBasis: lt.grossMerchandiseMinor,
        roundingDelta: '0',
        roundingPolicyId: policy.roundingPolicyId,
        roundingPolicyVersion: policy.policyVersion,
        roundingMode: policy.roundingMode,
        quantumMinor: policy.quantumMinor,
        calculationContext: policy.calculationContext,
      };
    }
    const unit =
      (lt.resolvedUnitPriceMinor as string | undefined) ??
      unitPriceForTargetGross(lt.grossMerchandiseMinor, live.quantity);
    const rounded = calculateRoundedLineGross({
      unitMoney: createMoney(unit, currencyCode, minorUnitExponent),
      quantity: live.quantity,
      roundingPolicy: policy,
    });
    if (rounded.roundedGrossMoney.amountMinor !== lt.grossMerchandiseMinor) {
      throw new Error(
        `setOrderCommercialTermsWithRounding: kernel ${rounded.roundedGrossMoney.amountMinor} != ${lt.grossMerchandiseMinor}`,
      );
    }
    return {
      ...lt,
      resolvedUnitPriceMinor: unit,
      exactUnroundedMinorBasis: rounded.exactUnroundedMinorBasis,
      roundingDelta: rounded.roundingDelta,
      roundingPolicyId: policy.roundingPolicyId,
      roundingPolicyVersion: policy.policyVersion,
      roundingMode: policy.roundingMode,
      quantumMinor: policy.quantumMinor,
      calculationContext: policy.calculationContext,
      provenance: {
        ...(typeof lt.provenance === 'object' && lt.provenance ? lt.provenance : {}),
        source: 'TEST_HELPER_C1_1',
        commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
      },
    };
  });

  return orders.setOrderCommercialTerms({
    ...raw,
    commercialResolution:
      (raw.commercialResolution as string | undefined) ??
      'C1.1 test wrapper — kernel-validated BASE_LIST_LINE_GROSS',
    provenance: {
      ...(typeof raw.provenance === 'object' && raw.provenance ? (raw.provenance as object) : {}),
      source: 'TEST_HELPER_C1_1',
      commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
    },
    lineTerms,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as Promise<any>;
}
