import { describe, expect, it } from 'vitest';
import { createCostValue } from './cost-value.js';
import {
  issueCostQuoteFromStream,
  mergeCertainty,
  replayStreamBefore,
} from './issue-cost.js';
import { emptyCostStream, orderMovementsForEconomicReplay } from './moving-average.js';

function row(
  partial: Partial<{
    direction: 'IN' | 'OUT';
    quantity: string;
    acquisition_cost_minor: string;
    currency_code: string;
    minor_unit_exponent: number;
    business_date: string;
    business_order: number;
    source_document_type: string;
    cost_certainty: 'FINAL' | 'ESTIMATED_FROM_LAST_KNOWN' | 'UNKNOWN' | 'ORDER_UNRESOLVED';
  }>,
) {
  return {
    direction: 'IN' as const,
    quantity: '10',
    acquisition_cost_minor: '100000',
    currency_code: 'VND',
    minor_unit_exponent: 0,
    business_date: '2026-03-01',
    business_order: 1,
    source_document_type: 'GoodsReceipt',
    cost_certainty: 'FINAL' as const,
    ...partial,
  };
}

describe('issue cost quote', () => {
  it('FINAL when positive on-hand before issue', () => {
    const { state, lastKnownUnitCost } = replayStreamBefore(
      [row({})],
      { businessDate: '2026-03-10', businessOrder: 1 },
      'VND',
      0,
    );
    const quote = issueCostQuoteFromStream(state, lastKnownUnitCost, '2026-03-10', 1);
    expect(quote.certainty).toBe('FINAL');
    expect(quote.amountMinorUnits).toBe('10000');
  });

  it('ESTIMATED_FROM_LAST_KNOWN when qty ≤ 0 but last known exists', () => {
    const { state, lastKnownUnitCost } = replayStreamBefore(
      [
        row({}),
        row({
          direction: 'OUT',
          business_date: '2026-03-05',
          acquisition_cost_minor: '100000',
          source_document_type: 'ProductionBatch',
        }),
      ],
      { businessDate: '2026-03-10', businessOrder: 1 },
      'VND',
      0,
    );
    expect(state.quantity).toBe('0');
    const quote = issueCostQuoteFromStream(state, lastKnownUnitCost, '2026-03-10', 1);
    expect(quote.certainty).toBe('ESTIMATED_FROM_LAST_KNOWN');
    expect(quote.amountMinorUnits).toBe('10000');
  });

  it('UNKNOWN when no prior cost knowledge', () => {
    const state = emptyCostStream('VND', 0);
    const quote = issueCostQuoteFromStream(state, null, '2026-03-10', 1);
    expect(quote.certainty).toBe('UNKNOWN');
    expect(quote.amountMinorUnits).toBe('0');
  });

  it('UNKNOWN inbound keeps positive stock UNKNOWN (not FINAL zero)', () => {
    const { state, lastKnownUnitCost } = replayStreamBefore(
      [
        row({
          acquisition_cost_minor: '0',
          cost_certainty: 'UNKNOWN',
          source_document_type: 'ProductionBatch',
        }),
      ],
      { businessDate: '2026-03-10', businessOrder: 1 },
      'VND',
      0,
    );
    expect(state.quantity).toBe('10');
    expect(state.carryingCertainty).toBe('UNKNOWN');
    const quote = issueCostQuoteFromStream(state, lastKnownUnitCost, '2026-03-10', 1);
    expect(quote.certainty).toBe('UNKNOWN');
    expect(quote.amountMinorUnits).toBe('0');
  });

  it('legitimate FINAL zero unit cost remains FINAL', () => {
    const { state, lastKnownUnitCost } = replayStreamBefore(
      [row({ acquisition_cost_minor: '0', cost_certainty: 'FINAL' })],
      { businessDate: '2026-03-10', businessOrder: 1 },
      'VND',
      0,
    );
    const quote = issueCostQuoteFromStream(state, lastKnownUnitCost, '2026-03-10', 1);
    expect(quote.certainty).toBe('FINAL');
    expect(quote.amountMinorUnits).toBe('0');
  });

  it('mergeCertainty prefers UNKNOWN', () => {
    expect(mergeCertainty('FINAL', 'UNKNOWN')).toBe('UNKNOWN');
    expect(mergeCertainty('FINAL', 'ESTIMATED_FROM_LAST_KNOWN')).toBe('ESTIMATED_FROM_LAST_KNOWN');
  });

  it('ignores movements at or after business position', () => {
    const { state } = replayStreamBefore(
      [row({ business_date: '2026-03-10', business_order: 1 })],
      { businessDate: '2026-03-10', businessOrder: 1 },
      'VND',
      0,
    );
    expect(state.quantity).toBe('0');
    void createCostValue;
  });

  it('same business facts in reverse upload order yield identical state', () => {
    const a = [
      row({ business_order: 1, acquisition_cost_minor: '100000' }),
      row({ business_order: 2, acquisition_cost_minor: '200000', quantity: '10' }),
    ];
    const b = [...a].reverse();
    const ra = replayStreamBefore(a, { businessDate: '2026-03-10', businessOrder: 9 }, 'VND', 0);
    const rb = replayStreamBefore(b, { businessDate: '2026-03-10', businessOrder: 9 }, 'VND', 0);
    expect(ra.state).toEqual(rb.state);
  });

  it('conflicting same business position marks ORDER_UNRESOLVED', () => {
    const { ordered, orderUnresolved } = orderMovementsForEconomicReplay([
      row({ business_order: 1, source_document_type: 'GoodsReceipt' }),
      row({
        business_order: 1,
        acquisition_cost_minor: '50000',
        source_document_type: 'GoodsReceipt',
      }),
    ]);
    expect(orderUnresolved).toBe(true);
    expect(ordered).toHaveLength(2);
    const { state } = replayStreamBefore(
      [
        row({ business_order: 1, source_document_type: 'GoodsReceipt' }),
        row({
          business_order: 1,
          acquisition_cost_minor: '50000',
          source_document_type: 'GoodsReceipt',
        }),
      ],
      { businessDate: '2026-03-10', businessOrder: 9 },
      'VND',
      0,
    );
    expect(state.carryingCertainty).toBe('ORDER_UNRESOLVED');
  });
});
