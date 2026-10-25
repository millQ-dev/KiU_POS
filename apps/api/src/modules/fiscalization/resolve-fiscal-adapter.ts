/**
 * Resolve FiscalProviderAdapter for HTTP / runtime wiring (ADR-0014).
 *
 * Production always uses unavailable (fail-closed). The test-satisfying adapter is
 * allowed only in the explicit disposable/test contour — never on production routes.
 */
import {
  testSatisfyingFiscalProviderAdapter,
  unavailableFiscalProviderAdapter,
  type FiscalProviderAdapter,
} from './fiscal-provider-adapter.js';

export type ResolveFiscalAdapterInput = {
  /** Fastify/route production flag (NODE_ENV === 'production'). */
  isProduction: boolean;
  /** process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER */
  allowFiscalTestAdapterEnv?: string | null;
  /** process.env.DATABASE_URL — disposable millq_ci_pos_* required for test adapter. */
  databaseUrl?: string | null;
  /** process.env.NODE_ENV */
  nodeEnv?: string | null;
};

const DISPOSABLE_POS_DB =
  /\/millq_ci_pos(?:_[A-Za-z0-9]+)+(\?|$)/;

/**
 * Hard gate: test adapter never loads when isProduction or NODE_ENV=production.
 * Opt-in + disposable POS DB required otherwise.
 */
export function resolveFiscalProviderAdapter(
  input: ResolveFiscalAdapterInput,
): { adapter: FiscalProviderAdapter; mode: 'unavailable' | 'test-satisfying' } {
  const nodeEnv = (input.nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (input.isProduction || nodeEnv === 'production') {
    return { adapter: unavailableFiscalProviderAdapter(), mode: 'unavailable' };
  }

  const allow =
    (input.allowFiscalTestAdapterEnv ?? process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER ?? '') ===
    '1';
  const db = input.databaseUrl ?? process.env.DATABASE_URL ?? '';
  const disposable = DISPOSABLE_POS_DB.test(db) && !/millq_dev/.test(db);

  if (allow && disposable) {
    return {
      adapter: testSatisfyingFiscalProviderAdapter('AUTHORITY_ACCEPTED'),
      mode: 'test-satisfying',
    };
  }

  return { adapter: unavailableFiscalProviderAdapter(), mode: 'unavailable' };
}
