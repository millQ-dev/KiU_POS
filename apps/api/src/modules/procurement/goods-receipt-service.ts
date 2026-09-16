import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  costQuoteFromStream,
  compareBusinessPosition,
  type CostQuote,
} from '@millq/domain';
import {
  OperationalFactType,
  parseOperationalFact,
  semanticFingerprint as factSemanticFingerprint,
} from '@millq/contracts';
import { rebuildInventoryBalance, lockValuationStream } from '../inventory/rebuild-balance.js';
import { DomainValidationError, IdempotencyConflictError, NotFoundError, PostedImmutableError } from './errors.js';
import { fingerprintFromDraft } from './fingerprint.js';
import {
  assertLineAcquisitionMatches,
  resolveAcceptedBaseQuantity,
  type CatalogItemRow,
  type SupplierPackRow,
} from './quantity.js';
import {
  createDraftSchema,
  updateDraftSchema,
  postCommandSchema,
  type CreateDraftInput,
  type UpdateDraftInput,
  type PostCommandInput,
  type GoodsReceiptLineInput,
} from './types.js';

type Pool = pg.Pool;
type Client = pg.PoolClient;

function asIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
  }
  if (value instanceof Date) {
    // node-pg returns DATE as local-midnight Date; use local calendar parts
    // (UTC getters shift the business date in positive-offset timezones).
    const y = value.getFullYear();
    const m = value.getMonth() + 1;
    const d = value.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  throw new DomainValidationError('INVALID_DATE', `Invalid business date: ${String(value)}`);
}

export class GoodsReceiptService {
  constructor(private readonly pool: Pool) {}

  async createDraft(raw: unknown) {
    const input = createDraftSchema.parse(raw);
    await this.validateBoundary(input.legalEntityId, input.warehouseId, input.tenantId);
    await this.validateValuationCurrency(
      input.legalEntityId,
      input.currencyCode,
      input.minorUnitExponent,
    );
    await this.validateSupplier(input.supplierId, input.tenantId);
    for (const line of input.lines) {
      await this.validateLine(line, input.currencyCode, input.minorUnitExponent, input.tenantId);
    }

    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO goods_receipt (
          goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
          supplier_document_number, currency_code, minor_unit_exponent,
          business_date, business_time, business_order, status, actor_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12)`,
        [
          id,
          input.tenantId,
          input.legalEntityId,
          input.warehouseId,
          input.supplierId,
          input.supplierDocumentNumber,
          input.currencyCode,
          input.minorUnitExponent,
          input.businessDate,
          input.businessTime ?? null,
          input.businessOrder,
          input.actorId ?? null,
        ],
      );
      await this.insertLines(client, id, input.lines);
      await this.writeAudit(client, {
        tenantId: input.tenantId,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        aggregateId: id,
        action: 'GOODS_RECEIPT_DRAFT_CREATED',
        after: { status: 'DRAFT' },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.get(id);
  }

  async updateDraft(id: string, raw: unknown) {
    const input = updateDraftSchema.parse(raw);
    const existing = await this.getRow(id);
    if (!existing) throw new NotFoundError(`Goods receipt ${id} not found`);
    if (existing.status !== 'DRAFT') throw new PostedImmutableError();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE goods_receipt SET
          supplier_document_number = COALESCE($2, supplier_document_number),
          business_date = COALESCE($3, business_date),
          business_time = CASE WHEN $4::boolean THEN $5 ELSE business_time END,
          business_order = COALESCE($6, business_order),
          recorded_at = NOW()
         WHERE goods_receipt_id = $1 AND status = 'DRAFT'`,
        [
          id,
          input.supplierDocumentNumber ?? null,
          input.businessDate ?? null,
          input.businessTime !== undefined,
          input.businessTime === undefined ? null : input.businessTime,
          input.businessOrder ?? null,
        ],
      );
      if (input.lines) {
        for (const line of input.lines) {
          await this.validateLine(
            line,
            existing.currency_code as string,
            existing.minor_unit_exponent as number,
            existing.tenant_id as string,
          );
        }
        await client.query('DELETE FROM goods_receipt_line WHERE goods_receipt_id = $1', [id]);
        await this.insertLines(client, id, input.lines);
      }
      await this.writeAudit(client, {
        tenantId: existing.tenant_id as string,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        aggregateId: id,
        action: 'GOODS_RECEIPT_DRAFT_UPDATED',
        after: { status: 'DRAFT' },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.get(id);
  }

  async validate(id: string) {
    const doc = await this.get(id);
    if (!doc) throw new NotFoundError(`Goods receipt ${id} not found`);
    await this.validateBoundary(doc.legalEntityId, doc.warehouseId, doc.tenantId);
    for (const line of doc.lines) {
      await this.validateLine(line, doc.currencyCode, doc.minorUnitExponent, doc.tenantId);
    }
    return { valid: true as const, goodsReceiptId: id };
  }

  async post(id: string, raw: unknown) {
    const cmd = postCommandSchema.parse(raw);
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError(`Goods receipt ${id} not found`);

    if (existing.status === 'POSTED') {
      if (existing.postIdempotencyKey === cmd.idempotencyKey) {
        const fp = fingerprintFromDraft(
          {
            goodsReceiptId: existing.goodsReceiptId,
            legalEntityId: existing.legalEntityId,
            warehouseId: existing.warehouseId,
            supplierId: existing.supplierId,
            supplierDocumentNumber: existing.supplierDocumentNumber,
            currencyCode: existing.currencyCode,
            minorUnitExponent: existing.minorUnitExponent,
            businessDate: existing.businessDate,
            businessTime: existing.businessTime,
            businessOrder: existing.businessOrder,
          },
          existing.lines,
        );
        if (fp === existing.postSemanticFingerprint) {
          return { status: 'duplicate' as const, receipt: existing };
        }
        throw new IdempotencyConflictError(cmd.idempotencyKey);
      }
      throw new PostedImmutableError('Already POSTED with a different idempotency key');
    }
    if (existing.status !== 'DRAFT') {
      throw new DomainValidationError('INVALID_STATUS', `Cannot post from status ${existing.status}`);
    }

    await this.validate(id);
    const fp = fingerprintFromDraft(
      {
        goodsReceiptId: existing.goodsReceiptId,
        legalEntityId: existing.legalEntityId,
        warehouseId: existing.warehouseId,
        supplierId: existing.supplierId,
        supplierDocumentNumber: existing.supplierDocumentNumber,
        currencyCode: existing.currencyCode,
        minorUnitExponent: existing.minorUnitExponent,
        businessDate: existing.businessDate,
        businessTime: existing.businessTime,
        businessOrder: existing.businessOrder,
      },
      existing.lines,
    );

    // Conflict if same key was used on another document in this legal entity
    const conflict = await this.pool.query(
      `SELECT goods_receipt_id, post_semantic_fingerprint, status FROM goods_receipt
       WHERE legal_entity_id = $1 AND post_idempotency_key = $2`,
      [existing.legalEntityId, cmd.idempotencyKey],
    );
    if (conflict.rowCount && conflict.rows[0]) {
      const row = conflict.rows[0] as {
        goods_receipt_id: string;
        post_semantic_fingerprint: string;
        status: string;
      };
      if (row.goods_receipt_id !== id) {
        throw new IdempotencyConflictError(cmd.idempotencyKey, 'Idempotency key already used by another receipt');
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query(
        `SELECT status FROM goods_receipt WHERE goods_receipt_id = $1 FOR UPDATE`,
        [id],
      );
      if (lock.rows[0]?.status !== 'DRAFT') {
        throw new PostedImmutableError();
      }

      const postedAt = new Date().toISOString();
      await client.query(
        `UPDATE goods_receipt SET
          status = 'POSTED',
          posted_at = $2,
          post_idempotency_key = $3,
          post_semantic_fingerprint = $4,
          actor_id = COALESCE($5, actor_id),
          recorded_at = NOW()
         WHERE goods_receipt_id = $1`,
        [id, postedAt, cmd.idempotencyKey, fp, cmd.actorId ?? null],
      );

      for (const line of existing.lines) {
        const movementId = randomUUID();
        await client.query(
          `INSERT INTO inventory_movement (
            movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
            direction, quantity, base_unit, dimension, acquisition_cost_minor,
            currency_code, minor_unit_exponent, business_date, business_time, business_order,
            source_document_type, source_document_id, source_document_line_id, actor_id,
            cost_certainty, cost_basis
          ) VALUES ($1,$2,$3,$4,$5,'IN',$6,$7,$8,$9,$10,$11,$12,$13,$14,'GoodsReceipt',$15,$16,$17,'FINAL','SUPPLIER_PRICE')`,
          [
            movementId,
            existing.tenantId,
            existing.legalEntityId,
            existing.warehouseId,
            line.catalogItemId,
            line.acceptedBaseQuantity,
            line.baseUnit,
            line.dimension,
            line.lineAcquisitionCostMinor,
            existing.currencyCode,
            existing.minorUnitExponent,
            existing.businessDate,
            existing.businessTime,
            existing.businessOrder,
            id,
            line.goodsReceiptLineId,
            cmd.actorId ?? null,
          ],
        );
      }

      // Replay cost streams for all affected items (chronology-correct)
      const itemIds = [...new Set(existing.lines.map((l) => l.catalogItemId))].sort();
      for (const catalogItemId of itemIds) {
        await lockValuationStream(
          client,
          existing.legalEntityId,
          existing.warehouseId,
          catalogItemId,
          existing.currencyCode,
          existing.minorUnitExponent,
        );
        await this.rebuildBalance(
          client,
          existing.legalEntityId,
          existing.warehouseId,
          catalogItemId,
          existing.currencyCode,
          existing.minorUnitExponent,
        );
      }

      await this.mirrorGoodsReceivedFacts(client, existing, cmd);
      await this.writeAudit(client, {
        tenantId: existing.tenantId,
        ...(cmd.actorId ? { actorId: cmd.actorId } : {}),
        aggregateId: id,
        action: 'GOODS_RECEIPT_POSTED',
        after: { status: 'POSTED', idempotencyKey: cmd.idempotencyKey },
      });

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const posted = await this.get(id);
    return { status: 'created' as const, receipt: posted };
  }

  async reverse(id: string, input: { idempotencyKey: string; actorId?: string; reason?: string }) {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError(`Goods receipt ${id} not found`);
    if (existing.status !== 'POSTED') {
      throw new DomainValidationError('INVALID_STATUS', 'Only POSTED receipts can be reversed');
    }

    const reverseKey = `reverse:${input.idempotencyKey}`;
    const existingReverse = await this.pool.query(
      `SELECT goods_receipt_id FROM goods_receipt WHERE reverses_goods_receipt_id = $1 AND status = 'POSTED'`,
      [id],
    );
    if (existingReverse.rowCount && existingReverse.rowCount > 0) {
      return { status: 'duplicate' as const, receipt: await this.get(id) };
    }

    const reverseId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE goods_receipt SET status = 'REVERSED', reversed_at = NOW(), recorded_at = NOW()
         WHERE goods_receipt_id = $1 AND status = 'POSTED'`,
        [id],
      );
      await client.query(
        `INSERT INTO goods_receipt (
          goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
          supplier_document_number, currency_code, minor_unit_exponent,
          business_date, business_time, business_order, status, actor_id,
          post_idempotency_key, post_semantic_fingerprint, reverses_goods_receipt_id, posted_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'POSTED',$12,$13,$14,$15,NOW())`,
        [
          reverseId,
          existing.tenantId,
          existing.legalEntityId,
          existing.warehouseId,
          existing.supplierId,
          `REV-${existing.supplierDocumentNumber}`,
          existing.currencyCode,
          existing.minorUnitExponent,
          existing.businessDate,
          existing.businessTime,
          existing.businessOrder,
          input.actorId ?? null,
          reverseKey,
          `reverse-of:${id}`,
          id,
        ],
      );

      for (const line of existing.lines) {
        const lineId = randomUUID();
        await client.query(
          `INSERT INTO goods_receipt_line (
            goods_receipt_line_id, goods_receipt_id, line_number, catalog_item_id, supplier_item_id,
            input_kind, package_count, accepted_base_quantity, base_unit, dimension,
            unit_price_minor, line_acquisition_cost_minor
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            lineId,
            reverseId,
            line.lineNumber,
            line.catalogItemId,
            line.supplierItemId,
            line.inputKind,
            line.packageCount,
            line.acceptedBaseQuantity,
            line.baseUnit,
            line.dimension,
            line.unitPriceMinor,
            line.lineAcquisitionCostMinor,
          ],
        );
        await client.query(
          `INSERT INTO inventory_movement (
            movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
            direction, quantity, base_unit, dimension, acquisition_cost_minor,
            currency_code, minor_unit_exponent, business_date, business_time, business_order,
            source_document_type, source_document_id, source_document_line_id, actor_id,
            cost_certainty, cost_basis
          ) VALUES ($1,$2,$3,$4,$5,'OUT',$6,$7,$8,$9,$10,$11,$12,$13,$14,'GoodsReceiptReversal',$15,$16,$17,'FINAL','SUPPLIER_PRICE')`,
          [
            randomUUID(),
            existing.tenantId,
            existing.legalEntityId,
            existing.warehouseId,
            line.catalogItemId,
            line.acceptedBaseQuantity,
            line.baseUnit,
            line.dimension,
            line.lineAcquisitionCostMinor,
            existing.currencyCode,
            existing.minorUnitExponent,
            existing.businessDate,
            existing.businessTime,
            existing.businessOrder,
            reverseId,
            lineId,
            input.actorId ?? null,
          ],
        );
      }

      const itemIds = [...new Set(existing.lines.map((l) => l.catalogItemId))].sort();
      for (const catalogItemId of itemIds) {
        await lockValuationStream(
          client,
          existing.legalEntityId,
          existing.warehouseId,
          catalogItemId,
          existing.currencyCode,
          existing.minorUnitExponent,
        );
        await this.rebuildBalance(
          client,
          existing.legalEntityId,
          existing.warehouseId,
          catalogItemId,
          existing.currencyCode,
          existing.minorUnitExponent,
        );
      }

      await this.writeAudit(client, {
        tenantId: existing.tenantId,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        aggregateId: id,
        action: 'GOODS_RECEIPT_REVERSED',
        ...(input.reason ? { reason: input.reason } : {}),
        after: { status: 'REVERSED', reverseDocumentId: reverseId },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { status: 'created' as const, receipt: await this.get(id), reverseDocumentId: reverseId };
  }

  async getBalance(
    legalEntityId: string,
    warehouseId: string,
    catalogItemId: string,
    currencyCode?: string,
  ) {
    const r = currencyCode
      ? await this.pool.query(
          `SELECT * FROM inventory_balance
           WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3 AND currency_code = $4`,
          [legalEntityId, warehouseId, catalogItemId, currencyCode],
        )
      : await this.pool.query(
          `SELECT * FROM inventory_balance
           WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3`,
          [legalEntityId, warehouseId, catalogItemId],
        );
    if (!r.rowCount) {
      return {
        legalEntityId,
        warehouseId,
        catalogItemId,
        quantity: '0',
        carryingValueMinor: '0',
        carryingCertainty: 'FINAL' as const,
        costQuote: null as CostQuote | null,
      };
    }
    if (!currencyCode && r.rowCount > 1) {
      throw new DomainValidationError(
        'AMBIGUOUS_VALUATION_STREAM',
        'Multiple valuation-currency balances exist; currencyCode is required',
      );
    }
    const row = r.rows[0] as {
      quantity: string;
      carrying_value_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
      carrying_certainty: 'FINAL' | 'ESTIMATED_FROM_LAST_KNOWN' | 'UNKNOWN' | 'ORDER_UNRESOLVED';
    };
    const quote = costQuoteFromStream(
      {
        quantity: row.quantity,
        carryingValueMinor: row.carrying_value_minor,
        currencyCode: row.currency_code,
        minorUnitExponent: row.minor_unit_exponent,
        carryingCertainty: row.carrying_certainty,
      },
      new Date().toISOString().slice(0, 10),
      0,
    );
    return {
      legalEntityId,
      warehouseId,
      catalogItemId,
      quantity: row.quantity,
      carryingValueMinor: row.carrying_value_minor,
      currencyCode: row.currency_code,
      minorUnitExponent: row.minor_unit_exponent,
      carryingCertainty: row.carrying_certainty,
      costQuote: quote,
    };
  }

  async get(id: string) {
    const header = await this.getRow(id);
    if (!header) return null;
    const lines = await this.pool.query(
      `SELECT * FROM goods_receipt_line WHERE goods_receipt_id = $1 ORDER BY line_number`,
      [id],
    );
    return this.mapDoc(header, lines.rows);
  }

  /** Rebuild inventory_balance for a cost stream by replaying movements in business chronology. */
  async rebuildBalance(
    client: Client,
    legalEntityId: string,
    warehouseId: string,
    catalogItemId: string,
    currencyCode: string,
    minorUnitExponent: number,
  ): Promise<void> {
    await rebuildInventoryBalance(
      client,
      legalEntityId,
      warehouseId,
      catalogItemId,
      currencyCode,
      minorUnitExponent,
    );
  }

  private async validateValuationCurrency(
    legalEntityId: string,
    currencyCode: string,
    minorUnitExponent: number,
  ) {
    const r = await this.pool.query<{
      valuation_currency_code: string;
      valuation_minor_unit_exponent: number;
    }>(
      `SELECT valuation_currency_code, valuation_minor_unit_exponent
       FROM legal_entity WHERE legal_entity_id = $1`,
      [legalEntityId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError(`Legal entity not found: ${legalEntityId}`);
    if (
      row.valuation_currency_code !== currencyCode ||
      row.valuation_minor_unit_exponent !== minorUnitExponent
    ) {
      throw new DomainValidationError(
        'VALUATION_CURRENCY_MISMATCH',
        `Request currency ${currencyCode}/${minorUnitExponent} does not match legal entity valuation ${row.valuation_currency_code}/${row.valuation_minor_unit_exponent}`,
      );
    }
  }

  private async mirrorGoodsReceivedFacts(
    client: Client,
    existing: NonNullable<Awaited<ReturnType<GoodsReceiptService['get']>>>,
    cmd: PostCommandInput,
  ) {
    for (const line of existing.lines) {
      const factId = randomUUID();
      // Stable line identity (UUID), not mutable draft lineNumber
      const idempotencyKey = `fact:${cmd.idempotencyKey}:line:${line.goodsReceiptLineId}`;
      const occurredAt = new Date().toISOString();
      const context = {
        businessGroupId: cmd.businessGroupId ?? existing.tenantId,
        legalEntityId: existing.legalEntityId,
        restaurantLocationId: cmd.restaurantLocationId ?? existing.warehouseId,
        warehouseId: existing.warehouseId,
        actorId: cmd.actorId ?? '00000000-0000-4000-8000-000000000099',
        jurisdictionProfileVersionId:
          cmd.jurisdictionProfileVersionId ?? '00000000-0000-4000-8000-000000000098',
        valuationCurrencyCode: existing.currencyCode,
      };
      const payload = {
        stockItemId: line.catalogItemId,
        supplierReceiptId: existing.goodsReceiptId,
        sourceDocumentLineId: line.goodsReceiptLineId,
        acceptedBaseQuantity: {
          value: line.acceptedBaseQuantity,
          unit: line.baseUnit,
          dimension: line.dimension,
        },
        purchasePrice: {
          amountMinor: line.unitPriceMinor,
          currencyCode: existing.currencyCode,
          minorUnitExponent: existing.minorUnitExponent,
        },
      };
      const fact = parseOperationalFact({
        factId,
        factType: OperationalFactType.GoodsReceived,
        idempotencyKey,
        occurredAt,
        recordedAt: occurredAt,
        position: {
          businessDate: existing.businessDate,
          businessTime: existing.businessTime ?? undefined,
          businessOrder: existing.businessOrder,
        },
        context,
        payload,
      });
      const sem = factSemanticFingerprint(fact);
      await client.query(
        `INSERT INTO operational_fact_feed (
          fact_id, fact_type, idempotency_key, semantic_fingerprint,
          occurred_at, recorded_at, business_date, business_order, business_time, context, payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          fact.factId,
          fact.factType,
          fact.idempotencyKey,
          sem,
          fact.occurredAt,
          fact.recordedAt,
          fact.position.businessDate,
          fact.position.businessOrder,
          fact.position.businessTime ?? null,
          JSON.stringify(fact.context),
          JSON.stringify(fact.payload),
        ],
      );
    }
  }

  private async validateBoundary(legalEntityId: string, warehouseId: string, tenantId: string) {
    const r = await this.pool.query(
      `SELECT warehouse_id, legal_entity_id, tenant_id FROM warehouse WHERE warehouse_id = $1`,
      [warehouseId],
    );
    if (!r.rowCount) throw new DomainValidationError('WAREHOUSE_NOT_FOUND', 'Warehouse not found');
    const w = r.rows[0] as { legal_entity_id: string; tenant_id: string };
    if (w.tenant_id !== tenantId) {
      throw new DomainValidationError('TENANT_MISMATCH', 'Warehouse tenant mismatch');
    }
    if (w.legal_entity_id !== legalEntityId) {
      throw new DomainValidationError(
        'LEGAL_ENTITY_WAREHOUSE_MISMATCH',
        'Warehouse does not belong to the Goods Receipt LegalEntity',
      );
    }
  }

  private async validateSupplier(supplierId: string, tenantId: string) {
    const r = await this.pool.query(`SELECT tenant_id FROM supplier WHERE supplier_id = $1`, [supplierId]);
    if (!r.rowCount) throw new DomainValidationError('SUPPLIER_NOT_FOUND', 'Supplier not found');
    if ((r.rows[0] as { tenant_id: string }).tenant_id !== tenantId) {
      throw new DomainValidationError('SUPPLIER_TENANT_MISMATCH', 'Supplier tenant mismatch');
    }
  }

  private async validateLine(
    line: GoodsReceiptLineInput,
    currencyCode: string,
    minorUnitExponent: number,
    tenantId: string,
  ) {
    void currencyCode;
    void minorUnitExponent;
    const item = await this.pool.query(
      `SELECT catalog_item_id, base_unit, dimension, tenant_id FROM catalog_item WHERE catalog_item_id = $1`,
      [line.catalogItemId],
    );
    if (!item.rowCount) throw new DomainValidationError('CATALOG_ITEM_NOT_FOUND', 'Catalog item not found');
    const catalog = item.rows[0] as CatalogItemRow & { tenant_id: string };
    if (catalog.tenant_id !== tenantId) {
      throw new DomainValidationError('CATALOG_TENANT_MISMATCH', 'Catalog item tenant mismatch');
    }

    let pack: SupplierPackRow | null = null;
    if (line.supplierItemId) {
      const si = await this.pool.query(
        `SELECT si.supplier_item_id, si.catalog_item_id, sp.pack_kind, sp.units_per_package,
                sp.unit_quantity, sp.unit, sp.dimension, sp.to_base_unit, sp.factor_per_unit
         FROM supplier_item si
         JOIN supplier_pack sp ON sp.supplier_pack_id = si.supplier_pack_id
         WHERE si.supplier_item_id = $1`,
        [line.supplierItemId],
      );
      if (!si.rowCount) throw new DomainValidationError('SUPPLIER_ITEM_NOT_FOUND', 'SupplierItem not found');
      const row = si.rows[0] as { catalog_item_id: string } & SupplierPackRow;
      if (row.catalog_item_id !== line.catalogItemId) {
        throw new DomainValidationError('SUPPLIER_ITEM_MAPPING', 'SupplierItem does not map to line catalog item');
      }
      pack = row;
    }

    resolveAcceptedBaseQuantity(line, catalog, pack);
    assertLineAcquisitionMatches(line);

    const qty = parseFloat(line.acceptedBaseQuantity);
    if (!(qty > 0)) {
      throw new DomainValidationError('INVALID_QUANTITY', 'Accepted quantity must be positive');
    }
  }

  private async insertLines(client: Client, receiptId: string, lines: GoodsReceiptLineInput[]) {
    for (const line of lines) {
      await client.query(
        `INSERT INTO goods_receipt_line (
          goods_receipt_line_id, goods_receipt_id, line_number, catalog_item_id, supplier_item_id,
          input_kind, package_count, accepted_base_quantity, base_unit, dimension,
          unit_price_minor, line_acquisition_cost_minor
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          receiptId,
          line.lineNumber,
          line.catalogItemId,
          line.supplierItemId ?? null,
          line.inputKind,
          line.packageCount ?? null,
          line.acceptedBaseQuantity,
          line.baseUnit,
          line.dimension,
          line.unitPriceMinor,
          line.lineAcquisitionCostMinor,
        ],
      );
    }
  }

  private async getRow(id: string) {
    const r = await this.pool.query(`SELECT * FROM goods_receipt WHERE goods_receipt_id = $1`, [id]);
    return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  private mapDoc(header: Record<string, unknown>, lines: Record<string, unknown>[]) {
    return {
      goodsReceiptId: header.goods_receipt_id as string,
      tenantId: header.tenant_id as string,
      legalEntityId: header.legal_entity_id as string,
      warehouseId: header.warehouse_id as string,
      supplierId: header.supplier_id as string,
      supplierDocumentNumber: header.supplier_document_number as string,
      currencyCode: header.currency_code as string,
      minorUnitExponent: header.minor_unit_exponent as number,
      businessDate: asIsoDate(header.business_date),
      businessTime: header.business_time ? String(header.business_time).slice(0, 8) : null,
      businessOrder: header.business_order as number,
      status: header.status as string,
      postIdempotencyKey: (header.post_idempotency_key as string | null) ?? null,
      postSemanticFingerprint: (header.post_semantic_fingerprint as string | null) ?? null,
      postedAt: header.posted_at ? String(header.posted_at) : null,
      lines: lines.map((l) => ({
        goodsReceiptLineId: l.goods_receipt_line_id as string,
        lineNumber: l.line_number as number,
        catalogItemId: l.catalog_item_id as string,
        supplierItemId: (l.supplier_item_id as string | null) ?? null,
        inputKind: l.input_kind as GoodsReceiptLineInput['inputKind'],
        packageCount: (l.package_count as number | null) ?? null,
        acceptedBaseQuantity: l.accepted_base_quantity as string,
        baseUnit: l.base_unit as string,
        dimension: l.dimension as GoodsReceiptLineInput['dimension'],
        unitPriceMinor: l.unit_price_minor as string,
        lineAcquisitionCostMinor: l.line_acquisition_cost_minor as string,
      })),
    };
  }

  private async writeAudit(
    client: Client,
    input: {
      tenantId: string;
      actorId?: string;
      aggregateId: string;
      action: string;
      reason?: string;
      before?: unknown;
      after?: unknown;
    },
  ) {
    await client.query(
      `INSERT INTO audit_record (
        audit_id, tenant_id, actor_id, aggregate_type, aggregate_id, action, reason, before_state, after_state, risk_level
      ) VALUES ($1,$2,$3,'GoodsReceipt',$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        input.tenantId,
        input.actorId ?? null,
        input.aggregateId,
        input.action,
        input.reason ?? null,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        input.action.includes('REVERSE') ? 'HIGH' : 'NORMAL',
      ],
    );
  }
}

// re-export compare for tests
export { compareBusinessPosition };
