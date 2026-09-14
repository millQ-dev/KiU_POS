import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { RecipesService } from '../recipes/recipes-service.js';
import {
  DomainValidationError,
  FinalizedImmutableError,
  IdempotencyConflictError,
} from './errors.js';
import { ProductionBatchService } from './production-batch-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

let pool: pg.Pool;
let fx: BlockCFixture;
let recipes: RecipesService;
let service: ProductionBatchService;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed,
      audit_record,
      consumption_plan_physical_leaf,
      consumption_plan_resolved_version,
      consumption_plan_line,
      consumption_plan_snapshot,
      sales_order_line,
      sales_order,
      catalog_item_recipe_profile,
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

async function insertPrepOutputItem(name: string, baseUnit: string, dimension: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, fx.tenantId, name, baseUnit, dimension],
  );
  return id;
}

async function publishedStockTrackedPrep(opts?: {
  inputQty?: string;
  inputUnit?: string;
  outputQty?: string;
  outputUnit?: string;
  meatQty?: string;
}) {
  const outputId = await insertPrepOutputItem('Dough stock', 'g', 'MASS');
  const draft = await recipes.createPreparationDraft({
    tenantId: fx.tenantId,
    name: 'Dough',
    materializationMode: 'STOCK_TRACKED',
    outputCatalogItemId: outputId,
    normativeInputQuantity: opts?.inputQty ?? '1',
    normativeInputUnit: opts?.inputUnit ?? 'kg',
    normativeInputDimension: 'MASS',
    normativeOutputQuantity: opts?.outputQty ?? '800',
    normativeOutputUnit: opts?.outputUnit ?? 'g',
    normativeOutputDimension: 'MASS',
    components: [
      {
        lineNumber: 1,
        componentKind: 'CATALOG_ITEM',
        catalogItemId: fx.meatItemId,
        quantity: opts?.meatQty ?? '1',
        unit: 'kg',
        dimension: 'MASS',
      },
    ],
  });
  return recipes.publishPreparationVersion(draft.preparationVersionId);
}

describe('Block D1.2A ProductionBatch foundation (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    recipes = new RecipesService(pool);
    service = new ProductionBatchService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
  });

  it('1 — create draft batch for PUBLISHED STOCK_TRACKED preparation', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
      actorId: fx.actorId,
    });
    expect(batch.status).toBe('DRAFT');
    expect(batch.preparationVersionId).toBe(prep.preparationVersionId);
    expect(batch.expectedInputQuantity).toBe('1');
    expect(batch.expectedOutputQuantity).toBe('800');
    expect(batch.expectedYieldRatio).toBe('0.8');
    expect(batch.actualInputQuantity).toBe('1');
    expect(batch.actualOutputQuantity).toBe('800');
    expect(batch.actualYieldRatio).toBe('0.8');
    expect(batch.yieldVariance).toBe('0');
    expect(batch.inputs).toHaveLength(1);
    expect(batch.inputs[0]!.plannedQuantity).toBe('1');
    expect(batch.inputs[0]!.actualQuantity).toBe('1');
  });

  it('2 — reject VIRTUAL preparation', async () => {
    const draft = await recipes.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Virtual sauce',
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
    const prep = await recipes.publishPreparationVersion(draft.preparationVersionId);
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
      }),
    ).rejects.toMatchObject({ code: 'VIRTUAL_PREPARATION_FORBIDDEN' });
  });

  it('3 — reject DRAFT preparation', async () => {
    const outputId = await insertPrepOutputItem('Draft dough', 'g', 'MASS');
    const draft = await recipes.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Draft dough',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: outputId,
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
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: draft.preparationVersionId,
      }),
    ).rejects.toMatchObject({ code: 'PREPARATION_NOT_PUBLISHED' });
  });

  it('4 — reject cross-tenant preparation', async () => {
    const prep = await publishedStockTrackedPrep();
    const otherTenant = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'Other')`, [otherTenant]);
    await expect(
      service.createDraft({
        tenantId: otherTenant,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_TENANT_PREPARATION' });
  });

  it('5 — normative specification remains distinct from actual inputs/output', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
      actualInputQuantity: '1',
      actualInputUnit: 'kg',
      actualInputDimension: 'MASS',
      actualOutputQuantity: '700',
      actualOutputUnit: 'g',
      actualOutputDimension: 'MASS',
    });
    expect(batch.expectedOutputQuantity).toBe('800');
    expect(batch.actualOutputQuantity).toBe('700');
    expect(batch.expectedYieldRatio).toBe('0.8');
    expect(batch.actualYieldRatio).toBe('0.7');
    expect(batch.yieldVariance).toBe('-0.1');
  });

  it('6 — batch pins exact PreparationVersion', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
    });
    expect(batch.preparationVersionId).toBe(prep.preparationVersionId);
  });

  it('7 — newer PreparationVersion does not change existing batch', async () => {
    const prep = await publishedStockTrackedPrep({ outputQty: '800' });
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
    });
    const next = await recipes.createNextPreparationVersion(prep.preparationSpecificationId);
    await recipes.updatePreparationDraft({
      preparationVersionId: next.preparationVersionId,
      normativeOutputQuantity: '500',
      normativeOutputUnit: 'g',
      normativeOutputDimension: 'MASS',
    });
    await recipes.publishPreparationVersion(next.preparationVersionId);

    const reloaded = await service.getBatch(batch.productionBatchId);
    expect(reloaded.preparationVersionId).toBe(prep.preparationVersionId);
    expect(reloaded.expectedOutputQuantity).toBe('800');
    expect(reloaded.expectedYieldRatio).toBe('0.8');
  });

  it('8 — actual yield calculated correctly', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
      actualInputQuantity: '1000',
      actualInputUnit: 'g',
      actualInputDimension: 'MASS',
      actualOutputQuantity: '800',
      actualOutputUnit: 'g',
      actualOutputDimension: 'MASS',
    });
    expect(batch.actualYieldRatio).toBe('0.8');
  });

  it('9 — compatible unit conversion works (kg ↔ g)', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
      actualInputQuantity: '1',
      actualInputUnit: 'kg',
      actualInputDimension: 'MASS',
      actualOutputQuantity: '800',
      actualOutputUnit: 'g',
      actualOutputDimension: 'MASS',
    });
    expect(batch.actualYieldRatio).toBe('0.8');
  });

  it('10 — incompatible dimensions rejected', async () => {
    const prep = await publishedStockTrackedPrep();
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        actualInputQuantity: '1',
        actualInputUnit: 'kg',
        actualInputDimension: 'MASS',
        actualOutputQuantity: '1',
        actualOutputUnit: 'L',
        actualOutputDimension: 'VOLUME',
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });
  });

  it('11 — actual output must be positive for normal production', async () => {
    const prep = await publishedStockTrackedPrep();
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        actualOutputQuantity: '0',
        actualOutputUnit: 'g',
        actualOutputDimension: 'MASS',
        deviationClass: 'NORMAL',
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it('12 — ACCIDENT requires reason', async () => {
    const prep = await publishedStockTrackedPrep();
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        deviationClass: 'ACCIDENT',
      }),
    ).rejects.toMatchObject({ code: 'DEVIATION_REASON_REQUIRED' });
  });

  it('13 — TOTAL_LOSS requires reason', async () => {
    const prep = await publishedStockTrackedPrep();
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        deviationClass: 'TOTAL_LOSS',
        actualOutputQuantity: '0',
        actualOutputUnit: 'g',
        actualOutputDimension: 'MASS',
      }),
    ).rejects.toMatchObject({ code: 'DEVIATION_REASON_REQUIRED' });
  });

  it('14 — TOTAL_LOSS explicit zero output handled correctly', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
      deviationClass: 'TOTAL_LOSS',
      deviationReason: 'Batch burned',
      actualOutputQuantity: '0',
      actualOutputUnit: 'g',
      actualOutputDimension: 'MASS',
    });
    expect(batch.deviationClass).toBe('TOTAL_LOSS');
    expect(batch.actualOutputQuantity).toBe('0');
    expect(batch.actualYieldRatio).toBe('0');
    expect(batch.yieldVariance).toBe('-0.8');
    const finalized = await service.finalize({
      productionBatchId: batch.productionBatchId,
      idempotencyKey: 'total-loss-1',
      actorId: fx.actorId,
    });
    expect(finalized.status).toBe('FINALIZED');
  });

  it('15 — FINALIZED batch immutable', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
    });
    await service.finalize({
      productionBatchId: batch.productionBatchId,
      idempotencyKey: 'fin-1',
      actorId: fx.actorId,
    });
    await expect(
      service.updateDraft({
        productionBatchId: batch.productionBatchId,
        actualOutputQuantity: '100',
        actualOutputUnit: 'g',
        actualOutputDimension: 'MASS',
      }),
    ).rejects.toBeInstanceOf(FinalizedImmutableError);
  });

  it('16 — double/concurrent finalization cannot corrupt state', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
    });

    const [a, b] = await Promise.all([
      service.finalize({
        productionBatchId: batch.productionBatchId,
        idempotencyKey: 'same-key',
        actorId: fx.actorId,
      }),
      service.finalize({
        productionBatchId: batch.productionBatchId,
        idempotencyKey: 'same-key',
        actorId: fx.actorId,
      }),
    ]);
    expect(a.status).toBe('FINALIZED');
    expect(b.status).toBe('FINALIZED');
    expect(a.finalizeIdempotencyKey).toBe('same-key');
    expect(b.finalizeIdempotencyKey).toBe('same-key');

    await expect(
      service.finalize({
        productionBatchId: batch.productionBatchId,
        idempotencyKey: 'other-key',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('17 — concurrent partial update cannot lose a committed field', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
    });

    // Serialize intentionally conflicting partials via overlapping transactions:
    // T1 sets output; T2 sets input — both must retain the other's committed values.
    const client1 = await pool.connect();
    const client2 = await pool.connect();
    try {
      await client1.query('BEGIN');
      await client1.query(
        `SELECT * FROM production_batch WHERE production_batch_id = $1 FOR UPDATE`,
        [batch.productionBatchId],
      );

      const p2 = (async () => {
        await client2.query('BEGIN');
        await client2.query(
          `SELECT * FROM production_batch WHERE production_batch_id = $1 FOR UPDATE`,
          [batch.productionBatchId],
        );
        await client2.query(
          `UPDATE production_batch SET
             actual_input_quantity = '2',
             actual_input_unit = 'kg',
             actual_input_dimension = 'MASS',
             actual_yield_ratio = '0.4',
             yield_variance = '-0.4',
             updated_at = NOW()
           WHERE production_batch_id = $1`,
          [batch.productionBatchId],
        );
        await client2.query('COMMIT');
      })();

      // Let T2 block on lock, then commit T1 output change.
      await new Promise((r) => setTimeout(r, 50));
      await client1.query(
        `UPDATE production_batch SET
           actual_output_quantity = '750',
           actual_output_unit = 'g',
           actual_output_dimension = 'MASS',
           actual_yield_ratio = '0.75',
           yield_variance = '-0.05',
           updated_at = NOW()
         WHERE production_batch_id = $1`,
        [batch.productionBatchId],
      );
      await client1.query('COMMIT');
      await p2;

      // Service-level merge after FOR UPDATE proves field retention under API path.
      await service.updateDraft({
        productionBatchId: batch.productionBatchId,
        actualOutputQuantity: '720',
        actualOutputUnit: 'g',
        actualOutputDimension: 'MASS',
      });
      const afterOutput = await service.getBatch(batch.productionBatchId);
      expect(afterOutput.actualInputQuantity).toBe('2');
      expect(afterOutput.actualOutputQuantity).toBe('720');

      await service.updateDraft({
        productionBatchId: batch.productionBatchId,
        actualInputQuantity: '1.5',
        actualInputUnit: 'kg',
        actualInputDimension: 'MASS',
      });
      const afterInput = await service.getBatch(batch.productionBatchId);
      expect(afterInput.actualInputQuantity).toBe('1.5');
      expect(afterInput.actualOutputQuantity).toBe('720');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('18 — no inventory movements / cost SoT from finalize', async () => {
    const prep = await publishedStockTrackedPrep();
    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
    });
    await service.finalize({
      productionBatchId: batch.productionBatchId,
      idempotencyKey: 'no-inv',
      actorId: fx.actorId,
    });
    const movements = await pool.query(`SELECT count(*)::int AS c FROM inventory_movement`);
    const balances = await pool.query(`SELECT count(*)::int AS c FROM inventory_balance`);
    expect(movements.rows[0]!.c).toBe(0);
    expect(balances.rows[0]!.c).toBe(0);
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        productCost: '1',
      } as never),
    ).rejects.toBeTruthy();
  });

  it('19 — line actual unit/dimension must match planned measurement', async () => {
    const prep = await publishedStockTrackedPrep();
    await expect(
      service.createDraft({
        tenantId: fx.tenantId,
        warehouseId: fx.warehouseId,
        preparationVersionId: prep.preparationVersionId,
        inputActuals: [
          {
            lineNumber: 1,
            actualQuantity: '1',
            actualUnit: 'L',
            actualDimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });

    const batch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: prep.preparationVersionId,
      inputActuals: [
        {
          lineNumber: 1,
          actualQuantity: '1000',
          actualUnit: 'g',
          actualDimension: 'MASS',
        },
      ],
    });
    expect(batch.inputs[0]!.actualUnit).toBe('g');
    expect(batch.inputs[0]!.actualQuantity).toBe('1000');

    await expect(
      service.updateDraft({
        productionBatchId: batch.productionBatchId,
        inputActuals: [
          {
            lineNumber: 1,
            actualQuantity: '2',
            actualUnit: 'L',
            actualDimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });
  });

  it('20 — same-unit actuals accepted without conversion table; unsupported conversion rejected', async () => {
    // 1) identical supported unit (kg) → accepted
    const siPrep = await publishedStockTrackedPrep();
    const siBatch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: siPrep.preparationVersionId,
      inputActuals: [
        {
          lineNumber: 1,
          actualQuantity: '1.25',
          actualUnit: 'kg',
          actualDimension: 'MASS',
        },
      ],
    });
    expect(siBatch.inputs[0]!.actualUnit).toBe('kg');
    expect(siBatch.inputs[0]!.actualQuantity).toBe('1.25');

    // 2) identical valid unit NOT in SI conversion table (oz) → accepted
    const ozItemId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Spice oz','oz','MASS')`,
      [ozItemId, fx.tenantId],
    );
    const outputId = await insertPrepOutputItem('Spice stock', 'g', 'MASS');
    const ozDraft = await recipes.createPreparationDraft({
      tenantId: fx.tenantId,
      name: 'Spice mix',
      materializationMode: 'STOCK_TRACKED',
      outputCatalogItemId: outputId,
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
          catalogItemId: ozItemId,
          quantity: '16',
          unit: 'oz',
          dimension: 'MASS',
        },
      ],
    });
    const ozPrep = await recipes.publishPreparationVersion(ozDraft.preparationVersionId);
    const ozBatch = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: ozPrep.preparationVersionId,
      inputActuals: [
        {
          lineNumber: 1,
          actualQuantity: '15',
          actualUnit: 'oz',
          actualDimension: 'MASS',
        },
      ],
    });
    expect(ozBatch.inputs[0]!.plannedUnit).toBe('oz');
    expect(ozBatch.inputs[0]!.actualUnit).toBe('oz');
    expect(ozBatch.inputs[0]!.actualQuantity).toBe('15');

    // 3) compatible different units with supported conversion (kg → g) → accepted
    // covered by test 19 create path; reaffirm here
    const converted = await service.createDraft({
      tenantId: fx.tenantId,
      warehouseId: fx.warehouseId,
      preparationVersionId: siPrep.preparationVersionId,
      inputActuals: [
        {
          lineNumber: 1,
          actualQuantity: '500',
          actualUnit: 'g',
          actualDimension: 'MASS',
        },
      ],
    });
    expect(converted.inputs[0]!.actualUnit).toBe('g');

    // 4) same dimension, different unsupported conversion (oz → kg) → rejected
    await expect(
      service.updateDraft({
        productionBatchId: ozBatch.productionBatchId,
        inputActuals: [
          {
            lineNumber: 1,
            actualQuantity: '1',
            actualUnit: 'kg',
            actualDimension: 'MASS',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });

    // 5) different dimensions → rejected
    await expect(
      service.updateDraft({
        productionBatchId: ozBatch.productionBatchId,
        inputActuals: [
          {
            lineNumber: 1,
            actualQuantity: '1',
            actualUnit: 'L',
            actualDimension: 'VOLUME',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNIT' });
  });
});
