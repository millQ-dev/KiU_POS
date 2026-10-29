import { describe, expect, it } from 'vitest';
import {
  aggregateExposure,
  assertAllergenCodes,
  resolveCatalogOffer,
  resolveConfiguredOffer,
  type Composition,
  type KitchenHandlingPolicy,
  type LeafAllergenProfile,
  type ModificationCandidate,
} from './allergen-resolution.js';

const MILK = 'milk-leaf';
const OAT = 'oat-leaf';
const EGG = 'egg-leaf';
const GAP = 'unprofiled-leaf';

function profile(
  status: 'COMPLETE' | 'INCOMPLETE',
  declared: Array<[string, 'CONTAINS' | 'MAY_CONTAIN' | 'CROSS_CONTAMINATION_RISK']> = [],
): LeafAllergenProfile {
  return { declarationStatus: status, declared: new Map(declared) };
}

const profiles = new Map<string, LeafAllergenProfile>([
  [MILK, profile('COMPLETE', [['MILK', 'CONTAINS']])],
  [OAT, profile('COMPLETE', [['GLUTEN', 'CROSS_CONTAMINATION_RISK']])],
  [EGG, profile('COMPLETE', [['EGG', 'CONTAINS']])],
]);
const comp = (...leafIds: string[]): Composition => ({ known: true, leafIds });
const permit: ReadonlyMap<string, KitchenHandlingPolicy> = new Map([
  ['MILK', { modificationPermitted: true, handlingCode: 'CLEAN_STEAM_WAND' }],
]);

describe('aggregateExposure', () => {
  it('never turns missing declarations into absence', () => {
    expect(aggregateExposure(comp(GAP), profiles, 'MILK')).toBe('UNKNOWN');
    expect(aggregateExposure({ known: false, leafIds: [] }, profiles, 'MILK')).toBe('UNKNOWN');
    expect(aggregateExposure(comp(), profiles, 'MILK')).toBe('UNKNOWN');
  });

  it('INCOMPLETE profile keeps undeclared codes UNKNOWN; COMPLETE yields NOT_KNOWN_TO_CONTAIN', () => {
    const p = new Map([
      ['a', profile('INCOMPLETE')],
      ['b', profile('COMPLETE')],
    ]);
    expect(aggregateExposure(comp('a'), p, 'MILK')).toBe('UNKNOWN');
    expect(aggregateExposure(comp('b'), p, 'MILK')).toBe('NOT_KNOWN_TO_CONTAIN');
  });

  it('worst exposure across leaves wins', () => {
    expect(aggregateExposure(comp(OAT, MILK), profiles, 'MILK')).toBe('CONTAINS');
    expect(aggregateExposure(comp(OAT), profiles, 'GLUTEN')).toBe('CROSS_CONTAMINATION_RISK');
  });
});

describe('resolveConfiguredOffer', () => {
  const base = (c: Composition, codes: string[], effective = c) => ({
    choice: 'SELECT_ALLERGENS' as const,
    allergenCodes: codes,
    base: c,
    effective,
    profiles,
    policies: permit,
  });

  it('NO_ALLERGIES_CONFIRMED is AVAILABLE without warnings or acknowledgements', () => {
    const r = resolveConfiguredOffer({ ...base(comp(MILK), []), choice: 'NO_ALLERGIES_CONFIRMED' });
    expect(r.result).toBe('AVAILABLE');
    expect(r.kitchenWarnings).toEqual([]);
    expect(r.requiredAcknowledgements).toEqual([]);
  });

  it('UNABLE_TO_CLARIFY is never AVAILABLE and requires guest + kitchen review', () => {
    const r = resolveConfiguredOffer({ ...base(comp(OAT), []), choice: 'UNABLE_TO_CLARIFY' });
    expect(r.result).toBe('REQUIRES_CONFIRMATION');
    expect(r.kitchenWarnings[0]?.code).toBe('ALLERGY_STATUS_UNKNOWN');
    expect(r.requiredAcknowledgements.map((a) => a.kind)).toEqual([
      'CASHIER_GUEST_INFORMED',
      'KITCHEN_ACKNOWLEDGED',
    ]);
  });

  it('CONTAINS surviving in the effective recipe is BLOCKED with no acknowledgements', () => {
    const r = resolveConfiguredOffer(base(comp(MILK), ['MILK']));
    expect(r.result).toBe('BLOCKED');
    expect(r.requiredAcknowledgements).toEqual([]);
    expect(r.kitchenWarnings.some((w) => w.code === 'ALLERGEN_BLOCKED')).toBe(true);
  });

  it('unprofiled leaf is REQUIRES_CONFIRMATION, never AVAILABLE', () => {
    const r = resolveConfiguredOffer(base(comp(GAP), ['MILK']));
    expect(r.result).toBe('REQUIRES_CONFIRMATION');
    expect(r.findings[0]?.reason).toBe('UNCERTAIN_COMPOSITION');
  });

  it('cross-contact risk is REQUIRES_CONFIRMATION with kitchen warning', () => {
    const r = resolveConfiguredOffer(base(comp(OAT), ['GLUTEN']));
    expect(r.result).toBe('REQUIRES_CONFIRMATION');
    expect(r.findings[0]?.reason).toBe('CROSS_CONTACT_RISK');
    expect(r.kitchenWarnings.map((w) => w.code)).toContain('CROSS_CONTACT_RISK');
  });

  it('declared-complete leaf without the allergen is AVAILABLE (not a guarantee) but kitchen still told', () => {
    const r = resolveConfiguredOffer(base(comp(EGG), ['MILK']));
    expect(r.result).toBe('AVAILABLE');
    expect(r.findings[0]?.reason).toBe('NOT_KNOWN_TO_CONTAIN');
    expect(r.requiredAcknowledgements.map((a) => a.kind)).toEqual(['KITCHEN_ACKNOWLEDGED']);
    expect(r.kitchenWarnings[0]?.code).toBe('ALLERGY_ORDER');
  });

  it('modification that removes the allergen is AVAILABLE_WITH_MODIFICATION only with permitting policy', () => {
    const effective = comp(EGG);
    const withPolicy = resolveConfiguredOffer(base(comp(MILK), ['MILK'], effective));
    expect(withPolicy.result).toBe('AVAILABLE_WITH_MODIFICATION');
    expect(withPolicy.findings[0]?.handlingCode).toBe('CLEAN_STEAM_WAND');

    const noPolicy = resolveConfiguredOffer({
      ...base(comp(MILK), ['MILK'], effective),
      policies: new Map(),
    });
    expect(noPolicy.result).toBe('REQUIRES_CONFIRMATION');
    expect(noPolicy.findings[0]?.reason).toBe('KITCHEN_POLICY_MISSING');

    const forbids = resolveConfiguredOffer({
      ...base(comp(MILK), ['MILK'], effective),
      policies: new Map([['MILK', { modificationPermitted: false, handlingCode: null }]]),
    });
    expect(forbids.result).toBe('BLOCKED');
    expect(forbids.findings[0]?.reason).toBe('KITCHEN_POLICY_FORBIDS_MODIFICATION');
  });

  it('is deterministic regardless of allergen code order and duplicates', () => {
    const a = resolveConfiguredOffer(base(comp(MILK, EGG), ['MILK', 'EGG', 'MILK']));
    const b = resolveConfiguredOffer(base(comp(MILK, EGG), ['EGG', 'MILK']));
    expect(a).toEqual(b);
    expect(a.result).toBe('BLOCKED');
  });

  it('rejects malformed allergen codes', () => {
    expect(() => assertAllergenCodes(['milk'])).toThrow(/INVALID_ALLERGEN_CODE/);
    expect(() => assertAllergenCodes(['MILK; DROP'])).toThrow(/INVALID_ALLERGEN_CODE/);
  });
});

describe('resolveCatalogOffer', () => {
  const delta = (target: string, replacement: string): ModificationCandidate['deltas'] => [
    { kind: 'REPLACE_COMPONENT', targetCatalogItemId: target, replacementCatalogItemId: replacement },
  ];
  const inputs = {
    choice: 'SELECT_ALLERGENS' as const,
    allergenCodes: ['MILK'],
    base: comp(MILK),
    profiles,
    policies: permit,
  };

  it('offers required options when an approved delta removes the allergen', () => {
    const r = resolveCatalogOffer(inputs, [
      {
        modifierGroupId: 'g1',
        modifierOptionId: 'o-oat',
        selectionMode: 'SINGLE',
        deltas: delta(MILK, EGG),
      },
    ]);
    expect(r.result).toBe('AVAILABLE_WITH_MODIFICATION');
    expect(r.requiredOptions).toEqual([{ modifierGroupId: 'g1', modifierOptionId: 'o-oat' }]);
  });

  it('stays BLOCKED when no option removes the allergen', () => {
    const r = resolveCatalogOffer(inputs, [
      {
        modifierGroupId: 'g1',
        modifierOptionId: 'o-add',
        selectionMode: 'SINGLE',
        deltas: [
          {
            kind: 'ADD_COMPONENT',
            addCatalogItemId: EGG,
            quantity: '1',
            unit: 'ea',
            dimension: 'COUNT',
          },
        ],
      },
    ]);
    expect(r.result).toBe('BLOCKED');
    expect(r.requiredOptions).toEqual([]);
  });

  it('stays BLOCKED when kitchen policy forbids modification', () => {
    const r = resolveCatalogOffer(
      { ...inputs, policies: new Map([['MILK', { modificationPermitted: false, handlingCode: null }]]) },
      [{ modifierGroupId: 'g1', modifierOptionId: 'o', selectionMode: 'SINGLE', deltas: delta(MILK, EGG) }],
    );
    expect(r.result).toBe('BLOCKED');
    expect(r.requiredOptions).toEqual([]);
  });

  it('does not accept a replacement that introduces an unknown leaf as SAFE', () => {
    const r = resolveCatalogOffer(inputs, [
      { modifierGroupId: 'g1', modifierOptionId: 'o', selectionMode: 'SINGLE', deltas: delta(MILK, GAP) },
    ]);
    expect(r.result).toBe('REQUIRES_CONFIRMATION');
  });

  it('refuses two options from one SINGLE group', () => {
    const profs = new Map(profiles);
    profs.set('egg2', profile('COMPLETE', [['EGG', 'CONTAINS']]));
    const r = resolveCatalogOffer(
      {
        ...inputs,
        allergenCodes: ['MILK', 'EGG'],
        base: comp(MILK, 'egg2'),
        profiles: profs,
        policies: new Map([
          ['MILK', { modificationPermitted: true, handlingCode: null }],
          ['EGG', { modificationPermitted: true, handlingCode: null }],
        ]),
      },
      [
        { modifierGroupId: 'g', modifierOptionId: 'o1', selectionMode: 'SINGLE', deltas: [{ kind: 'REMOVE_COMPONENT', targetCatalogItemId: MILK }] },
        { modifierGroupId: 'g', modifierOptionId: 'o2', selectionMode: 'SINGLE', deltas: [{ kind: 'REMOVE_COMPONENT', targetCatalogItemId: 'egg2' }] },
      ],
    );
    expect(r.result).toBe('BLOCKED');
    expect(r.findings.every((f) => f.reason === 'MODIFICATION_COMBINATION_UNSUPPORTED')).toBe(true);
  });

  it('REMOVE of the only leaf yields empty composition = UNKNOWN, not safe', () => {
    const r = resolveCatalogOffer(inputs, [
      { modifierGroupId: 'g1', modifierOptionId: 'o', selectionMode: 'SINGLE', deltas: [{ kind: 'REMOVE_COMPONENT', targetCatalogItemId: MILK }] },
    ]);
    expect(r.result).not.toBe('AVAILABLE');
    expect(r.result).not.toBe('AVAILABLE_WITH_MODIFICATION');
  });
});
