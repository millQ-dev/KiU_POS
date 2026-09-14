import { z } from 'zod';

const uuid = z.string().uuid();

export const postProductionBatchSchema = z
  .object({
    productionBatchId: uuid,
    idempotencyKey: z.string().min(1),
    currencyCode: z.string().length(3),
    minorUnitExponent: z.number().int().min(0).max(4),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    businessTime: z.string().optional(),
    businessOrder: z.number().int().min(0),
    actorId: uuid.optional(),
    productCost: z.never().optional(),
    recipeCurrentCost: z.never().optional(),
  })
  .strict();

export const reverseProductionBatchSchema = z
  .object({
    productionBatchId: uuid,
    idempotencyKey: z.string().min(1),
    actorId: uuid.optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

export type PostProductionBatchInput = z.infer<typeof postProductionBatchSchema>;
export type ReverseProductionBatchInput = z.infer<typeof reverseProductionBatchSchema>;
