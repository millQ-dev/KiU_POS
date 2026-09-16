/**
 * OPTION A — Explicit gross only (PO decision for M1.1).
 *
 * MenuResolver supplies UNIT price + provenance.
 * Caller MUST supply grossMerchandiseMinor explicitly.
 * This helper MUST NOT compute unitPrice × quantity.
 */
import { DomainValidationError } from './errors.js';
import type { ResolvedOrderLineFromMenu } from './menu-resolver.js';

export type ExplicitLineCommercialAmount = {
  readonly orderLineId: string;
  readonly grossMerchandiseMinor: string;
};

export type BuildMenuResolvedCommercialTermsInput = {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly certainty?: 'FINAL' | 'UNKNOWN';
  readonly resolvedLines: ReadonlyArray<ResolvedOrderLineFromMenu>;
  readonly explicitLineCommercialAmounts: ReadonlyArray<ExplicitLineCommercialAmount>;
  /** Optional order-level fields — defaults keep base commercial proposal. */
  readonly orderMerchantFundedDiscountMinor?: string;
  readonly taxMinor?: string | null;
  readonly tipMinor?: string | null;
  readonly nonMerchandiseChargesMinor?: string | null;
  readonly actorId?: string;
  readonly deviceId?: string;
};

/**
 * Build SetOrderCommercialTerms input from menu unit-price resolution + explicit gross.
 * Does not call OrdersService and does not write commercial tables.
 */
export function buildMenuResolvedCommercialTermsInput(input: BuildMenuResolvedCommercialTermsInput) {
  if (input.resolvedLines.length === 0) {
    throw new DomainValidationError('EMPTY_ORDER', 'No resolved menu lines');
  }
  if (input.explicitLineCommercialAmounts.length !== input.resolvedLines.length) {
    throw new DomainValidationError(
      'INCOMPLETE_LINE_TERMS',
      'explicitLineCommercialAmounts must cover every resolved line exactly once',
    );
  }

  const grossByLine = new Map<string, string>();
  for (const a of input.explicitLineCommercialAmounts) {
    if (!/^[0-9]+$/.test(a.grossMerchandiseMinor)) {
      throw new DomainValidationError('INVALID_MONEY', 'grossMerchandiseMinor must be integer minor digits');
    }
    if (grossByLine.has(a.orderLineId)) {
      throw new DomainValidationError('DUPLICATE_LINE_TERM', `Duplicate explicit gross for ${a.orderLineId}`);
    }
    grossByLine.set(a.orderLineId, a.grossMerchandiseMinor);
  }

  const c0 = input.resolvedLines[0]!;
  for (const line of input.resolvedLines) {
    if (line.currencyCode !== c0.currencyCode || line.minorUnitExponent !== c0.minorUnitExponent) {
      throw new DomainValidationError(
        'ORDER_COMMERCIAL_CURRENCY_MISMATCH',
        'Resolved lines must share one currency / minor exponent',
      );
    }
    if (!grossByLine.has(line.orderLineId)) {
      throw new DomainValidationError(
        'INCOMPLETE_LINE_TERMS',
        `Missing explicit gross for order line ${line.orderLineId}`,
      );
    }
  }

  const orderProvenance = {
    source: 'MENU_RESOLVER_M1_1',
    commercialGrossPolicy: 'EXPLICIT_GROSS_ONLY',
    note: 'grossMerchandiseMinor supplied by caller; Menu does not compute unit×quantity',
    menuPublicationId: c0.menuPublicationId,
    menuAssignmentId: c0.menuAssignmentId,
    salesContext: c0.salesContextProvenance,
    lines: input.resolvedLines.map((l) => ({
      orderLineId: l.orderLineId,
      catalogItemId: l.catalogItemId,
      quantity: l.quantity,
      resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
      priceRuleId: l.priceRuleId,
      availabilityProvenance: l.availabilityProvenance,
      menuPublicationId: l.menuPublicationId,
      menuAssignmentId: l.menuAssignmentId,
    })),
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
    commercialResolution: 'menu-base-price-unit; gross explicit caller input',
    provenance: orderProvenance,
    actorId: input.actorId,
    deviceId: input.deviceId,
    lineTerms: input.resolvedLines.map((l) => ({
      orderLineId: l.orderLineId,
      resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
      grossMerchandiseMinor: grossByLine.get(l.orderLineId)!,
      lineMerchantFundedDiscountMinor: '0',
      eligibleForOrderDiscount: true,
      thirdPartyMerchandiseFundingMinor: '0',
      taxMinor: null,
      certainty: input.certainty ?? 'FINAL',
      provenance: {
        source: 'MENU_RESOLVER_M1_1',
        commercialGrossPolicy: 'EXPLICIT_GROSS_ONLY',
        catalogItemId: l.catalogItemId,
        quantity: l.quantity,
        resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
        menuPublicationId: l.menuPublicationId,
        menuAssignmentId: l.menuAssignmentId,
        priceRuleId: l.priceRuleId,
        availabilityProvenance: l.availabilityProvenance,
        salesContext: l.salesContextProvenance,
      },
    })),
  };
}
