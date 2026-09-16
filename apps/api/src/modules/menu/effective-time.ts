/**
 * Half-open commercial effectiveness: [effectiveFrom, effectiveTo).
 * Comparisons use absolute instants (TIMESTAMPTZ). Outlet IANA TZ is used for
 * local business calendar derivation — never Node/DB/browser timezone as authority.
 */
export function isEffectiveAt(
  at: Date,
  effectiveFrom: Date,
  effectiveTo: Date | null,
): boolean {
  if (at.getTime() < effectiveFrom.getTime()) return false;
  if (effectiveTo !== null && at.getTime() >= effectiveTo.getTime()) return false;
  return true;
}

/** Local calendar date YYYY-MM-DD in the given IANA timezone (no UTC slice). */
export function localBusinessDateIso(instant: Date, ianaTimezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) {
    throw new Error(`Unable to derive local business date for timezone ${ianaTimezone}`);
  }
  return `${y}-${m}-${d}`;
}

/** Local wall-clock HH:mm:ss in IANA timezone. */
export function localBusinessTimeIso(instant: Date, ianaTimezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ianaTimezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const s = parts.find((p) => p.type === 'second')?.value ?? '00';
  return `${h}:${m}:${s}`;
}

export function assertIanaTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

export const SCOPE_RANK: Record<'TENANT' | 'BRAND' | 'OUTLET', number> = {
  TENANT: 1,
  BRAND: 2,
  OUTLET: 3,
  // TerminalGroup / Terminal deferred until Organization runtime exists.
};
