/**
 * ADR-0049 — apply structured ModifierOption recipe deltas onto a base component list.
 * Pure function; does not own recipe publication or inventory posting.
 */

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
    }
  | {
      kind: 'ADD_COMPONENT';
      addCatalogItemId: string;
      quantity: string;
      unit: string;
      dimension: 'MASS' | 'VOLUME' | 'COUNT';
    };

export function applyEffectiveRecipeDeltas(
  base: ReadonlyArray<RecipeComponentRef>,
  deltas: ReadonlyArray<ModifierRecipeDelta>,
): RecipeComponentRef[] {
  let next = base.map((c) => ({ ...c }));
  for (const d of deltas) {
    if (d.kind === 'REMOVE_COMPONENT') {
      next = next.filter((c) => c.catalogItemId !== d.targetCatalogItemId);
      continue;
    }
    if (d.kind === 'REPLACE_COMPONENT') {
      next = next.map((c) =>
        c.catalogItemId === d.targetCatalogItemId
          ? { ...c, catalogItemId: d.replacementCatalogItemId }
          : c,
      );
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
