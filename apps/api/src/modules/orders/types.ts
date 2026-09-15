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

export const reverseCompletedOrderSchema = z
  .object({
    orderId: uuid,
    idempotencyKey: z.string().min(1),
    /** Authoritative reversal business chronology (ADR-0027). Required. */
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    businessOrder: z.number().int().nonnegative(),
    businessTime: z.string().optional(),
    reason: z.string().min(1).optional(),
    actorId: uuid.optional(),
    deviceId: uuid.optional(),
  })
  .strict();

const minorNonNeg = z.string().regex(/^[0-9]+$/);
const commercialCertaintySchema = z.enum(['FINAL', 'UNKNOWN']);

export const setOrderCommercialTermsSchema = z
  .object({
    orderId: uuid,
    idempotencyKey: z.string().min(1),
    currencyCode: z.string().length(3),
    minorUnitExponent: z.number().int().min(0).max(4),
    certainty: commercialCertaintySchema,
    orderMerchantFundedDiscountMinor: minorNonNeg.default('0'),
    taxMinor: minorNonNeg.nullable().optional(),
    nonMerchandiseChargesMinor: minorNonNeg.nullable().optional(),
    tipMinor: minorNonNeg.nullable().optional(),
    customerPayableMinor: minorNonNeg.nullable().optional(),
    commercialResolution: z.string().min(1).nullable().optional(),
    provenance: z.unknown().optional(),
    actorId: uuid.optional(),
    deviceId: uuid.optional(),
    lineTerms: z
      .array(
        z
          .object({
            orderLineId: uuid,
            resolvedUnitPriceMinor: minorNonNeg.nullable().optional(),
            grossMerchandiseMinor: minorNonNeg,
            lineMerchantFundedDiscountMinor: minorNonNeg.default('0'),
            eligibleForOrderDiscount: z.boolean().default(true),
            thirdPartyMerchandiseFundingMinor: minorNonNeg.default('0'),
            taxMinor: minorNonNeg.nullable().optional(),
            certainty: commercialCertaintySchema.optional(),
            fundingProvenance: z.string().min(1).nullable().optional(),
            provenance: z.unknown().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type OpenOrderInput = z.infer<typeof openOrderSchema>;
export type CompleteOrderInput = z.infer<typeof completeOrderSchema>;
export type ReverseCompletedOrderInput = z.infer<typeof reverseCompletedOrderSchema>;
export type SetOrderCommercialTermsInput = z.infer<typeof setOrderCommercialTermsSchema>;
