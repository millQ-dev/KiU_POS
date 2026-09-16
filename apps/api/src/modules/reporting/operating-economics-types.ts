import { z } from 'zod';
import type { CostCertainty } from '@millq/domain';
import type { ActualCogsAggregate } from './actual-cogs-types.js';
import type { RevenueBasisAggregate } from './revenue-basis-types.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Common sold/order grain filters shared by Revenue + COGS for combined metrics. */
export const operatingEconomicsQuerySchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    outletId: uuid.optional(),
    orderId: uuid.optional(),
    orderLineId: uuid.optional(),
    soldCatalogItemId: uuid.optional(),
    channel: z.string().min(1).optional(),
    businessDateFrom: date.optional(),
    businessDateTo: date.optional(),
    businessDate: date.optional(),
    currencyCode: z.string().length(3).optional(),
  })
  .strict();

export type OperatingEconomicsQuery = z.infer<typeof operatingEconomicsQuerySchema>;

export type MetricStatus = 'AVAILABLE' | 'UNAVAILABLE';

export type MetricUnavailableReason =
  | 'ZERO_REVENUE_BASIS'
  | 'REVENUE_UNKNOWN'
  | 'COGS_UNKNOWN'
  | 'COGS_ORDER_UNRESOLVED'
  | 'REVENUE_COVERAGE_GAP'
  | 'CURRENCY_MISMATCH'
  | 'NO_CURRENCY_CONTEXT';

export type CoverageGapDetail = {
  readonly orderId: string;
  readonly orderLineId: string;
  readonly effectType: 'SALE' | 'REVERSAL';
};

/**
 * Reporting ratio precision for Food Cost Ratio (non-money derived).
 * 8 decimal places, ROUND_HALF_EVEN — ADR-0002 banker's rounding.
 */
export const FOOD_COST_RATIO_DECIMAL_PLACES = 8;

export type OperatingEconomicsResult = {
  readonly currencyCode: string | null;
  readonly minorUnitExponent: number | null;

  readonly revenue: RevenueBasisAggregate;
  readonly cogs: ActualCogsAggregate;

  readonly hasRevenueCoverageGap: boolean;
  readonly coverageGaps: readonly CoverageGapDetail[];

  /** Exact signed Actual COGS used as Food Cost numerator when available. */
  readonly numeratorActualCogsMinor: string | null;
  /** Exact signed Revenue Basis used as Food Cost denominator when available. */
  readonly denominatorRevenueBasisMinor: string | null;

  readonly foodCostRatio: string | null;
  readonly foodCostRatioStatus: MetricStatus;
  readonly foodCostRatioUnavailableReasons: readonly MetricUnavailableReason[];
  readonly foodCostRatioCertainty: CostCertainty | null;

  readonly operationalGrossProfitMinor: string | null;
  readonly operationalGrossProfitStatus: MetricStatus;
  readonly operationalGrossProfitUnavailableReasons: readonly MetricUnavailableReason[];
  readonly operationalGrossProfitCertainty: CostCertainty | null;
};
