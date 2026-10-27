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
 * C0-CHRONO1: cross-tab allocation is serialized via Web Locks (preferred) or a
 * localStorage busy-lock with verified CAS. Silent duplicate `businessOrder` across
 * parallel windows of the same terminal is rejected; unsupported environments fail closed.
 */

const STORAGE_PREFIX = 'millq.terminalBusinessOrder.';
const LOCK_SUFFIX = '.lock';

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
 * Read → increment → write with post-write verification.
 * Caller must hold an exclusive lock (Web Lock or busy-lock).
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
      'Concurrent tab mutated businessOrder counter during allocation; retry',
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

/**
 * Best-effort exclusive busy-lock in localStorage.
 * `Date.now()` is used only for lock TTL — never as businessOrder.
 */
export function createLocalStorageBusyLockRequest(options?: {
  ttlMs?: number;
  attempts?: number;
  ownerId?: string;
  sleepMs?: number;
}): ChronologyLockRequest {
  const ttlMs = options?.ttlMs ?? 2_000;
  const attempts = options?.attempts ?? 40;
  const sleepMs = options?.sleepMs ?? 25;
  const ownerId = options?.ownerId ?? crypto.randomUUID();

  return async (name, run) => {
    const lockKey = `${name}${LOCK_SUFFIX}`;
    for (let i = 0; i < attempts; i++) {
      const now = Date.now();
      let heldByOther = false;
      try {
        const raw = localStorage.getItem(lockKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { owner?: string; until?: number };
          if (
            typeof parsed.until === 'number' &&
            parsed.until > now &&
            parsed.owner &&
            parsed.owner !== ownerId
          ) {
            heldByOther = true;
          }
        }
        if (!heldByOther) {
          const payload = JSON.stringify({ owner: ownerId, until: now + ttlMs });
          localStorage.setItem(lockKey, payload);
          const check = localStorage.getItem(lockKey);
          if (check === payload) {
            try {
              return await run();
            } finally {
              try {
                const cur = localStorage.getItem(lockKey);
                if (cur === payload) localStorage.removeItem(lockKey);
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* storage denied */
      }
      await new Promise((r) => setTimeout(r, sleepMs));
    }
    throw new TerminalChronologyError(
      'CHRONOLOGY_ALLOCATION_BUSY',
      'Could not acquire exclusive businessOrder lock across terminal windows; retry',
    );
  };
}

function resolveLockRequest(explicit?: ChronologyLockRequest): ChronologyLockRequest {
  if (explicit) return explicit;
  const web = createWebLocksRequest();
  if (web) return web;
  // Fail closed for multi-document without Web Locks: busy-lock still tries;
  // if it cannot acquire, allocate throws CHRONOLOGY_ALLOCATION_BUSY (no silent dup).
  return createLocalStorageBusyLockRequest();
}

/**
 * Allocate the next monotonic businessOrder for this terminal + businessDate.
 * Persists in localStorage so reload/retry after UNKNOWN keeps sequence once locked
 * chronology is also persisted by the checkout UI.
 *
 * Cross-tab safe when Web Locks or busy-lock succeeds. Never uses Date.now() as order.
 */
export async function allocateTerminalBusinessChronology(input: {
  terminalId: string;
  timeZone: string;
  now?: Date;
  /** Inject exclusive lock (tests). Default: Web Locks → localStorage busy-lock. */
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

export function persistLockedCompleteChronology(
  settlementGroupId: string,
  chrono: TerminalBusinessChronology,
): void {
  try {
    sessionStorage.setItem(
      `${COMPLETE_CHRONO_PREFIX}${settlementGroupId}`,
      JSON.stringify(chrono),
    );
  } catch {
    /* ignore */
  }
}

export function clearLockedCompleteChronology(settlementGroupId: string): void {
  try {
    sessionStorage.removeItem(`${COMPLETE_CHRONO_PREFIX}${settlementGroupId}`);
  } catch {
    /* ignore */
  }
}
