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

/**
 * Inventory-owned posting boundary (ADR-0025 §4).
 * Must create typed GoodsIssue + POSTED movements inside the caller's transaction client
 * when D1.3B is wired. D1.3A leaves this unwired.
 */
export interface SaleInventoryWriteOffPort {
  postGoodsIssueFromConsumptionPlan(
    client: unknown,
    command: SaleWriteOffCommand,
  ): Promise<SaleGoodsIssueRef>;
}
