import type pg from 'pg';
import {
  mergeReportingCertainty,
  parseCanonicalDecimal,
  toCanonicalDecimal,
  type CostBasis,
  type CostCertainty,
} from '@millq/domain';
import { DomainValidationError } from '../orders/errors.js';
import {
  actualCogsQuerySchema,
  type ActualCogsAggregate,
  type ActualCogsEffect,
  type ActualCogsPhysicalEffect,
  type ActualCogsQuery,
} from './actual-cogs-types.js';

type Pool = pg.Pool;

type LineEffectRow = {
  effect_type: 'SALE' | 'REVERSAL';
  tenant_id: string;
  legal_entity_id: string;
  outlet_id: string;
  warehouse_id: string;
  order_id: string;
  order_line_id: string;
  sold_catalog_item_id: string;
  physical_catalog_item_id: string;
  goods_issue_id: string;
  goods_issue_line_id: string;
  inventory_movement_id: string;
  goods_issue_reversal_id: string | null;
  business_date: string | Date;
  business_order: number;
  business_time: string | null;
  quantity_base: string;
  unit_base: string;
  dimension: string;
  issue_cost_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
  cost_certainty: CostCertainty;
  cost_basis: CostBasis;
  channel: string;
};

type PhysicalEffectRow = {
  effect_type: 'SALE' | 'REVERSAL';
  tenant_id: string;
  legal_entity_id: string;
  outlet_id: string;
  warehouse_id: string;
  order_id: string;
  physical_catalog_item_id: string;
  goods_issue_id: string;
  inventory_movement_id: string;
  goods_issue_reversal_id: string | null;
  business_date: string | Date;
  business_order: number;
  business_time: string | null;
  quantity: string;
  base_unit: string;
  dimension: string;
  acquisition_cost_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
  cost_certainty: CostCertainty;
  cost_basis: CostBasis;
};

function asIsoDate(value: string | Date): string {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function negateMinor(amount: string): string {
  return toCanonicalDecimal(parseCanonicalDecimal(amount).neg());
}

function negateQty(qty: string): string {
  return toCanonicalDecimal(parseCanonicalDecimal(qty).neg());
}

/**
 * Reporting-owned Actual COGS read model (ADR-0026 / ADR-0027).
 * Pure query over Orders + Inventory historical facts — no mutation, no second ledger.
 */
export class ActualCogsService {
  constructor(private readonly pool: Pool) {}

  /**
   * Evidence-line grain: one effect per goods_issue_line (SALE) and compensating
   * negative effect per line when reversed (REVERSAL at reversal chronology).
   * Uses allocated issue_cost_minor — safe for Order / OrderLine / sold-item aggregates.
   */
  async listLineEffects(raw: unknown): Promise<ActualCogsEffect[]> {
    const q = actualCogsQuerySchema.parse(raw);
    const { sql, params } = this.buildLineEffectsSql(q);
    const res = await this.pool.query<LineEffectRow>(sql, params);
    const rows = res.rows.filter((r) => (q.channel ? r.channel === q.channel : true));
    const mapped = rows.map((r) => this.mapLineEffect(r));
    const elevated = this.applyUnresolvedChronologyLine(mapped);
    return elevated.filter((e) => (q.certainty ? e.costCertainty === q.certainty : true));
  }

  /**
   * Physical-movement grain: each unique inventory_movement_id counted once
   * (SALE OUT + REVERSAL compensating IN). Never join-multiply movement cost.
   */
  async listPhysicalEffects(raw: unknown): Promise<ActualCogsPhysicalEffect[]> {
    const q = actualCogsQuerySchema.parse(raw);
    const { sql, params } = this.buildPhysicalEffectsSql(q);
    const res = await this.pool.query<PhysicalEffectRow>(sql, params);
    const mapped = res.rows.map((r) => this.mapPhysicalEffect(r));
    const elevated = this.applyUnresolvedChronologyPhysical(mapped);
    return elevated.filter((e) => (q.certainty ? e.costCertainty === q.certainty : true));
  }

  /** Aggregate at evidence-line grain (sold/order reporting). */
  async aggregateByLine(raw: unknown): Promise<ActualCogsAggregate> {
    const effects = await this.listLineEffects(raw);
    return this.aggregateEffects(
      effects.map((e) => ({
        signedActualCogsMinor: e.signedActualCogsMinor,
        costCertainty: e.costCertainty,
        currencyCode: e.currencyCode,
        minorUnitExponent: e.minorUnitExponent,
      })),
    );
  }

  /** Aggregate at physical-movement grain (no double-count of shared movements). */
  async aggregateByPhysicalMovement(raw: unknown): Promise<ActualCogsAggregate> {
    const effects = await this.listPhysicalEffects(raw);
    return this.aggregateEffects(
      effects.map((e) => ({
        signedActualCogsMinor: e.signedActualCogsMinor,
        costCertainty: e.costCertainty,
        currencyCode: e.currencyCode,
        minorUnitExponent: e.minorUnitExponent,
      })),
    );
  }

  /**
   * Food Cost Ratio is explicitly unavailable in D1.4A (ADR-0026).
   * Do not invent a revenue denominator.
   */
  foodCostRatioUnavailable(): never {
    throw new DomainValidationError(
      'FOOD_COST_RATIO_UNAVAILABLE',
      'Food Cost Ratio / Revenue Basis are out of scope for D1.4A (ADR-0026)',
    );
  }

  /**
   * ADR-0003 / ADR-0026: unrelated independent documents at the same business
   * position cannot be ordered → report ORDER_UNRESOLVED (do not present as exact).
   * Linked primary SALE + its GoodsIssueReversal at the same position stay ordered.
   */
  private unresolvedPositionKeys(
    effects: ReadonlyArray<{
      warehouseId: string;
      physicalCatalogItemId: string;
      currencyCode: string;
      businessDate: string;
      businessOrder: number;
      goodsIssueId: string;
    }>,
  ): Set<string> {
    const byPos = new Map<string, Set<string>>();
    for (const e of effects) {
      const key = `${e.warehouseId}|${e.physicalCatalogItemId}|${e.currencyCode}|${e.businessDate}|${e.businessOrder}`;
      let issues = byPos.get(key);
      if (!issues) {
        issues = new Set();
        byPos.set(key, issues);
      }
      issues.add(e.goodsIssueId);
    }
    const unresolved = new Set<string>();
    for (const [key, issues] of byPos) {
      if (issues.size > 1) unresolved.add(key);
    }
    return unresolved;
  }

  private applyUnresolvedChronologyLine(effects: ActualCogsEffect[]): ActualCogsEffect[] {
    const unresolved = this.unresolvedPositionKeys(effects);
    if (unresolved.size === 0) return effects;
    return effects.map((e) => {
      const key = `${e.warehouseId}|${e.physicalCatalogItemId}|${e.currencyCode}|${e.businessDate}|${e.businessOrder}`;
      if (!unresolved.has(key) || e.costCertainty === 'ORDER_UNRESOLVED') return e;
      return { ...e, costCertainty: 'ORDER_UNRESOLVED' };
    });
  }

  private applyUnresolvedChronologyPhysical(
    effects: ActualCogsPhysicalEffect[],
  ): ActualCogsPhysicalEffect[] {
    const unresolved = this.unresolvedPositionKeys(effects);
    if (unresolved.size === 0) return effects;
    return effects.map((e) => {
      const key = `${e.warehouseId}|${e.physicalCatalogItemId}|${e.currencyCode}|${e.businessDate}|${e.businessOrder}`;
      if (!unresolved.has(key) || e.costCertainty === 'ORDER_UNRESOLVED') return e;
      return { ...e, costCertainty: 'ORDER_UNRESOLVED' };
    });
  }

  aggregateEffects(
    components: ReadonlyArray<{
      signedActualCogsMinor: string | null;
      costCertainty: CostCertainty;
      currencyCode: string;
      minorUnitExponent: number;
    }>,
  ): ActualCogsAggregate {
    if (components.length === 0) {
      return {
        currencyCode: 'VND',
        minorUnitExponent: 0,
        actualCogsMinor: '0',
        knownSubtotalMinor: '0',
        certainty: 'FINAL',
        componentCount: 0,
        finalComponentCount: 0,
        estimatedComponentCount: 0,
        unknownComponentCount: 0,
        unresolvedComponentCount: 0,
      };
    }

    const currencies = new Set(components.map((c) => `${c.currencyCode}:${c.minorUnitExponent}`));
    if (currencies.size > 1) {
      throw new DomainValidationError(
        'MULTI_CURRENCY_NOT_AGGREGATABLE',
        'Actual COGS aggregate cannot silently mix valuation currencies',
      );
    }
    const first = components[0]!;
    let certainty: CostCertainty = 'FINAL';
    let known = parseCanonicalDecimal('0');
    let finalCount = 0;
    let estimatedCount = 0;
    let unknownCount = 0;
    let unresolvedCount = 0;

    for (const c of components) {
      certainty = mergeReportingCertainty(certainty, c.costCertainty);
      if (c.costCertainty === 'FINAL') finalCount += 1;
      else if (c.costCertainty === 'ESTIMATED_FROM_LAST_KNOWN') estimatedCount += 1;
      else if (c.costCertainty === 'UNKNOWN') unknownCount += 1;
      else unresolvedCount += 1;

      if (
        c.signedActualCogsMinor !== null &&
        (c.costCertainty === 'FINAL' || c.costCertainty === 'ESTIMATED_FROM_LAST_KNOWN')
      ) {
        known = known.plus(parseCanonicalDecimal(c.signedActualCogsMinor));
      }
    }

    const knownSubtotalMinor = toCanonicalDecimal(known);
    const exactAllowed = unknownCount === 0 && unresolvedCount === 0;
    let actualCogsMinor: string | null = null;
    if (exactAllowed) {
      let total = parseCanonicalDecimal('0');
      let ok = true;
      for (const c of components) {
        if (c.signedActualCogsMinor === null) {
          ok = false;
          break;
        }
        total = total.plus(parseCanonicalDecimal(c.signedActualCogsMinor));
      }
      actualCogsMinor = ok ? toCanonicalDecimal(total) : null;
    }

    return {
      currencyCode: first.currencyCode,
      minorUnitExponent: first.minorUnitExponent,
      actualCogsMinor,
      knownSubtotalMinor,
      certainty,
      componentCount: components.length,
      finalComponentCount: finalCount,
      estimatedComponentCount: estimatedCount,
      unknownComponentCount: unknownCount,
      unresolvedComponentCount: unresolvedCount,
    };
  }

  private mapLineEffect(r: LineEffectRow): ActualCogsEffect {
    const isReversal = r.effect_type === 'REVERSAL';
    const amount = isReversal ? negateMinor(r.issue_cost_minor) : r.issue_cost_minor;
    const qty = isReversal ? negateQty(r.quantity_base) : r.quantity_base;
    // UNKNOWN / ORDER_UNRESOLVED still carry signed amount for knownSubtotal filtering;
    // aggregate() nulls exact total when these certainties appear.
    return {
      effectType: r.effect_type,
      tenantId: r.tenant_id,
      legalEntityId: r.legal_entity_id,
      outletId: r.outlet_id,
      warehouseId: r.warehouse_id,
      orderId: r.order_id,
      orderLineId: r.order_line_id,
      soldCatalogItemId: r.sold_catalog_item_id,
      physicalCatalogItemId: r.physical_catalog_item_id,
      goodsIssueId: r.goods_issue_id,
      goodsIssueLineId: r.goods_issue_line_id,
      inventoryMovementId: r.inventory_movement_id,
      goodsIssueReversalId: r.goods_issue_reversal_id,
      businessDate: asIsoDate(r.business_date),
      businessOrder: r.business_order,
      businessTime: r.business_time,
      signedQuantity: qty,
      unit: r.unit_base,
      dimension: r.dimension,
      signedActualCogsMinor: amount,
      currencyCode: r.currency_code,
      minorUnitExponent: r.minor_unit_exponent,
      costCertainty: r.cost_certainty,
      costBasis: r.cost_basis,
    };
  }

  private mapPhysicalEffect(r: PhysicalEffectRow): ActualCogsPhysicalEffect {
    const isReversal = r.effect_type === 'REVERSAL';
    // SALE OUT: positive COGS; REVERSAL IN movement stores positive acquisition_cost of original —
    // report as negative compensating COGS.
    const amount = isReversal
      ? negateMinor(r.acquisition_cost_minor)
      : r.acquisition_cost_minor;
    const qty = isReversal ? negateQty(r.quantity) : r.quantity;
    return {
      effectType: r.effect_type,
      tenantId: r.tenant_id,
      legalEntityId: r.legal_entity_id,
      outletId: r.outlet_id,
      warehouseId: r.warehouse_id,
      orderId: r.order_id,
      physicalCatalogItemId: r.physical_catalog_item_id,
      goodsIssueId: r.goods_issue_id,
      inventoryMovementId: r.inventory_movement_id,
      goodsIssueReversalId: r.goods_issue_reversal_id,
      businessDate: asIsoDate(r.business_date),
      businessOrder: r.business_order,
      businessTime: r.business_time,
      signedQuantity: qty,
      unit: r.base_unit,
      dimension: r.dimension,
      signedActualCogsMinor: amount,
      currencyCode: r.currency_code,
      minorUnitExponent: r.minor_unit_exponent,
      costCertainty: r.cost_certainty,
      costBasis: r.cost_basis,
    };
  }

  private buildLineEffectsSql(q: ActualCogsQuery): { sql: string; params: unknown[] } {
    const params: unknown[] = [q.tenantId];
    let p = 2;
    const filters: string[] = ['gi.tenant_id = $1'];

    const add = (clause: string, value: unknown) => {
      filters.push(clause.replace('?', `$${p}`));
      params.push(value);
      p += 1;
    };

    if (q.legalEntityId) add('gi.legal_entity_id = ?', q.legalEntityId);
    if (q.outletId) add('so.outlet_id = ?', q.outletId);
    if (q.warehouseId) add('gi.warehouse_id = ?', q.warehouseId);
    if (q.orderId) add('gi.source_order_id = ?', q.orderId);
    if (q.orderLineId) add('gil.order_line_id = ?', q.orderLineId);
    if (q.soldCatalogItemId) add('sol.catalog_item_id = ?', q.soldCatalogItemId);
    if (q.physicalCatalogItemId) add('gil.catalog_item_id = ?', q.physicalCatalogItemId);
    if (q.currencyCode) add('gi.currency_code = ?', q.currencyCode);
    if (q.businessDate) {
      // Applied per-effect in HAVING-style via outer filter on effect business date — see dateFilterExpr
    }
    if (q.businessDateFrom) {
      /* applied below on effect dates */
    }
    if (q.businessDateTo) {
      /* applied below */
    }

    const saleDateFilters: string[] = [...filters];
    const revDateFilters: string[] = [...filters];
    if (q.businessDate) {
      saleDateFilters.push(`gi.business_date = $${p}::date`);
      revDateFilters.push(`gir.business_date = $${p}::date`);
      params.push(q.businessDate);
      p += 1;
    }
    if (q.businessDateFrom) {
      saleDateFilters.push(`gi.business_date >= $${p}::date`);
      revDateFilters.push(`gir.business_date >= $${p}::date`);
      params.push(q.businessDateFrom);
      p += 1;
    }
    if (q.businessDateTo) {
      saleDateFilters.push(`gi.business_date <= $${p}::date`);
      revDateFilters.push(`gir.business_date <= $${p}::date`);
      params.push(q.businessDateTo);
      p += 1;
    }

    const saleWhere = saleDateFilters.join(' AND ');
    const revWhere = revDateFilters.join(' AND ');

    const sql = `
WITH sale_effects AS (
  SELECT
    'SALE'::text AS effect_type,
    gi.tenant_id, gi.legal_entity_id, so.outlet_id, gi.warehouse_id,
    gi.source_order_id AS order_id, gil.order_line_id,
    sol.catalog_item_id AS sold_catalog_item_id,
    gil.catalog_item_id AS physical_catalog_item_id,
    gil.goods_issue_id, gil.goods_issue_line_id, gil.inventory_movement_id,
    NULL::uuid AS goods_issue_reversal_id,
    gi.business_date, gi.business_order, gi.business_time,
    gil.quantity_base, gil.unit_base, gil.dimension::text AS dimension,
    gil.issue_cost_minor, gi.currency_code, gi.minor_unit_exponent,
    gil.cost_certainty, gil.cost_basis, so.channel
  FROM goods_issue_line gil
  JOIN goods_issue gi ON gi.goods_issue_id = gil.goods_issue_id
  JOIN sales_order so ON so.order_id = gi.source_order_id
  JOIN sales_order_line sol ON sol.order_line_id = gil.order_line_id
  WHERE ${saleWhere}
    AND gil.inventory_movement_id IS NOT NULL
),
reversal_effects AS (
  SELECT
    'REVERSAL'::text AS effect_type,
    gi.tenant_id, gi.legal_entity_id, so.outlet_id, gi.warehouse_id,
    gi.source_order_id AS order_id, gil.order_line_id,
    sol.catalog_item_id AS sold_catalog_item_id,
    gil.catalog_item_id AS physical_catalog_item_id,
    gil.goods_issue_id, gil.goods_issue_line_id, gil.inventory_movement_id,
    gir.goods_issue_reversal_id,
    gir.business_date, gir.business_order, gir.business_time,
    gil.quantity_base, gil.unit_base, gil.dimension::text AS dimension,
    gil.issue_cost_minor, gi.currency_code, gi.minor_unit_exponent,
    gil.cost_certainty, gil.cost_basis, so.channel
  FROM goods_issue_reversal gir
  JOIN goods_issue gi ON gi.goods_issue_id = gir.goods_issue_id
  JOIN goods_issue_line gil ON gil.goods_issue_id = gi.goods_issue_id
  JOIN sales_order so ON so.order_id = gi.source_order_id
  JOIN sales_order_line sol ON sol.order_line_id = gil.order_line_id
  WHERE ${revWhere}
    AND gil.inventory_movement_id IS NOT NULL
)
SELECT * FROM (
  SELECT * FROM sale_effects
  UNION ALL
  SELECT * FROM reversal_effects
) effects
ORDER BY
  business_date ASC,
  business_order ASC,
  CASE effect_type WHEN 'SALE' THEN 0 ELSE 1 END ASC,
  goods_issue_line_id ASC
`;
    return { sql, params };
  }

  private buildPhysicalEffectsSql(q: ActualCogsQuery): { sql: string; params: unknown[] } {
    const params: unknown[] = [q.tenantId];
    let p = 2;
    const filters: string[] = ['gi.tenant_id = $1'];
    const add = (clause: string, value: unknown) => {
      filters.push(clause.replace('?', `$${p}`));
      params.push(value);
      p += 1;
    };
    if (q.legalEntityId) add('gi.legal_entity_id = ?', q.legalEntityId);
    if (q.outletId) add('so.outlet_id = ?', q.outletId);
    if (q.warehouseId) add('gi.warehouse_id = ?', q.warehouseId);
    if (q.orderId) add('gi.source_order_id = ?', q.orderId);
    if (q.physicalCatalogItemId) add('m.catalog_item_id = ?', q.physicalCatalogItemId);
    if (q.currencyCode) add('m.currency_code = ?', q.currencyCode);
    if (q.soldCatalogItemId || q.orderLineId) {
      // Physical grain does not filter by sold line without joining evidence — apply via EXISTS
    }

    const saleFilters = [...filters];
    const revFilters = [...filters];
    if (q.businessDate) {
      saleFilters.push(`m.business_date = $${p}::date`);
      revFilters.push(`m.business_date = $${p}::date`);
      params.push(q.businessDate);
      p += 1;
    }
    if (q.businessDateFrom) {
      saleFilters.push(`m.business_date >= $${p}::date`);
      revFilters.push(`m.business_date >= $${p}::date`);
      params.push(q.businessDateFrom);
      p += 1;
    }
    if (q.businessDateTo) {
      saleFilters.push(`m.business_date <= $${p}::date`);
      revFilters.push(`m.business_date <= $${p}::date`);
      params.push(q.businessDateTo);
      p += 1;
    }

    let soldExistsSale = '';
    let soldExistsRev = '';
    if (q.soldCatalogItemId) {
      // SALE: gil.inventory_movement_id is the OUT movement id.
      soldExistsSale = `AND EXISTS (
        SELECT 1 FROM goods_issue_line gil2
        JOIN sales_order_line sol2 ON sol2.order_line_id = gil2.order_line_id
        WHERE gil2.goods_issue_id = gi.goods_issue_id
          AND gil2.inventory_movement_id = m.movement_id
          AND sol2.catalog_item_id = $${p}
      )`;
      // REVERSAL IN movements have distinct ids; match via original OUT that gil points to.
      soldExistsRev = `AND EXISTS (
        SELECT 1 FROM goods_issue_line gil2
        JOIN sales_order_line sol2 ON sol2.order_line_id = gil2.order_line_id
        JOIN inventory_movement out_m ON out_m.movement_id = gil2.inventory_movement_id
        WHERE gil2.goods_issue_id = gi.goods_issue_id
          AND sol2.catalog_item_id = $${p}
          AND out_m.source_document_type = 'GoodsIssue'
          AND out_m.source_document_id = gi.goods_issue_id
          AND out_m.catalog_item_id = m.catalog_item_id
          AND out_m.quantity = m.quantity
          AND out_m.acquisition_cost_minor = m.acquisition_cost_minor
      )`;
      params.push(q.soldCatalogItemId);
      p += 1;
    }
    if (q.orderLineId) {
      soldExistsSale += ` AND EXISTS (
        SELECT 1 FROM goods_issue_line gil2
        WHERE gil2.goods_issue_id = gi.goods_issue_id
          AND gil2.inventory_movement_id = m.movement_id
          AND gil2.order_line_id = $${p}
      )`;
      soldExistsRev += ` AND EXISTS (
        SELECT 1 FROM goods_issue_line gil2
        JOIN inventory_movement out_m ON out_m.movement_id = gil2.inventory_movement_id
        WHERE gil2.goods_issue_id = gi.goods_issue_id
          AND gil2.order_line_id = $${p}
          AND out_m.source_document_type = 'GoodsIssue'
          AND out_m.source_document_id = gi.goods_issue_id
          AND out_m.catalog_item_id = m.catalog_item_id
          AND out_m.quantity = m.quantity
          AND out_m.acquisition_cost_minor = m.acquisition_cost_minor
      )`;
      params.push(q.orderLineId);
      p += 1;
    }

    const saleWhere = saleFilters.join(' AND ');
    const revWhere = revFilters.join(' AND ');

    const sql = `
SELECT * FROM (
SELECT
  'SALE'::text AS effect_type,
  gi.tenant_id, gi.legal_entity_id, so.outlet_id, gi.warehouse_id,
  gi.source_order_id AS order_id,
  m.catalog_item_id AS physical_catalog_item_id,
  gi.goods_issue_id, m.movement_id AS inventory_movement_id,
  NULL::uuid AS goods_issue_reversal_id,
  m.business_date, m.business_order, m.business_time,
  m.quantity, m.base_unit, m.dimension::text AS dimension,
  m.acquisition_cost_minor, m.currency_code, m.minor_unit_exponent,
  m.cost_certainty, m.cost_basis
FROM inventory_movement m
JOIN goods_issue gi ON gi.goods_issue_id = m.source_document_id
JOIN sales_order so ON so.order_id = gi.source_order_id
WHERE m.source_document_type = 'GoodsIssue'
  AND ${saleWhere}
  ${soldExistsSale}

UNION ALL

SELECT
  'REVERSAL'::text AS effect_type,
  gi.tenant_id, gi.legal_entity_id, so.outlet_id, gi.warehouse_id,
  gi.source_order_id AS order_id,
  m.catalog_item_id AS physical_catalog_item_id,
  gi.goods_issue_id, m.movement_id AS inventory_movement_id,
  gir.goods_issue_reversal_id,
  m.business_date, m.business_order, m.business_time,
  m.quantity, m.base_unit, m.dimension::text AS dimension,
  m.acquisition_cost_minor, m.currency_code, m.minor_unit_exponent,
  m.cost_certainty, m.cost_basis
FROM inventory_movement m
JOIN goods_issue_reversal gir ON gir.goods_issue_reversal_id = m.source_document_id
JOIN goods_issue gi ON gi.goods_issue_id = gir.goods_issue_id
JOIN sales_order so ON so.order_id = gi.source_order_id
WHERE m.source_document_type = 'GoodsIssueReversal'
  AND ${revWhere}
  ${soldExistsRev}
) effects
ORDER BY
  business_date ASC,
  business_order ASC,
  CASE effect_type WHEN 'SALE' THEN 0 ELSE 1 END ASC,
  inventory_movement_id ASC
`;
    return { sql, params };
  }
}
