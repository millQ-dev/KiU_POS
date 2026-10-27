/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allocateTerminalBusinessChronology,
  businessDateInTimeZone,
  clearLockedCompleteChronology,
  createLocalStorageBusyLockRequest,
  loadLockedCompleteChronology,
  peekTerminalBusinessOrder,
  persistLockedCompleteChronology,
  type ChronologyLockRequest,
} from './terminalBusinessChronology.js';

/** Serializing mutex for deterministic concurrent tests (no Web Locks in jsdom). */
function createSerialLock(): ChronologyLockRequest {
  let tail: Promise<unknown> = Promise.resolve();
  return async (_name, run) => {
    const next = tail.then(() => run());
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

describe('terminalBusinessChronology', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('formats businessDate in outlet timezone', () => {
    // 2026-10-25 20:00 UTC → still 2026-10-26 in Asia/Ho_Chi_Minh (UTC+7)
    const d = new Date('2026-10-25T20:00:00.000Z');
    expect(businessDateInTimeZone(d, 'Asia/Ho_Chi_Minh')).toBe('2026-10-26');
    expect(businessDateInTimeZone(d, 'UTC')).toBe('2026-10-25');
  });

  it('allocates monotonic businessOrder per terminal+date (not Date.now)', async () => {
    const now = new Date('2026-10-26T04:00:00.000Z');
    const lock = createSerialLock();
    const a = await allocateTerminalBusinessChronology({
      terminalId: 'term-1',
      timeZone: 'UTC',
      now,
      requestExclusiveLock: lock,
    });
    const b = await allocateTerminalBusinessChronology({
      terminalId: 'term-1',
      timeZone: 'UTC',
      now,
      requestExclusiveLock: lock,
    });
    expect(a.businessDate).toBe('2026-10-26');
    expect(a.businessOrder).toBe(1);
    expect(b.businessOrder).toBe(2);
    expect(peekTerminalBusinessOrder('term-1', '2026-10-26')).toBe(2);
    expect(a.businessOrder).not.toBe(Date.now());

    const other = await allocateTerminalBusinessChronology({
      terminalId: 'term-2',
      timeZone: 'UTC',
      now,
      requestExclusiveLock: lock,
    });
    expect(other.businessOrder).toBe(1);
  });

  it('parallel allocations under exclusive lock yield unique orders (two windows)', async () => {
    const now = new Date('2026-10-26T04:00:00.000Z');
    const lock = createSerialLock();
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        allocateTerminalBusinessChronology({
          terminalId: 'term-conc',
          timeZone: 'UTC',
          now,
          requestExclusiveLock: lock,
        }),
      ),
    );
    const orders = results.map((r) => r.businessOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(new Set(orders).size).toBe(16);
    expect(peekTerminalBusinessOrder('term-conc', '2026-10-26')).toBe(16);
  });

  it('localStorage busy-lock serializes parallel allocations without silent duplicates', async () => {
    const now = new Date('2026-10-26T04:00:00.000Z');
    const busy = createLocalStorageBusyLockRequest({
      attempts: 80,
      sleepMs: 5,
      ttlMs: 3_000,
    });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        allocateTerminalBusinessChronology({
          terminalId: 'term-busy',
          timeZone: 'UTC',
          now,
          requestExclusiveLock: busy,
        }),
      ),
    );
    const orders = results.map((r) => r.businessOrder);
    expect(new Set(orders).size).toBe(12);
    expect(Math.max(...orders)).toBe(12);
  });

  it('unlocked lost-update can duplicate; exclusive lock prevents silent duplicates', async () => {
    const now = new Date('2026-10-26T04:00:00.000Z');
    // Classic race without a lock: two readers both write the same next value.
    const key = 'millq.terminalBusinessOrder.term-race.2026-10-26';
    localStorage.setItem(key, '0');
    const readA = Number(localStorage.getItem(key));
    const readB = Number(localStorage.getItem(key));
    localStorage.setItem(key, String(readA + 1));
    localStorage.setItem(key, String(readB + 1));
    expect(Number(localStorage.getItem(key))).toBe(1);

    localStorage.clear();
    const locked = await Promise.all(
      Array.from({ length: 8 }, () =>
        allocateTerminalBusinessChronology({
          terminalId: 'term-race',
          timeZone: 'UTC',
          now,
          requestExclusiveLock: createSerialLock(),
        }),
      ),
    );
    expect(new Set(locked.map((r) => r.businessOrder)).size).toBe(8);
  });

  it('persists locked Complete chronology across reload (UNKNOWN retry)', () => {
    const chrono = { businessDate: '2026-10-26', businessOrder: 3 };
    persistLockedCompleteChronology('sg-1', chrono);
    expect(loadLockedCompleteChronology('sg-1')).toEqual(chrono);
    clearLockedCompleteChronology('sg-1');
    expect(loadLockedCompleteChronology('sg-1')).toBeNull();
  });
});
