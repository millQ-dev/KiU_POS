/**
 * Positive allowlist for disposable PostgreSQL URLs used by acceptance suites.
 * millq_dev / staging / production / shared URLs must never enable these suites.
 */
/** e.g. millq_migrate_runner_42, millq_ci_pos_42_1, millq_ci_gr_42_1 */
export const DISPOSABLE_DATABASE_URL_RE =
  /\/millq_(?:migrate_runner|ci_pos|ci_gr)(?:_[A-Za-z0-9]+)+(\?|$)/;

/** GoodsReceipt destructive suites: only millq_ci_gr_* (never millq_dev / pos / migrate_runner). */
export const GOODS_RECEIPT_DISPOSABLE_DATABASE_URL_RE =
  /\/millq_ci_gr(?:_[A-Za-z0-9]+)+(\?|$)/;

/** POS / Identity destructive suites: only millq_ci_pos_* (never millq_dev / gr / migrate_runner). */
export const POS_DISPOSABLE_DATABASE_URL_RE = /\/millq_ci_pos(?:_[A-Za-z0-9]+)+(\?|$)/;

export function isDisposableDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (/\/millq_dev(\?|$)/.test(url)) return false;
  return DISPOSABLE_DATABASE_URL_RE.test(url);
}

export function isGoodsReceiptDisposableDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (/\/millq_dev(\?|$)/.test(url)) return false;
  return GOODS_RECEIPT_DISPOSABLE_DATABASE_URL_RE.test(url);
}

export function isPosDisposableDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (/\/millq_dev(\?|$)/.test(url)) return false;
  return POS_DISPOSABLE_DATABASE_URL_RE.test(url);
}

/** Fail closed before migrate/TRUNCATE. */
export function assertGoodsReceiptDisposableDatabaseUrl(url: string | undefined | null): string {
  if (!isGoodsReceiptDisposableDatabaseUrl(url)) {
    throw new Error(
      'GoodsReceipt destructive acceptance requires DATABASE_URL matching /millq_ci_gr(_…)? (not millq_dev / shared / staging / production)',
    );
  }
  return url as string;
}

/** Fail closed before migrate/TRUNCATE for POS Identity destructive suites. */
export function assertPosDisposableDatabaseUrl(url: string | undefined | null): string {
  if (!isPosDisposableDatabaseUrl(url)) {
    throw new Error(
      'POS Identity destructive acceptance requires DATABASE_URL matching /millq_ci_pos(_…)? (not millq_dev / shared / staging / production)',
    );
  }
  return url as string;
}
