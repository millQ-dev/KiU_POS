import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  OperationalFactType,
  parseOperationalFact,
  semanticFingerprint as factSemanticFingerprint,
} from '@millq/contracts';
import {
  computeActualBatchUnitCost,
  costForQuantity,
  createCostValue,
  issueCostQuoteFromStream,
  mergeCertainty,
  normalizeToBaseUnit,
  parseCanonicalDecimal,
  replayStreamBefore,
  toCanonicalDecimal,
  type CostCertainty,
  type UnitDimension,
} from '@millq/domain';
import { rebuildInventoryBalance } from '../inventory/rebuild-balance.js';
import {
  DomainValidationError,
  FinalizedImmutableError,
  IdempotencyConflictError,
  NotFoundError,
} from './errors.js';
import { productionPostFingerprint } from './posting-fingerprint.js';
import {
  postProductionBatchSchema,
  reverseProductionBatchSchema,
} from './posting-types.js';
import { ProductionBatchService } from './production-batch-service.js';

type Pool = pg.Pool;
type Client = pg.PoolClient;

type BatchLockRow = {
  production_batch_id: string;
  tenant_id: string;
  warehouse_id: string;
  preparation_version_id: string;
  status: 'DRAFT' | 'FINALIZED';
  posting_status: 'UNPOSTED' | 'POSTED' | 'REVERSED';
  deviation_class: string;
  deviation_reason: string | null;
  expected_input_quantity: string;
  expected_input_unit: string;
  expected_input_dimension: UnitDimension;
  expected_output_quantity: string;
  expected_output_unit: string;
  expected_output_dimension: UnitDimension;
  expected_yield_ratio: string | null;
  actual_input_quantity: string;
  actual_input_unit: string;
  actual_input_dimension: UnitDimension;
  actual_output_quantity: string;
  actual_output_unit: string;
  actual_output_dimension: UnitDimension;
  actual_yield_ratio: string | null;
  yield_variance: string | null;
  legal_entity_id: string | null;
  currency_code: string | null;
  minor_unit_exponent: number | null;
  business_date: string | Date | null;
  business_time: string | null;
  business_order: number | null;
  post_idempotency_key: string | null;
  post_semantic_fingerprint: string | null;
  reverses_production_batch_id: string | null;
  actual_batch_cost_minor: string | null;
  actual_batch_cost_certainty: string | null;
  actual_output_unit_cost_minor: string | null;
};

type InputRow = {
  production_batch_input_id: string;
  line_number: number;
  component_kind: 'CATALOG_ITEM' | 'PREPARATION_VERSION';
  catalog_item_id: string | null;
  nested_preparation_version_id: string | null;
  actual_quantity: string;
  actual_unit: string;
  actual_dimension: UnitDimension;
};

function asIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  throw new DomainValidationError('INVALID_DATE', `Invalid business date: ${String(value)}`);
}

export class ProductionPostingService {
  private readonly batches: ProductionBatchService;

  constructor(private readonly pool: Pool) {
    this.batches = new ProductionBatchService(pool);
  }

  async post(raw: unknown) {
    const cmd = postProductionBatchSchema.parse(raw);
    const existing = await this.batches.getBatch(cmd.productionBatchId);

    if (existing.status !== 'FINALIZED') {
      throw new DomainValidationError(
        'NOT_FINALIZED',
        'Only FINALIZED production batches can be posted',
      );
    }

    // Pre-lock idempotency for already-posted
    const headerPeek = await this.pool.query<BatchLockRow>(
      `SELECT * FROM production_batch WHERE production_batch_id = $1`,
      [cmd.productionBatchId],
    );
    const peek = headerPeek.rows[0];
    if (!peek) throw new NotFoundError(`ProductionBatch not found: ${cmd.productionBatchId}`);

    if (peek.posting_status === 'POSTED') {
      const fp = await this.computeFingerprint(cmd, existing, peek.warehouse_id);
      if (
        peek.post_idempotency_key === cmd.idempotencyKey &&
        peek.post_semantic_fingerprint === fp
      ) {
        return { status: 'duplicate' as const, batch: await this.getPostedView(cmd.productionBatchId) };
      }
      throw new IdempotencyConflictError(
        cmd.idempotencyKey,
        'Already POSTED with a different idempotency key or semantic fingerprint',
      );
    }
    if (peek.posting_status === 'REVERSED') {
      throw new DomainValidationError('ALREADY_REVERSED', 'Reversed batch cannot be posted');
    }

    const warehouse = await this.loadWarehouse(peek.warehouse_id, existing.tenantId);
    const keyConflict = await this.pool.query(
      `SELECT production_batch_id, post_semantic_fingerprint FROM production_batch
       WHERE legal_entity_id = $1 AND post_idempotency_key = $2`,
      [warehouse.legal_entity_id, cmd.idempotencyKey],
    );
    if (keyConflict.rows[0] && keyConflict.rows[0].production_batch_id !== cmd.productionBatchId) {
      throw new IdempotencyConflictError(
        cmd.idempotencyKey,
        'Idempotency key already used by another production batch',
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockBatch(client, cmd.productionBatchId);
      if (locked.status !== 'FINALIZED') {
        throw new DomainValidationError('NOT_FINALIZED', 'Only FINALIZED batches can be posted');
      }
      if (locked.posting_status === 'POSTED') {
        const fp = await this.computeFingerprint(cmd, existing, locked.warehouse_id);
        if (
          locked.post_idempotency_key === cmd.idempotencyKey &&
          locked.post_semantic_fingerprint === fp
        ) {
          await client.query('COMMIT');
          return {
            status: 'duplicate' as const,
            batch: await this.getPostedView(cmd.productionBatchId),
          };
        }
        throw new IdempotencyConflictError(cmd.idempotencyKey, 'Already POSTED');
      }
      if (locked.posting_status !== 'UNPOSTED') {
        throw new DomainValidationError(
          'INVALID_POSTING_STATUS',
          `Cannot post from posting_status=${locked.posting_status}`,
        );
      }

      const fp = await this.computeFingerprint(cmd, existing, locked.warehouse_id);
      const prep = await this.loadPrepOutput(client, locked.preparation_version_id);
      const inputs = await this.loadInputs(client, locked.production_batch_id);
      const physicalInputs = await this.resolvePhysicalInputs(client, locked.tenant_id, inputs);

      const touched = new Set<string>();
      let batchCostMinor = parseCanonicalDecimal('0');
      let batchCertainty: CostCertainty = 'FINAL';

      for (const line of physicalInputs) {
        const catalog = await this.loadCatalogItem(client, locked.tenant_id, line.catalogItemId);
        if (catalog.dimension !== line.actualDimension) {
          throw new DomainValidationError(
            'INCOMPATIBLE_UNIT',
            `Input line ${line.lineNumber} dimension mismatch vs catalog`,
          );
        }
        const qtyInCatalogBase = this.toCatalogBaseQuantity(
          line.actualQuantity,
          line.actualUnit,
          line.actualDimension,
          catalog.base_unit,
        );

        const quote = await this.quoteIssueCost(
          client,
          warehouse.legal_entity_id,
          locked.warehouse_id,
          line.catalogItemId,
          cmd.currencyCode,
          cmd.minorUnitExponent,
          cmd.businessDate,
          cmd.businessOrder,
        );
        batchCertainty = mergeCertainty(batchCertainty, quote.certainty);
        const lineCost = costForQuantity(
          createCostValue(quote.amountMinorUnits, quote.currencyCode, quote.minorUnitExponent),
          qtyInCatalogBase,
        );
        batchCostMinor = batchCostMinor.plus(parseCanonicalDecimal(lineCost.amountMinorUnits));

        await client.query(
          `INSERT INTO inventory_movement (
             movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
             direction, quantity, base_unit, dimension, acquisition_cost_minor,
             currency_code, minor_unit_exponent, business_date, business_time, business_order,
             source_document_type, source_document_id, source_document_line_id, actor_id
           ) VALUES ($1,$2,$3,$4,$5,'OUT',$6,$7,$8,$9,$10,$11,$12,$13,$14,'ProductionBatch',$15,$16,$17)`,
          [
            randomUUID(),
            locked.tenant_id,
            warehouse.legal_entity_id,
            locked.warehouse_id,
            line.catalogItemId,
            qtyInCatalogBase,
            catalog.base_unit,
            catalog.dimension,
            lineCost.amountMinorUnits,
            cmd.currencyCode,
            cmd.minorUnitExponent,
            cmd.businessDate,
            cmd.businessTime ?? null,
            cmd.businessOrder,
            locked.production_batch_id,
            line.productionBatchInputId,
            cmd.actorId ?? null,
          ],
        );
        touched.add(line.catalogItemId);

        await this.mirrorInventoryConsumed(client, {
          tenantId: locked.tenant_id,
          legalEntityId: warehouse.legal_entity_id,
          warehouseId: locked.warehouse_id,
          catalogItemId: line.catalogItemId,
          quantity: qtyInCatalogBase,
          unit: catalog.base_unit,
          dimension: catalog.dimension,
          productionBatchId: locked.production_batch_id,
          inputLineId: line.productionBatchInputId,
          idempotencyKey: cmd.idempotencyKey,
          businessDate: cmd.businessDate,
          businessTime: cmd.businessTime ?? null,
          businessOrder: cmd.businessOrder,
          actorId: cmd.actorId,
          currencyCode: cmd.currencyCode,
        });
      }

      const batchCost = createCostValue(
        toCanonicalDecimal(batchCostMinor),
        cmd.currencyCode,
        cmd.minorUnitExponent,
      );
      let outputUnitCostMinor: string | null = null;
      const isTotalLoss = locked.deviation_class === 'TOTAL_LOSS';
      const outQty = parseCanonicalDecimal(locked.actual_output_quantity);

      if (isTotalLoss) {
        if (!outQty.isZero()) {
          throw new DomainValidationError(
            'TOTAL_LOSS_OUTPUT_MUST_BE_ZERO',
            'TOTAL_LOSS posting requires zero actual output',
          );
        }
      } else {
        if (!outQty.gt(0)) {
          throw new DomainValidationError(
            'POSITIVE_OUTPUT_REQUIRED',
            'Non-TOTAL_LOSS posting requires positive actual output',
          );
        }
        if (!prep.output_catalog_item_id) {
          throw new DomainValidationError(
            'STOCK_TRACKED_OUTPUT_REQUIRED',
            'STOCK_TRACKED preparation requires output_catalog_item_id',
          );
        }
        const outCatalog = await this.loadCatalogItem(
          client,
          locked.tenant_id,
          prep.output_catalog_item_id,
        );
        const outQtyBase = this.toCatalogBaseQuantity(
          locked.actual_output_quantity,
          locked.actual_output_unit,
          locked.actual_output_dimension,
          outCatalog.base_unit,
        );
        const unitCost = computeActualBatchUnitCost(batchCost, outQtyBase);
        if (!unitCost) {
          throw new DomainValidationError('ZERO_OUTPUT', 'Cannot compute unit cost for zero output');
        }
        outputUnitCostMinor = unitCost.amountMinorUnits;

        await client.query(
          `INSERT INTO inventory_movement (
             movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
             direction, quantity, base_unit, dimension, acquisition_cost_minor,
             currency_code, minor_unit_exponent, business_date, business_time, business_order,
             source_document_type, source_document_id, source_document_line_id, actor_id
           ) VALUES ($1,$2,$3,$4,$5,'IN',$6,$7,$8,$9,$10,$11,$12,$13,$14,'ProductionBatch',$15,NULL,$16)`,
          [
            randomUUID(),
            locked.tenant_id,
            warehouse.legal_entity_id,
            locked.warehouse_id,
            prep.output_catalog_item_id,
            outQtyBase,
            outCatalog.base_unit,
            outCatalog.dimension,
            batchCost.amountMinorUnits,
            cmd.currencyCode,
            cmd.minorUnitExponent,
            cmd.businessDate,
            cmd.businessTime ?? null,
            cmd.businessOrder,
            locked.production_batch_id,
            cmd.actorId ?? null,
          ],
        );
        touched.add(prep.output_catalog_item_id);
      }

      for (const catalogItemId of touched) {
        await rebuildInventoryBalance(
          client,
          warehouse.legal_entity_id,
          locked.warehouse_id,
          catalogItemId,
        );
      }

      await this.mirrorPreparationProduced(client, {
        tenantId: locked.tenant_id,
        legalEntityId: warehouse.legal_entity_id,
        warehouseId: locked.warehouse_id,
        productionBatchId: locked.production_batch_id,
        preparationVersionId: locked.preparation_version_id,
        batchCost,
        actualOutputQuantity: locked.actual_output_quantity,
        actualOutputUnit: locked.actual_output_unit,
        actualOutputDimension: locked.actual_output_dimension,
        idempotencyKey: cmd.idempotencyKey,
        businessDate: cmd.businessDate,
        businessTime: cmd.businessTime ?? null,
        businessOrder: cmd.businessOrder,
        totalLoss: isTotalLoss,
        actorId: cmd.actorId,
      });

      const postedAt = new Date().toISOString();
      await client.query(
        `UPDATE production_batch SET
           posting_status = 'POSTED',
           legal_entity_id = $2,
           currency_code = $3,
           minor_unit_exponent = $4,
           business_date = $5,
           business_time = $6,
           business_order = $7,
           post_idempotency_key = $8,
           post_semantic_fingerprint = $9,
           posted_at = $10,
           posted_by = $11,
           actual_batch_cost_minor = $12,
           actual_batch_cost_certainty = $13,
           actual_output_unit_cost_minor = $14,
           updated_at = NOW()
         WHERE production_batch_id = $1 AND posting_status = 'UNPOSTED'`,
        [
          locked.production_batch_id,
          warehouse.legal_entity_id,
          cmd.currencyCode,
          cmd.minorUnitExponent,
          cmd.businessDate,
          cmd.businessTime ?? null,
          cmd.businessOrder,
          cmd.idempotencyKey,
          fp,
          postedAt,
          cmd.actorId ?? null,
          batchCost.amountMinorUnits,
          batchCertainty,
          outputUnitCostMinor,
        ],
      );

      await this.writeAudit(client, {
        tenantId: locked.tenant_id,
        actorId: cmd.actorId,
        aggregateId: locked.production_batch_id,
        action: isTotalLoss ? 'PRODUCTION_BATCH_TOTAL_LOSS_POSTED' : 'PRODUCTION_BATCH_POSTED',
        after: {
          postingStatus: 'POSTED',
          idempotencyKey: cmd.idempotencyKey,
          batchCostMinor: batchCost.amountMinorUnits,
          certainty: batchCertainty,
          totalLoss: isTotalLoss,
        },
        reason: locked.deviation_reason,
        riskLevel: isTotalLoss ? 'SENSITIVE' : 'NORMAL',
      });

      await client.query('COMMIT');
      return { status: 'created' as const, batch: await this.getPostedView(cmd.productionBatchId) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async reverse(raw: unknown) {
    const cmd = reverseProductionBatchSchema.parse(raw);
    const peek = await this.pool.query<BatchLockRow>(
      `SELECT * FROM production_batch WHERE production_batch_id = $1`,
      [cmd.productionBatchId],
    );
    const existing = peek.rows[0];
    if (!existing) throw new NotFoundError(`ProductionBatch not found: ${cmd.productionBatchId}`);

    const reverseKey = `reverse:${cmd.idempotencyKey}`;
    const existingReverse = await this.pool.query<{
      production_batch_id: string;
      post_idempotency_key: string | null;
    }>(
      `SELECT production_batch_id, post_idempotency_key FROM production_batch
       WHERE reverses_production_batch_id = $1 AND posting_status = 'POSTED'`,
      [cmd.productionBatchId],
    );
    if (existing.posting_status === 'REVERSED') {
      const stub = existingReverse.rows[0];
      if (stub && stub.post_idempotency_key === reverseKey) {
        return {
          status: 'duplicate' as const,
          batch: await this.getPostedView(cmd.productionBatchId),
        };
      }
      if (stub) {
        throw new IdempotencyConflictError(
          cmd.idempotencyKey,
          'Batch already reversed with a different idempotency key',
        );
      }
      throw new DomainValidationError('ALREADY_REVERSED', 'Batch posting is already REVERSED');
    }
    if (existing.posting_status !== 'POSTED') {
      throw new DomainValidationError('INVALID_STATUS', 'Only POSTED batches can be reversed');
    }
    if (existingReverse.rowCount && existingReverse.rowCount > 0) {
      return {
        status: 'duplicate' as const,
        batch: await this.getPostedView(cmd.productionBatchId),
      };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockBatch(client, cmd.productionBatchId);
      if (locked.posting_status === 'REVERSED') {
        await client.query('COMMIT');
        return {
          status: 'duplicate' as const,
          batch: await this.getPostedView(cmd.productionBatchId),
        };
      }
      if (locked.posting_status !== 'POSTED') {
        throw new DomainValidationError('INVALID_STATUS', 'Only POSTED batches can be reversed');
      }

      const movements = await client.query<{
        movement_id: string;
        catalog_item_id: string;
        direction: 'IN' | 'OUT';
        quantity: string;
        base_unit: string;
        dimension: UnitDimension;
        acquisition_cost_minor: string;
        currency_code: string;
        minor_unit_exponent: number;
        business_date: string | Date;
        business_time: string | null;
        business_order: number;
        source_document_line_id: string | null;
      }>(
        `SELECT * FROM inventory_movement
         WHERE source_document_type = 'ProductionBatch' AND source_document_id = $1
         ORDER BY recorded_at ASC`,
        [locked.production_batch_id],
      );

      await client.query(
        `UPDATE production_batch SET
           posting_status = 'REVERSED',
           reversed_at = NOW(),
           updated_at = NOW()
         WHERE production_batch_id = $1 AND posting_status = 'POSTED'`,
        [locked.production_batch_id],
      );

      // Compensating movements at same historical costs (immutable originals retained).
      const touched = new Set<string>();
      for (const m of movements.rows) {
        const compensateDirection = m.direction === 'IN' ? 'OUT' : 'IN';
        await client.query(
          `INSERT INTO inventory_movement (
             movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
             direction, quantity, base_unit, dimension, acquisition_cost_minor,
             currency_code, minor_unit_exponent, business_date, business_time, business_order,
             source_document_type, source_document_id, source_document_line_id, actor_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ProductionBatchReversal',$16,$17,$18)`,
          [
            randomUUID(),
            locked.tenant_id,
            locked.legal_entity_id,
            locked.warehouse_id,
            m.catalog_item_id,
            compensateDirection,
            m.quantity,
            m.base_unit,
            m.dimension,
            m.acquisition_cost_minor,
            m.currency_code,
            m.minor_unit_exponent,
            asIsoDate(m.business_date),
            m.business_time,
            m.business_order,
            locked.production_batch_id,
            m.source_document_line_id,
            cmd.actorId ?? null,
          ],
        );
        touched.add(m.catalog_item_id);
      }

      for (const catalogItemId of touched) {
        await rebuildInventoryBalance(
          client,
          locked.legal_entity_id!,
          locked.warehouse_id,
          catalogItemId,
        );
      }

      // Marker reverse row for idempotency (same frozen fact; posting_status POSTED on reverse stub).
      const reverseStubId = randomUUID();
      await client.query(
        `INSERT INTO production_batch (
           production_batch_id, tenant_id, warehouse_id, preparation_version_id,
           expected_input_quantity, expected_input_unit, expected_input_dimension,
           expected_output_quantity, expected_output_unit, expected_output_dimension,
           expected_yield_ratio,
           actual_input_quantity, actual_input_unit, actual_input_dimension,
           actual_output_quantity, actual_output_unit, actual_output_dimension,
           actual_yield_ratio, yield_variance,
           deviation_class, deviation_reason, status, posting_status,
           legal_entity_id, currency_code, minor_unit_exponent,
           business_date, business_time, business_order,
           post_idempotency_key, post_semantic_fingerprint,
           reverses_production_batch_id, posted_at, posted_by
         ) VALUES (
           $1,$2,$3,$4,
           $5,$6,$7,$8,$9,$10,$11,
           $12,$13,$14,$15,$16,$17,$18,$19,
           $20,$21,'FINALIZED','POSTED',
           $22,$23,$24,$25,$26,$27,
           $28,$29,$30,NOW(),$31
         )`,
        [
          reverseStubId,
          locked.tenant_id,
          locked.warehouse_id,
          locked.preparation_version_id,
          locked.expected_input_quantity,
          locked.expected_input_unit,
          locked.expected_input_dimension,
          locked.expected_output_quantity,
          locked.expected_output_unit,
          locked.expected_output_dimension,
          locked.expected_yield_ratio,
          locked.actual_input_quantity,
          locked.actual_input_unit,
          locked.actual_input_dimension,
          locked.actual_output_quantity,
          locked.actual_output_unit,
          locked.actual_output_dimension,
          locked.actual_yield_ratio,
          locked.yield_variance,
          locked.deviation_class,
          locked.deviation_reason,
          locked.legal_entity_id,
          locked.currency_code,
          locked.minor_unit_exponent,
          locked.business_date,
          locked.business_time,
          locked.business_order,
          reverseKey,
          `reverse-of:${locked.production_batch_id}`,
          locked.production_batch_id,
          cmd.actorId ?? null,
        ],
      );

      await this.writeAudit(client, {
        tenantId: locked.tenant_id,
        actorId: cmd.actorId,
        aggregateId: locked.production_batch_id,
        action: 'PRODUCTION_BATCH_POSTING_REVERSED',
        after: { postingStatus: 'REVERSED', reverseStubId, idempotencyKey: cmd.idempotencyKey },
        reason: cmd.reason ?? null,
        riskLevel: 'HIGH',
      });

      await client.query('COMMIT');
      return { status: 'created' as const, batch: await this.getPostedView(cmd.productionBatchId) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getPostedView(productionBatchId: string) {
    const batch = await this.batches.getBatch(productionBatchId);
    const header = await this.pool.query<BatchLockRow>(
      `SELECT * FROM production_batch WHERE production_batch_id = $1`,
      [productionBatchId],
    );
    const row = header.rows[0]!;
    const movements = await this.pool.query(
      `SELECT movement_id, direction, catalog_item_id, quantity, base_unit, dimension,
              acquisition_cost_minor, source_document_type
       FROM inventory_movement
       WHERE source_document_id = $1
         AND source_document_type IN ('ProductionBatch', 'ProductionBatchReversal')
       ORDER BY recorded_at ASC`,
      [productionBatchId],
    );
    return {
      ...batch,
      postingStatus: row.posting_status,
      legalEntityId: row.legal_entity_id,
      currencyCode: row.currency_code,
      minorUnitExponent: row.minor_unit_exponent,
      businessDate: row.business_date ? asIsoDate(row.business_date) : null,
      businessOrder: row.business_order,
      postIdempotencyKey: row.post_idempotency_key,
      actualBatchCostMinor: row.actual_batch_cost_minor ?? null,
      actualBatchCostCertainty: row.actual_batch_cost_certainty ?? null,
      actualOutputUnitCostMinor: row.actual_output_unit_cost_minor ?? null,
      movements: movements.rows,
    };
  }

  private async computeFingerprint(
    cmd: {
      currencyCode: string;
      minorUnitExponent: number;
      businessDate: string;
      businessTime?: string | undefined;
      businessOrder: number;
    },
    batch: Awaited<ReturnType<ProductionBatchService['getBatch']>>,
    warehouseId: string,
  ) {
    const warehouse = await this.loadWarehouse(warehouseId, batch.tenantId);
    const physical = await this.resolvePhysicalInputs(
      this.pool as unknown as Client,
      batch.tenantId,
      batch.inputs.map((i) => ({
        production_batch_input_id: i.productionBatchInputId,
        line_number: i.lineNumber,
        component_kind: i.componentKind,
        catalog_item_id: i.catalogItemId,
        nested_preparation_version_id: i.nestedPreparationVersionId,
        actual_quantity: i.actualQuantity,
        actual_unit: i.actualUnit,
        actual_dimension: i.actualDimension,
      })),
    );
    return productionPostFingerprint({
      productionBatchId: batch.productionBatchId,
      preparationVersionId: batch.preparationVersionId,
      warehouseId,
      legalEntityId: warehouse.legal_entity_id,
      currencyCode: cmd.currencyCode,
      minorUnitExponent: cmd.minorUnitExponent,
      businessDate: cmd.businessDate,
      businessTime: cmd.businessTime ?? null,
      businessOrder: cmd.businessOrder,
      actualOutputQuantity: batch.actualOutputQuantity,
      actualOutputUnit: batch.actualOutputUnit,
      actualOutputDimension: batch.actualOutputDimension,
      deviationClass: batch.deviationClass,
      inputs: physical.map((p) => ({
        lineNumber: p.lineNumber,
        catalogItemId: p.catalogItemId,
        quantity: p.actualQuantity,
        unit: p.actualUnit,
        dimension: p.actualDimension,
      })),
    });
  }

  private async lockBatch(client: Client, id: string): Promise<BatchLockRow> {
    const res = await client.query<BatchLockRow>(
      `SELECT * FROM production_batch WHERE production_batch_id = $1 FOR UPDATE`,
      [id],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`ProductionBatch not found: ${id}`);
    return row;
  }

  private async loadWarehouse(warehouseId: string, tenantId: string) {
    const res = await this.pool.query<{
      warehouse_id: string;
      tenant_id: string;
      legal_entity_id: string;
    }>(`SELECT warehouse_id, tenant_id, legal_entity_id FROM warehouse WHERE warehouse_id = $1`, [
      warehouseId,
    ]);
    const row = res.rows[0];
    if (!row || row.tenant_id !== tenantId) {
      throw new NotFoundError(`Warehouse not found for tenant: ${warehouseId}`);
    }
    return row;
  }

  private async loadPrepOutput(client: Client, preparationVersionId: string) {
    const res = await client.query<{
      preparation_version_id: string;
      materialization_mode: string;
      output_catalog_item_id: string | null;
      status: string;
    }>(
      `SELECT preparation_version_id, materialization_mode, output_catalog_item_id, status
       FROM preparation_version WHERE preparation_version_id = $1`,
      [preparationVersionId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`PreparationVersion not found: ${preparationVersionId}`);
    return row;
  }

  private async loadInputs(client: Client, batchId: string): Promise<InputRow[]> {
    const res = await client.query<InputRow>(
      `SELECT production_batch_input_id, line_number, component_kind, catalog_item_id,
              nested_preparation_version_id, actual_quantity, actual_unit,
              actual_dimension::text AS actual_dimension
       FROM production_batch_input
       WHERE production_batch_id = $1
       ORDER BY line_number ASC`,
      [batchId],
    );
    return res.rows;
  }

  private async resolvePhysicalInputs(
    client: Client | Pool,
    tenantId: string,
    inputs: InputRow[],
  ): Promise<
    Array<{
      productionBatchInputId: string;
      lineNumber: number;
      catalogItemId: string;
      actualQuantity: string;
      actualUnit: string;
      actualDimension: UnitDimension;
    }>
  > {
    const out: Array<{
      productionBatchInputId: string;
      lineNumber: number;
      catalogItemId: string;
      actualQuantity: string;
      actualUnit: string;
      actualDimension: UnitDimension;
    }> = [];
    for (const i of inputs) {
      if (i.component_kind === 'CATALOG_ITEM') {
        if (!i.catalog_item_id) {
          throw new DomainValidationError('INVALID_INPUT', `Line ${i.line_number} missing catalog item`);
        }
        out.push({
          productionBatchInputId: i.production_batch_input_id,
          lineNumber: i.line_number,
          catalogItemId: i.catalog_item_id,
          actualQuantity: i.actual_quantity,
          actualUnit: i.actual_unit,
          actualDimension: i.actual_dimension,
        });
        continue;
      }
      // Nested preparation: only STOCK_TRACKED may be a physical OUT (exactly-one write-off).
      const nested = await client.query<{
        materialization_mode: string;
        output_catalog_item_id: string | null;
        normative_output_unit: string;
        normative_output_dimension: UnitDimension;
      }>(
        `SELECT materialization_mode, output_catalog_item_id, normative_output_unit,
                normative_output_dimension::text AS normative_output_dimension
         FROM preparation_version WHERE preparation_version_id = $1`,
        [i.nested_preparation_version_id],
      );
      const n = nested.rows[0];
      if (!n) {
        throw new NotFoundError(`Nested PreparationVersion not found on line ${i.line_number}`);
      }
      if (n.materialization_mode === 'VIRTUAL') {
        throw new DomainValidationError(
          'VIRTUAL_NESTED_FORBIDDEN',
          `Line ${i.line_number}: VIRTUAL nested preparation cannot create an independent physical OUT`,
        );
      }
      if (!n.output_catalog_item_id) {
        throw new DomainValidationError(
          'STOCK_TRACKED_OUTPUT_REQUIRED',
          `Line ${i.line_number}: nested STOCK_TRACKED prep missing output catalog item`,
        );
      }
      void tenantId;
      out.push({
        productionBatchInputId: i.production_batch_input_id,
        lineNumber: i.line_number,
        catalogItemId: n.output_catalog_item_id,
        actualQuantity: i.actual_quantity,
        actualUnit: i.actual_unit,
        actualDimension: i.actual_dimension,
      });
    }
    return out;
  }

  private async loadCatalogItem(client: Client, tenantId: string, catalogItemId: string) {
    const res = await client.query<{
      catalog_item_id: string;
      tenant_id: string;
      base_unit: string;
      dimension: UnitDimension;
    }>(
      `SELECT catalog_item_id, tenant_id, base_unit, dimension::text AS dimension
       FROM catalog_item WHERE catalog_item_id = $1`,
      [catalogItemId],
    );
    const row = res.rows[0];
    if (!row || row.tenant_id !== tenantId) {
      throw new NotFoundError(`Catalog item not found: ${catalogItemId}`);
    }
    return row;
  }

  private toCatalogBaseQuantity(
    quantity: string,
    unit: string,
    dimension: UnitDimension,
    catalogBaseUnit: string,
  ): string {
    const normalized = normalizeToBaseUnit(quantity, unit, dimension);
    if (normalized.unit === catalogBaseUnit) return normalized.value;
    const catalogAsBase = normalizeToBaseUnit('1', catalogBaseUnit, dimension);
    // Both in SI base; convert: qty_in_catalog = si_qty / (1 catalog in si)
    const factor = parseCanonicalDecimal(catalogAsBase.value);
    return toCanonicalDecimal(parseCanonicalDecimal(normalized.value).div(factor));
  }

  private async quoteIssueCost(
    client: Client,
    legalEntityId: string,
    warehouseId: string,
    catalogItemId: string,
    currencyCode: string,
    minorUnitExponent: number,
    businessDate: string,
    businessOrder: number,
  ) {
    const movements = await client.query(
      `SELECT direction, quantity, acquisition_cost_minor, currency_code, minor_unit_exponent,
              business_date, business_order
       FROM inventory_movement
       WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3
       ORDER BY business_date ASC, business_order ASC, recorded_at ASC`,
      [legalEntityId, warehouseId, catalogItemId],
    );
    const rows = movements.rows.map((m) => ({
      direction: m.direction as 'IN' | 'OUT',
      quantity: m.quantity as string,
      acquisition_cost_minor: m.acquisition_cost_minor as string,
      currency_code: m.currency_code as string,
      minor_unit_exponent: m.minor_unit_exponent as number,
      business_date: asIsoDate(m.business_date),
      business_order: m.business_order as number,
    }));
    const { state, lastKnownUnitCost } = replayStreamBefore(
      rows,
      { businessDate, businessOrder },
      currencyCode,
      minorUnitExponent,
    );
    return issueCostQuoteFromStream(state, lastKnownUnitCost, businessDate, businessOrder);
  }

  private async mirrorInventoryConsumed(
    client: Client,
    input: {
      tenantId: string;
      legalEntityId: string;
      warehouseId: string;
      catalogItemId: string;
      quantity: string;
      unit: string;
      dimension: UnitDimension;
      productionBatchId: string;
      inputLineId: string;
      idempotencyKey: string;
      businessDate: string;
      businessTime: string | null;
      businessOrder: number;
      actorId?: string | undefined;
      currencyCode: string;
    },
  ) {
    const occurredAt = new Date().toISOString();
    const idempotencyKey = `fact:${input.idempotencyKey}:consume:${input.inputLineId}`;
    const context = {
      businessGroupId: input.tenantId,
      legalEntityId: input.legalEntityId,
      restaurantLocationId: input.warehouseId,
      warehouseId: input.warehouseId,
      actorId: input.actorId ?? '00000000-0000-4000-8000-000000000099',
      jurisdictionProfileVersionId: '00000000-0000-4000-8000-000000000098',
      valuationCurrencyCode: input.currencyCode,
    };
    const payload = {
      stockItemId: input.catalogItemId,
      warehouseId: input.warehouseId,
      quantity: { value: input.quantity, unit: input.unit, dimension: input.dimension },
      sourcePreparationBatchId: input.productionBatchId,
    };
    const fact = parseOperationalFact({
      factId: randomUUID(),
      factType: OperationalFactType.InventoryConsumed,
      idempotencyKey,
      occurredAt,
      recordedAt: occurredAt,
      position: {
        businessDate: input.businessDate,
        businessTime: input.businessTime ?? undefined,
        businessOrder: input.businessOrder,
      },
      context,
      payload,
    });
    await client.query(
      `INSERT INTO operational_fact_feed (
         fact_id, fact_type, idempotency_key, semantic_fingerprint,
         occurred_at, recorded_at, business_date, business_order, business_time, context, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        fact.factId,
        fact.factType,
        fact.idempotencyKey,
        factSemanticFingerprint(fact),
        fact.occurredAt,
        fact.recordedAt,
        input.businessDate,
        input.businessOrder,
        input.businessTime,
        JSON.stringify(context),
        JSON.stringify(payload),
      ],
    );
  }

  private async mirrorPreparationProduced(
    client: Client,
    input: {
      tenantId: string;
      legalEntityId: string;
      warehouseId: string;
      productionBatchId: string;
      preparationVersionId: string;
      batchCost: { amountMinorUnits: string; currencyCode: string; minorUnitExponent: number };
      actualOutputQuantity: string;
      actualOutputUnit: string;
      actualOutputDimension: UnitDimension;
      idempotencyKey: string;
      businessDate: string;
      businessTime: string | null;
      businessOrder: number;
      totalLoss: boolean;
      actorId?: string | undefined;
    },
  ) {
    const occurredAt = new Date().toISOString();
    const idempotencyKey = input.totalLoss
      ? `fact:${input.idempotencyKey}:total-loss:${input.productionBatchId}`
      : `fact:${input.idempotencyKey}:produced:${input.productionBatchId}`;
    const context = {
      businessGroupId: input.tenantId,
      legalEntityId: input.legalEntityId,
      restaurantLocationId: input.warehouseId,
      warehouseId: input.warehouseId,
      actorId: input.actorId ?? '00000000-0000-4000-8000-000000000099',
      jurisdictionProfileVersionId: '00000000-0000-4000-8000-000000000098',
      valuationCurrencyCode: input.batchCost.currencyCode,
    };
    const payload = {
      preparationSpecVersionId: input.preparationVersionId,
      productionBatchId: input.productionBatchId,
      actualInputCost: {
        amountMinorUnits: input.batchCost.amountMinorUnits,
        currencyCode: input.batchCost.currencyCode,
        minorUnitExponent: input.batchCost.minorUnitExponent,
      },
      actualOutputQuantity: {
        value: input.actualOutputQuantity,
        unit: input.actualOutputUnit,
        dimension: input.actualOutputDimension,
      },
    };
    const fact = parseOperationalFact({
      factId: randomUUID(),
      factType: OperationalFactType.PreparationProduced,
      idempotencyKey,
      occurredAt,
      recordedAt: occurredAt,
      position: {
        businessDate: input.businessDate,
        businessTime: input.businessTime ?? undefined,
        businessOrder: input.businessOrder,
      },
      context,
      payload,
    });
    await client.query(
      `INSERT INTO operational_fact_feed (
         fact_id, fact_type, idempotency_key, semantic_fingerprint,
         occurred_at, recorded_at, business_date, business_order, business_time, context, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        fact.factId,
        fact.factType,
        fact.idempotencyKey,
        factSemanticFingerprint(fact),
        fact.occurredAt,
        fact.recordedAt,
        input.businessDate,
        input.businessOrder,
        input.businessTime,
        JSON.stringify({ ...context, totalLoss: input.totalLoss }),
        JSON.stringify(payload),
      ],
    );
  }

  private async writeAudit(
    client: Client,
    input: {
      tenantId: string;
      actorId?: string | undefined;
      aggregateId: string;
      action: string;
      after: Record<string, unknown>;
      reason?: string | null;
      riskLevel?: string;
    },
  ) {
    await client.query(
      `INSERT INTO audit_record (
         audit_id, tenant_id, actor_id, aggregate_type, aggregate_id,
         action, reason, after_state, risk_level
       ) VALUES ($1,$2,$3,'ProductionBatch',$4,$5,$6,$7::jsonb,$8)`,
      [
        randomUUID(),
        input.tenantId,
        input.actorId ?? null,
        input.aggregateId,
        input.action,
        input.reason ?? null,
        JSON.stringify(input.after),
        input.riskLevel ?? 'NORMAL',
      ],
    );
  }
}

// Re-export for callers that need FinalizedImmutableError from this module path
export { FinalizedImmutableError };
