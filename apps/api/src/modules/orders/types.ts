import { z } from 'zod';

const uuid = z.string().uuid();
const decimalString = z.string().min(1);
const dimensionSchema = z.enum(['MASS', 'VOLUME', 'COUNT']);

export const openOrderSchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid,
    outletId: uuid,
    channel: z.string().min(1).default('DIRECT'),
    actorId: uuid.optional(),
    deviceId: uuid.optional(),
  })
  .strict();

export const addOrderLineSchema = z
  .object({
    orderId: uuid,
    catalogItemId: uuid,
    quantity: decimalString,
    unit: z.string().min(1),
    dimension: dimensionSchema,
  })
  .strict();

export const updateOrderLineSchema = z
  .object({
    orderId: uuid,
    orderLineId: uuid,
    quantity: decimalString.optional(),
    unit: z.string().min(1).optional(),
    dimension: dimensionSchema.optional(),
    catalogItemId: uuid.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.quantity !== undefined ||
      v.unit !== undefined ||
      v.dimension !== undefined ||
      v.catalogItemId !== undefined,
    { message: 'At least one updatable field is required' },
  );

export const removeOrderLineSchema = z
  .object({
    orderId: uuid,
    orderLineId: uuid,
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    orderId: uuid,
    reason: z.string().min(1),
    actorId: uuid.optional(),
    deviceId: uuid.optional(),
  })
  .strict();

export const completeOrderSchema = z
  .object({
    orderId: uuid,
    idempotencyKey: z.string().min(1),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    businessTime: z.string().optional(),
    businessOrder: z.number().int().nonnegative(),
    actorId: uuid.optional(),
    deviceId: uuid.optional(),
    /** Forbidden: client must not assign issue warehouse (ADR-0025 §11). */
    warehouseId: z.never().optional(),
    issueWarehouseId: z.never().optional(),
  })
  .strict();

export type OpenOrderInput = z.infer<typeof openOrderSchema>;
export type CompleteOrderInput = z.infer<typeof completeOrderSchema>;
