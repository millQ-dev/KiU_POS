import { describe, expect, it } from 'vitest';
import { createCostValue } from './cost-value.js';
import {
  issueCostQuoteFromStream,
  mergeCertainty,
  replayStreamBefore,
} from './issue-cost.js';
import { emptyCostStream } from './moving-average.js';

describe('issue cost quote', () => {
  it('FINAL when positive on-hand before issue', () => {
    const { state, lastKnownUnitCost } = replayStreamBefore(
      [
        {
          direction: 'IN',
          quantity: '10',
          acquisition_cost_minor: '100000',
          currency_code: 'VND',
          minor_unit_exponent: 0,
          business_date: '2026-03-01',
          business_order: 1,
        },
      ],
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
        {
          direction: 'IN',
          quantity: '10',
          acquisition_cost_minor: '100000',
          currency_code: 'VND',
          minor_unit_exponent: 0,
          business_date: '2026-03-01',
          business_order: 1,
        },
        {
          direction: 'OUT',
          quantity: '10',
          acquisition_cost_minor: '100000',
          currency_code: 'VND',
          minor_unit_exponent: 0,
          business_date: '2026-03-05',
          business_order: 1,
        },
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

  it('mergeCertainty prefers UNKNOWN', () => {
    expect(mergeCertainty('FINAL', 'UNKNOWN')).toBe('UNKNOWN');
    expect(mergeCertainty('FINAL', 'ESTIMATED_FROM_LAST_KNOWN')).toBe('ESTIMATED_FROM_LAST_KNOWN');
  });

  it('ignores movements at or after business position', () => {
    const { state } = replayStreamBefore(
      [
        {
          direction: 'IN',
          quantity: '10',
          acquisition_cost_minor: '100000',
          currency_code: 'VND',
          minor_unit_exponent: 0,
          business_date: '2026-03-10',
          business_order: 1,
        },
      ],
      { businessDate: '2026-03-10', businessOrder: 1 },
      'VND',
      0,
    );
    expect(state.quantity).toBe('0');
    void createCostValue;
  });
});
