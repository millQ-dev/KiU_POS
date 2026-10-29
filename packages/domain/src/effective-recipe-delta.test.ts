import { describe, expect, it } from 'vitest';
import {
  applyEffectiveRecipeDeltas,
  sumAdditivePriceAdjustmentsMinor,
} from './effective-recipe-delta.js';

describe('effective-recipe-delta (ADR-0049)', () => {
  const base = [
    { catalogItemId: 'milk-whole', quantity: '30', unit: 'ml', dimension: 'VOLUME' as const },
    { catalogItemId: 'espresso', quantity: '1', unit: 'shot', dimension: 'COUNT' as const },
  ];

  it('removes and replaces components', () => {
    const next = applyEffectiveRecipeDeltas(base, [
      { kind: 'REPLACE_COMPONENT', targetCatalogItemId: 'milk-whole', replacementCatalogItemId: 'milk-oat' },
      { kind: 'ADD_COMPONENT', addCatalogItemId: 'syrup-vanilla', quantity: '10', unit: 'ml', dimension: 'VOLUME' },
    ]);
    expect(next.map((c) => c.catalogItemId)).toEqual(['milk-oat', 'espresso', 'syrup-vanilla']);
  });

  it('rejects a missing REPLACE target and a partial yield override', () => {
    expect(() =>
      applyEffectiveRecipeDeltas(base, [
        {
          kind: 'REPLACE_COMPONENT',
          targetCatalogItemId: 'missing',
          replacementCatalogItemId: 'oat',
        },
      ]),
    ).toThrow(/not on the base recipe/);
    expect(() =>
      applyEffectiveRecipeDeltas(base, [
        {
          kind: 'REPLACE_COMPONENT',
          targetCatalogItemId: 'milk-whole',
          replacementCatalogItemId: 'oat',
          replacementQuantity: '100',
        },
      ]),
    ).toThrow(/quantity, unit, and dimension/);
  });

  it('sums additive VND adjustments', () => {
    expect(sumAdditivePriceAdjustmentsMinor(['0', '5000', '-1000'])).toBe('4000');
  });
});
