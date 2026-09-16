/**
 * Canonical decimal quantity helpers for cashier UX.
 * No binary float arithmetic; strings stay the business representation.
 */

const CANONICAL_RE = /^-?\d+(\.\d+)?$/;

export function isCanonicalDecimalString(raw: string): boolean {
  const t = raw.trim();
  return t.length > 0 && CANONICAL_RE.test(t);
}

/** COUNT must be a positive integer string (domain createQuantity rule). */
export function isValidCountQuantityString(raw: string): boolean {
  const t = raw.trim();
  if (!/^[1-9]\d*$/.test(t)) return false;
  return true;
}

/** MASS/VOLUME: positive canonical decimal, no leading junk. */
export function isValidWeightedQuantityString(raw: string): boolean {
  if (!isCanonicalDecimalString(raw)) return false;
  const t = raw.trim();
  if (t.startsWith('-')) return false;
  if (t === '0' || /^0\.0+$/.test(t)) return false;
  // Reject trailing decimal point etc. already covered by regex
  return true;
}

/** Integer increment/decrement for COUNT only — string arithmetic, no Number(). */
export function bumpCountQuantity(current: string, delta: 1 | -1): string | null {
  if (!/^\d+$/.test(current.trim())) return null;
  const n = BigInt(current.trim());
  const next = n + BigInt(delta);
  if (next <= 0n) return null;
  return next.toString();
}
