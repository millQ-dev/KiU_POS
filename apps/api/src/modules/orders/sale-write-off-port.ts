/**
 * D1.3B Inventory port for sale write-off.
 * D1.3A does not wire a production implementation — CompleteOrder cannot succeed without it.
 */
export type SaleGoodsIssueRef = {
  readonly goodsIssueId: string;
};

export type SaleWriteOffCommand = {
  readonly orderId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly outletId: string;
  readonly warehouseId: string;
  readonly businessDate: string;
  readonly businessTime?: string | null;
  readonly businessOrder: number;
  readonly actorId?: string | null;
  readonly deviceId?: string | null;
  readonly idempotencyKey: string;
  readonly provenanceHash: string;
  readonly planJson: unknown;
  readonly physicalLeaves: ReadonlyArray<{
    orderLineId: string;
    catalogItemId: string;
    quantityBase: string;
    unitBase: string;
    dimension: string;
  }>;
};

export type SaleGoodsIssueReverseCommand = {
  readonly orderId: string;
  readonly goodsIssueId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly idempotencyKey: string;
  readonly reason?: string | null;
  readonly actorId?: string | null;
  readonly deviceId?: string | null;
};

export type SaleGoodsIssueReverseRef = {
  readonly goodsIssueReversalId: string;
};

/**
 * Inventory-owned posting boundary (ADR-0025 §4 / §9).
 * Creates typed GoodsIssue + POSTED movements (and reversals) inside the caller's TX.
 */
export interface SaleInventoryWriteOffPort {
  postGoodsIssueFromConsumptionPlan(
    client: unknown,
    command: SaleWriteOffCommand,
  ): Promise<SaleGoodsIssueRef>;

  reverseGoodsIssueFromOrder(
    client: unknown,
    command: SaleGoodsIssueReverseCommand,
  ): Promise<SaleGoodsIssueReverseRef>;
}
