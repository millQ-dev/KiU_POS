import { z } from 'zod';

const uuid = z.string().uuid();
const minorNonNeg = z.string().regex(/^[0-9]+$/);
const currencyCode = z.string().length(3).regex(/^[A-Z]{3}$/);
const isoInstant = z.string().datetime({ offset: true });

export const menuScopeKindSchema = z.enum(['TENANT', 'BRAND', 'OUTLET']);
export type MenuScopeKind = z.infer<typeof menuScopeKindSchema>;

export const availabilityStatusSchema = z.enum(['AVAILABLE', 'UNAVAILABLE']);
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;

export const createMenuDefinitionSchema = z
  .object({
    tenantId: uuid,
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export type CreateMenuDefinitionInput = z.infer<typeof createMenuDefinitionSchema>;

export const setMenuDefinitionItemsSchema = z
  .object({
    menuDefinitionId: uuid,
    catalogItemIds: z.array(uuid).min(0),
  })
  .strict();
export type SetMenuDefinitionItemsInput = z.infer<typeof setMenuDefinitionItemsSchema>;

export const publishMenuSchema = z
  .object({
    menuDefinitionId: uuid,
    idempotencyKey: z.string().min(1),
    actorId: uuid.optional(),
  })
  .strict();
export type PublishMenuInput = z.infer<typeof publishMenuSchema>;

export const assignMenuSchema = z
  .object({
    tenantId: uuid,
    menuPublicationId: uuid,
    scopeKind: menuScopeKindSchema,
    brandId: uuid.optional(),
    outletId: uuid.optional(),
    effectiveFrom: isoInstant,
    effectiveTo: isoInstant.nullable().optional(),
    idempotencyKey: z.string().min(1),
    actorId: uuid.optional(),
  })
  .strict();
export type AssignMenuInput = z.infer<typeof assignMenuSchema>;

export const activateAvailabilityRuleSchema = z
  .object({
    tenantId: uuid,
    catalogItemId: uuid,
    scopeKind: menuScopeKindSchema,
    brandId: uuid.optional(),
    outletId: uuid.optional(),
    availabilityStatus: availabilityStatusSchema,
    orderChannel: z.string().min(1).nullable().optional(),
    effectiveFrom: isoInstant,
    effectiveTo: isoInstant.nullable().optional(),
    idempotencyKey: z.string().min(1),
    actorId: uuid.optional(),
  })
  .strict();
export type ActivateAvailabilityRuleInput = z.infer<typeof activateAvailabilityRuleSchema>;

export const activatePriceRuleSchema = z
  .object({
    tenantId: uuid,
    catalogItemId: uuid,
    scopeKind: menuScopeKindSchema,
    brandId: uuid.optional(),
    outletId: uuid.optional(),
    amountMinor: minorNonNeg,
    currencyCode,
    minorUnitExponent: z.number().int().min(0).max(4),
    orderChannel: z.string().min(1).nullable().optional(),
    effectiveFrom: isoInstant,
    effectiveTo: isoInstant.nullable().optional(),
    idempotencyKey: z.string().min(1),
    actorId: uuid.optional(),
  })
  .strict();
export type ActivatePriceRuleInput = z.infer<typeof activatePriceRuleSchema>;

export const setOutletTimezoneSchema = z
  .object({
    outletId: uuid,
    timezone: z.string().min(1),
  })
  .strict();
export type SetOutletTimezoneInput = z.infer<typeof setOutletTimezoneSchema>;

export const salesContextSchema = z
  .object({
    tenantId: uuid,
    brandId: uuid,
    outletId: uuid,
    terminalGroupId: uuid.nullable().optional(),
    terminalId: uuid.nullable().optional(),
    serviceMode: z.string().min(1).nullable().optional(),
    orderChannel: z.string().min(1),
    businessDateTime: isoInstant,
  })
  .strict();
export type SalesContextInput = z.infer<typeof salesContextSchema>;

export const resolveMenuSchema = z
  .object({
    salesContext: salesContextSchema,
  })
  .strict();

export const resolveMenuItemSchema = z
  .object({
    salesContext: salesContextSchema,
    catalogItemId: uuid,
  })
  .strict();

export const resolveOrderLinesFromMenuSchema = z
  .object({
    orderId: uuid,
    salesContext: salesContextSchema.optional(),
  })
  .strict();
export type ResolveOrderLinesFromMenuInput = z.infer<typeof resolveOrderLinesFromMenuSchema>;
