/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allocateTerminalBusinessChronology,
  businessDateInTimeZone,
  clearLockedCompleteChronology,
  createWebLocksRequest,
  loadLockedCompleteChronology,
  loadOrCreateDurableCompleteIdempotencyKey,
  peekTerminalBusinessOrder,
  persistLockedCompleteChronology,
  TerminalChronologyError,
  type ChronologyLockRequest,
} from './terminalBusinessChronology.js';

/** Serializing mutex for deterministic concurrent tests (no Web Locks in jsdom by default). */
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
    vi.unstubAllGlobals();
  });

  it('formats businessDate in outlet timezone', () => {
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

  it('parallel allocations under exclusive lock yield unique orders', async () => {
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
  });

  it('fails closed when Web Locks are unavailable (no localStorage busy-lock fallback)', async () => {
    vi.stubGlobal('navigator', { locks: undefined });
    expect(createWebLocksRequest()).toBeNull();
    await expect(
      allocateTerminalBusinessChronology({
        terminalId: 'term-no-locks',
        timeZone: 'UTC',
        now: new Date('2026-10-26T04:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      name: 'TerminalChronologyError',
      code: 'CHRONOLOGY_LOCK_UNAVAILABLE',
    });
    expect(peekTerminalBusinessOrder('term-no-locks', '2026-10-26')).toBe(0);
  });

  it('fails closed when localStorage cannot store the counter', async () => {
    const lock = createSerialLock();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    await expect(
      allocateTerminalBusinessChronology({
        terminalId: 'term-quota',
        timeZone: 'UTC',
        now: new Date('2026-10-26T04:00:00.000Z'),
        requestExclusiveLock: lock,
      }),
    ).rejects.toMatchObject({ code: 'CHRONOLOGY_STORAGE_UNAVAILABLE' });
    setItem.mockRestore();
  });

  it('persists locked Complete chronology; fails closed if sessionStorage unavailable', () => {
    const chrono = { businessDate: '2026-10-26', businessOrder: 3 };
    persistLockedCompleteChronology('sg-1', chrono);
    expect(loadLockedCompleteChronology('sg-1')).toEqual(chrono);
    clearLockedCompleteChronology('sg-1');
    expect(loadLockedCompleteChronology('sg-1')).toBeNull();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => persistLockedCompleteChronology('sg-2', chrono)).toThrow(TerminalChronologyError);
    expect(() => persistLockedCompleteChronology('sg-2', chrono)).toThrow(/sessionStorage unavailable/);
    setItem.mockRestore();
  });

  it('durable Complete idempotency key fails closed when sessionStorage cannot persist', () => {
    const key = loadOrCreateDurableCompleteIdempotencyKey('sg-dur');
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(loadOrCreateDurableCompleteIdempotencyKey('sg-dur')).toBe(key);

    sessionStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => loadOrCreateDurableCompleteIdempotencyKey('sg-fail')).toThrow(
      TerminalChronologyError,
    );
    setItem.mockRestore();
  });
});
