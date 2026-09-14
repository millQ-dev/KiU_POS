import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ZodError } from 'zod';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { DomainValidationError, PublishedImmutableError } from './errors.js';
import { RecipesService } from './recipes-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let service: RecipesService;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed,
      audit_record,
      inventory_balance,
      inventory_movement,
      goods_receipt_line,
      goods_receipt,
      production_batch_reversal,
      production_batch_input,
      production_batch,
      recipe_component,
      recipe_version,
      recipe_specification,
      preparation_component,
      preparation_version,
      preparation_specification,
      supplier_item,
      supplier_pack,
      catalog_item,
      supplier,
      warehouse,
      outlet,
      brand,
      legal_entity,
      tenant
    RESTART IDENTITY CASCADE
  `);
}

describe('Block D1.1 Recipes & Preparations foundation (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    service = new RecipesService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
  });

  it('1 — create simple ingredient recipe', async () => {
    const recipe = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Milk drink',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.2',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    expect(recipe.status).toBe('DRAFT');
    expect(recipe.versionNumber).toBe(1);
    expect(recipe.components).toHaveLength(1);
    expect(recipe.components[0]!.catalogItemId).toBe(fx.milkItemId);
  });

  it('2 — create nested VIRTUAL preparation', async () => {
    const sauceBase = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Oil blend',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(sauceBase.preparationVersionId);

    const nested = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Dressing',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: sauceBase.preparationVersionId,
          quantity: '0.5',
          unit: 'L',
          dimension: 'VOLUME',
        },
        {
          lineNumber: 2,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '0.5',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    expect(nested.materializationMode).toBe('VIRTUAL');
    expect(nested.outputCatalogItemId).toBeNull();
    expect(nested.components.some((c) => c.componentKind === 'PREPARATION_VERSION')).toBe(true);
  });

  it('3 — create STOCK_TRACKED preparation specification', async () => {
    const doughItemId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Prep dough stock','kg','MASS')`,
      [doughItemId, fx.tenantId],
    );

    const prep = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Dough',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: doughItemId,
      normativeInputQuantity: '1',
      normativeInputUnit: 'kg',
      normativeInputDimension: 'MASS',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'kg',
      normativeOutputDimension: 'MASS',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.meatItemId,
          quantity: '1',
          unit: 'kg',
          dimension: 'MASS',
        },
      ],
    });
    expect(prep.materializationMode).toBe('STOCK_TRACKED');
    expect(prep.outputCatalogItemId).toBe(doughItemId);
  });

  it('4 — batch-size normalization invariant', async () => {
    const recipe = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Scaled dish',
      batchSizeQuantity: '10',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '2',
          unit: 'L',
          dimension: 'VOLUME',
        },
        {
          lineNumber: 2,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    const scaled = await service.scaleRecipeDraftBatch(recipe.recipeVersionId, '2');
    expect(scaled.batchSizeQuantity).toBe('20');
    expect(scaled.components.find((c) => c.lineNumber === 1)!.quantity).toBe('4');
    expect(scaled.components.find((c) => c.lineNumber === 2)!.quantity).toBe('2');
    // ratios unchanged: 2/10 == 4/20
    expect(Number(scaled.components[0]!.quantity) / Number(scaled.batchSizeQuantity)).toBe(0.2);
  });

  it('5 — normative yield calculation/validation', async () => {
    const prep = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Trimmed meat',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'kg',
      normativeInputDimension: 'MASS',
      normativeOutputQuantity: '800',
      normativeOutputUnit: 'g',
      normativeOutputDimension: 'MASS',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.meatItemId,
          quantity: '1',
          unit: 'kg',
          dimension: 'MASS',
        },
      ],
    });
    expect(prep.normativeYieldRatio).toBe('0.8');

    await expect(
      service.createPreparationDraft({
        tenantId: fx.tenantId,
        name: 'Bad yield basis',
        materializationMode: 'VIRTUAL',
        normativeInputQuantity: '1',
        normativeInputUnit: 'kg',
        normativeInputDimension: 'MASS',
        normativeOutputQuantity: '1',
        normativeOutputUnit: 'L',
        normativeOutputDimension: 'VOLUME',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.meatItemId,
            quantity: '1',
            unit: 'kg',
            dimension: 'MASS',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });
  });

  it('6 — direct cycle rejected (A → A)', async () => {
    const a = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'A',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await expect(
      service.updatePreparationDraft({
        preparationVersionId: a.preparationVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'PREPARATION_VERSION',
            nestedPreparationVersionId: a.preparationVersionId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it('7 — indirect two-node cycle rejected (A → B → A)', async () => {
    const a = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'A',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(a.preparationVersionId);

    const b = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'B',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: a.preparationVersionId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(b.preparationVersionId);

    const a2 = await service.createNextPreparationVersion(a.preparationSpecificationId);
    await expect(
      service.updatePreparationDraft({
        preparationVersionId: a2.preparationVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'PREPARATION_VERSION',
            nestedPreparationVersionId: b.preparationVersionId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COMPOSITION_CYCLE' });
  });

  it('8 — deeper cycle rejected (A → B → C → A)', async () => {
    const mkLeaf = async (name: string) => {
      const p = await service.createPreparationDraft({
        tenantId: fx.tenantId,
        name,
        materializationMode: 'VIRTUAL',
        normativeInputQuantity: '1',
        normativeInputUnit: 'L',
        normativeInputDimension: 'VOLUME',
        normativeOutputQuantity: '1',
        normativeOutputUnit: 'L',
        normativeOutputDimension: 'VOLUME',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.oilItemId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      });
      await service.publishPreparationVersion(p.preparationVersionId);
      return p;
    };

    const a = await mkLeaf('A');
    const bDraft = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'B',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: a.preparationVersionId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(bDraft.preparationVersionId);

    const cDraft = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'C',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: bDraft.preparationVersionId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(cDraft.preparationVersionId);

    const aNext = await service.createNextPreparationVersion(a.preparationSpecificationId);
    await expect(
      service.updatePreparationDraft({
        preparationVersionId: aNext.preparationVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'PREPARATION_VERSION',
            nestedPreparationVersionId: cDraft.preparationVersionId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COMPOSITION_CYCLE' });
  });

  it('9 — valid acyclic nested graph accepted', async () => {
    const leaf = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Leaf oil',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(leaf.preparationVersionId);

    const mid = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Mid',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: leaf.preparationVersionId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(mid.preparationVersionId);

    const top = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Dish with nested prep',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: mid.preparationVersionId,
          quantity: '0.1',
          unit: 'L',
          dimension: 'VOLUME',
        },
        {
          lineNumber: 2,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.eggItemId,
          quantity: '2',
          unit: 'ea',
          dimension: 'COUNT',
        },
      ],
    });
    const published = await service.publishRecipeVersion(top.recipeVersionId);
    expect(published.status).toBe('PUBLISHED');
  });

  it('10 — published/versioned history cannot be silently overwritten', async () => {
    const recipe = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'History dish',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishRecipeVersion(recipe.recipeVersionId);

    await expect(
      service.updateRecipeDraft({
        recipeVersionId: recipe.recipeVersionId,
        batchSizeQuantity: '99',
      }),
    ).rejects.toBeInstanceOf(PublishedImmutableError);

    const next = await service.createNextRecipeVersion(recipe.recipeSpecificationId);
    expect(next.versionNumber).toBe(2);
    expect(next.status).toBe('DRAFT');
    const original = await service.getRecipeVersion(recipe.recipeVersionId);
    expect(original.status).toBe('PUBLISHED');
    expect(original.batchSizeQuantity).toBe('1');
  });

  it('11 — incompatible/invalid unit usage rejected', async () => {
    await expect(
      service.createRecipeDraft({
        tenantId: fx.tenantId,
        name: 'Bad unit',
        batchSizeQuantity: '1',
        batchSizeUnit: 'ea',
        batchSizeDimension: 'COUNT',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '1',
            unit: 'kg',
            dimension: 'MASS',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });

    await expect(
      service.createRecipeDraft({
        tenantId: fx.tenantId,
        name: 'Ad-hoc unit',
        batchSizeQuantity: '1',
        batchSizeUnit: 'ea',
        batchSizeDimension: 'COUNT',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '1',
            unit: 'cup',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });
  });

  it('12 — no mutable product/recipe cost truth introduced', async () => {
    expect(await service.assertNoCostTruthColumns()).toBe(true);

    await expect(
      service.createRecipeDraft({
        tenantId: fx.tenantId,
        name: 'Cost sneak',
        batchSizeQuantity: '1',
        batchSizeUnit: 'ea',
        batchSizeDimension: 'COUNT',
        productCost: '100',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('13 — cannot publish recipe referencing DRAFT preparation', async () => {
    const draftPrep = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Draft sauce',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    const recipe = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Depends on draft',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: draftPrep.preparationVersionId,
          quantity: '0.1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await expect(service.publishRecipeVersion(recipe.recipeVersionId)).rejects.toMatchObject({
      code: 'DRAFT_DEPENDENCY',
    });
  });

  it('14 — cannot publish preparation referencing DRAFT preparation', async () => {
    const draftChild = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Child draft',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    const parent = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Parent',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: draftChild.preparationVersionId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await expect(service.publishPreparationVersion(parent.preparationVersionId)).rejects.toMatchObject({
      code: 'DRAFT_DEPENDENCY',
    });
  });

  it('15 — publish succeeds when dependencies are PUBLISHED; later prep edit does not change published parent', async () => {
    const child = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Published child',
      materializationMode: 'VIRTUAL',
      normativeInputQuantity: '1',
      normativeInputUnit: 'L',
      normativeInputDimension: 'VOLUME',
      normativeOutputQuantity: '1',
      normativeOutputUnit: 'L',
      normativeOutputDimension: 'VOLUME',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.oilItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    await service.publishPreparationVersion(child.preparationVersionId);

    const recipe = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Pinned dish',
      batchSizeQuantity: '1',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'PREPARATION_VERSION',
          nestedPreparationVersionId: child.preparationVersionId,
          quantity: '0.2',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    const published = await service.publishRecipeVersion(recipe.recipeVersionId);
    expect(published.status).toBe('PUBLISHED');
    expect(published.components[0]!.nestedPreparationVersionId).toBe(child.preparationVersionId);

    const nextChild = await service.createNextPreparationVersion(child.preparationSpecificationId);
    await service.updatePreparationDraft({
      preparationVersionId: nextChild.preparationVersionId,
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '1',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });
    const still = await service.getRecipeVersion(published.recipeVersionId);
    expect(still.components[0]!.nestedPreparationVersionId).toBe(child.preparationVersionId);
    expect(still.components[0]!.nestedPreparationVersionId).not.toBe(nextChild.preparationVersionId);
  });

  it('16 — STOCK_TRACKED output must match CatalogItem measurement', async () => {
    const doughItemId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Dough kg','kg','MASS')`,
      [doughItemId, fx.tenantId],
    );

    const ok = await service.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Dough ok',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: doughItemId,
      normativeInputQuantity: '1',
      normativeInputUnit: 'kg',
      normativeInputDimension: 'MASS',
      normativeOutputQuantity: '1000',
      normativeOutputUnit: 'g',
      normativeOutputDimension: 'MASS',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.meatItemId,
          quantity: '1',
          unit: 'kg',
          dimension: 'MASS',
        },
      ],
    });
    expect(ok.outputCatalogItemId).toBe(doughItemId);
    expect(ok.normativeYieldRatio).toBe('1');

    await expect(
      service.createPreparationDraft({
        tenantId: fx.tenantId,
        name: 'Dough bad dim',
        materializationMode: 'STOCK_TRACKED',
        outputCatalogItemId: doughItemId,
        normativeInputQuantity: '1',
        normativeInputUnit: 'L',
        normativeInputDimension: 'VOLUME',
        normativeOutputQuantity: '1',
        normativeOutputUnit: 'L',
        normativeOutputDimension: 'VOLUME',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.oilItemId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });
  });

  it('17 — concurrent opposing graph updates cannot both commit a cycle', async () => {
    const mkPublishedLeaf = async (name: string) => {
      const p = await service.createPreparationDraft({
        tenantId: fx.tenantId,
        name,
        materializationMode: 'VIRTUAL',
        normativeInputQuantity: '1',
        normativeInputUnit: 'L',
        normativeInputDimension: 'VOLUME',
        normativeOutputQuantity: '1',
        normativeOutputUnit: 'L',
        normativeOutputDimension: 'VOLUME',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.oilItemId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      });
      await service.publishPreparationVersion(p.preparationVersionId);
      return p;
    };
    const aPub = await mkPublishedLeaf('ConcA');
    const bPub = await mkPublishedLeaf('ConcB');
    const aDraft = await service.createNextPreparationVersion(aPub.preparationSpecificationId);
    const bDraft = await service.createNextPreparationVersion(bPub.preparationSpecificationId);

    const results = await Promise.allSettled([
      service.updatePreparationDraft({
        preparationVersionId: aDraft.preparationVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'PREPARATION_VERSION',
            nestedPreparationVersionId: bPub.preparationVersionId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
      service.updatePreparationDraft({
        preparationVersionId: bDraft.preparationVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'PREPARATION_VERSION',
            nestedPreparationVersionId: aPub.preparationVersionId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    // With tenant graph lock + cycle check, at most one opposing edge may land without forming a cycle
    // among *latest* versions. If both nest the other's PUBLISHED v1, latest A→B and B→A is a cycle —
    // so at least one must fail.
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled + rejected.length).toBe(2);
    if (rejected.length === 1) {
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'COMPOSITION_CYCLE' });
    }
  });

  it('18 — partial concurrent update cannot revert previously committed field', async () => {
    const recipe = await service.createRecipeDraft({
      tenantId: fx.tenantId,
      name: 'Race dish',
      batchSizeQuantity: '10',
      batchSizeUnit: 'ea',
      batchSizeDimension: 'COUNT',
      components: [
        {
          lineNumber: 1,
          componentKind: 'CATALOG_ITEM',
          catalogItemId: fx.milkItemId,
          quantity: '2',
          unit: 'L',
          dimension: 'VOLUME',
        },
      ],
    });

    await Promise.all([
      service.updateRecipeDraft({
        recipeVersionId: recipe.recipeVersionId,
        batchSizeQuantity: '99',
      }),
      service.updateRecipeDraft({
        recipeVersionId: recipe.recipeVersionId,
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '5',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ]);
    const final = await service.getRecipeVersion(recipe.recipeVersionId);
    expect(final.batchSizeQuantity).toBe('99');
    expect(final.components[0]!.quantity).toBe('5');
  });

  it('19 — positive quantity required for batch, component, normative I/O', async () => {
    await expect(
      service.createRecipeDraft({
        tenantId: fx.tenantId,
        name: 'Zero batch',
        batchSizeQuantity: '0',
        batchSizeUnit: 'ea',
        batchSizeDimension: 'COUNT',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DECIMAL' });

    await expect(
      service.createRecipeDraft({
        tenantId: fx.tenantId,
        name: 'Zero component',
        batchSizeQuantity: '1',
        batchSizeUnit: 'ea',
        batchSizeDimension: 'COUNT',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.milkItemId,
            quantity: '0',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DECIMAL' });

    await expect(
      service.createPreparationDraft({
        tenantId: fx.tenantId,
        name: 'Zero normative',
        materializationMode: 'VIRTUAL',
        normativeInputQuantity: '0',
        normativeInputUnit: 'L',
        normativeInputDimension: 'VOLUME',
        normativeOutputQuantity: '1',
        normativeOutputUnit: 'L',
        normativeOutputDimension: 'VOLUME',
        components: [
          {
            lineNumber: 1,
            componentKind: 'CATALOG_ITEM',
            catalogItemId: fx.oilItemId,
            quantity: '1',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DECIMAL' });
  });
});
