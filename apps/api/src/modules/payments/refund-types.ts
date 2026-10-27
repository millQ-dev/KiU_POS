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
  cashShiftId: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  duplicate?: boolean;
};

/** Production CASH handover evidence kind (ADR-0048 B2). */
export const CASH_HANDOVER_CONFIRM_EVIDENCE = 'CASH_HANDOVER_CONFIRM' as const;

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
