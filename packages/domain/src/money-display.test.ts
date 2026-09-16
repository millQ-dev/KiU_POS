import { describe, expect, it } from 'vitest';
import { createMoney, formatMoneyDisplay } from './money.js';

describe('formatMoneyDisplay', () => {
  it('formats without floating-point business arithmetic', () => {
    expect(formatMoneyDisplay(createMoney('100000', 'VND', 0))).toBe('100000 VND');
    expect(formatMoneyDisplay(createMoney('1050', 'USD', 2))).toBe('10.50 USD');
    expect(formatMoneyDisplay(createMoney('-250', 'VND', 0))).toBe('-250 VND');
  });
});
