/**
 * Test helper: accept simple FINAL merchandise commercial terms for all current order lines.
 * Does not invent Pricing — tests supply gross minors (default 0 for COGS-only flows).
 */
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
  },
) {
  const order = await orders.getOrder(orderId);
  const defaultGross = opts?.defaultGrossMinor ?? '0';
  return orders.setOrderCommercialTerms({
    orderId,
    idempotencyKey: opts?.idempotencyKey ?? `commercial:${orderId}`,
    currencyCode: opts?.currencyCode ?? 'VND',
    minorUnitExponent: opts?.minorUnitExponent ?? 0,
    certainty: opts?.certainty ?? 'FINAL',
    orderMerchantFundedDiscountMinor: opts?.orderMerchantFundedDiscountMinor ?? '0',
    taxMinor: opts?.taxMinor ?? null,
    nonMerchandiseChargesMinor: opts?.nonMerchandiseChargesMinor ?? null,
    tipMinor: opts?.tipMinor ?? null,
    customerPayableMinor: opts?.customerPayableMinor ?? null,
    lineTerms: order.lines.map(
      (l: { orderLineId: string; catalogItemId: string }) => ({
        orderLineId: l.orderLineId,
        grossMerchandiseMinor:
          opts?.grossByOrderLineId?.[l.orderLineId] ??
          opts?.grossByCatalogItemId?.[l.catalogItemId] ??
          defaultGross,
        lineMerchantFundedDiscountMinor:
          opts?.lineDiscountsByOrderLineId?.[l.orderLineId] ?? '0',
        thirdPartyMerchandiseFundingMinor:
          opts?.thirdPartyFundingByOrderLineId?.[l.orderLineId] ?? '0',
        eligibleForOrderDiscount: true,
      }),
    ),
  });
}
