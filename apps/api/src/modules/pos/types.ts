import { z } from 'zod';

const modifierSelectionSchema = z
  .object({
    groupId: z.string().uuid(),
    optionIds: z.array(z.string().uuid()),
  })
  .strict();

const uuid = z.string().uuid();
const isoInstant = z.string().datetime({ offset: true });

export const layoutScopeKindSchema = z.enum(['TENANT', 'BRAND', 'OUTLET']);
export type LayoutScopeKind = z.infer<typeof layoutScopeKindSchema>;

export const slotZoneSchema = z.enum(['PAGE', 'QUICK_ACCESS']);
export type SlotZone = z.infer<typeof slotZoneSchema>;

export const createLayoutDefinitionSchema = z
  .object({
    tenantId: uuid,
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export type CreateLayoutDefinitionInput = z.infer<typeof createLayoutDefinitionSchema>;

export const setLayoutPagesSchema = z
  .object({
    layoutDefinitionId: uuid,
    pages: z
      .array(
        z
          .object({
            pageCode: z.string().trim().min(1).max(64),
            label: z.string().trim().min(1).max(200),
            sortOrder: z.number().int().min(0),
            colorToken: z.string().trim().min(1).max(64).nullable().optional(),
          })
          .strict(),
      )
      .min(0),
  })
  .strict();
export type SetLayoutPagesInput = z.infer<typeof setLayoutPagesSchema>;

export const setLayoutSlotsSchema = z
  .object({
    layoutDefinitionId: uuid,
    slots: z
      .array(
        z
          .object({
            zone: slotZoneSchema,
            pageCode: z.string().trim().min(1).max(64).optional(),
            catalogItemId: uuid,
            position: z.number().int().min(1),
            labelOverride: z.string().trim().min(1).max(200).nullable().optional(),
            colorToken: z.string().trim().min(1).max(64).nullable().optional(),
          })
          .strict(),
      )
      .min(0),
  })
  .strict();
export type SetLayoutSlotsInput = z.infer<typeof setLayoutSlotsSchema>;

export const publishLayoutSchema = z
  .object({
    layoutDefinitionId: uuid,
    idempotencyKey: z.string().min(1),
    effectiveFrom: isoInstant,
    effectiveTo: isoInstant.nullable().optional(),
    actorId: uuid.optional(),
  })
  .strict();
export type PublishLayoutInput = z.infer<typeof publishLayoutSchema>;

export const assignLayoutSchema = z
  .object({
    tenantId: uuid,
    layoutPublicationId: uuid,
    scopeKind: layoutScopeKindSchema,
    brandId: uuid.optional(),
    outletId: uuid.optional(),
    effectiveFrom: isoInstant,
    effectiveTo: isoInstant.nullable().optional(),
    idempotencyKey: z.string().min(1),
    actorId: uuid.optional(),
  })
  .strict();
export type AssignLayoutInput = z.infer<typeof assignLayoutSchema>;

export const presentationContextSchema = z
  .object({
    tenantId: uuid,
    brandId: uuid,
    outletId: uuid,
    terminalGroupId: uuid.nullable().optional(),
    terminalId: uuid.nullable().optional(),
  })
  .strict();
export type PresentationContextInput = z.infer<typeof presentationContextSchema>;

export const resolveLayoutSchema = z
  .object({
    presentationContext: presentationContextSchema,
    businessDateTime: isoInstant,
  })
  .strict();

export const resolvePosSurfaceSchema = z
  .object({
    presentationContext: presentationContextSchema,
    salesContext: z
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
      .strict(),
  })
  .strict();

export const selectPosItemSchema = z
  .object({
    orderId: uuid,
    layoutPublicationSlotId: uuid,
    presentationContext: presentationContextSchema,
    salesContext: z
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
      .strict(),
    quantity: z.string().regex(/^-?\d+(\.\d+)?$/),
    unit: z.string().min(1),
    dimension: z.enum(['MASS', 'VOLUME', 'COUNT']),
    modifierSelections: z.array(modifierSelectionSchema).optional().default([]),
  })
  .strict();
export type SelectPosItemInput = z.infer<typeof selectPosItemSchema>;

/** P1.2 COUNT one-tap — quantity/unit derived from Catalog; MASS/VOLUME rejected. */
export const selectPosCountTapSchema = z
  .object({
    orderId: uuid,
    layoutPublicationSlotId: uuid,
    presentationContext: presentationContextSchema,
    salesContext: z
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
      .strict(),
    modifierSelections: z.array(modifierSelectionSchema).optional().default([]),
  })
  .strict();
export type SelectPosCountTapInput = z.infer<typeof selectPosCountTapSchema>;

/** P1.3 explicit quantity add (COUNT / MASS / VOLUME) — no unit×qty gross. */
export const selectPosQuantityTapSchema = z
  .object({
    orderId: uuid,
    layoutPublicationSlotId: uuid,
    presentationContext: presentationContextSchema,
    salesContext: z
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
      .strict(),
    quantity: z.string().regex(/^-?\d+(\.\d+)?$/),
    modifierSelections: z.array(modifierSelectionSchema).optional().default([]),
  })
  .strict();
export type SelectPosQuantityTapInput = z.infer<typeof selectPosQuantityTapSchema>;
