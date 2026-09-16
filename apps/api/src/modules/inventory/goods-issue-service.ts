import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  OperationalFactType,
  parseOperationalFact,
  semanticFingerprint as factSemanticFingerprint,
} from '@millq/contracts';
import {
  costForQuantity,
  createCostValue,
  issueCostQuoteFromStream,
  normalizeToBaseUnit,
  parseCanonicalDecimal,
  replayStreamBefore,
  toCanonicalDecimal,
  type CostCertainty,
  type UnitDimension,
} from '@millq/domain';
import { lockValuationStream, rebuildInventoryBalance } from '../inventory/rebuild-balance.js';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
} from '../orders/errors.js';
import type {
  SaleGoodsIssueRef,
  SaleGoodsIssueReverseCommand,
  SaleInventoryWriteOffPort,
  SaleWriteOffCommand,
} from '../orders/sale-write-off-port.js';

type Client = pg.PoolClient;
type Pool = pg.Pool;

type GoodsIssueRow = {
  goods_issue_id: string;
  tenant_id: string;
  legal_entity_id: string;
  warehouse_id: string;
  currency_code: string;
  minor_unit_exponent: number;
  source_order_id: string;
  business_date: string | Date;
  business_time: string | null;
  business_order: number;
  post_idempotency_key: string;
  post_semantic_fingerprint: string;
  provenance_hash: string;
  posting_status: 'POSTED' | 'REVERSED';
};

type GoodsIssueReversalRow = {
  goods_issue_reversal_id: string;
  goods_issue_id: string;
  source_order_id: string;
  legal_entity_id: string;
  idempotency_key: string;
  semantic_fingerprint: string;
};

function asIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
  }
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = value.getMonth() + 1;
    const d = value.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  throw new DomainValidationError('INVALID_DATE', `Invalid business date: ${String(value)}`);
}

function goodsIssueFingerprint(command: SaleWriteOffCommand): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        orderId: command.orderId,
        warehouseId: command.warehouseId,
        businessDate: command.businessDate,
        businessTime: command.businessTime ?? null,
        businessOrder: command.businessOrder,
        provenanceHash: command.provenanceHash,
        physicalLeaves: command.physicalLeaves.map((l) => ({
          orderLineId: l.orderLineId,
          catalogItemId: l.catalogItemId,
          quantityBase: l.quantityBase,
          unitBase: l.unitBase,
          dimension: l.dimension,
        })),
      }),
    )
    .digest('hex');
}

function goodsIssueReverseFingerprint(input: {
  goodsIssueId: string;
  orderId: string;
  businessDate: string;
  businessOrder: number;
  businessTime?: string | null;
  reason?: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        goodsIssueId: input.goodsIssueId,
        orderId: input.orderId,
        businessDate: input.businessDate,
        businessOrder: input.businessOrder,
        businessTime: input.businessTime ?? null,
        reason: input.reason ?? null,
      }),
    )
    .digest('hex');
}

/**
 * Inventory-owned sale GoodsIssue posting (ADR-0025 / D1.3B).
 * Consumes frozen ConsumptionPlan physical leaves only — never re-resolves recipes.
 */
export class GoodsIssueService implements SaleInventoryWriteOffPort {
  constructor(private readonly pool: Pool) {}

  async postGoodsIssueFromConsumptionPlan(
    client: unknown,
    command: SaleWriteOffCommand,
  ): Promise<SaleGoodsIssueRef> {
    const tx = client as Client;
    const fp = goodsIssueFingerprint(command);

    const existing = await tx.query<GoodsIssueRow>(
      `SELECT * FROM goods_issue WHERE source_order_id = $1 FOR UPDATE`,
      [command.orderId],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (
        prior.post_idempotency_key === command.idempotencyKey &&
        prior.post_semantic_fingerprint === fp
      ) {
        return { goodsIssueId: prior.goods_issue_id };
      }
      throw new IdempotencyConflictError(
        command.idempotencyKey,
        'Sale GoodsIssue already exists for this order with different key or semantics',
      );
    }

    const keyConflict = await tx.query(
      `SELECT goods_issue_id FROM goods_issue
       WHERE legal_entity_id = $1 AND post_idempotency_key = $2`,
      [command.legalEntityId, command.idempotencyKey],
    );
    if (keyConflict.rows[0]) {
      throw new IdempotencyConflictError(
        command.idempotencyKey,
        'GoodsIssue idempotency key already used in this legal entity',
      );
    }

    const valuation = await this.loadAuthoritativeValuation(tx, command.legalEntityId);
    const goodsIssueId = randomUUID();

    await tx.query(
      `INSERT INTO goods_issue (
         goods_issue_id, tenant_id, legal_entity_id, warehouse_id,
         currency_code, minor_unit_exponent, source_type, source_order_id,
         business_date, business_time, business_order, actor_id, device_id,
         post_idempotency_key, post_semantic_fingerprint, provenance_hash,
         posting_status, posted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'ORDER',$7,$8::date,$9,$10,$11,$12,$13,$14,$15,'POSTED',NOW())`,
      [
        goodsIssueId,
        command.tenantId,
        command.legalEntityId,
        command.warehouseId,
        valuation.currencyCode,
        valuation.minorUnitExponent,
        command.orderId,
        command.businessDate,
        command.businessTime ?? null,
        command.businessOrder,
        command.actorId ?? null,
        command.deviceId ?? null,
        command.idempotencyKey,
        fp,
        command.provenanceHash,
      ],
    );

    const touched = new Set<string>();

    // Aggregate same catalog item into one OUT at the sale business position so rebuild
    // does not treat sibling leaves as ORDER_UNRESOLVED chronology conflicts (ADR-0003).
    // Evidence lines remain one-per-leaf and share the aggregated movement id.
    type AggLeaf = {
      catalogItemId: string;
      quantityBase: string;
      unitBase: string;
      dimension: UnitDimension;
      leaves: SaleWriteOffCommand['physicalLeaves'];
    };
    const aggregated = new Map<string, AggLeaf>();
    for (const leaf of command.physicalLeaves) {
      const catalog = await this.loadCatalogItem(tx, command.tenantId, leaf.catalogItemId);
      if (catalog.dimension !== leaf.dimension) {
        throw new DomainValidationError(
          'DIMENSION_MISMATCH',
          `Leaf dimension ${leaf.dimension} does not match catalog ${catalog.dimension}`,
        );
      }
      const qtyInCatalogBase = this.toCatalogBaseQuantity(
        leaf.quantityBase,
        leaf.unitBase,
        leaf.dimension as UnitDimension,
        catalog.base_unit,
      );
      const existing = aggregated.get(leaf.catalogItemId);
      if (existing) {
        existing.quantityBase = toCanonicalDecimal(
          parseCanonicalDecimal(existing.quantityBase).plus(parseCanonicalDecimal(qtyInCatalogBase)),
        );
        existing.leaves = [...existing.leaves, leaf];
      } else {
        aggregated.set(leaf.catalogItemId, {
          catalogItemId: leaf.catalogItemId,
          quantityBase: qtyInCatalogBase,
          unitBase: catalog.base_unit,
          dimension: catalog.dimension,
          leaves: [leaf],
        });
      }
    }

    // Deterministic processing order (deadlock-safe with sorted stream locks later).
    const groups = [...aggregated.values()].sort((a, b) =>
      a.catalogItemId.localeCompare(b.catalogItemId),
    );

    let lineNumber = 0;
    for (const group of groups) {
      const catalog = await this.loadCatalogItem(tx, command.tenantId, group.catalogItemId);
      const quote = await this.quoteIssueCost(
        tx,
        command.legalEntityId,
        command.warehouseId,
        group.catalogItemId,
        valuation.currencyCode,
        valuation.minorUnitExponent,
        command.businessDate,
        command.businessOrder,
      );
      const lineCost = costForQuantity(
        createCostValue(quote.amountMinorUnits, quote.currencyCode, quote.minorUnitExponent),
        group.quantityBase,
      );

      const movementId = randomUUID();
      await tx.query(
        `INSERT INTO inventory_movement (
           movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
           direction, quantity, base_unit, dimension, acquisition_cost_minor,
           currency_code, minor_unit_exponent, business_date, business_time, business_order,
           source_document_type, source_document_id, source_document_line_id, actor_id,
           cost_certainty, cost_basis
         ) VALUES ($1,$2,$3,$4,$5,'OUT',$6,$7,$8,$9,$10,$11,$12::date,$13,$14,'GoodsIssue',$15,$16,$17,$18,$19)`,
        [
          movementId,
          command.tenantId,
          command.legalEntityId,
          command.warehouseId,
          group.catalogItemId,
          group.quantityBase,
          catalog.base_unit,
          catalog.dimension,
          lineCost.amountMinorUnits,
          valuation.currencyCode,
          valuation.minorUnitExponent,
          command.businessDate,
          command.businessTime ?? null,
          command.businessOrder,
          goodsIssueId,
          null,
          command.actorId ?? null,
          quote.certainty,
          quote.basis,
        ],
      );
      touched.add(group.catalogItemId);

      // Allocate line cost proportionally across evidence leaves for historical COGS-ready rows.
      const groupQty = parseCanonicalDecimal(group.quantityBase);
      if (groupQty.lte(0)) {
        throw new DomainValidationError(
          'NON_POSITIVE_ISSUE_QTY',
          `Aggregated issue quantity for ${group.catalogItemId} must be positive`,
        );
      }
      let allocated = parseCanonicalDecimal('0');
      for (let i = 0; i < group.leaves.length; i++) {
        const leaf = group.leaves[i]!;
        const leafQty = this.toCatalogBaseQuantity(
          leaf.quantityBase,
          leaf.unitBase,
          leaf.dimension as UnitDimension,
          catalog.base_unit,
        );
        const leafQtyDec = parseCanonicalDecimal(leafQty);
        const leafCost =
          i === group.leaves.length - 1
            ? toCanonicalDecimal(parseCanonicalDecimal(lineCost.amountMinorUnits).minus(allocated))
            : toCanonicalDecimal(
                parseCanonicalDecimal(lineCost.amountMinorUnits).times(leafQtyDec).div(groupQty),
              );
        if (i < group.leaves.length - 1) {
          allocated = allocated.plus(parseCanonicalDecimal(leafCost));
        }

        lineNumber += 1;
        const lineId = randomUUID();
        await tx.query(
          `INSERT INTO goods_issue_line (
             goods_issue_line_id, goods_issue_id, line_number, order_line_id,
             catalog_item_id, quantity_base, unit_base, dimension,
             issue_cost_minor, cost_certainty, cost_basis, inventory_movement_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            lineId,
            goodsIssueId,
            lineNumber,
            leaf.orderLineId,
            leaf.catalogItemId,
            leafQty,
            catalog.base_unit,
            catalog.dimension,
            leafCost,
            quote.certainty,
            quote.basis,
            movementId,
          ],
        );

        await this.mirrorInventoryConsumed(tx, {
          tenantId: command.tenantId,
          legalEntityId: command.legalEntityId,
          warehouseId: command.warehouseId,
          catalogItemId: leaf.catalogItemId,
          quantity: leafQty,
          unit: catalog.base_unit,
          dimension: catalog.dimension,
          orderId: command.orderId,
          goodsIssueLineId: lineId,
          idempotencyKey: command.idempotencyKey,
          businessDate: command.businessDate,
          businessTime: command.businessTime ?? null,
          businessOrder: command.businessOrder,
          actorId: command.actorId ?? null,
          currencyCode: valuation.currencyCode,
        });
      }
    }

    for (const catalogItemId of [...touched].sort()) {
      await lockValuationStream(
        tx,
        command.legalEntityId,
        command.warehouseId,
        catalogItemId,
        valuation.currencyCode,
        valuation.minorUnitExponent,
      );
      await rebuildInventoryBalance(
        tx,
        command.legalEntityId,
        command.warehouseId,
        catalogItemId,
        valuation.currencyCode,
        valuation.minorUnitExponent,
      );
    }

    return { goodsIssueId };
  }

  /**
   * Reverse a POSTED sale GoodsIssue inside the caller's transaction.
   * Creates dedicated goods_issue_reversal + compensating IN movements.
   */
  async reverseGoodsIssueFromOrder(
    client: unknown,
    input: SaleGoodsIssueReverseCommand,
  ): Promise<{ goodsIssueReversalId: string }> {
    const tx = client as Client;
    const locked = await tx.query<GoodsIssueRow>(
      `SELECT * FROM goods_issue WHERE goods_issue_id = $1 FOR UPDATE`,
      [input.goodsIssueId],
    );
    const gi = locked.rows[0];
    if (!gi) throw new NotFoundError(`GoodsIssue not found: ${input.goodsIssueId}`);
    if (gi.source_order_id !== input.orderId) {
      throw new DomainValidationError(
        'GOODS_ISSUE_ORDER_MISMATCH',
        'GoodsIssue does not belong to the given order',
      );
    }

    const fp = goodsIssueReverseFingerprint({
      goodsIssueId: input.goodsIssueId,
      orderId: input.orderId,
      businessDate: input.businessDate,
      businessOrder: input.businessOrder,
      businessTime: input.businessTime ?? null,
      reason: input.reason ?? null,
    });

    const existingReversal = await tx.query<GoodsIssueReversalRow>(
      `SELECT * FROM goods_issue_reversal WHERE goods_issue_id = $1 FOR UPDATE`,
      [input.goodsIssueId],
    );
    const prior = existingReversal.rows[0];
    if (prior) {
      if (prior.idempotency_key === input.idempotencyKey && prior.semantic_fingerprint === fp) {
        return { goodsIssueReversalId: prior.goods_issue_reversal_id };
      }
      if (prior.idempotency_key === input.idempotencyKey) {
        throw new IdempotencyConflictError(
          input.idempotencyKey,
          'GoodsIssue already reversed with a different semantic fingerprint',
        );
      }
      throw new DomainValidationError('ALREADY_REVERSED', 'GoodsIssue is already REVERSED');
    }

    if (gi.posting_status === 'REVERSED') {
      throw new DomainValidationError('ALREADY_REVERSED', 'GoodsIssue is already REVERSED');
    }
    if (gi.posting_status !== 'POSTED') {
      throw new DomainValidationError('INVALID_STATUS', 'Only POSTED GoodsIssue can be reversed');
    }

    const keyConflict = await tx.query(
      `SELECT goods_issue_reversal_id FROM goods_issue_reversal
       WHERE legal_entity_id = $1 AND idempotency_key = $2`,
      [input.legalEntityId, input.idempotencyKey],
    );
    if (keyConflict.rows[0]) {
      throw new IdempotencyConflictError(
        input.idempotencyKey,
        'GoodsIssue reversal idempotency key already used in this legal entity',
      );
    }

    // Guard: never reverse a reversal document as if it were a sale GoodsIssue
    const asReversalDoc = await tx.query(
      `SELECT 1 FROM goods_issue_reversal WHERE goods_issue_reversal_id = $1`,
      [input.goodsIssueId],
    );
    if (asReversalDoc.rowCount && asReversalDoc.rowCount > 0) {
      throw new DomainValidationError(
        'INVALID',
        'Cannot reverse a GoodsIssueReversal as if it were a GoodsIssue',
      );
    }

    const movements = await tx.query<{
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
      cost_certainty: CostCertainty;
      cost_basis: string;
    }>(
      `SELECT catalog_item_id, direction, quantity, base_unit, dimension,
              acquisition_cost_minor, currency_code, minor_unit_exponent,
              business_date, business_time, business_order, source_document_line_id,
              cost_certainty, cost_basis
       FROM inventory_movement
       WHERE source_document_type = 'GoodsIssue' AND source_document_id = $1
       ORDER BY business_date ASC, business_order ASC`,
      [input.goodsIssueId],
    );

    const reversalId = randomUUID();
    await tx.query(
      `INSERT INTO goods_issue_reversal (
         goods_issue_reversal_id, tenant_id, goods_issue_id, source_order_id,
         legal_entity_id, warehouse_id, idempotency_key, semantic_fingerprint,
         business_date, business_time, business_order,
         reason, actor_id, device_id, reversed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,NOW())`,
      [
        reversalId,
        input.tenantId,
        input.goodsIssueId,
        input.orderId,
        input.legalEntityId,
        gi.warehouse_id,
        input.idempotencyKey,
        fp,
        input.businessDate,
        input.businessTime ?? null,
        input.businessOrder,
        input.reason ?? null,
        input.actorId ?? null,
        input.deviceId ?? null,
      ],
    );

    await tx.query(
      `UPDATE goods_issue SET posting_status = 'REVERSED', reversed_at = NOW()
       WHERE goods_issue_id = $1 AND posting_status = 'POSTED'`,
      [input.goodsIssueId],
    );

    const touched = new Set<string>();
    for (const m of movements.rows) {
      const compensateDirection = m.direction === 'IN' ? 'OUT' : 'IN';
      await tx.query(
        `INSERT INTO inventory_movement (
           movement_id, tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
           direction, quantity, base_unit, dimension, acquisition_cost_minor,
           currency_code, minor_unit_exponent, business_date, business_time, business_order,
           source_document_type, source_document_id, source_document_line_id, actor_id,
           cost_certainty, cost_basis
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,$15,'GoodsIssueReversal',$16,$17,$18,$19,$20)`,
        [
          randomUUID(),
          input.tenantId,
          input.legalEntityId,
          gi.warehouse_id,
          m.catalog_item_id,
          compensateDirection,
          m.quantity,
          m.base_unit,
          m.dimension,
          m.acquisition_cost_minor,
          m.currency_code,
          m.minor_unit_exponent,
          input.businessDate,
          input.businessTime ?? null,
          input.businessOrder,
          reversalId,
          m.source_document_line_id,
          input.actorId ?? null,
          m.cost_certainty,
          m.cost_basis,
        ],
      );
      touched.add(m.catalog_item_id);
    }

    for (const catalogItemId of [...touched].sort()) {
      await lockValuationStream(
        tx,
        input.legalEntityId,
        gi.warehouse_id,
        catalogItemId,
        gi.currency_code,
        gi.minor_unit_exponent,
      );
      await rebuildInventoryBalance(
        tx,
        input.legalEntityId,
        gi.warehouse_id,
        catalogItemId,
        gi.currency_code,
        gi.minor_unit_exponent,
      );
    }

    return { goodsIssueReversalId: reversalId };
  }

  private async loadAuthoritativeValuation(client: Client, legalEntityId: string) {
    const r = await client.query<{
      valuation_currency_code: string;
      valuation_minor_unit_exponent: number;
    }>(
      `SELECT valuation_currency_code, valuation_minor_unit_exponent
       FROM legal_entity WHERE legal_entity_id = $1`,
      [legalEntityId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError(`Legal entity not found: ${legalEntityId}`);
    return {
      currencyCode: row.valuation_currency_code,
      minorUnitExponent: row.valuation_minor_unit_exponent,
    };
  }

  private async loadCatalogItem(client: Client, tenantId: string, catalogItemId: string) {
    const r = await client.query<{
      catalog_item_id: string;
      tenant_id: string;
      base_unit: string;
      dimension: UnitDimension;
    }>(
      `SELECT catalog_item_id, tenant_id, base_unit, dimension::text AS dimension
       FROM catalog_item WHERE catalog_item_id = $1`,
      [catalogItemId],
    );
    const row = r.rows[0];
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
              business_date, business_order, source_document_type, cost_certainty
       FROM inventory_movement
       WHERE legal_entity_id = $1
         AND warehouse_id = $2
         AND catalog_item_id = $3
         AND currency_code = $4
         AND minor_unit_exponent = $5
       ORDER BY business_date ASC, business_order ASC`,
      [legalEntityId, warehouseId, catalogItemId, currencyCode, minorUnitExponent],
    );
    const rows = movements.rows.map((m) => ({
      direction: m.direction as 'IN' | 'OUT',
      quantity: m.quantity as string,
      acquisition_cost_minor: m.acquisition_cost_minor as string,
      currency_code: m.currency_code as string,
      minor_unit_exponent: m.minor_unit_exponent as number,
      business_date: asIsoDate(m.business_date),
      business_order: m.business_order as number,
      source_document_type: m.source_document_type as string,
      cost_certainty: m.cost_certainty as CostCertainty,
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
      orderId: string;
      goodsIssueLineId: string;
      idempotencyKey: string;
      businessDate: string;
      businessTime: string | null;
      businessOrder: number;
      actorId?: string | null;
      currencyCode: string;
    },
  ) {
    const occurredAt = new Date().toISOString();
    const idempotencyKey = `fact:${input.legalEntityId}:${input.idempotencyKey}:consume:${input.goodsIssueLineId}`;
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
      sourceOrderId: input.orderId,
    };
    const fact = parseOperationalFact({
      factId: randomUUID(),
      factType: OperationalFactType.InventoryConsumed,
      idempotencyKey,
      occurredAt,
      recordedAt: occurredAt,
      position: {
        businessDate: input.businessDate,
        ...(input.businessTime ? { businessTime: input.businessTime } : {}),
        businessOrder: input.businessOrder,
      },
      context,
      payload,
    });
    await client.query(
      `INSERT INTO operational_fact_feed (
         fact_id, fact_type, idempotency_key, semantic_fingerprint,
         occurred_at, recorded_at, business_date, business_order, business_time, context, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb,$11::jsonb)
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
        JSON.stringify(fact.context),
        JSON.stringify(fact.payload),
      ],
    );
  }
}
