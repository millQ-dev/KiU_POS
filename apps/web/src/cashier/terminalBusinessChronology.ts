/**
 * Terminal-scoped business chronology for CompleteOrder (ADR-0003 / offline-foundation §6).
 *
 * Authoritative model already Accepted: the device/terminal maintains a monotonic
 * `businessOrder` per `businessDate`. This helper does **not** invent a production
 * numbering authority or use wall-clock millis as `businessOrder`.
 *
 * `businessDate` is the local calendar date in the outlet IANA timezone at completion
 * (same instant family as CashierShell salesContext.businessDateTime). Cross-terminal
 * reconciliation remains Block F / ADR-0003 ORDER_UNRESOLVED — out of C0 scope.
 *
 * C0-CHRONO1.1: cross-tab allocation uses **Web Locks only**. There is no localStorage
 * busy-lock fallback (not atomic across browser contexts). If `navigator.locks` is
 * unavailable, allocation fails closed via `CHRONOLOGY_LOCK_UNAVAILABLE`.
 */

const STORAGE_PREFIX = 'millq.terminalBusinessOrder.';

export type TerminalBusinessChronology = {
  businessDate: string;
  businessOrder: number;
};

export type TerminalChronologyErrorCode =
  | 'CHRONOLOGY_LOCK_UNAVAILABLE'
  | 'CHRONOLOGY_ALLOCATION_BUSY'
  | 'CHRONOLOGY_STORAGE_UNAVAILABLE';

export class TerminalChronologyError extends Error {
  readonly code: TerminalChronologyErrorCode;

  constructor(code: TerminalChronologyErrorCode, message: string) {
    super(message);
    this.name = 'TerminalChronologyError';
    this.code = code;
  }
}

export type ChronologyLockRequest = <T>(
  name: string,
  run: () => T | Promise<T>,
) => Promise<T>;

/** YYYY-MM-DD in the given IANA zone (fallback UTC). */
export function businessDateInTimeZone(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* invalid zone → UTC */
  }
  return instant.toISOString().slice(0, 10);
}

function storageKey(terminalId: string, businessDate: string): string {
  return `${STORAGE_PREFIX}${terminalId}.${businessDate}`;
}

function readCounter(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null && /^[0-9]+$/.test(raw)) return Number(raw);
  } catch {
    /* private mode */
  }
  return 0;
}

/**
 * Read → increment → write under an exclusive Web Lock.
 * Post-write verification catches corrupted/unexpected storage; it is not a lock substitute.
 */
function allocateUnderLock(key: string): number {
  const current = readCounter(key);
  const next = current + 1;
  try {
    localStorage.setItem(key, String(next));
  } catch {
    throw new TerminalChronologyError(
      'CHRONOLOGY_STORAGE_UNAVAILABLE',
      'localStorage unavailable; cannot allocate terminal businessOrder',
    );
  }
  const verified = readCounter(key);
  if (verified !== next) {
    throw new TerminalChronologyError(
      'CHRONOLOGY_ALLOCATION_BUSY',
      'businessOrder counter changed unexpectedly during Web Lock allocation; retry',
    );
  }
  return next;
}

/** Web Locks when available (cross-tab exclusive). */
export function createWebLocksRequest(): ChronologyLockRequest | null {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') return null;
  return async (name, run) =>
    locks.request(name, { mode: 'exclusive' }, async () => run()) as Promise<
      Awaited<ReturnType<typeof run>>
    >;
}

function resolveLockRequest(explicit?: ChronologyLockRequest): ChronologyLockRequest {
  if (explicit) return explicit;
  const web = createWebLocksRequest();
  if (web) return web;
  throw new TerminalChronologyError(
    'CHRONOLOGY_LOCK_UNAVAILABLE',
    'Web Locks API required for terminal businessOrder allocation; unsupported browser context',
  );
}

/**
 * Allocate the next monotonic businessOrder for this terminal + businessDate.
 * Requires Web Locks (or an injected exclusive lock in tests). Never uses Date.now() as order.
 */
export async function allocateTerminalBusinessChronology(input: {
  terminalId: string;
  timeZone: string;
  now?: Date;
  /** Inject exclusive lock (unit tests). Production uses Web Locks only. */
  requestExclusiveLock?: ChronologyLockRequest;
}): Promise<TerminalBusinessChronology> {
  const now = input.now ?? new Date();
  const businessDate = businessDateInTimeZone(now, input.timeZone);
  const key = storageKey(input.terminalId, businessDate);
  const lockName = `millq-chrono:${input.terminalId}:${businessDate}`;
  const requestLock = resolveLockRequest(input.requestExclusiveLock);

  const businessOrder = await requestLock(lockName, () => allocateUnderLock(key));
  return { businessDate, businessOrder };
}

/** Peek without allocating — tests / diagnostics. */
export function peekTerminalBusinessOrder(terminalId: string, businessDate: string): number {
  return readCounter(storageKey(terminalId, businessDate));
}

/** Persist CompleteOrder chronology for UNKNOWN/reload retry (session-scoped). */
const COMPLETE_CHRONO_PREFIX = 'millq.completeOrderChronology.';

export function loadLockedCompleteChronology(
  settlementGroupId: string,
): TerminalBusinessChronology | null {
  try {
    const raw = sessionStorage.getItem(`${COMPLETE_CHRONO_PREFIX}${settlementGroupId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { businessDate?: string; businessOrder?: number };
    if (
      typeof parsed.businessDate === 'string' &&
      typeof parsed.businessOrder === 'number' &&
      Number.isInteger(parsed.businessOrder) &&
      parsed.businessOrder >= 1
    ) {
      return { businessDate: parsed.businessDate, businessOrder: parsed.businessOrder };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Persist locked chronology. Fail closed if sessionStorage cannot round-trip the value —
 * otherwise reload would lose chronology while Complete may already be in flight.
 */
export function persistLockedCompleteChronology(
  settlementGroupId: string,
  chrono: TerminalBusinessChronology,
): void {
  const key = `${COMPLETE_CHRONO_PREFIX}${settlementGroupId}`;
  const payload = JSON.stringify(chrono);
  try {
    sessionStorage.setItem(key, payload);
    if (sessionStorage.getItem(key) !== payload) {
      throw new Error('round-trip mismatch');
    }
  } catch {
    throw new TerminalChronologyError(
      'CHRONOLOGY_STORAGE_UNAVAILABLE',
      'sessionStorage unavailable; cannot lock CompleteOrder chronology for safe retry',
    );
  }
}

export function clearLockedCompleteChronology(settlementGroupId: string): void {
  try {
    sessionStorage.removeItem(`${COMPLETE_CHRONO_PREFIX}${settlementGroupId}`);
  } catch {
    /* ignore */
  }
}

/**
 * Ensure a CompleteOrder idempotency key is durable in sessionStorage.
 * Creating a new key when storage is unavailable would make reload retries unsafe.
 */
export function loadOrCreateDurableCompleteIdempotencyKey(
  settlementGroupId: string,
  prefix = 'millq.completeOrderIdempotency.',
): string {
  const storageKey = `${prefix}${settlementGroupId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 8) return existing;
  } catch {
    throw new TerminalChronologyError(
      'CHRONOLOGY_STORAGE_UNAVAILABLE',
      'sessionStorage unavailable; cannot read CompleteOrder idempotency key',
    );
  }
  const next = `cmpl-${settlementGroupId}-${crypto.randomUUID()}`.slice(0, 128);
  try {
    sessionStorage.setItem(storageKey, next);
    if (sessionStorage.getItem(storageKey) !== next) {
      throw new Error('round-trip mismatch');
    }
  } catch {
    throw new TerminalChronologyError(
      'CHRONOLOGY_STORAGE_UNAVAILABLE',
      'sessionStorage unavailable; cannot persist CompleteOrder idempotency key for safe retry',
    );
  }
  return next;
}

/** DEV/E2E: expose production helpers so Playwright does not inline a copy of the algorithm. */
export type TerminalChronologyTestHooks = {
  allocateTerminalBusinessChronology: typeof allocateTerminalBusinessChronology;
  peekTerminalBusinessOrder: typeof peekTerminalBusinessOrder;
  loadLockedCompleteChronology: typeof loadLockedCompleteChronology;
  persistLockedCompleteChronology: typeof persistLockedCompleteChronology;
  clearLockedCompleteChronology: typeof clearLockedCompleteChronology;
};

declare global {
  interface Window {
    __millqTerminalChronology?: TerminalChronologyTestHooks;
  }
}

export function installTerminalChronologyTestHooks(
  target: Pick<Window, '__millqTerminalChronology'> = globalThis as Window,
): void {
  target.__millqTerminalChronology = {
    allocateTerminalBusinessChronology,
    peekTerminalBusinessOrder,
    loadLockedCompleteChronology,
    persistLockedCompleteChronology,
    clearLockedCompleteChronology,
  };
}
