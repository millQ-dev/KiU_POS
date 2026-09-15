import { describe, expect, it } from 'vitest';
import {
  assertExactlyOneConsumptionPath,
  consumptionPlanProvenanceHash,
  resolveSaleLineConsumption,
  type GraphCatalogItem,
  type GraphPreparationVersion,
  type GraphRecipeVersion,
  type RecipeGraphLookup,
} from './sale-consumption.js';
import { DomainError } from './errors.js';

const milk: GraphCatalogItem = { catalogItemId: 'milk', baseUnit: 'L', dimension: 'VOLUME' };
const oil: GraphCatalogItem = { catalogItemId: 'oil', baseUnit: 'L', dimension: 'VOLUME' };
const sauceFinished: GraphCatalogItem = {
  catalogItemId: 'sauce-finished',
  baseUnit: 'L',
  dimension: 'VOLUME',
};
const dish: GraphCatalogItem = { catalogItemId: 'dish', baseUnit: 'ea', dimension: 'COUNT' };

function lookup(opts: {
  catalogs?: GraphCatalogItem[];
  recipeByItem?: Record<string, GraphRecipeVersion>;
  stockPrepByOutput?: Record<string, GraphPreparationVersion>;
  preps?: GraphPreparationVersion[];
}): RecipeGraphLookup {
  const catalogs = new Map((opts.catalogs ?? []).map((c) => [c.catalogItemId, c]));
  const preps = new Map((opts.preps ?? []).map((p) => [p.preparationVersionId, p]));
  return {
    getCatalogItem: (id) => catalogs.get(id) ?? null,
    getPublishedRecipeForCatalogItem: (id) => opts.recipeByItem?.[id] ?? null,
    getPublishedStockTrackedPrepForOutput: (id) => opts.stockPrepByOutput?.[id] ?? null,
    getPreparationVersion: (id) => preps.get(id) ?? null,
  };
}

describe('sale consumption resolver', () => {
  it('direct stock item', () => {
    const plan = resolveSaleLineConsumption(
      { catalogItemId: 'milk', quantity: '0.5', unit: 'L', dimension: 'VOLUME' },
      lookup({ catalogs: [milk] }),
    );
    assertExactlyOneConsumptionPath(plan);
    expect(plan.appliedStrategy).toBe('DIRECT_STOCK_OUT');
    expect(plan.physicalLeaves[0]).toMatchObject({
      catalogItemId: 'milk',
      quantityBase: '0.5',
      unitBase: 'L',
    });
  });

  it('simple recipe explodes with unit normalization and qty>1 scaling', () => {
    const recipe: GraphRecipeVersion = {
      recipeVersionId: 'rv1',
      recipeSpecificationId: 'rs1',
      status: 'PUBLISHED',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: 'milk',
          nestedPreparationVersionId: null,
          quantity: '200',
          unit: 'ml',
          dimension: 'VOLUME',
        },
      ],
    };
    const plan = resolveSaleLineConsumption(
      { catalogItemId: 'dish', quantity: '2', unit: 'ea', dimension: 'COUNT' },
      lookup({ catalogs: [milk, dish], recipeByItem: { dish: recipe } }),
    );
    assertExactlyOneConsumptionPath(plan);
    expect(plan.appliedStrategy).toBe('EXPLODE_RECIPE_ON_SALE');
    expect(plan.physicalLeaves[0]).toMatchObject({
      catalogItemId: 'milk',
      quantityBase: '0.4',
      unitBase: 'L',
    });
  });

  it('nested VIRTUAL expands; nested STOCK_TRACKED is finished leaf only', () => {
    const virtualBlend: GraphPreparationVersion = {
      preparationVersionId: 'pv-virtual',
      preparationSpecificationId: 'ps-v',
      status: 'PUBLISHED',
      materializationMode: 'VIRTUAL',
      outputCatalogItemId: null,
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: 'oil',
          nestedPreparationVersionId: null,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    };
    const stockSauce: GraphPreparationVersion = {
      preparationVersionId: 'pv-stock',
      preparationSpecificationId: 'ps-s',
      status: 'PUBLISHED',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: 'sauce-finished',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: 'milk',
          nestedPreparationVersionId: null,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    };
    const recipe: GraphRecipeVersion = {
      recipeVersionId: 'rv2',
      recipeSpecificationId: 'rs2',
      status: 'PUBLISHED',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          catalogItemId: null,
          nestedPreparationVersionId: 'pv-virtual',
          quantity: '0.1',
          unit: 'L',
          dimension: 'VOLUME',
        },
        {
          lineNumber: 2,
          componentKind: 'PREPARATION_VERSION',
          catalogItemId: null,
          nestedPreparationVersionId: 'pv-stock',
          quantity: '0.2',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    };
    const plan = resolveSaleLineConsumption(
      { catalogItemId: 'dish', quantity: '1', unit: 'ea', dimension: 'COUNT' },
      lookup({
        catalogs: [milk, oil, sauceFinished, dish],
        recipeByItem: { dish: recipe },
        preps: [virtualBlend, stockSauce],
      }),
    );
    assertExactlyOneConsumptionPath(plan);
    const byId = Object.fromEntries(plan.physicalLeaves.map((l) => [l.catalogItemId, l]));
    expect(byId.oil?.quantityBase).toBe('0.1');
    expect(byId['sauce-finished']?.quantityBase).toBe('0.2');
    expect(byId.milk).toBeUndefined();
  });

  it('STOCK_TRACKED root consumes finished stock only', () => {
    const stockSauce: GraphPreparationVersion = {
      preparationVersionId: 'pv-stock',
      preparationSpecificationId: 'ps-s',
      status: 'PUBLISHED',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: 'sauce-finished',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: 'oil',
          nestedPreparationVersionId: null,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    };
    const plan = resolveSaleLineConsumption(
      { catalogItemId: 'sauce-finished', quantity: '0.5', unit: 'L', dimension: 'VOLUME' },
      lookup({
        catalogs: [oil, sauceFinished],
        stockPrepByOutput: { 'sauce-finished': stockSauce },
        preps: [stockSauce],
      }),
    );
    assertExactlyOneConsumptionPath(plan);
    expect(plan.appliedStrategy).toBe('CONSUME_FINISHED_ITEM');
    expect(plan.physicalLeaves).toHaveLength(1);
    expect(plan.physicalLeaves[0]?.catalogItemId).toBe('sauce-finished');
  });

  it('rejects ambiguous recipe binding + STOCK_TRACKED root (no priority heuristic)', () => {
    const recipe: GraphRecipeVersion = {
      recipeVersionId: 'rv1',
      recipeSpecificationId: 'rs1',
      status: 'PUBLISHED',
      batchSizeQuantity: '1',
      batchSizeUnit: 'L',
      batchSizeDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: 'oil',
          nestedPreparationVersionId: null,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    };
    const stockSauce: GraphPreparationVersion = {
      preparationVersionId: 'pv-stock',
      preparationSpecificationId: 'ps-s',
      status: 'PUBLISHED',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: 'sauce-finished',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: 'oil',
          nestedPreparationVersionId: null,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    };
    expect(() =>
      resolveSaleLineConsumption(
        { catalogItemId: 'sauce-finished', quantity: '1', unit: 'L', dimension: 'VOLUME' },
        lookup({
          catalogs: [oil, sauceFinished],
          recipeByItem: { 'sauce-finished': recipe },
          stockPrepByOutput: { 'sauce-finished': stockSauce },
          preps: [stockSauce],
        }),
      ),
    ).toThrow(DomainError);
    try {
      resolveSaleLineConsumption(
        { catalogItemId: 'sauce-finished', quantity: '1', unit: 'L', dimension: 'VOLUME' },
        lookup({
          catalogs: [oil, sauceFinished],
          recipeByItem: { 'sauce-finished': recipe },
          stockPrepByOutput: { 'sauce-finished': stockSauce },
          preps: [stockSauce],
        }),
      );
    } catch (e) {
      expect((e as DomainError).code).toBe('AMBIGUOUS_CONSUMPTION_ROOT');
    }
  });

  it('provenance hash deterministic and sensitive to semantics', () => {
    const plan = resolveSaleLineConsumption(
      { catalogItemId: 'milk', quantity: '1', unit: 'L', dimension: 'VOLUME' },
      lookup({ catalogs: [milk] }),
    );
    const a = consumptionPlanProvenanceHash({
      orderId: 'o1',
      outletId: 'out1',
      resolvedIssueWarehouseId: 'wh1',
      lines: [{ ...plan, orderLineId: 'ol1', lineNumber: 1 }],
    });
    const b = consumptionPlanProvenanceHash({
      orderId: 'o1',
      outletId: 'out1',
      resolvedIssueWarehouseId: 'wh1',
      lines: [{ ...plan, orderLineId: 'ol1', lineNumber: 1 }],
    });
    expect(a).toBe(b);
    const other = consumptionPlanProvenanceHash({
      orderId: 'o1',
      outletId: 'out1',
      resolvedIssueWarehouseId: 'wh2',
      lines: [{ ...plan, orderLineId: 'ol1', lineNumber: 1 }],
    });
    expect(other).not.toBe(a);
  });
});
