/** ADR-0048 FinancialRefundStatus (money side). FiscalCorrectionStatus is independent / out of B1. */
export type FinancialRefundStatus =
  | 'AUTHORIZED'
  | 'EXECUTION_PENDING'
  | 'EXECUTION_UNKNOWN'
  | 'RECONCILE_BLOCKED'
  | 'EXECUTION_FAILED'
  | 'MONEY_RETURNED';

export const ACTIVE_RESERVATION_STATUSES: ReadonlySet<FinancialRefundStatus> = new Set([
  'AUTHORIZED',
  'EXECUTION_PENDING',
  'EXECUTION_UNKNOWN',
  'RECONCILE_BLOCKED',
]);

/** Owner-issued scoped grant keys (ADR-0048 R8). Job title alone grants nothing. */
export const PERMISSION_PAYMENTS_REFUND_CASH = 'payments.refund_cash' as const;
export const PERMISSION_PAYMENTS_REFUND_VIETQR = 'payments.refund_vietqr' as const;
export const PERMISSION_PAYMENTS_REFUND_APPROVE = 'payments.refund.approve' as const;
export const PERMISSION_PAYMENTS_REFUND_RECONCILE = 'payments.refund.reconcile' as const;

export type RefundGrantKey =
  | typeof PERMISSION_PAYMENTS_REFUND_CASH
  | typeof PERMISSION_PAYMENTS_REFUND_VIETQR
  | typeof PERMISSION_PAYMENTS_REFUND_APPROVE
  | typeof PERMISSION_PAYMENTS_REFUND_RECONCILE;

/** Disposable-test-only money-effect proof. Production CASH/VietQR proofs arrive in later slices. */
export const DISPOSABLE_TEST_MONEY_EFFECT_PROOF = 'DISPOSABLE_TEST_MONEY_EFFECT_PROOF' as const;

export type VerifiedMoneyEffectEvidence = {
  evidenceKind: typeof DISPOSABLE_TEST_MONEY_EFFECT_PROOF;
  recordedByActorId: string;
  payload?: Record<string, unknown>;
};

export type NonPaymentProofEvidence = {
  evidenceKind: 'NON_PAYMENT_PROVEN';
  recordedByActorId: string;
  payload?: Record<string, unknown>;
};

export type PaymentRefundProjection = {
  paymentRefundId: string;
  tenantId: string;
  legalEntityId: string;
  originalPaymentId: string;
  settlementCheckId: string;
  settlementGroupId: string;
  outletId: string;
  tenderDefinitionId: string;
  instrumentFamily: string;
  amountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  financialStatus: FinancialRefundStatus;
  reservationHoldsCapacity: boolean;
  nonPaymentProven: boolean;
  refundIdempotencyKey: string;
  semanticFingerprint: string;
  reasonText: string;
  authorizedByUserId: string | null;
  payoutAttemptId: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  duplicate?: boolean;
};

export type RefundCapacitySnapshot = {
  originalPaymentId: string;
  settlementCheckId: string;
  settlementGroupId: string;
  qualifyingMinor: string;
  confirmedRefundsMinor: string;
  activeReservationsMinor: string;
  remainingCapacityMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  outletId: string;
  tenderDefinitionId: string;
  instrumentFamily: string;
  tenantId: string;
  legalEntityId: string;
};
