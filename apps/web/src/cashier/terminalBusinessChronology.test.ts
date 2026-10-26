/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allocateTerminalBusinessChronology,
  businessDateInTimeZone,
  peekTerminalBusinessOrder,
} from './terminalBusinessChronology.js';

describe('terminalBusinessChronology', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('formats businessDate in outlet timezone', () => {
    // 2026-10-25 20:00 UTC → still 2026-10-26 in Asia/Ho_Chi_Minh (UTC+7)
    const d = new Date('2026-10-25T20:00:00.000Z');
    expect(businessDateInTimeZone(d, 'Asia/Ho_Chi_Minh')).toBe('2026-10-26');
    expect(businessDateInTimeZone(d, 'UTC')).toBe('2026-10-25');
  });

  it('allocates monotonic businessOrder per terminal+date (not Date.now)', () => {
    const now = new Date('2026-10-26T04:00:00.000Z');
    const a = allocateTerminalBusinessChronology({
      terminalId: 'term-1',
      timeZone: 'UTC',
      now,
    });
    const b = allocateTerminalBusinessChronology({
      terminalId: 'term-1',
      timeZone: 'UTC',
      now,
    });
    expect(a.businessDate).toBe('2026-10-26');
    expect(a.businessOrder).toBe(1);
    expect(b.businessOrder).toBe(2);
    expect(peekTerminalBusinessOrder('term-1', '2026-10-26')).toBe(2);

    const other = allocateTerminalBusinessChronology({
      terminalId: 'term-2',
      timeZone: 'UTC',
      now,
    });
    expect(other.businessOrder).toBe(1);
  });
});
