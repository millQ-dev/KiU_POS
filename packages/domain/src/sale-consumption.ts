import { createHash } from 'node:crypto';
import { DomainError, IncompatibleUnitError } from './errors.js';
import { assertPositive, parseCanonicalDecimal, toCanonicalDecimal } from './decimal.js';
import {
  normalizeToBaseUnit,
  assertSameDimensionCompatibleUnits,
} from './recipe-graph.js';
import type { UnitDimension } from './quantity.js';

function assertPositiveQty(value: string, label: string): void {
  assertPositive(parseCanonicalDecimal(value), label);
}

export type MaterializationMode = 'VIRTUAL' | 'STOCK_TRACKED';

export type AppliedConsumptionStrategy =
  | 'EXPLODE_RECIPE_ON_SALE'
  | 'CONSUME_FINISHED_ITEM'
  | 'DIRECT_STOCK_OUT';

export type GraphCatalogItem = {
  readonly catalogItemId: string;
  readonly baseUnit: string;
  readonly dimension: UnitDimension;
};

export type GraphComponent = {
  readonly lineNumber: number;
  readonly componentKind: 'CATALOG_ITEM' | 'PREPARATION_VERSION';
  readonly catalogItemId: string | null;
  readonly nestedPreparationVersionId: string | null;
  readonly quantity: string;
  readonly unit: string;
  readonly dimension: UnitDimension;
};

export type GraphRecipeVersion = {
  readonly recipeVersionId: string;
  readonly recipeSpecificationId: string;
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly batchSizeQuantity: string;
  readonly batchSizeUnit: string;
  readonly batchSizeDimension: UnitDimension;
  readonly components: readonly GraphComponent[];
};

export type GraphPreparationVersion = {
  readonly preparationVersionId: string;
  readonly preparationSpecificationId: string;
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly materializationMode: MaterializationMode;
  readonly outputCatalogItemId: string | null;
  readonly normativeOutputQuantity: string;
  readonly normativeOutputUnit: string;
  readonly normativeOutputDimension: UnitDimension;
  readonly components: readonly GraphComponent[];
};

export type PhysicalLeaf = {
  readonly catalogItemId: string;
  readonly quantityBase: string;
  readonly unitBase: string;
  readonly dimension: UnitDimension;
  readonly leafPath: string;
};

export type ResolvedVersionRef = {
  readonly versionKind: 'RECIPE_VERSION' | 'PREPARATION_VERSION';
  readonly recipeVersionId?: string;
  readonly preparationVersionId?: string;
  readonly materializationMode?: MaterializationMode;
};

export type LineConsumptionPlan = {
  readonly soldCatalogItemId: string;
  readonly soldQuantity: string;
  readonly soldUnit: string;
  readonly soldDimension: UnitDimension;
  readonly rootKind: 'RECIPE_VERSION' | 'PREPARATION_VERSION' | 'DIRECT_STOCK';
  readonly rootRecipeVersionId: string | null;
  readonly rootPreparationVersionId: string | null;
  readonly appliedStrategy: AppliedConsumptionStrategy;
  readonly resolvedVersions: readonly ResolvedVersionRef[];
  readonly physicalLeaves: readonly PhysicalLeaf[];
};

export type RecipeGraphLookup = {
  getCatalogItem(catalogItemId: string): GraphCatalogItem | null;
  /** Latest PUBLISHED recipe version via CatalogItem RecipeProfile binding (ADR-0009). */
  getPublishedRecipeForCatalogItem(catalogItemId: string): GraphRecipeVersion | null;
  /** Latest PUBLISHED STOCK_TRACKED preparation that outputs this catalog item. */
  getPublishedStockTrackedPrepForOutput(catalogItemId: string): GraphPreparationVersion | null;
  getPreparationVersion(preparationVersionId: string): GraphPreparationVersion | null;
};

function scaleFactor(
  soldQty: string,
  soldUnit: string,
  soldDim: UnitDimension,
  basisQty: string,
  basisUnit: string,
  basisDim: UnitDimension,
): string {
  if (soldDim !== basisDim) {
    throw new IncompatibleUnitError(
      `Sold dimension ${soldDim} incompatible with basis dimension ${basisDim}`,
    );
  }
  assertSameDimensionCompatibleUnits(soldUnit, basisUnit, soldDim);
  const soldBase = normalizeToBaseUnit(soldQty, soldUnit, soldDim);
  const basisBase = normalizeToBaseUnit(basisQty, basisUnit, basisDim);
  const denom = parseCanonicalDecimal(basisBase.value);
  if (denom.isZero()) {
    throw new DomainError('INVALID_SCALE_BASIS', 'Scale basis quantity must be positive');
  }
  return toCanonicalDecimal(parseCanonicalDecimal(soldBase.value).div(denom));
}

function addLeaf(
  leaves: Map<string, PhysicalLeaf>,
  catalogItemId: string,
  quantityBase: string,
  unitBase: string,
  dimension: UnitDimension,
  leafPath: string,
): void {
  assertPositiveQty(quantityBase, 'physical leaf quantity');
  const existing = leaves.get(catalogItemId);
  if (!existing) {
    leaves.set(catalogItemId, {
      catalogItemId,
      quantityBase: toCanonicalDecimal(parseCanonicalDecimal(quantityBase)),
      unitBase,
      dimension,
      leafPath,
    });
    return;
  }
  if (existing.dimension !== dimension || existing.unitBase !== unitBase) {
    throw new DomainError(
      'LEAF_UNIT_CONFLICT',
      `Conflicting base units for catalog item ${catalogItemId}`,
    );
  }
  const sum = parseCanonicalDecimal(existing.quantityBase).add(parseCanonicalDecimal(quantityBase));
  leaves.set(catalogItemId, {
    catalogItemId,
    quantityBase: toCanonicalDecimal(sum),
    unitBase,
    dimension,
    leafPath: `${existing.leafPath}|${leafPath}`,
  });
}

function explodePreparation(
  prep: GraphPreparationVersion,
  scale: string,
  lookup: RecipeGraphLookup,
  path: string,
  leaves: Map<string, PhysicalLeaf>,
  versions: ResolvedVersionRef[],
  visiting: Set<string>,
): void {
  if (visiting.has(prep.preparationVersionId)) {
    throw new DomainError(
      'COMPOSITION_CYCLE',
      `Cycle while exploding preparation ${prep.preparationVersionId}`,
    );
  }
  if (prep.status !== 'PUBLISHED') {
    throw new DomainError(
      'PREPARATION_NOT_PUBLISHED',
      `PreparationVersion ${prep.preparationVersionId} is not PUBLISHED`,
    );
  }

  versions.push({
    versionKind: 'PREPARATION_VERSION',
    preparationVersionId: prep.preparationVersionId,
    materializationMode: prep.materializationMode,
  });

  // Exactly-one path: STOCK_TRACKED never explodes into recipe leaves.
  if (prep.materializationMode === 'STOCK_TRACKED') {
    if (!prep.outputCatalogItemId) {
      throw new DomainError(
        'STOCK_TRACKED_OUTPUT_REQUIRED',
        `STOCK_TRACKED preparation ${prep.preparationVersionId} missing output catalog item`,
      );
    }
    const item = lookup.getCatalogItem(prep.outputCatalogItemId);
    if (!item) {
      throw new DomainError(
        'CATALOG_ITEM_NOT_FOUND',
        `Output catalog item ${prep.outputCatalogItemId} not found`,
      );
    }
    assertSameDimensionCompatibleUnits(
      prep.normativeOutputUnit,
      item.baseUnit,
      prep.normativeOutputDimension,
    );
    if (item.dimension !== prep.normativeOutputDimension) {
      throw new IncompatibleUnitError(
        `STOCK_TRACKED output dimension mismatch for ${prep.preparationVersionId}`,
      );
    }
    const qtyBase = normalizeToBaseUnit(
      toCanonicalDecimal(parseCanonicalDecimal(prep.normativeOutputQuantity).mul(parseCanonicalDecimal(scale))),
      prep.normativeOutputUnit,
      prep.normativeOutputDimension,
    );
    // Re-normalize into catalog base unit if needed (same dimension).
    const inCatalogBase = normalizeToBaseUnit(qtyBase.value, qtyBase.unit, item.dimension);
    // If catalog base differs from SI base alias, convert via SI factors already in normalizeToBaseUnit
    // then express in item.baseUnit:
    const asItemBase = (() => {
      if (inCatalogBase.unit === item.baseUnit) return inCatalogBase.value;
      const fromFactor = normalizeToBaseUnit('1', item.baseUnit, item.dimension);
      // inCatalogBase is already in BASE_UNITS; item.baseUnit → BASE factor known
      const baseAmount = parseCanonicalDecimal(inCatalogBase.value);
      const itemPerBase = parseCanonicalDecimal(fromFactor.value); // 1 item.baseUnit in SI base
      return toCanonicalDecimal(baseAmount.div(itemPerBase));
    })();
    addLeaf(
      leaves,
      item.catalogItemId,
      asItemBase,
      item.baseUnit,
      item.dimension,
      `${path}/STOCK_TRACKED:${prep.preparationVersionId}`,
    );
    return;
  }

  // VIRTUAL: recursively explode components only (never emit virtual parent as leaf).
  visiting.add(prep.preparationVersionId);
  for (const c of prep.components) {
    explodeComponent(c, scale, lookup, `${path}/VIRTUAL:${prep.preparationVersionId}`, leaves, versions, visiting);
  }
  visiting.delete(prep.preparationVersionId);
}

function explodeComponent(
  component: GraphComponent,
  parentScale: string,
  lookup: RecipeGraphLookup,
  path: string,
  leaves: Map<string, PhysicalLeaf>,
  versions: ResolvedVersionRef[],
  visiting: Set<string>,
): void {
  const lineScale = toCanonicalDecimal(
    parseCanonicalDecimal(component.quantity).mul(parseCanonicalDecimal(parentScale)),
  );

  if (component.componentKind === 'CATALOG_ITEM') {
    if (!component.catalogItemId) {
      throw new DomainError('INVALID_COMPONENT', `Catalog component missing catalogItemId at ${path}`);
    }
    const item = lookup.getCatalogItem(component.catalogItemId);
    if (!item) {
      throw new DomainError('CATALOG_ITEM_NOT_FOUND', `Catalog item ${component.catalogItemId} not found`);
    }
    if (item.dimension !== component.dimension) {
      throw new IncompatibleUnitError(
        `Component dimension ${component.dimension} != catalog ${item.dimension}`,
      );
    }
    assertSameDimensionCompatibleUnits(component.unit, item.baseUnit, item.dimension);
    const qtySi = normalizeToBaseUnit(lineScale, component.unit, component.dimension);
    const oneItemBase = normalizeToBaseUnit('1', item.baseUnit, item.dimension);
    const asItemBase = toCanonicalDecimal(
      parseCanonicalDecimal(qtySi.value).div(parseCanonicalDecimal(oneItemBase.value)),
    );
    addLeaf(
      leaves,
      item.catalogItemId,
      asItemBase,
      item.baseUnit,
      item.dimension,
      `${path}/CATALOG:${item.catalogItemId}#${component.lineNumber}`,
    );
    return;
  }

  if (!component.nestedPreparationVersionId) {
    throw new DomainError('INVALID_COMPONENT', `Nested prep component missing id at ${path}`);
  }
  const nested = lookup.getPreparationVersion(component.nestedPreparationVersionId);
  if (!nested) {
    throw new DomainError(
      'PREPARATION_NOT_FOUND',
      `PreparationVersion ${component.nestedPreparationVersionId} not found`,
    );
  }

  // Scale relative to nested prep normative output (sale of N units of nested output).
  const nestedScale = scaleFactor(
    lineScale,
    component.unit,
    component.dimension,
    nested.normativeOutputQuantity,
    nested.normativeOutputUnit,
    nested.normativeOutputDimension,
  );
  explodePreparation(
    nested,
    nestedScale,
    lookup,
    `${path}/PREP:${nested.preparationVersionId}#${component.lineNumber}`,
    leaves,
    versions,
    visiting,
  );
}

function explodeRecipe(
  recipe: GraphRecipeVersion,
  soldQuantity: string,
  soldUnit: string,
  soldDimension: UnitDimension,
  lookup: RecipeGraphLookup,
): { leaves: PhysicalLeaf[]; versions: ResolvedVersionRef[] } {
  if (recipe.status !== 'PUBLISHED') {
    throw new DomainError('RECIPE_NOT_PUBLISHED', `RecipeVersion ${recipe.recipeVersionId} is not PUBLISHED`);
  }
  const versions: ResolvedVersionRef[] = [
    { versionKind: 'RECIPE_VERSION', recipeVersionId: recipe.recipeVersionId },
  ];
  const leaves = new Map<string, PhysicalLeaf>();
  const scale = scaleFactor(
    soldQuantity,
    soldUnit,
    soldDimension,
    recipe.batchSizeQuantity,
    recipe.batchSizeUnit,
    recipe.batchSizeDimension,
  );
  const visiting = new Set<string>();
  for (const c of recipe.components) {
    explodeComponent(
      c,
      scale,
      lookup,
      `RECIPE:${recipe.recipeVersionId}`,
      leaves,
      versions,
      visiting,
    );
  }
  return { leaves: [...leaves.values()], versions };
}

/**
 * Resolve authoritative sale consumption for one sold CatalogItem line at CompleteOrder.
 * Exactly one physical write-off path: VIRTUAL explode XOR STOCK_TRACKED consume XOR direct stock.
 *
 * Root selection is structural — no silent priority heuristics.
 * RecipeProfile binding + competing STOCK_TRACKED root → AMBIGUOUS_CONSUMPTION_ROOT.
 */
export function resolveSaleLineConsumption(
  sold: {
    catalogItemId: string;
    quantity: string;
    unit: string;
    dimension: UnitDimension;
  },
  lookup: RecipeGraphLookup,
): LineConsumptionPlan {
  assertPositiveQty(sold.quantity, 'sold quantity');
  const item = lookup.getCatalogItem(sold.catalogItemId);
  if (!item) {
    throw new DomainError('CATALOG_ITEM_NOT_FOUND', `Sold catalog item ${sold.catalogItemId} not found`);
  }
  if (item.dimension !== sold.dimension) {
    throw new IncompatibleUnitError(
      `Sold dimension ${sold.dimension} does not match catalog item ${item.dimension}`,
    );
  }
  assertSameDimensionCompatibleUnits(sold.unit, item.baseUnit, item.dimension);

  const recipe = lookup.getPublishedRecipeForCatalogItem(sold.catalogItemId);
  const stockPrep = lookup.getPublishedStockTrackedPrepForOutput(sold.catalogItemId);

  if (recipe && stockPrep) {
    throw new DomainError(
      'AMBIGUOUS_CONSUMPTION_ROOT',
      `Sold item ${sold.catalogItemId} has both a CatalogItem RecipeProfile binding and a STOCK_TRACKED preparation output root; resolve configuration before completion`,
    );
  }

  if (recipe) {
    const { leaves, versions } = explodeRecipe(
      recipe,
      sold.quantity,
      sold.unit,
      sold.dimension,
      lookup,
    );
    return {
      soldCatalogItemId: sold.catalogItemId,
      soldQuantity: sold.quantity,
      soldUnit: sold.unit,
      soldDimension: sold.dimension,
      rootKind: 'RECIPE_VERSION',
      rootRecipeVersionId: recipe.recipeVersionId,
      rootPreparationVersionId: null,
      appliedStrategy: 'EXPLODE_RECIPE_ON_SALE',
      resolvedVersions: versions,
      physicalLeaves: leaves,
    };
  }

  if (stockPrep) {
    const qtySi = normalizeToBaseUnit(sold.quantity, sold.unit, sold.dimension);
    const oneItemBase = normalizeToBaseUnit('1', item.baseUnit, item.dimension);
    const asItemBase = toCanonicalDecimal(
      parseCanonicalDecimal(qtySi.value).div(parseCanonicalDecimal(oneItemBase.value)),
    );
    return {
      soldCatalogItemId: sold.catalogItemId,
      soldQuantity: sold.quantity,
      soldUnit: sold.unit,
      soldDimension: sold.dimension,
      rootKind: 'PREPARATION_VERSION',
      rootRecipeVersionId: null,
      rootPreparationVersionId: stockPrep.preparationVersionId,
      appliedStrategy: 'CONSUME_FINISHED_ITEM',
      resolvedVersions: [
        {
          versionKind: 'PREPARATION_VERSION',
          preparationVersionId: stockPrep.preparationVersionId,
          materializationMode: 'STOCK_TRACKED',
        },
      ],
      physicalLeaves: [
        {
          catalogItemId: sold.catalogItemId,
          quantityBase: asItemBase,
          unitBase: item.baseUnit,
          dimension: item.dimension,
          leafPath: `STOCK_TRACKED:${stockPrep.preparationVersionId}`,
        },
      ],
    };
  }

  // Direct stock CatalogItem (no recipe binding, not a STOCK_TRACKED prep output).
  const qtySi = normalizeToBaseUnit(sold.quantity, sold.unit, sold.dimension);
  const oneItemBase = normalizeToBaseUnit('1', item.baseUnit, item.dimension);
  const asItemBase = toCanonicalDecimal(
    parseCanonicalDecimal(qtySi.value).div(parseCanonicalDecimal(oneItemBase.value)),
  );
  return {
    soldCatalogItemId: sold.catalogItemId,
    soldQuantity: sold.quantity,
    soldUnit: sold.unit,
    soldDimension: sold.dimension,
    rootKind: 'DIRECT_STOCK',
    rootRecipeVersionId: null,
    rootPreparationVersionId: null,
    appliedStrategy: 'DIRECT_STOCK_OUT',
    resolvedVersions: [],
    physicalLeaves: [
      {
        catalogItemId: sold.catalogItemId,
        quantityBase: asItemBase,
        unitBase: item.baseUnit,
        dimension: item.dimension,
        leafPath: `DIRECT:${sold.catalogItemId}`,
      },
    ],
  };
}

/** Deterministic provenance hash for a completed consumption plan (historical evidence). */
export function consumptionPlanProvenanceHash(input: {
  orderId: string;
  outletId: string;
  resolvedIssueWarehouseId: string;
  lines: readonly (LineConsumptionPlan & { orderLineId: string; lineNumber: number })[];
}): string {
  const normalized = {
    orderId: input.orderId,
    outletId: input.outletId,
    resolvedIssueWarehouseId: input.resolvedIssueWarehouseId,
    lines: [...input.lines]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((l) => ({
        orderLineId: l.orderLineId,
        lineNumber: l.lineNumber,
        soldCatalogItemId: l.soldCatalogItemId,
        soldQuantity: l.soldQuantity,
        soldUnit: l.soldUnit,
        soldDimension: l.soldDimension,
        rootKind: l.rootKind,
        rootRecipeVersionId: l.rootRecipeVersionId,
        rootPreparationVersionId: l.rootPreparationVersionId,
        appliedStrategy: l.appliedStrategy,
        resolvedVersions: l.resolvedVersions.map((v) => ({
          versionKind: v.versionKind,
          recipeVersionId: v.recipeVersionId ?? null,
          preparationVersionId: v.preparationVersionId ?? null,
          materializationMode: v.materializationMode ?? null,
        })),
        physicalLeaves: [...l.physicalLeaves]
          .sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId))
          .map((leaf) => ({
            catalogItemId: leaf.catalogItemId,
            quantityBase: leaf.quantityBase,
            unitBase: leaf.unitBase,
            dimension: leaf.dimension,
            leafPath: leaf.leafPath,
          })),
      })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/** Assert exactly-one physical path semantics on a resolved line plan. */
export function assertExactlyOneConsumptionPath(plan: LineConsumptionPlan): void {
  if (plan.appliedStrategy === 'EXPLODE_RECIPE_ON_SALE') {
    if (plan.rootKind !== 'RECIPE_VERSION' || !plan.rootRecipeVersionId) {
      throw new DomainError('PATH_INVARIANT', 'EXPLODE_RECIPE_ON_SALE requires RECIPE_VERSION root');
    }
    // Must not also claim STOCK_TRACKED consume of the sold finished item as sole strategy.
    if (plan.physicalLeaves.length === 0) {
      throw new DomainError('PATH_INVARIANT', 'Exploded recipe produced no physical leaves');
    }
  } else if (plan.appliedStrategy === 'CONSUME_FINISHED_ITEM') {
    if (plan.rootKind !== 'PREPARATION_VERSION' || !plan.rootPreparationVersionId) {
      throw new DomainError('PATH_INVARIANT', 'CONSUME_FINISHED_ITEM requires PREPARATION_VERSION root');
    }
    if (plan.physicalLeaves.length !== 1 || plan.physicalLeaves[0]!.catalogItemId !== plan.soldCatalogItemId) {
      throw new DomainError(
        'PATH_INVARIANT',
        'CONSUME_FINISHED_ITEM must write off exactly the finished sold item',
      );
    }
    // Must not include nested exploded leaves beyond the finished item.
    if (plan.resolvedVersions.some((v) => v.materializationMode === 'VIRTUAL')) {
      throw new DomainError(
        'PATH_INVARIANT',
        'CONSUME_FINISHED_ITEM must not explode VIRTUAL nested graph',
      );
    }
  } else if (plan.appliedStrategy === 'DIRECT_STOCK_OUT') {
    if (plan.rootKind !== 'DIRECT_STOCK') {
      throw new DomainError('PATH_INVARIANT', 'DIRECT_STOCK_OUT requires DIRECT_STOCK root');
    }
    if (plan.physicalLeaves.length !== 1) {
      throw new DomainError('PATH_INVARIANT', 'DIRECT_STOCK_OUT requires exactly one leaf');
    }
  } else {
    throw new DomainError('PATH_INVARIANT', `Unknown strategy ${(plan as LineConsumptionPlan).appliedStrategy}`);
  }
}
