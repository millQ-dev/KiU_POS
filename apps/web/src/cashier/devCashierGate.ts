/**
 * DEV cashier bootstrap is reachable only when BOTH:
 * - Vite development runtime (`import.meta.env.DEV`)
 * - explicit `?devCashier=1`
 *
 * Production builds must never enter DevContextBootstrap / stored DEV context.
 */
export function isDevCashierPathEnabled(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
  isDevBuild: boolean = import.meta.env.DEV,
): boolean {
  if (!isDevBuild) return false;
  return new URLSearchParams(search).get('devCashier') === '1';
}

export const DEV_CASHIER_STORAGE_KEY = 'millq.dev.cashierContext.v1';
