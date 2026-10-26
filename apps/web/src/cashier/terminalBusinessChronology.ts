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
 */

const STORAGE_PREFIX = 'millq.terminalBusinessOrder.';

export type TerminalBusinessChronology = {
  businessDate: string;
  businessOrder: number;
};

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

/**
 * Allocate the next monotonic businessOrder for this terminal + businessDate.
 * Persists in localStorage so reload/retry after UNKNOWN keeps sequence.
 */
export function allocateTerminalBusinessChronology(input: {
  terminalId: string;
  timeZone: string;
  now?: Date;
}): TerminalBusinessChronology {
  const now = input.now ?? new Date();
  const businessDate = businessDateInTimeZone(now, input.timeZone);
  const key = storageKey(input.terminalId, businessDate);
  let next = 1;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null && /^[0-9]+$/.test(raw)) {
      next = Number(raw) + 1;
    }
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem(key, String(next));
  } catch {
    /* ignore */
  }
  return { businessDate, businessOrder: next };
}

/** Peek without allocating — tests / diagnostics. */
export function peekTerminalBusinessOrder(terminalId: string, businessDate: string): number {
  try {
    const raw = localStorage.getItem(storageKey(terminalId, businessDate));
    if (raw != null && /^[0-9]+$/.test(raw)) return Number(raw);
  } catch {
    /* ignore */
  }
  return 0;
}
