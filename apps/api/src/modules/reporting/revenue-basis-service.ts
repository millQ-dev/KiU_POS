import type pg from 'pg';
import {
  parseCanonicalDecimal,
  toCanonicalDecimal,
  type CommercialCertainty,
} from '@millq/domain';
import { DomainValidationError } from '../orders/errors.js';
import {
  revenueBasisQuerySchema,
  type RevenueBasisAggregate,
  type RevenueBasisLineEffect,
  type RevenueBasisOrderEffect,
  type RevenueBasisQuery,
} from './revenue-basis-types.js';

type Pool = pg.Pool;

type LineEffectRow = {
  effect_type: 'SALE' | 'REVERSAL';
  tenant_id: string;
  legal_entity_id: string;
  outlet_id: string;
  order_id: string;
  order_line_id: string;
  sold_catalog_item_id: string;
  line_number: number;
  business_date: string | Date;
  business_order: number;
  business_time: string | null;
  channel: string;
  currency_code: string;
  minor_unit_exponent: number;
  gross_merchandise_minor: string;
  line_merchant_funded_discount_minor: string;
  allocated_order_merchant_discount_minor: string;
  third_party_merchandise_funding_minor: string;
  net_merchandise_sales_minor: string | null;
  revenue_certainty: CommercialCertainty;
  order_commercial_snapshot_id: string;
  order_line_commercial_snapshot_id: string;
  sales_order_completion_reversal_id: string | null;
};

type OrderEffectRow = {
  effect_type: 'SALE' | 'REVERSAL';
  tenant_id: string;
  legal_entity_id: string;
  outlet_id: string;
  order_id: string;
  business_date: string | Date;
  business_order: number;
  business_time: string | null;
  channel: string;
  currency_code: string;
  minor_unit_exponent: number;
  revenue_certainty: CommercialCertainty;
  gross_merchandise_minor: string;
  merchant_funded_discount_minor: string;
  third_party_merchandise_funding_minor: string;
  tax_minor: string | null;
  non_merchandise_charges_minor: string | null;
  tip_minor: string | null;
  customer_payable_minor: string | null;
  net_merchandise_sales_minor: string | null;
  order_commercial_snapshot_id: string;
  sales_order_completion_reversal_id: string | null;
};

function asIsoDate(value: string | Date): string {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
    return value.slice(0, 10);
  }
  const y = value.getFullYear();
  const mo = value.getMonth() + 1;
  const d = value.getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function negateMinor(amount: string): string {
  return toCanonicalDecimal(parseCanonicalDecimal(amount).neg());
}

function mergeRevenueCertainty(a: CommercialCertainty, b: CommercialCertainty): CommercialCertainty {
  return a === 'UNKNOWN' || b === 'UNKNOWN' ? 'UNKNOWN' : 'FINAL';
}

function signedRevenueFromSnapshot(
  effectType: 'SALE' | 'REVERSAL',
  certainty: CommercialCertainty,
  netMerchandiseSalesMinor: string | null,
): string | null {
  if (certainty === 'UNKNOWN' || netMerchandiseSalesMinor === null) return null;
  return effectType === 'REVERSAL' ? negateMinor(netMerchandiseSalesMinor) : netMerchandiseSalesMinor;
}

/**
 * Reporting-owned Revenue Basis read model (ADR-0028 / ADR-0027).
 * Pure query over immutable Order commercial snapshots — no mutation, no second ledger.
 */
export class RevenueBasisService {
  constructor(private readonly pool: Pool) {}

  /** Line-grain effects: one per order_line_commercial_snapshot (SALE) + compensating REVERSAL. */
  async listLineEffects(raw: unknown): Promise<RevenueBasisLineEffect[]> {
    const q = revenueBasisQuerySchema.parse(raw);
    const { sql, params } = this.buildLineEffectsSql(q);
    const res = await this.pool.query<LineEffectRow>(sql, params);
    const mapped = res.rows.map((r) => this.mapLineEffect(r));
    return mapped.filter((e) => {
      if (q.certainty && e.revenueCertainty !== q.certainty) return false;
      if (q.effectType && e.effectType !== q.effectType) return false;
      return true;
    });
  }

  /** Order-grain effects: one per order_commercial_snapshot (SALE) + compensating REVERSAL. */
  async listOrderEffects(raw: unknown): Promise<RevenueBasisOrderEffect[]> {
    const q = revenueBasisQuerySchema.parse(raw);
    const { sql, params } = this.buildOrderEffectsSql(q);
    const res = await this.pool.query<OrderEffectRow>(sql, params);
    const mapped = res.rows.map((r) => this.mapOrderEffect(r));
    return mapped.filter((e) => {
      if (q.certainty && e.revenueCertainty !== q.certainty) return false;
      if (q.effectType && e.effectType !== q.effectType) return false;
      return true;
    });
  }

  async aggregateByLine(raw: unknown): Promise<RevenueBasisAggregate> {
    const q = revenueBasisQuerySchema.parse(raw);
    const effects = await this.listLineEffects(q);
    return this.aggregateEffects(
      effects.map((e) => ({
        signedRevenueBasisMinor: e.signedRevenueBasisMinor,
        revenueCertainty: e.revenueCertainty,
        currencyCode: e.currencyCode,
        minorUnitExponent: e.minorUnitExponent,
      })),
      { currencyCode: q.currencyCode ?? null, minorUnitExponent: null },
    );
  }

  async aggregateByOrder(raw: unknown): Promise<RevenueBasisAggregate> {
    const q = revenueBasisQuerySchema.parse(raw);
    const effects = await this.listOrderEffects(q);
    return this.aggregateEffects(
      effects.map((e) => ({
        signedRevenueBasisMinor: e.signedRevenueBasisMinor,
        revenueCertainty: e.revenueCertainty,
        currencyCode: e.currencyCode,
        minorUnitExponent: e.minorUnitExponent,
      })),
      { currencyCode: q.currencyCode ?? null, minorUnitExponent: null },
    );
  }

  aggregateEffects(
    components: ReadonlyArray<{
      signedRevenueBasisMinor: string | null;
      revenueCertainty: CommercialCertainty;
      currencyCode: string;
      minorUnitExponent: number;
    }>,
    emptyCurrencyHint?: { currencyCode: string | null; minorUnitExponent: number | null },
  ): RevenueBasisAggregate {
    if (components.length === 0) {
      return {
        currencyCode: emptyCurrencyHint?.currencyCode ?? null,
        minorUnitExponent: emptyCurrencyHint?.minorUnitExponent ?? null,
        revenueBasisMinor: '0',
        knownSubtotalMinor: '0',
        certainty: 'FINAL',
        componentCount: 0,
        finalComponentCount: 0,
        unknownComponentCount: 0,
      };
    }

    const currencies = new Set(components.map((c) => `${c.currencyCode}:${c.minorUnitExponent}`));
    if (currencies.size > 1) {
      throw new DomainValidationError(
        'MULTI_CURRENCY_NOT_AGGREGATABLE',
        'Revenue Basis aggregate cannot silently mix commercial currencies',
      );
    }

    const first = components[0]!;
    let certainty: CommercialCertainty = 'FINAL';
    let known = parseCanonicalDecimal('0');
    let finalCount = 0;
    let unknownCount = 0;

    for (const c of components) {
      certainty = mergeRevenueCertainty(certainty, c.revenueCertainty);
      if (c.revenueCertainty === 'FINAL') finalCount += 1;
      else unknownCount += 1;

      if (c.revenueCertainty === 'FINAL' && c.signedRevenueBasisMinor !== null) {
        known = known.plus(parseCanonicalDecimal(c.signedRevenueBasisMinor));
      }
    }

    const knownSubtotalMinor = toCanonicalDecimal(known);
    let revenueBasisMinor: string | null = null;
    if (unknownCount === 0) {
      let total = parseCanonicalDecimal('0');
      let ok = true;
      for (const c of components) {
        if (c.signedRevenueBasisMinor === null) {
          ok = false;
          break;
        }
        total = total.plus(parseCanonicalDecimal(c.signedRevenueBasisMinor));
      }
      revenueBasisMinor = ok ? toCanonicalDecimal(total) : null;
    }

    return {
      currencyCode: first.currencyCode,
      minorUnitExponent: first.minorUnitExponent,
      revenueBasisMinor,
      knownSubtotalMinor,
      certainty,
      componentCount: components.length,
      finalComponentCount: finalCount,
      unknownComponentCount: unknownCount,
    };
  }

  private mapLineEffect(r: LineEffectRow): RevenueBasisLineEffect {
    return {
      effectType: r.effect_type,
      tenantId: r.tenant_id,
      legalEntityId: r.legal_entity_id,
      outletId: r.outlet_id,
      orderId: r.order_id,
      orderLineId: r.order_line_id,
      soldCatalogItemId: r.sold_catalog_item_id,
      lineNumber: r.line_number,
      businessDate: asIsoDate(r.business_date),
      businessOrder: r.business_order,
      businessTime: r.business_time,
      channel: r.channel,
      currencyCode: r.currency_code,
      minorUnitExponent: r.minor_unit_exponent,
      grossMerchandiseMinor: r.gross_merchandise_minor,
      lineMerchantFundedDiscountMinor: r.line_merchant_funded_discount_minor,
      allocatedOrderMerchantDiscountMinor: r.allocated_order_merchant_discount_minor,
      thirdPartyMerchandiseFundingMinor: r.third_party_merchandise_funding_minor,
      revenueCertainty: r.revenue_certainty,
      signedRevenueBasisMinor: signedRevenueFromSnapshot(
        r.effect_type,
        r.revenue_certainty,
        r.net_merchandise_sales_minor,
      ),
      orderCommercialSnapshotId: r.order_commercial_snapshot_id,
      orderLineCommercialSnapshotId: r.order_line_commercial_snapshot_id,
      salesOrderCompletionReversalId: r.sales_order_completion_reversal_id,
    };
  }

  private mapOrderEffect(r: OrderEffectRow): RevenueBasisOrderEffect {
    return {
      effectType: r.effect_type,
      tenantId: r.tenant_id,
      legalEntityId: r.legal_entity_id,
      outletId: r.outlet_id,
      orderId: r.order_id,
      businessDate: asIsoDate(r.business_date),
      businessOrder: r.business_order,
      businessTime: r.business_time,
      channel: r.channel,
      currencyCode: r.currency_code,
      minorUnitExponent: r.minor_unit_exponent,
      revenueCertainty: r.revenue_certainty,
      grossMerchandiseMinor: r.gross_merchandise_minor,
      merchantFundedDiscountMinor: r.merchant_funded_discount_minor,
      thirdPartyMerchandiseFundingMinor: r.third_party_merchandise_funding_minor,
      taxMinor: r.tax_minor,
      nonMerchandiseChargesMinor: r.non_merchandise_charges_minor,
      tipMinor: r.tip_minor,
      customerPayableMinor: r.customer_payable_minor,
      signedRevenueBasisMinor: signedRevenueFromSnapshot(
        r.effect_type,
        r.revenue_certainty,
        r.net_merchandise_sales_minor,
      ),
      orderCommercialSnapshotId: r.order_commercial_snapshot_id,
      salesOrderCompletionReversalId: r.sales_order_completion_reversal_id,
    };
  }

  private buildLineEffectsSql(q: RevenueBasisQuery): { sql: string; params: unknown[] } {
    const params: unknown[] = [q.tenantId];
    let p = 2;
    const baseFilters: string[] = ['ocs.tenant_id = $1'];

    const add = (clause: string, value: unknown) => {
      baseFilters.push(clause.replace('?', `$${p}`));
      params.push(value);
      p += 1;
    };

    if (q.legalEntityId) add('ocs.legal_entity_id = ?', q.legalEntityId);
    if (q.outletId) add('ocs.outlet_id = ?', q.outletId);
    if (q.orderId) add('ocs.order_id = ?', q.orderId);
    if (q.orderLineId) add('olcs.order_line_id = ?', q.orderLineId);
    if (q.soldCatalogItemId) add('olcs.sold_catalog_item_id = ?', q.soldCatalogItemId);
    if (q.currencyCode) add('ocs.currency_code = ?', q.currencyCode);
    if (q.channel) add('so.channel = ?', q.channel);

    const saleFilters = [...baseFilters];
    const revFilters = [...baseFilters];

    if (q.businessDate) {
      saleFilters.push(`ocs.business_date = $${p}::date`);
      revFilters.push(`scr.business_date = $${p}::date`);
      params.push(q.businessDate);
      p += 1;
    }
    if (q.businessDateFrom) {
      saleFilters.push(`ocs.business_date >= $${p}::date`);
      revFilters.push(`scr.business_date >= $${p}::date`);
      params.push(q.businessDateFrom);
      p += 1;
    }
    if (q.businessDateTo) {
      saleFilters.push(`ocs.business_date <= $${p}::date`);
      revFilters.push(`scr.business_date <= $${p}::date`);
      params.push(q.businessDateTo);
      p += 1;
    }

    const saleWhere = saleFilters.join(' AND ');
    const revWhere = revFilters.join(' AND ');

    const sql = `
WITH sale_line_effects AS (
  SELECT
    'SALE'::text AS effect_type,
    ocs.tenant_id, ocs.legal_entity_id, ocs.outlet_id, ocs.order_id,
    olcs.order_line_id, olcs.sold_catalog_item_id, olcs.line_number,
    ocs.business_date, ocs.business_order, ocs.business_time,
    so.channel,
    ocs.currency_code, ocs.minor_unit_exponent,
    olcs.gross_merchandise_minor,
    olcs.line_merchant_funded_discount_minor,
    olcs.allocated_order_merchant_discount_minor,
    olcs.third_party_merchandise_funding_minor,
    olcs.net_merchandise_sales_minor,
    olcs.certainty AS revenue_certainty,
    ocs.order_commercial_snapshot_id,
    olcs.order_line_commercial_snapshot_id,
    NULL::uuid AS sales_order_completion_reversal_id
  FROM order_line_commercial_snapshot olcs
  JOIN order_commercial_snapshot ocs
    ON ocs.order_commercial_snapshot_id = olcs.order_commercial_snapshot_id
  JOIN sales_order so ON so.order_id = ocs.order_id
  WHERE ${saleWhere}
),
reversal_line_effects AS (
  SELECT
    'REVERSAL'::text AS effect_type,
    ocs.tenant_id, ocs.legal_entity_id, ocs.outlet_id, ocs.order_id,
    olcs.order_line_id, olcs.sold_catalog_item_id, olcs.line_number,
    scr.business_date, scr.business_order, scr.business_time,
    so.channel,
    ocs.currency_code, ocs.minor_unit_exponent,
    olcs.gross_merchandise_minor,
    olcs.line_merchant_funded_discount_minor,
    olcs.allocated_order_merchant_discount_minor,
    olcs.third_party_merchandise_funding_minor,
    olcs.net_merchandise_sales_minor,
    olcs.certainty AS revenue_certainty,
    ocs.order_commercial_snapshot_id,
    olcs.order_line_commercial_snapshot_id,
    scr.sales_order_completion_reversal_id
  FROM sales_order_completion_reversal scr
  JOIN sales_order so ON so.order_id = scr.order_id
  JOIN order_commercial_snapshot ocs ON ocs.order_id = scr.order_id
  JOIN order_line_commercial_snapshot olcs
    ON olcs.order_commercial_snapshot_id = ocs.order_commercial_snapshot_id
  WHERE ${revWhere}
)
SELECT * FROM (
  SELECT * FROM sale_line_effects
  UNION ALL
  SELECT * FROM reversal_line_effects
) effects
ORDER BY
  business_date ASC,
  business_order ASC,
  CASE effect_type WHEN 'SALE' THEN 0 ELSE 1 END ASC,
  order_line_id ASC
`;
    return { sql, params };
  }

  private buildOrderEffectsSql(q: RevenueBasisQuery): { sql: string; params: unknown[] } {
    const params: unknown[] = [q.tenantId];
    let p = 2;
    const baseFilters: string[] = ['ocs.tenant_id = $1'];

    const add = (clause: string, value: unknown) => {
      baseFilters.push(clause.replace('?', `$${p}`));
      params.push(value);
      p += 1;
    };

    if (q.legalEntityId) add('ocs.legal_entity_id = ?', q.legalEntityId);
    if (q.outletId) add('ocs.outlet_id = ?', q.outletId);
    if (q.orderId) add('ocs.order_id = ?', q.orderId);
    if (q.currencyCode) add('ocs.currency_code = ?', q.currencyCode);
    if (q.channel) add('so.channel = ?', q.channel);

    const saleFilters = [...baseFilters];
    const revFilters = [...baseFilters];

    if (q.businessDate) {
      saleFilters.push(`ocs.business_date = $${p}::date`);
      revFilters.push(`scr.business_date = $${p}::date`);
      params.push(q.businessDate);
      p += 1;
    }
    if (q.businessDateFrom) {
      saleFilters.push(`ocs.business_date >= $${p}::date`);
      revFilters.push(`scr.business_date >= $${p}::date`);
      params.push(q.businessDateFrom);
      p += 1;
    }
    if (q.businessDateTo) {
      saleFilters.push(`ocs.business_date <= $${p}::date`);
      revFilters.push(`scr.business_date <= $${p}::date`);
      params.push(q.businessDateTo);
      p += 1;
    }

    const saleWhere = saleFilters.join(' AND ');
    const revWhere = revFilters.join(' AND ');

    const sql = `
WITH sale_order_effects AS (
  SELECT
    'SALE'::text AS effect_type,
    ocs.tenant_id, ocs.legal_entity_id, ocs.outlet_id, ocs.order_id,
    ocs.business_date, ocs.business_order, ocs.business_time,
    so.channel,
    ocs.currency_code, ocs.minor_unit_exponent,
    ocs.certainty AS revenue_certainty,
    ocs.gross_merchandise_minor,
    ocs.merchant_funded_discount_minor,
    ocs.third_party_merchandise_funding_minor,
    ocs.tax_minor,
    ocs.non_merchandise_charges_minor,
    ocs.tip_minor,
    ocs.customer_payable_minor,
    ocs.net_merchandise_sales_minor,
    ocs.order_commercial_snapshot_id,
    NULL::uuid AS sales_order_completion_reversal_id
  FROM order_commercial_snapshot ocs
  JOIN sales_order so ON so.order_id = ocs.order_id
  WHERE ${saleWhere}
),
reversal_order_effects AS (
  SELECT
    'REVERSAL'::text AS effect_type,
    ocs.tenant_id, ocs.legal_entity_id, ocs.outlet_id, ocs.order_id,
    scr.business_date, scr.business_order, scr.business_time,
    so.channel,
    ocs.currency_code, ocs.minor_unit_exponent,
    ocs.certainty AS revenue_certainty,
    ocs.gross_merchandise_minor,
    ocs.merchant_funded_discount_minor,
    ocs.third_party_merchandise_funding_minor,
    ocs.tax_minor,
    ocs.non_merchandise_charges_minor,
    ocs.tip_minor,
    ocs.customer_payable_minor,
    ocs.net_merchandise_sales_minor,
    ocs.order_commercial_snapshot_id,
    scr.sales_order_completion_reversal_id
  FROM sales_order_completion_reversal scr
  JOIN sales_order so ON so.order_id = scr.order_id
  JOIN order_commercial_snapshot ocs ON ocs.order_id = scr.order_id
  WHERE ${revWhere}
)
SELECT * FROM (
  SELECT * FROM sale_order_effects
  UNION ALL
  SELECT * FROM reversal_order_effects
) effects
ORDER BY
  business_date ASC,
  business_order ASC,
  CASE effect_type WHEN 'SALE' THEN 0 ELSE 1 END ASC,
  order_id ASC
`;
    return { sql, params };
  }
}
