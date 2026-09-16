/**
 * Build SetOrderCommercialTerms input from Menu unit-price resolution + ADR-0030 RoundingPolicy kernel.
 * MenuResolver MUST NOT compute unit×quantity — it supplies UNIT price only.
 * This Orders/Commercial Calculation helper derives official line gross via RoundingPolicy.
 * Does not call OrdersService and does not write commercial tables.
 */
import {
  calculateRoundedLineGross,
  createMoney,
  type CommercialRoundingPolicySnapshot,
} from '@millq/domain';
import { DomainValidationError } from './errors.js';
import type { ResolvedOrderLineFromMenu } from './menu-resolver.js';

export type BuildMenuResolvedCommercialTermsInput = {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly certainty?: 'FINAL' | 'UNKNOWN';
  readonly resolvedLines: ReadonlyArray<ResolvedOrderLineFromMenu>;
  readonly roundingPolicy: CommercialRoundingPolicySnapshot;
  /** Optional order-level fields — defaults keep base commercial proposal. */
  readonly orderMerchantFundedDiscountMinor?: string;
  readonly taxMinor?: string | null;
  readonly tipMinor?: string | null;
  readonly nonMerchandiseChargesMinor?: string | null;
  readonly actorId?: string;
  readonly deviceId?: string;
};

/**
 * @deprecated OPTION A explicit-gross amounts — use roundingPolicy path.
 * Kept type alias only for migration of call sites; prefer BuildMenuResolvedCommercialTermsInput.
 */
export type ExplicitLineCommercialAmount = {
  readonly orderLineId: string;
  readonly grossMerchandiseMinor: string;
};

export function buildMenuResolvedCommercialTermsInput(input: BuildMenuResolvedCommercialTermsInput) {
  if (input.resolvedLines.length === 0) {
    throw new DomainValidationError('EMPTY_ORDER', 'No resolved menu lines');
  }
  if (input.roundingPolicy.calculationContext !== 'BASE_LIST_LINE_GROSS') {
    throw new DomainValidationError(
      'COMMERCIAL_ROUNDING_POLICY_INVALID',
      'roundingPolicy.calculationContext must be BASE_LIST_LINE_GROSS',
    );
  }

  const c0 = input.resolvedLines[0]!;
  for (const line of input.resolvedLines) {
    if (line.currencyCode !== c0.currencyCode || line.minorUnitExponent !== c0.minorUnitExponent) {
      throw new DomainValidationError(
        'COMMERCIAL_CURRENCY_MISMATCH',
        'Resolved lines must share one currency / minor exponent',
      );
    }
    if (line.availabilityStatus !== 'AVAILABLE' || line.resolvedUnitPriceMinor == null) {
      throw new DomainValidationError(
        'COMMERCIAL_PRICE_UNAVAILABLE',
        `Cannot calculate gross: line ${line.orderLineId} price/availability unavailable`,
      );
    }
  }

  const lineTerms = input.resolvedLines.map((l) => {
    const rounded = calculateRoundedLineGross({
      unitMoney: createMoney(l.resolvedUnitPriceMinor!, l.currencyCode, l.minorUnitExponent),
      quantity: l.quantity,
      roundingPolicy: input.roundingPolicy,
    });
    return {
      orderLineId: l.orderLineId,
      resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
      grossMerchandiseMinor: rounded.roundedGrossMoney.amountMinor,
      lineMerchantFundedDiscountMinor: '0',
      eligibleForOrderDiscount: true,
      thirdPartyMerchandiseFundingMinor: '0',
      taxMinor: null as string | null,
      certainty: input.certainty ?? ('FINAL' as const),
      exactUnroundedMinorBasis: rounded.exactUnroundedMinorBasis,
      roundingDelta: rounded.roundingDelta,
      roundingPolicyId: input.roundingPolicy.roundingPolicyId,
      roundingPolicyVersion: input.roundingPolicy.policyVersion,
      roundingMode: input.roundingPolicy.roundingMode,
      quantumMinor: input.roundingPolicy.quantumMinor,
      calculationContext: input.roundingPolicy.calculationContext,
      provenance: {
        source: 'C1_1_BASE_LIST_LINE_GROSS',
        commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
        catalogItemId: l.catalogItemId,
        quantity: l.quantity,
        resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
        menuPublicationId: l.menuPublicationId,
        menuAssignmentId: l.menuAssignmentId,
        priceRuleId: l.priceRuleId,
        availabilityProvenance: l.availabilityProvenance,
        salesContext: l.salesContextProvenance,
        exactUnroundedMinorBasis: rounded.exactUnroundedMinorBasis,
        roundingDelta: rounded.roundingDelta,
      },
    };
  });

  const orderProvenance = {
    source: 'C1_1_BASE_LIST_LINE_GROSS',
    commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
    roundingPolicy: input.roundingPolicy,
    menuPublicationId: c0.menuPublicationId,
    menuAssignmentId: c0.menuAssignmentId,
    salesContext: c0.salesContextProvenance,
  };

  return {
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
    currencyCode: c0.currencyCode,
    minorUnitExponent: c0.minorUnitExponent,
    certainty: input.certainty ?? 'FINAL',
    orderMerchantFundedDiscountMinor: input.orderMerchantFundedDiscountMinor ?? '0',
    taxMinor: input.taxMinor ?? null,
    tipMinor: input.tipMinor ?? null,
    nonMerchandiseChargesMinor: input.nonMerchandiseChargesMinor ?? null,
    commercialResolution: 'BASE_LIST_LINE_GROSS via ADR-0030 RoundingPolicy',
    provenance: orderProvenance,
    actorId: input.actorId,
    deviceId: input.deviceId,
    lineTerms,
  };
}
