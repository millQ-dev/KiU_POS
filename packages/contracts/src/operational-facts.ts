import { z } from 'zod';
import {
  factEnvelopeBaseSchema,
  OperationalFactType,
  operationalFactTypeSchema,
  type OperationalFactTypeName,
} from './common.js';

const moneyPayload = z.object({
  amountMinor: z.string(),
  currencyCode: z.string().length(3),
  minorUnitExponent: z.number().int().min(0).max(4),
});

const quantityPayload = z.object({
  value: z.string(),
  unit: z.string(),
  dimension: z.enum(['MASS', 'VOLUME', 'COUNT']),
});

const costCertaintySchema = z.enum([
  'FINAL',
  'ESTIMATED_FROM_LAST_KNOWN',
  'UNKNOWN',
  'ORDER_UNRESOLVED',
]);

const costPayload = z.object({
  amountMinorUnits: z.string(),
  currencyCode: z.string().length(3),
  minorUnitExponent: z.number().int().min(0).max(4),
  certainty: costCertaintySchema.optional(),
});

/**
 * GoodsReceived is a **line-level** operational fact (not one fact per document).
 *
 * - `supplierReceiptId` — business document id (group key for all lines of one POSTED receipt)
 * - `sourceDocumentLineId` — stable goods_receipt_line identity (optional for older fixtures;
 *   Block C always publishes it)
 * - `stockItemId` + quantity + purchasePrice — that line's accepted inventory/cost payload
 *
 * Consumers MUST group by `supplierReceiptId`. N line facts ≠ N receipts.
 */
export const goodsReceivedPayloadSchema = z.object({
  stockItemId: z.string().uuid(),
  supplierReceiptId: z.string().uuid(),
  sourceDocumentLineId: z.string().uuid().optional(),
  acceptedBaseQuantity: quantityPayload,
  purchasePrice: moneyPayload,
});

export const purchasePriceRecordedPayloadSchema = z.object({
  stockItemId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  purchasePrice: moneyPayload,
  packageDefinitionId: z.string().uuid().optional(),
});

export const recipeVersionActivatedPayloadSchema = z.object({
  recipeId: z.string().uuid(),
  recipeVersionId: z.string().uuid(),
  activatedAt: z.string().datetime(),
});

export const preparationProducedPayloadSchema = z.object({
  preparationSpecVersionId: z.string().uuid(),
  productionBatchId: z.string().uuid(),
  /** Derived input carrying cost — CostValue semantics (ADR-0002), not posted Money */
  actualInputCost: costPayload,
  actualOutputQuantity: quantityPayload,
});

/** TOTAL_LOSS posting: inputs consumed, no preparation stock produced (ADR-0003 §3). */
export const productionTotalLossPayloadSchema = z.object({
  preparationSpecVersionId: z.string().uuid(),
  productionBatchId: z.string().uuid(),
  actualInputCost: costPayload,
  deviationReason: z.string().min(1).optional(),
});

/** Compensating operational fact for production posting reversal (original facts remain immutable). */
export const productionPostingReversedPayloadSchema = z.object({
  productionBatchId: z.string().uuid(),
  productionBatchReversalId: z.string().uuid(),
  reason: z.string().min(1).optional(),
});

export const inventoryAdjustedPayloadSchema = z.object({
  stockItemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantityDelta: quantityPayload,
  reason: z.string().min(1),
});

export const inventoryConsumedPayloadSchema = z.object({
  stockItemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: quantityPayload,
  sourceOrderId: z.string().uuid().optional(),
  sourcePreparationBatchId: z.string().uuid().optional(),
});

export const orderOpenedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  channel: z.string().min(1),
});

export const orderItemAddedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  quantity: quantityPayload,
});

export const orderPaidPayloadSchema = z.object({
  orderId: z.string().uuid(),
  totalPaid: moneyPayload,
});

export const orderCancelledPayloadSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1),
  inventoryWriteOff: z.boolean(),
});

/** OrderCompleted — economic sale completion (ADR-0025). */
export const orderCompletedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  consumptionPlanId: z.string().uuid(),
  resolvedIssueWarehouseId: z.string().uuid(),
  provenanceHash: z.string().min(1),
  lineCount: z.number().int().positive(),
});

/** OrderCompletionReversed — compensating truth after ReverseCompletedOrder (ADR-0025 §9). */
export const orderCompletionReversedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  salesOrderCompletionReversalId: z.string().uuid(),
  goodsIssueId: z.string().uuid(),
  goodsIssueReversalId: z.string().uuid(),
  reason: z.string().min(1).optional(),
});

export const paymentRecordedPayloadSchema = z.object({
  paymentId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  amount: moneyPayload,
  method: z.string().min(1),
});

export const dangerousOperationRecordedPayloadSchema = z.object({
  operationType: z.string().min(1),
  targetRef: z.string().min(1),
  reason: z.string().min(1),
  authorizedBy: z.string().uuid(),
});

/**
 * Authoritative mapping: every OperationalFactType has exactly one payload schema.
 * Adding a new fact type requires adding its schema here — no generic JSON fallback.
 */
export const operationalFactPayloadSchemas = {
  [OperationalFactType.GoodsReceived]: goodsReceivedPayloadSchema,
  [OperationalFactType.PurchasePriceRecorded]: purchasePriceRecordedPayloadSchema,
  [OperationalFactType.RecipeVersionActivated]: recipeVersionActivatedPayloadSchema,
  [OperationalFactType.PreparationProduced]: preparationProducedPayloadSchema,
  [OperationalFactType.ProductionTotalLoss]: productionTotalLossPayloadSchema,
  [OperationalFactType.ProductionPostingReversed]: productionPostingReversedPayloadSchema,
  [OperationalFactType.InventoryAdjusted]: inventoryAdjustedPayloadSchema,
  [OperationalFactType.InventoryConsumed]: inventoryConsumedPayloadSchema,
  [OperationalFactType.OrderOpened]: orderOpenedPayloadSchema,
  [OperationalFactType.OrderItemAdded]: orderItemAddedPayloadSchema,
  [OperationalFactType.OrderPaid]: orderPaidPayloadSchema,
  [OperationalFactType.OrderCancelled]: orderCancelledPayloadSchema,
  [OperationalFactType.OrderCompleted]: orderCompletedPayloadSchema,
  [OperationalFactType.OrderCompletionReversed]: orderCompletionReversedPayloadSchema,
  [OperationalFactType.PaymentRecorded]: paymentRecordedPayloadSchema,
  [OperationalFactType.DangerousOperationRecorded]: dangerousOperationRecordedPayloadSchema,
} as const satisfies Record<OperationalFactTypeName, z.ZodTypeAny>;

type PayloadSchemas = typeof operationalFactPayloadSchemas;

export type PayloadForFactType<T extends keyof PayloadSchemas> = z.infer<PayloadSchemas[T]>;

export type OperationalFact = {
  [K in OperationalFactTypeName]: z.infer<typeof factEnvelopeBaseSchema> & {
    factType: K;
    payload: PayloadForFactType<K>;
  };
}[OperationalFactTypeName];

export class UnknownOperationalFactTypeError extends Error {
  readonly code = 'UNKNOWN_OPERATIONAL_FACT_TYPE' as const;
  constructor(readonly factType: string) {
    super(`Unsupported operational fact type: ${factType}`);
    this.name = 'UnknownOperationalFactTypeError';
  }
}

export class OperationalFactPayloadMismatchError extends Error {
  readonly code = 'OPERATIONAL_FACT_PAYLOAD_MISMATCH' as const;
  constructor(
    readonly factType: string,
    readonly details: string,
  ) {
    super(`Payload does not match factType ${factType}: ${details}`);
    this.name = 'OperationalFactPayloadMismatchError';
  }
}

/**
 * Authoritative ingestion validator: envelope + payload for the exact factType.
 * Unknown fact types and mismatched payloads are rejected.
 */
export function parseOperationalFact(raw: unknown): OperationalFact {
  if (raw === null || typeof raw !== 'object') {
    throw new OperationalFactPayloadMismatchError('unknown', 'fact must be an object');
  }
  const candidate = raw as Record<string, unknown>;
  const typeResult = operationalFactTypeSchema.safeParse(candidate.factType);
  if (!typeResult.success) {
    throw new UnknownOperationalFactTypeError(String(candidate.factType ?? ''));
  }
  const factType = typeResult.data;
  const baseResult = factEnvelopeBaseSchema.safeParse(candidate);
  if (!baseResult.success) {
    throw new OperationalFactPayloadMismatchError(
      factType,
      baseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const payloadResult = operationalFactPayloadSchemas[factType].safeParse(candidate.payload);
  if (!payloadResult.success) {
    throw new OperationalFactPayloadMismatchError(
      factType,
      payloadResult.error.issues.map((i) => `payload.${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return {
    ...baseResult.data,
    factType,
    payload: payloadResult.data,
  } as OperationalFact;
}

export function createOperationalFact(
  input: Omit<OperationalFact, 'recordedAt'> & { recordedAt?: string },
): OperationalFact {
  return parseOperationalFact({
    ...input,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  });
}

/** @deprecated Prefer createOperationalFact */
export const createFactEnvelope = createOperationalFact;

export type GoodsReceivedPayload = z.infer<typeof goodsReceivedPayloadSchema>;
export type PreparationProducedPayload = z.infer<typeof preparationProducedPayloadSchema>;
export type OrderOpenedPayload = z.infer<typeof orderOpenedPayloadSchema>;
