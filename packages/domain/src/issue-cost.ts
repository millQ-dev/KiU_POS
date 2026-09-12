/**
 * Issue-cost quote at a business position using Block C stream replay semantics.
 * When on-hand qty ≤ 0: ESTIMATED_FROM_LAST_KNOWN if a prior positive average existed, else UNKNOWN.
 */
import {
  applyCompensatingOutbound,
  applyPositiveInbound,
  createCostValue,
  deriveUnitCost,
  emptyCostStream,
  type CostCertainty,
  type CostQuote,
  type CostValue,
  type CostStreamState,
} from '@millq/domain';

export type MovementReplayRow = {
  readonly direction: 'IN' | 'OUT';
  readonly quantity: string;
  readonly acquisition_cost_minor: string;
  readonly currency_code: string;
  readonly minor_unit_exponent: number;
  readonly business_date: string;
  readonly business_order: number;
};

function asDate(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
    return value.slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Replay movements strictly before (businessDate, businessOrder). */
export function replayStreamBefore(
  movements: readonly MovementReplayRow[],
  before: { businessDate: string; businessOrder: number },
  currencyCode: string,
  minorUnitExponent: number,
): { state: CostStreamState; lastKnownUnitCost: CostValue | null } {
  let state = emptyCostStream(currencyCode, minorUnitExponent);
  let lastKnownUnitCost: CostValue | null = null;

  for (const m of movements) {
    const date = asDate(m.business_date);
    if (
      date > before.businessDate ||
      (date === before.businessDate && m.business_order >= before.businessOrder)
    ) {
      break;
    }
    const cost = createCostValue(m.acquisition_cost_minor, m.currency_code, m.minor_unit_exponent);
    if (m.direction === 'IN') {
      state = applyPositiveInbound(state, m.quantity, cost);
    } else {
      state = applyCompensatingOutbound(state, m.quantity, cost);
    }
    const unit = deriveUnitCost(state);
    if (unit) lastKnownUnitCost = unit;
  }

  return { state, lastKnownUnitCost };
}

export function issueCostQuoteFromStream(
  state: CostStreamState,
  lastKnownUnitCost: CostValue | null,
  asOfBusinessDate: string,
  asOfBusinessOrder: number,
): CostQuote {
  const unit = deriveUnitCost(state);
  if (unit) {
    return {
      amountMinorUnits: unit.amountMinorUnits,
      currencyCode: unit.currencyCode,
      minorUnitExponent: unit.minorUnitExponent,
      certainty: 'FINAL',
      basis: 'ACTUAL_STOCK_VALUATION',
      asOfBusinessDate,
      asOfBusinessOrder,
    };
  }
  if (lastKnownUnitCost) {
    return {
      amountMinorUnits: lastKnownUnitCost.amountMinorUnits,
      currencyCode: lastKnownUnitCost.currencyCode,
      minorUnitExponent: lastKnownUnitCost.minorUnitExponent,
      certainty: 'ESTIMATED_FROM_LAST_KNOWN',
      basis: 'ESTIMATED',
      asOfBusinessDate,
      asOfBusinessOrder,
    };
  }
  return {
    amountMinorUnits: '0',
    currencyCode: state.currencyCode,
    minorUnitExponent: state.minorUnitExponent,
    certainty: 'UNKNOWN',
    basis: 'ACTUAL_STOCK_VALUATION',
    asOfBusinessDate,
    asOfBusinessOrder,
  };
}

export function mergeCertainty(a: CostCertainty, b: CostCertainty): CostCertainty {
  const rank: Record<CostCertainty, number> = {
    UNKNOWN: 3,
    ORDER_UNRESOLVED: 2,
    ESTIMATED_FROM_LAST_KNOWN: 1,
    FINAL: 0,
  };
  return rank[a] >= rank[b] ? a : b;
}
