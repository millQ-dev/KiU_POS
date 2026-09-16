import { DomainValidationError } from '../orders/errors.js';

/** Canonical Payment lifecycle (ADR-0032 outcome classes). Not a card auth/capture machine. */
export type PaymentLifecycleState =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

export type NormalizedProviderOutcome =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'UNVERIFIED';

export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED';

export type ReconciliationOrigin = 'CALLBACK' | 'INQUIRY' | 'DEV_SIMULATOR' | 'SYSTEM';

const TERMINAL_SUCCESS = new Set<PaymentLifecycleState>(['SUCCEEDED']);
const TERMINAL_NON_SUCCESS = new Set<PaymentLifecycleState>([
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

/** True if state is a qualifying successful/final outcome for Settlement coverage. */
export function isQualifyingSuccess(state: PaymentLifecycleState): boolean {
  return state === 'SUCCEEDED';
}

/**
 * Apply a verified normalized outcome to current lifecycle.
 * Stale PENDING after SUCCESS must not regress.
 */
export function applyNormalizedOutcomeToLifecycle(
  current: PaymentLifecycleState,
  normalized: NormalizedProviderOutcome,
): PaymentLifecycleState {
  if (normalized === 'UNVERIFIED' || normalized === 'AMOUNT_MISMATCH' || normalized === 'CURRENCY_MISMATCH') {
    // Quarantine / non-qualifying — do not invent SUCCESS; leave current unless still early.
    if (current === 'INITIATED') return 'UNKNOWN';
    return current;
  }
  if (normalized === 'SUCCEEDED') {
    if (TERMINAL_NON_SUCCESS.has(current)) {
      throw new DomainValidationError(
        'PAYMENT_STATE_MONOTONICITY',
        `Cannot transition ${current} → SUCCEEDED`,
      );
    }
    return 'SUCCEEDED';
  }
  if (normalized === 'PENDING') {
    if (TERMINAL_SUCCESS.has(current) || TERMINAL_NON_SUCCESS.has(current)) {
      return current; // stale pending ignored
    }
    return 'PENDING';
  }
  if (normalized === 'FAILED' || normalized === 'CANCELLED' || normalized === 'EXPIRED') {
    if (TERMINAL_SUCCESS.has(current)) {
      throw new DomainValidationError(
        'PAYMENT_STATE_MONOTONICITY',
        `Cannot regress SUCCEEDED → ${normalized}; void/refund requires compensating architecture`,
      );
    }
    return normalized;
  }
  // UNKNOWN
  if (TERMINAL_SUCCESS.has(current) || TERMINAL_NON_SUCCESS.has(current)) {
    return current;
  }
  return 'UNKNOWN';
}

export function presentationCapabilityAllowed(value: string | null | undefined): boolean {
  if (value == null) return true;
  return (
    value === 'MERCHANT_PRESENTED' ||
    value === 'CUSTOMER_PRESENTED' ||
    value === 'DEVICE_INTERACTION' ||
    value === 'REDIRECT_OR_DEEPLINK'
  );
}
