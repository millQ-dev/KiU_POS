/**
 * Issue-cost quote at a business position using Block C stream replay semantics.
 * When on-hand qty ≤ 0: ESTIMATED_FROM_LAST_KNOWN if a prior positive average existed, else UNKNOWN.
 * Carrying certainty from inbound movements propagates (UNKNOWN never becomes silent FINAL zero).
 */
import { createCostValue, type CostValue } from './cost-value.js';
import {
  applyCompensatingOutbound,
  applyPositiveInbound,
  deriveUnitCost,
  emptyCostStream,
  mergeCertainty,
  orderMovementsForEconomicReplay,
  type CostCertainty,
  type CostQuote,
  type CostStreamState,
} from './moving-average.js';

export type MovementReplayRow = {
  readonly direction: 'IN' | 'OUT';
  readonly quantity: string;
  readonly acquisition_cost_minor: string;
  readonly currency_code: string;
  readonly minor_unit_exponent: number;
  readonly business_date: string;
  readonly business_order: number;
  readonly source_document_type: string;
  readonly cost_certainty: CostCertainty;
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

export { mergeCertainty } from './moving-average.js';

/** Replay movements strictly before (businessDate, businessOrder). */
export function replayStreamBefore(
  movements: readonly MovementReplayRow[],
  before: { businessDate: string; businessOrder: number },
  currencyCode: string,
  minorUnitExponent: number,
): { state: CostStreamState; lastKnownUnitCost: CostValue | null; orderUnresolved: boolean } {
  const scoped = movements
    .filter((m) => m.currency_code === currencyCode && m.minor_unit_exponent === minorUnitExponent)
    .map((m) => ({ ...m, business_date: asDate(m.business_date) }));

  const beforeRows = scoped.filter((m) => {
    const date = m.business_date;
    return (
      date < before.businessDate ||
      (date === before.businessDate && m.business_order < before.businessOrder)
    );
  });

  const { ordered, orderUnresolved } = orderMovementsForEconomicReplay(beforeRows);
  let state = emptyCostStream(currencyCode, minorUnitExponent);
  let lastKnownUnitCost: CostValue | null = null;

  for (const m of ordered) {
    if (m.currency_code !== currencyCode) {
      throw new Error(`Currency contamination in valuation stream: ${m.currency_code} vs ${currencyCode}`);
    }
    const cost = createCostValue(m.acquisition_cost_minor, m.currency_code, m.minor_unit_exponent);
    if (m.direction === 'IN') {
      state = applyPositiveInbound(state, m.quantity, cost, m.cost_certainty);
    } else {
      state = applyCompensatingOutbound(state, m.quantity, cost, m.cost_certainty);
    }
    const unit = deriveUnitCost(state);
    if (unit && state.carryingCertainty !== 'UNKNOWN' && state.carryingCertainty !== 'ORDER_UNRESOLVED') {
      lastKnownUnitCost = unit;
    }
  }

  if (orderUnresolved) {
    state = { ...state, carryingCertainty: mergeCertainty(state.carryingCertainty, 'ORDER_UNRESOLVED') };
  }

  return { state, lastKnownUnitCost, orderUnresolved };
}

export function issueCostQuoteFromStream(
  state: CostStreamState,
  lastKnownUnitCost: CostValue | null,
  asOfBusinessDate: string,
  asOfBusinessOrder: number,
): CostQuote {
  if (state.carryingCertainty === 'ORDER_UNRESOLVED') {
    const unit = deriveUnitCost(state);
    return {
      amountMinorUnits: unit?.amountMinorUnits ?? '0',
      currencyCode: state.currencyCode,
      minorUnitExponent: state.minorUnitExponent,
      certainty: 'ORDER_UNRESOLVED',
      basis: 'ACTUAL_STOCK_VALUATION',
      asOfBusinessDate,
      asOfBusinessOrder,
    };
  }

  const unit = deriveUnitCost(state);
  if (unit) {
    return {
      amountMinorUnits: unit.amountMinorUnits,
      currencyCode: unit.currencyCode,
      minorUnitExponent: unit.minorUnitExponent,
      // Propagate stream certainty — UNKNOWN stock never becomes FINAL merely because qty>0.
      certainty: state.carryingCertainty,
      basis: 'ACTUAL_STOCK_VALUATION',
      asOfBusinessDate,
      asOfBusinessOrder,
    };
  }
  // Depleted / negative: last-known estimate remains usable unless order itself is unresolved.
  // Stream certainty UNKNOWN after a zero-cost historical issue must not erase a prior FINAL unit cost.
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
