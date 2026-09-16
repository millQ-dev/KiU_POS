import {
  mergeReportingCertainty,
  parseCanonicalDecimal,
  toCanonicalDecimal,
  type CostCertainty,
} from '@millq/domain';
import { DomainValidationError } from '../orders/errors.js';
import { ActualCogsService } from './actual-cogs-service.js';
import type { ActualCogsAggregate, ActualCogsEffect } from './actual-cogs-types.js';
import { RevenueBasisService } from './revenue-basis-service.js';
import type { RevenueBasisAggregate, RevenueBasisLineEffect } from './revenue-basis-types.js';
import {
  FOOD_COST_RATIO_DECIMAL_PLACES,
  operatingEconomicsQuerySchema,
  type CoverageGapDetail,
  type MetricUnavailableReason,
  type OperatingEconomicsQuery,
  type OperatingEconomicsResult,
} from './operating-economics-types.js';

function coverageKey(
  orderId: string,
  orderLineId: string,
  effectType: 'SALE' | 'REVERSAL',
): string {
  return `${orderId}|${orderLineId}|${effectType}`;
}

function emptyRevenueAggregate(
  currencyCode: string | null,
  minorUnitExponent: number | null,
): RevenueBasisAggregate {
  return {
    currencyCode,
    minorUnitExponent,
    revenueBasisMinor: '0',
    knownSubtotalMinor: '0',
    certainty: 'FINAL',
    componentCount: 0,
    finalComponentCount: 0,
    unknownComponentCount: 0,
  };
}

/**
 * Local empty-COGS normalization for combined metrics (D1.4D §21).
 * Does not alter ActualCogsService empty aggregate contract — placeholder VND is not economic evidence.
 */
function emptyCogsAggregate(
  currencyCode: string | null,
  minorUnitExponent: number | null,
): ActualCogsAggregate {
  return {
    currencyCode: currencyCode ?? '',
    minorUnitExponent: minorUnitExponent ?? 0,
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

function revenueToReportingCertainty(certainty: 'FINAL' | 'UNKNOWN'): CostCertainty {
  return certainty === 'UNKNOWN' ? 'UNKNOWN' : 'FINAL';
}

/**
 * Reporting-owned Food Cost Ratio & Operational Gross Profit (ADR-0026 / ADR-0028).
 * Derives metrics from RevenueBasisService + ActualCogsService — no second ledger.
 */
export class OperatingEconomicsService {
  private readonly revenue: RevenueBasisService;
  private readonly cogs: ActualCogsService;

  constructor(
    revenue: RevenueBasisService,
    cogs: ActualCogsService,
  ) {
    this.revenue = revenue;
    this.cogs = cogs;
  }

  async compute(raw: unknown): Promise<OperatingEconomicsResult> {
    const q = operatingEconomicsQuerySchema.parse(raw);
    const common = this.toCommonQuery(q);

    let revenueEffects: RevenueBasisLineEffect[];
    let revenueAgg: RevenueBasisAggregate;
    try {
      revenueEffects = await this.revenue.listLineEffects(common);
      revenueAgg = this.revenue.aggregateEffects(
        revenueEffects.map((e) => ({
          signedRevenueBasisMinor: e.signedRevenueBasisMinor,
          revenueCertainty: e.revenueCertainty,
          currencyCode: e.currencyCode,
          minorUnitExponent: e.minorUnitExponent,
        })),
        { currencyCode: q.currencyCode ?? null, minorUnitExponent: null },
      );
    } catch (err) {
      if (err instanceof DomainValidationError && err.code === 'MULTI_CURRENCY_NOT_AGGREGATABLE') {
        throw err;
      }
      throw err;
    }

    let cogsEffects: ActualCogsEffect[];
    let cogsAggRaw: ActualCogsAggregate;
    try {
      cogsEffects = await this.cogs.listLineEffects(common);
      cogsAggRaw = this.cogs.aggregateEffects(
        cogsEffects.map((e) => ({
          signedActualCogsMinor: e.signedActualCogsMinor,
          costCertainty: e.costCertainty,
          currencyCode: e.currencyCode,
          minorUnitExponent: e.minorUnitExponent,
        })),
      );
    } catch (err) {
      if (err instanceof DomainValidationError && err.code === 'MULTI_CURRENCY_NOT_AGGREGATABLE') {
        throw err;
      }
      throw err;
    }

    const coverageGaps = this.detectCoverageGaps(cogsEffects, revenueEffects);
    const hasRevenueCoverageGap = coverageGaps.length > 0;

    return this.derive(q, revenueAgg, cogsAggRaw, cogsEffects.length, hasRevenueCoverageGap, coverageGaps);
  }

  /**
   * Pure derivation from already-fetched component aggregates (unit-testable).
   * `cogsEffectCount` is the true effect count (not ActualCogs empty-placeholder semantics).
   */
  derive(
    q: OperatingEconomicsQuery,
    revenueAgg: RevenueBasisAggregate,
    cogsAggRaw: ActualCogsAggregate,
    cogsEffectCount: number,
    hasRevenueCoverageGap: boolean,
    coverageGaps: readonly CoverageGapDetail[],
  ): OperatingEconomicsResult {
    const revenueCount = revenueAgg.componentCount;
    const cogsCount = cogsEffectCount;

    // §21: normalize empty sides locally — do not trust COGS placeholder currency when count=0
    let revenue = revenueAgg;
    let cogs: ActualCogsAggregate;
    let currencyCode: string | null = null;
    let minorUnitExponent: number | null = null;

    if (revenueCount > 0 && cogsCount === 0) {
      // Asymmetric: Revenue without COGS → exact zero COGS in Revenue currency
      currencyCode = revenue.currencyCode;
      minorUnitExponent = revenue.minorUnitExponent;
      cogs = emptyCogsAggregate(currencyCode, minorUnitExponent);
    } else if (revenueCount === 0 && cogsCount > 0) {
      // Coverage gap path — keep COGS evidence; do not fabricate Revenue 0 as metric input
      cogs = cogsAggRaw;
      currencyCode = cogs.currencyCode || null;
      minorUnitExponent = cogs.componentCount > 0 ? cogs.minorUnitExponent : null;
      revenue = emptyRevenueAggregate(null, null);
    } else if (revenueCount === 0 && cogsCount === 0) {
      if (q.currencyCode) {
        currencyCode = q.currencyCode;
        minorUnitExponent = 0;
        revenue = emptyRevenueAggregate(currencyCode, minorUnitExponent);
        cogs = emptyCogsAggregate(currencyCode, minorUnitExponent);
      } else {
        revenue = emptyRevenueAggregate(null, null);
        cogs = emptyCogsAggregate(null, null);
        currencyCode = null;
        minorUnitExponent = null;
      }
    } else {
      // Both sides have effects
      cogs = cogsAggRaw;
      currencyCode = revenue.currencyCode;
      minorUnitExponent = revenue.minorUnitExponent;
    }

    const foodReasons: MetricUnavailableReason[] = [];
    const gpReasons: MetricUnavailableReason[] = [];

    if (hasRevenueCoverageGap) {
      foodReasons.push('REVENUE_COVERAGE_GAP');
      gpReasons.push('REVENUE_COVERAGE_GAP');
    }

    if (revenueCount === 0 && cogsCount === 0 && !q.currencyCode) {
      foodReasons.push('NO_CURRENCY_CONTEXT');
      gpReasons.push('NO_CURRENCY_CONTEXT');
    }

    // Currency compatibility when both sides have economic components
    if (revenueCount > 0 && cogsCount > 0) {
      if (
        revenue.currencyCode !== cogs.currencyCode ||
        revenue.minorUnitExponent !== cogs.minorUnitExponent
      ) {
        foodReasons.push('CURRENCY_MISMATCH');
        gpReasons.push('CURRENCY_MISMATCH');
        currencyCode = null;
        minorUnitExponent = null;
      } else {
        currencyCode = revenue.currencyCode;
        minorUnitExponent = revenue.minorUnitExponent;
      }
    }

    const revenueAmount = revenue.revenueBasisMinor;
    const cogsAmount = cogs.actualCogsMinor;

    if (revenue.certainty === 'UNKNOWN' || revenueAmount === null) {
      if (revenueCount > 0 || revenue.unknownComponentCount > 0) {
        foodReasons.push('REVENUE_UNKNOWN');
        gpReasons.push('REVENUE_UNKNOWN');
      }
    }

    if (cogs.certainty === 'UNKNOWN' || (cogs.unknownComponentCount > 0 && cogsAmount === null)) {
      if (cogsCount > 0 && cogs.certainty === 'UNKNOWN') {
        foodReasons.push('COGS_UNKNOWN');
        gpReasons.push('COGS_UNKNOWN');
      }
    }
    if (cogs.certainty === 'ORDER_UNRESOLVED' || cogs.unresolvedComponentCount > 0) {
      if (cogsCount > 0) {
        foodReasons.push('COGS_ORDER_UNRESOLVED');
        gpReasons.push('COGS_ORDER_UNRESOLVED');
      }
    }
    // When COGS amount null due to UNKNOWN/UNRESOLVED already covered; also if amount null for other reasons
    if (cogsCount > 0 && cogsAmount === null) {
      if (cogs.certainty === 'UNKNOWN' && !foodReasons.includes('COGS_UNKNOWN')) {
        foodReasons.push('COGS_UNKNOWN');
        gpReasons.push('COGS_UNKNOWN');
      }
      if (
        cogs.certainty === 'ORDER_UNRESOLVED' &&
        !foodReasons.includes('COGS_ORDER_UNRESOLVED')
      ) {
        foodReasons.push('COGS_ORDER_UNRESOLVED');
        gpReasons.push('COGS_ORDER_UNRESOLVED');
      }
    }

    const componentsCompatible =
      !foodReasons.includes('REVENUE_COVERAGE_GAP') &&
      !foodReasons.includes('CURRENCY_MISMATCH') &&
      !foodReasons.includes('REVENUE_UNKNOWN') &&
      !foodReasons.includes('COGS_UNKNOWN') &&
      !foodReasons.includes('COGS_ORDER_UNRESOLVED') &&
      !foodReasons.includes('NO_CURRENCY_CONTEXT');

    const revenueExact = componentsCompatible && revenueAmount !== null;
    const cogsExact = componentsCompatible && cogsAmount !== null;

    // Zero denominator for Food Cost only
    if (revenueExact && parseCanonicalDecimal(revenueAmount!).isZero()) {
      foodReasons.push('ZERO_REVENUE_BASIS');
    }

    let foodCostRatio: string | null = null;
    let foodStatus: 'AVAILABLE' | 'UNAVAILABLE' = 'UNAVAILABLE';
    let foodCertainty: CostCertainty | null = null;

    const foodBlocking = foodReasons.filter((r) => r !== 'ZERO_REVENUE_BASIS');
    // ZERO_REVENUE_BASIS alone still blocks ratio
    if (
      foodReasons.length === 0 &&
      revenueExact &&
      cogsExact &&
      !parseCanonicalDecimal(revenueAmount!).isZero()
    ) {
      const ratio = parseCanonicalDecimal(cogsAmount!).div(parseCanonicalDecimal(revenueAmount!));
      foodCostRatio = toCanonicalDecimal(ratio, FOOD_COST_RATIO_DECIMAL_PLACES);
      foodStatus = 'AVAILABLE';
      foodCertainty = mergeReportingCertainty(
        revenueToReportingCertainty(revenue.certainty),
        cogs.certainty,
      );
    } else if (foodReasons.includes('ZERO_REVENUE_BASIS') && foodBlocking.length === 0) {
      foodStatus = 'UNAVAILABLE';
      foodCertainty = null;
    }

    let operationalGrossProfitMinor: string | null = null;
    let gpStatus: 'AVAILABLE' | 'UNAVAILABLE' = 'UNAVAILABLE';
    let gpCertainty: CostCertainty | null = null;

    if (gpReasons.length === 0 && revenueExact && cogsExact) {
      const gp = parseCanonicalDecimal(revenueAmount!).minus(parseCanonicalDecimal(cogsAmount!));
      operationalGrossProfitMinor = toCanonicalDecimal(gp);
      gpStatus = 'AVAILABLE';
      gpCertainty = mergeReportingCertainty(
        revenueToReportingCertainty(revenue.certainty),
        cogs.certainty,
      );
    }

    // Empty both with explicit currency: OGP = 0 available; Food Cost ZERO_REVENUE_BASIS
    if (
      revenueCount === 0 &&
      cogsCount === 0 &&
      q.currencyCode &&
      !hasRevenueCoverageGap
    ) {
      // Recompute empty-with-currency path cleanly
      const zeroFoodReasons: MetricUnavailableReason[] = ['ZERO_REVENUE_BASIS'];
      return {
        currencyCode: q.currencyCode,
        minorUnitExponent: 0,
        revenue: emptyRevenueAggregate(q.currencyCode, 0),
        cogs: emptyCogsAggregate(q.currencyCode, 0),
        hasRevenueCoverageGap: false,
        coverageGaps: [],
        numeratorActualCogsMinor: '0',
        denominatorRevenueBasisMinor: '0',
        foodCostRatio: null,
        foodCostRatioStatus: 'UNAVAILABLE',
        foodCostRatioUnavailableReasons: zeroFoodReasons,
        foodCostRatioCertainty: null,
        operationalGrossProfitMinor: '0',
        operationalGrossProfitStatus: 'AVAILABLE',
        operationalGrossProfitUnavailableReasons: [],
        operationalGrossProfitCertainty: 'FINAL',
      };
    }

    return {
      currencyCode,
      minorUnitExponent,
      revenue,
      cogs: {
        ...cogs,
        // Surface empty-normalized currency honestly when we inherited Revenue currency for zero COGS
        currencyCode: cogs.componentCount === 0 && currencyCode ? currencyCode : cogs.currencyCode,
        minorUnitExponent:
          cogs.componentCount === 0 && minorUnitExponent !== null
            ? minorUnitExponent
            : cogs.minorUnitExponent,
      },
      hasRevenueCoverageGap,
      coverageGaps,
      numeratorActualCogsMinor: cogsExact ? cogsAmount : cogs.actualCogsMinor,
      denominatorRevenueBasisMinor: revenueExact ? revenueAmount : revenue.revenueBasisMinor,
      foodCostRatio,
      foodCostRatioStatus: foodStatus,
      foodCostRatioUnavailableReasons: [...new Set(foodReasons)],
      foodCostRatioCertainty: foodCertainty,
      operationalGrossProfitMinor,
      operationalGrossProfitStatus: gpStatus,
      operationalGrossProfitUnavailableReasons: [...new Set(gpReasons)],
      operationalGrossProfitCertainty: gpCertainty,
    };
  }

  private toCommonQuery(q: OperatingEconomicsQuery) {
    return {
      tenantId: q.tenantId,
      legalEntityId: q.legalEntityId,
      outletId: q.outletId,
      orderId: q.orderId,
      orderLineId: q.orderLineId,
      soldCatalogItemId: q.soldCatalogItemId,
      channel: q.channel,
      businessDate: q.businessDate,
      businessDateFrom: q.businessDateFrom,
      businessDateTo: q.businessDateTo,
      currencyCode: q.currencyCode,
    };
  }

  private detectCoverageGaps(
    cogsEffects: readonly ActualCogsEffect[],
    revenueEffects: readonly RevenueBasisLineEffect[],
  ): CoverageGapDetail[] {
    const revenueKeys = new Set(
      revenueEffects.map((e) => coverageKey(e.orderId, e.orderLineId, e.effectType)),
    );
    const seen = new Set<string>();
    const gaps: CoverageGapDetail[] = [];
    for (const e of cogsEffects) {
      const key = coverageKey(e.orderId, e.orderLineId, e.effectType);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!revenueKeys.has(key)) {
        gaps.push({
          orderId: e.orderId,
          orderLineId: e.orderLineId,
          effectType: e.effectType,
        });
      }
    }
    return gaps;
  }
}
