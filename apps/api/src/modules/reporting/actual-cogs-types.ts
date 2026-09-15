import { z } from 'zod';
import type { CostBasis, CostCertainty } from '@millq/domain';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type ActualCogsEffectType = 'SALE' | 'REVERSAL';

/**
 * Evidence-line grain Actual COGS effect (ADR-0026).
 * SALE uses goods_issue_line.issue_cost_minor (positive).
 * REVERSAL compensates the same allocation at reversal business chronology (negative).
 */
export type ActualCogsEffect = {
  readonly effectType: ActualCogsEffectType;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly outletId: string;
  readonly warehouseId: string;
  readonly orderId: string;
  readonly orderLineId: string;
  readonly soldCatalogItemId: string;
  readonly physicalCatalogItemId: string;
  readonly goodsIssueId: string;
  readonly goodsIssueLineId: string;
  /** Original sale OUT movement id (shared across sibling evidence lines). */
  readonly inventoryMovementId: string;
  readonly goodsIssueReversalId: string | null;
  readonly businessDate: string;
  readonly businessOrder: number;
  readonly businessTime: string | null;
  readonly signedQuantity: string;
  readonly unit: string;
  readonly dimension: string;
  /** Positive for SALE; negative for REVERSAL. Null only if component certainty prevents a known amount. */
  readonly signedActualCogsMinor: string | null;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly costCertainty: CostCertainty;
  readonly costBasis: CostBasis;
};

export type ActualCogsPhysicalEffect = {
  readonly effectType: ActualCogsEffectType;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly outletId: string;
  readonly warehouseId: string;
  readonly orderId: string;
  readonly physicalCatalogItemId: string;
  readonly goodsIssueId: string;
  readonly inventoryMovementId: string;
  readonly goodsIssueReversalId: string | null;
  readonly businessDate: string;
  readonly businessOrder: number;
  readonly businessTime: string | null;
  readonly signedQuantity: string;
  readonly unit: string;
  readonly dimension: string;
  readonly signedActualCogsMinor: string | null;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly costCertainty: CostCertainty;
  readonly costBasis: CostBasis;
};

export type ActualCogsAggregate = {
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  /** Exact total when all components have known amounts and no UNKNOWN/ORDER_UNRESOLVED. */
  readonly actualCogsMinor: string | null;
  /** Sum of FINAL + ESTIMATED components only (may be incomplete). */
  readonly knownSubtotalMinor: string;
  readonly certainty: CostCertainty;
  readonly componentCount: number;
  readonly finalComponentCount: number;
  readonly estimatedComponentCount: number;
  readonly unknownComponentCount: number;
  readonly unresolvedComponentCount: number;
};

export const actualCogsQuerySchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    outletId: uuid.optional(),
    warehouseId: uuid.optional(),
    orderId: uuid.optional(),
    orderLineId: uuid.optional(),
    soldCatalogItemId: uuid.optional(),
    physicalCatalogItemId: uuid.optional(),
    currencyCode: z.string().length(3).optional(),
    businessDateFrom: date.optional(),
    businessDateTo: date.optional(),
    businessDate: date.optional(),
    certainty: z
      .enum(['FINAL', 'ESTIMATED_FROM_LAST_KNOWN', 'UNKNOWN', 'ORDER_UNRESOLVED'])
      .optional(),
    channel: z.string().min(1).optional(),
  })
  .strict();

export type ActualCogsQuery = z.infer<typeof actualCogsQuerySchema>;
