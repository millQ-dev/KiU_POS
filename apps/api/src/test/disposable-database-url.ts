/**
 * Positive allowlist for disposable PostgreSQL URLs used by acceptance suites.
 * millq_dev / staging / production / shared URLs must never enable these suites.
 */
/** Requires a disposable suffix, e.g. millq_migrate_runner_42 or millq_ci_pos_42_1 */
export const DISPOSABLE_DATABASE_URL_RE =
  /\/millq_(?:migrate_runner|ci_pos)(?:_[A-Za-z0-9]+)+(\?|$)/;

export function isDisposableDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (/\/millq_dev(\?|$)/.test(url)) return false;
  return DISPOSABLE_DATABASE_URL_RE.test(url);
}
