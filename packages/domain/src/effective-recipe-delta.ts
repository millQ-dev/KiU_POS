/**
 * ADR-0049 / ADR-0052 M3 — apply structured ModifierOption recipe deltas
 * onto a base component list before explosion.
 * Pure function; does not own recipe publication or inventory posting.
 */
import { DomainError } from './errors.js';

export type RecipeComponentRef = {
  catalogItemId: string;
  quantity: string;
  unit: string;
  dimension: 'MASS' | 'VOLUME' | 'COUNT';
};

export type ModifierRecipeDelta =
  | { kind: 'REMOVE_COMPONENT'; targetCatalogItemId: string }
    | {
      kind: 'REPLACE_COMPONENT';
      targetCatalogItemId: string;
      replacementCatalogItemId: string;
      /** Published yield override. All three fields, or none (keep source quantity and unit). */
      replacementQuantity?: string;
      replacementUnit?: string;
      replacementDimension?: 'MASS' | 'VOLUME' | 'COUNT';
    }
  | {
      kind: 'ADD_COMPONENT';
      addCatalogItemId: string;
      quantity: string;
      unit: string;
      dimension: 'MASS' | 'VOLUME' | 'COUNT';
    };

function replacementYield(
  delta: Extract<ModifierRecipeDelta, { kind: 'REPLACE_COMPONENT' }>,
): { quantity: string; unit: string; dimension: 'MASS' | 'VOLUME' | 'COUNT' } | null {
  const present = [
    delta.replacementQuantity,
    delta.replacementUnit,
    delta.replacementDimension,
  ].filter((v) => v != null).length;
  if (present === 0) return null;
  if (
    present !== 3 ||
    delta.replacementQuantity == null ||
    delta.replacementUnit == null ||
    delta.replacementDimension == null
  ) {
    throw new DomainError(
      'MODIFIER_DELTA_INVALID',
      'REPLACE yield override requires quantity, unit, and dimension together',
    );
  }
  return {
    quantity: delta.replacementQuantity,
    unit: delta.replacementUnit,
    dimension: delta.replacementDimension,
  };
}

export function applyEffectiveRecipeDeltas(
  base: ReadonlyArray<RecipeComponentRef>,
  deltas: ReadonlyArray<ModifierRecipeDelta>,
): RecipeComponentRef[] {
  let next = base.map((c) => ({ ...c }));
  for (const d of deltas) {
    if (d.kind === 'REMOVE_COMPONENT') {
      const before = next.length;
      next = next.filter((c) => c.catalogItemId !== d.targetCatalogItemId);
      if (next.length === before) {
        throw new DomainError(
          'MODIFIER_DELTA_TARGET_MISSING',
          `REMOVE target ${d.targetCatalogItemId} is not on the base recipe`,
        );
      }
      continue;
    }
    if (d.kind === 'REPLACE_COMPONENT') {
      const yieldOverride = replacementYield(d);
      let hits = 0;
      next = next.map((c) => {
        if (c.catalogItemId !== d.targetCatalogItemId) return c;
        hits += 1;
        return {
          catalogItemId: d.replacementCatalogItemId,
          quantity: yieldOverride?.quantity ?? c.quantity,
          unit: yieldOverride?.unit ?? c.unit,
          dimension: yieldOverride?.dimension ?? c.dimension,
        };
      });
      if (hits === 0) {
        throw new DomainError(
          'MODIFIER_DELTA_TARGET_MISSING',
          `REPLACE target ${d.targetCatalogItemId} is not on the base recipe`,
        );
      }
      continue;
    }
    next.push({
      catalogItemId: d.addCatalogItemId,
      quantity: d.quantity,
      unit: d.unit,
      dimension: d.dimension,
    });
  }
  return next;
}

export function catalogIdsReferencedByDeltas(
  deltas: ReadonlyArray<ModifierRecipeDelta>,
): string[] {
  const ids = new Set<string>();
  for (const d of deltas) {
    if (d.kind === 'REPLACE_COMPONENT') ids.add(d.replacementCatalogItemId);
    if (d.kind === 'ADD_COMPONENT') ids.add(d.addCatalogItemId);
  }
  return [...ids];
}

export function parseFrozenRecipeDeltas(raw: unknown): ModifierRecipeDelta[] {
  if (!Array.isArray(raw)) {
    throw new DomainError(
      'MODIFIER_DELTAS_INVALID',
      'Frozen Effective Recipe deltas must be a JSON array',
    );
  }
  return raw.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new DomainError('MODIFIER_DELTAS_INVALID', `Delta ${index} is not an object`);
    }
    const d = row as Record<string, unknown>;
    if (d.kind === 'REMOVE_COMPONENT' && typeof d.targetCatalogItemId === 'string') {
      return { kind: 'REMOVE_COMPONENT', targetCatalogItemId: d.targetCatalogItemId };
    }
    if (
      d.kind === 'REPLACE_COMPONENT' &&
      typeof d.targetCatalogItemId === 'string' &&
      typeof d.replacementCatalogItemId === 'string'
    ) {
      const yieldFields = [
        d.replacementQuantity,
        d.replacementUnit,
        d.replacementDimension,
      ].filter((v) => v != null);
      if (yieldFields.length === 0) {
        return {
          kind: 'REPLACE_COMPONENT',
          targetCatalogItemId: d.targetCatalogItemId,
          replacementCatalogItemId: d.replacementCatalogItemId,
        };
      }
      if (
        yieldFields.length !== 3 ||
        typeof d.replacementQuantity !== 'string' ||
        typeof d.replacementUnit !== 'string' ||
        (d.replacementDimension !== 'MASS' &&
          d.replacementDimension !== 'VOLUME' &&
          d.replacementDimension !== 'COUNT')
      ) {
        throw new DomainError(
          'MODIFIER_DELTAS_INVALID',
          `REPLACE delta ${index} yield override must include quantity, unit, and dimension`,
        );
      }
      return {
        kind: 'REPLACE_COMPONENT',
        targetCatalogItemId: d.targetCatalogItemId,
        replacementCatalogItemId: d.replacementCatalogItemId,
        replacementQuantity: d.replacementQuantity,
        replacementUnit: d.replacementUnit,
        replacementDimension: d.replacementDimension,
      };
    }
    if (
      d.kind === 'ADD_COMPONENT' &&
      typeof d.addCatalogItemId === 'string' &&
      typeof d.quantity === 'string' &&
      typeof d.unit === 'string' &&
      (d.dimension === 'MASS' || d.dimension === 'VOLUME' || d.dimension === 'COUNT')
    ) {
      return {
        kind: 'ADD_COMPONENT',
        addCatalogItemId: d.addCatalogItemId,
        quantity: d.quantity,
        unit: d.unit,
        dimension: d.dimension,
      };
    }
    throw new DomainError(
      'MODIFIER_DELTAS_INVALID',
      `Delta ${index} is not a complete REMOVE, REPLACE, or ADD`,
    );
  });
}

export function sumAdditivePriceAdjustmentsMinor(
  adjustments: ReadonlyArray<string>,
): string {
  let sum = 0n;
  for (const a of adjustments) {
    if (!/^-?[0-9]+$/.test(a)) {
      throw new Error(`INVALID_PRICE_ADJUSTMENT:${a}`);
    }
    sum += BigInt(a);
  }
  return sum.toString();
}
