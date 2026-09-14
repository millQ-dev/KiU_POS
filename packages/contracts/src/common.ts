import { z } from 'zod';

export const businessPositionSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  businessTime: z.string().optional(),
  businessOrder: z.number().int().nonnegative(),
});

export type BusinessPosition = z.infer<typeof businessPositionSchema>;

export const operationalContextSchema = z.object({
  businessGroupId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  restaurantLocationId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  terminalId: z.string().uuid().optional(),
  actorId: z.string().uuid(),
  jurisdictionProfileVersionId: z.string().uuid(),
  valuationCurrencyCode: z.string().length(3),
});

export type OperationalContext = z.infer<typeof operationalContextSchema>;

/** Authoritative operational fact type identifiers */
export const OperationalFactType = {
  GoodsReceived: 'GoodsReceived',
  PurchasePriceRecorded: 'PurchasePriceRecorded',
  RecipeVersionActivated: 'RecipeVersionActivated',
  PreparationProduced: 'PreparationProduced',
  ProductionTotalLoss: 'ProductionTotalLoss',
  ProductionPostingReversed: 'ProductionPostingReversed',
  InventoryAdjusted: 'InventoryAdjusted',
  InventoryConsumed: 'InventoryConsumed',
  OrderOpened: 'OrderOpened',
  OrderItemAdded: 'OrderItemAdded',
  OrderPaid: 'OrderPaid',
  OrderCancelled: 'OrderCancelled',
  PaymentRecorded: 'PaymentRecorded',
  DangerousOperationRecorded: 'DangerousOperationRecorded',
} as const;

export type OperationalFactTypeName =
  (typeof OperationalFactType)[keyof typeof OperationalFactType];

export const operationalFactTypeSchema = z.enum([
  OperationalFactType.GoodsReceived,
  OperationalFactType.PurchasePriceRecorded,
  OperationalFactType.RecipeVersionActivated,
  OperationalFactType.PreparationProduced,
  OperationalFactType.ProductionTotalLoss,
  OperationalFactType.ProductionPostingReversed,
  OperationalFactType.InventoryAdjusted,
  OperationalFactType.InventoryConsumed,
  OperationalFactType.OrderOpened,
  OperationalFactType.OrderItemAdded,
  OperationalFactType.OrderPaid,
  OperationalFactType.OrderCancelled,
  OperationalFactType.PaymentRecorded,
  OperationalFactType.DangerousOperationRecorded,
]);

/** Envelope without typed payload — used only for shared fields. Authoritative facts use operationalFactSchema. */
export const factEnvelopeBaseSchema = z.object({
  factId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  position: businessPositionSchema,
  context: operationalContextSchema,
});
