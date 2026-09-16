import { z } from 'zod';
import type { CommercialCertainty } from '@millq/domain';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type RevenueBasisEffectType = 'SALE' | 'REVERSAL';

/**
 * Line-grain Revenue Basis effect (ADR-0028).
 * SALE uses frozen order_line_commercial_snapshot at completion chronology.
 * REVERSAL compensates the same line at ADR-0027 reversal business chronology.
 */
export type RevenueBasisLineEffect = {
  readonly effectType: RevenueBasisEffectType;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly outletId: string;
  readonly orderId: string;
  readonly orderLineId: string;
  readonly soldCatalogItemId: string;
  readonly lineNumber: number;
  readonly businessDate: string;
  readonly businessOrder: number;
  readonly businessTime: string | null;
  readonly channel: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly grossMerchandiseMinor: string;
  readonly lineMerchantFundedDiscountMinor: string;
  readonly allocatedOrderMerchantDiscountMinor: string;
  readonly thirdPartyMerchandiseFundingMinor: string;
  readonly revenueCertainty: CommercialCertainty;
  /** Positive for SALE; negative for REVERSAL. Null when certainty is UNKNOWN. */
  readonly signedRevenueBasisMinor: string | null;
  readonly orderCommercialSnapshotId: string;
  readonly orderLineCommercialSnapshotId: string;
  readonly salesOrderCompletionReversalId: string | null;
};

/**
 * Order-grain Revenue Basis effect (ADR-0028).
 * Component fields remain positive historical evidence; sign is on signedRevenueBasisMinor.
 */
export type RevenueBasisOrderEffect = {
  readonly effectType: RevenueBasisEffectType;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly outletId: string;
  readonly orderId: string;
  readonly businessDate: string;
  readonly businessOrder: number;
  readonly businessTime: string | null;
  readonly channel: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly revenueCertainty: CommercialCertainty;
  readonly grossMerchandiseMinor: string;
  readonly merchantFundedDiscountMinor: string;
  readonly thirdPartyMerchandiseFundingMinor: string;
  readonly taxMinor: string | null;
  readonly nonMerchandiseChargesMinor: string | null;
  readonly tipMinor: string | null;
  readonly customerPayableMinor: string | null;
  readonly signedRevenueBasisMinor: string | null;
  readonly orderCommercialSnapshotId: string;
  readonly salesOrderCompletionReversalId: string | null;
};

export type RevenueBasisAggregate = {
  readonly currencyCode: string | null;
  readonly minorUnitExponent: number | null;
  /** Exact total when all components are FINAL. Null when any UNKNOWN is included. */
  readonly revenueBasisMinor: string | null;
  /** Sum of FINAL signed components only (may be incomplete when UNKNOWN present). */
  readonly knownSubtotalMinor: string;
  readonly certainty: CommercialCertainty;
  readonly componentCount: number;
  readonly finalComponentCount: number;
  readonly unknownComponentCount: number;
};

export const revenueBasisQuerySchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    outletId: uuid.optional(),
    orderId: uuid.optional(),
    orderLineId: uuid.optional(),
    soldCatalogItemId: uuid.optional(),
    channel: z.string().min(1).optional(),
    businessDateFrom: date.optional(),
    businessDateTo: date.optional(),
    businessDate: date.optional(),
    currencyCode: z.string().length(3).optional(),
    certainty: z.enum(['FINAL', 'UNKNOWN']).optional(),
    effectType: z.enum(['SALE', 'REVERSAL']).optional(),
  })
  .strict();

export type RevenueBasisQuery = z.infer<typeof revenueBasisQuerySchema>;
