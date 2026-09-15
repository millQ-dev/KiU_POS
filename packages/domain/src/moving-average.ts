/**
 * Moving weighted-average costing (ADR-0003).
 * Cost stream scope: warehouse + catalogItem + valuationCurrency (+ legalEntity boundary).
 */
import { parseCanonicalDecimal, toCanonicalDecimal, type DecimalValue } from './decimal.js';
import { createCostValue, roundCostValue, type CostValue } from './cost-value.js';
import { InvalidDecimalError } from './errors.js';

export type CostCertainty = 'FINAL' | 'ESTIMATED_FROM_LAST_KNOWN' | 'UNKNOWN' | 'ORDER_UNRESOLVED';

export type CostBasis = 'ACTUAL_STOCK_VALUATION' | 'SUPPLIER_PRICE' | 'ESTIMATED';

export type CostQuote = {
  readonly amountMinorUnits: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly certainty: CostCertainty;
  readonly basis: CostBasis;
  readonly asOfBusinessDate: string;
  readonly asOfBusinessOrder: number;
};

export type CostStreamState = {
  readonly quantity: string;
  readonly carryingValueMinor: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  /** Certainty of the positive carrying stock (or stream-level unresolved order). */
  readonly carryingCertainty: CostCertainty;
};

const CERTAINTY_RANK: Record<CostCertainty, number> = {
  UNKNOWN: 3,
  ORDER_UNRESOLVED: 2,
  ESTIMATED_FROM_LAST_KNOWN: 1,
  FINAL: 0,
};

export function mergeCertainty(a: CostCertainty, b: CostCertainty): CostCertainty {
  return CERTAINTY_RANK[a] >= CERTAINTY_RANK[b] ? a : b;
}

/**
 * ADR-0026 Actual COGS reporting aggregate precedence (distinct from inventory stream mergeCertainty):
 * ORDER_UNRESOLVED > UNKNOWN > ESTIMATED_FROM_LAST_KNOWN > FINAL
 */
const REPORTING_CERTAINTY_RANK: Record<CostCertainty, number> = {
  ORDER_UNRESOLVED: 3,
  UNKNOWN: 2,
  ESTIMATED_FROM_LAST_KNOWN: 1,
  FINAL: 0,
};

export function mergeReportingCertainty(a: CostCertainty, b: CostCertainty): CostCertainty {
  return REPORTING_CERTAINTY_RANK[a] >= REPORTING_CERTAINTY_RANK[b] ? a : b;
}

export function deriveUnitCost(state: CostStreamState): CostValue | null {
  const qty = parseCanonicalDecimal(state.quantity);
  if (qty.lte(0)) {
    return null;
  }
  const carrying = parseCanonicalDecimal(state.carryingValueMinor);
  return roundCostValue(carrying.div(qty), state.currencyCode, state.minorUnitExponent);
}

/**
 * Positive inbound with no open deficit: newAvg = (oldValue + inboundCost) / (oldQty + inboundQty)
 */
export function applyPositiveInbound(
  state: CostStreamState,
  inboundQuantity: string,
  inboundCost: CostValue,
  inboundCertainty: CostCertainty = 'FINAL',
): CostStreamState {
  if (inboundCost.currencyCode !== state.currencyCode || inboundCost.minorUnitExponent !== state.minorUnitExponent) {
    throw new InvalidDecimalError('Inbound cost currency mismatch');
  }
  const qty = parseCanonicalDecimal(state.quantity);
  const inboundQty = parseCanonicalDecimal(inboundQuantity);
  if (inboundQty.lte(0)) {
    throw new InvalidDecimalError('Inbound quantity must be positive');
  }
  const newQty = qty.plus(inboundQty);
  const newValue = parseCanonicalDecimal(state.carryingValueMinor).plus(
    parseCanonicalDecimal(inboundCost.amountMinorUnits),
  );
  return {
    quantity: toCanonicalDecimal(newQty),
    carryingValueMinor: toCanonicalDecimal(newValue),
    currencyCode: state.currencyCode,
    minorUnitExponent: state.minorUnitExponent,
    carryingCertainty: mergeCertainty(state.carryingCertainty, inboundCertainty),
  };
}

/**
 * Compensating outbound for reversal: reduce qty and carrying value at historical unit cost portion.
 * For full receipt reversal: outboundQty = original inbound qty, outboundCost = original inbound cost.
 */
export function applyCompensatingOutbound(
  state: CostStreamState,
  outboundQuantity: string,
  outboundCost: CostValue,
  outboundCertainty: CostCertainty = 'FINAL',
): CostStreamState {
  if (outboundCost.currencyCode !== state.currencyCode || outboundCost.minorUnitExponent !== state.minorUnitExponent) {
    throw new InvalidDecimalError('Outbound cost currency mismatch');
  }
  const newQty = parseCanonicalDecimal(state.quantity).minus(parseCanonicalDecimal(outboundQuantity));
  let newValue = parseCanonicalDecimal(state.carryingValueMinor).minus(
    parseCanonicalDecimal(outboundCost.amountMinorUnits),
  );
  // ADR-0003 invariant: zero quantity has zero carrying value.
  if (newQty.isZero()) {
    newValue = parseCanonicalDecimal('0');
  }
  return {
    quantity: toCanonicalDecimal(newQty),
    carryingValueMinor: toCanonicalDecimal(newValue),
    currencyCode: state.currencyCode,
    minorUnitExponent: state.minorUnitExponent,
    carryingCertainty: newQty.isZero()
      ? 'FINAL'
      : mergeCertainty(state.carryingCertainty, outboundCertainty),
  };
}

export function emptyCostStream(
  currencyCode: string,
  minorUnitExponent: number,
): CostStreamState {
  return {
    quantity: '0',
    carryingValueMinor: '0',
    currencyCode,
    minorUnitExponent,
    carryingCertainty: 'FINAL',
  };
}

export function costQuoteFromStream(
  state: CostStreamState,
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
  if (!unit) {
    return {
      amountMinorUnits: '0',
      currencyCode: state.currencyCode,
      minorUnitExponent: state.minorUnitExponent,
      certainty: state.carryingCertainty === 'FINAL' ? 'UNKNOWN' : state.carryingCertainty,
      basis: 'ACTUAL_STOCK_VALUATION',
      asOfBusinessDate,
      asOfBusinessOrder,
    };
  }
  // Positive stock: numeric value never upgrades certainty. UNKNOWN stays UNKNOWN even if amount is 0.
  return {
    amountMinorUnits: unit.amountMinorUnits,
    currencyCode: unit.currencyCode,
    minorUnitExponent: unit.minorUnitExponent,
    certainty: state.carryingCertainty,
    basis: 'ACTUAL_STOCK_VALUATION',
    asOfBusinessDate,
    asOfBusinessOrder,
  };
}

/** Line acquisition value = unit purchase price (money) × base quantity, as CostValue */
export function lineAcquisitionCost(
  unitPriceMinor: string,
  currencyCode: string,
  minorUnitExponent: number,
  baseQuantity: string,
): CostValue {
  const price = parseCanonicalDecimal(unitPriceMinor);
  const qty = parseCanonicalDecimal(baseQuantity);
  return roundCostValue(price.mul(qty), currencyCode, minorUnitExponent);
}

export function assertBusinessChronologyLess(
  a: { businessDate: string; businessOrder: number },
  b: { businessDate: string; businessOrder: number },
): boolean {
  if (a.businessDate < b.businessDate) return true;
  if (a.businessDate > b.businessDate) return false;
  return a.businessOrder < b.businessOrder;
}

export function compareBusinessPosition(
  a: { businessDate: string; businessOrder: number },
  b: { businessDate: string; businessOrder: number },
): number {
  if (a.businessDate < b.businessDate) return -1;
  if (a.businessDate > b.businessDate) return 1;
  return a.businessOrder - b.businessOrder;
}

/** Reversal document types are compensating effects of an earlier business fact. */
export function isReversalDocumentType(sourceDocumentType: string): boolean {
  return sourceDocumentType.endsWith('Reversal');
}

export type ChronologySortRow = {
  readonly business_date: string;
  readonly business_order: number;
  readonly source_document_type: string;
};

/**
 * Order movements for economic replay using business chronology only (ADR-0003 §8).
 * Within the same (businessDate, businessOrder): non-reversal effects before reversal compensations.
 * Two independent (non-linked-by-class) movements at the same business position → ORDER_UNRESOLVED.
 * Never uses recorded_at / upload / UUID order as a costing tie-breaker.
 */
export function orderMovementsForEconomicReplay<T extends ChronologySortRow>(
  movements: readonly T[],
): { ordered: T[]; orderUnresolved: boolean } {
  const decorated = movements.map((m, index) => ({
    m,
    index,
    effectClass: isReversalDocumentType(m.source_document_type) ? 1 : 0,
  }));
  decorated.sort((a, b) => {
    const byDate = a.m.business_date.localeCompare(b.m.business_date);
    if (byDate !== 0) return byDate;
    if (a.m.business_order !== b.m.business_order) return a.m.business_order - b.m.business_order;
    if (a.effectClass !== b.effectClass) return a.effectClass - b.effectClass;
    // Stable only for sort implementation; callers must treat same-class ties as ORDER_UNRESOLVED.
    return a.index - b.index;
  });

  let orderUnresolved = false;
  for (let i = 1; i < decorated.length; i++) {
    const prev = decorated[i - 1]!;
    const cur = decorated[i]!;
    if (
      prev.m.business_date === cur.m.business_date &&
      prev.m.business_order === cur.m.business_order &&
      prev.effectClass === cur.effectClass
    ) {
      orderUnresolved = true;
      break;
    }
  }

  return {
    ordered: decorated.map((d) => d.m),
    orderUnresolved,
  };
}
