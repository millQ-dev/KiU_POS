/**
 * Provider-neutral FiscalProviderAdapter (ADR-0014 D9).
 * No vendor DTOs enter Fiscal Core. No LEGAL GATE G2 / legal sufficiency claims.
 */

export type FiscalAdapterOperation =
  | 'ISSUE'
  | 'QUERY_STATUS'
  | 'RETRIEVE_EVIDENCE'
  | 'IDEMPOTENT_RETRY'
  | 'RECONCILE_TIMEOUT';

export type FiscalAdapterAttemptStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'ADAPTER_UNAVAILABLE'
  | 'REJECTED';

export type FiscalEvidenceClass =
  | 'AUTHORITY_ACCEPTED'
  | 'PROVIDER_CONFIRMED_ISSUED'
  | 'AUTHORITATIVE_RETRIEVAL'
  | 'TRANSPORT_TIMEOUT'
  | 'TRANSPORT_FAILURE'
  | 'ADAPTER_UNAVAILABLE'
  | 'UNKNOWN'
  | 'REJECTED';

export type FiscalAdapterIssueInput = {
  fiscalDocumentId: string;
  legalEntityId: string;
  settlementGroupId: string;
  orderId: string;
  paymentCollectionEventId: string;
  collectionBusinessTime: string;
  taxOrderSnapshotId: string;
  taxSemanticFingerprint: string;
  documentAmountMinor: string;
  currencyCode: string;
  issueIdempotencyKey: string;
};

export type FiscalAdapterResult = {
  attemptStatus: FiscalAdapterAttemptStatus;
  evidenceClass: FiscalEvidenceClass;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED';
  rawProviderStatus: string;
  providerReference?: string | null;
  diagnosticMetadata?: Record<string, unknown>;
};

/**
 * Minimum adapter surface (ADR-0014 D9). Concrete Vietnam production provider is OUT.
 */
export type FiscalProviderAdapter = {
  readonly adapterIdentity: string;
  /**
   * Written provider contract that the same issue key will not create a second invoice.
   * The presence of idempotentRetry is not this capability. Absent means do not call it.
   */
  readonly verifiedSameKeyRetry?: true;
  issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterResult>;
  queryStatus(input: {
    fiscalDocumentId: string;
    providerReference?: string | null;
    issueIdempotencyKey: string;
  }): Promise<FiscalAdapterResult>;
  retrieveEvidence(input: {
    fiscalDocumentId: string;
    providerReference?: string | null;
  }): Promise<FiscalAdapterResult>;
  idempotentRetry(input: FiscalAdapterIssueInput): Promise<FiscalAdapterResult>;
  reconcileTimeoutAfterSuccess(input: {
    fiscalDocumentId: string;
    providerReference?: string | null;
    issueIdempotencyKey: string;
  }): Promise<FiscalAdapterResult>;
};

/**
 * PENDING_ISSUE may repeat issue only when verifiedSameKeyRetry is exactly true.
 * Timeout-after-success and every unverified adapter reconcile instead.
 */
export function selectFiscalRecoveryOperation(input: {
  documentStatus: string;
  verifiedSameKeyRetry: boolean;
}): 'NONE' | 'IDEMPOTENT_RETRY' | 'RECONCILE_TIMEOUT' {
  if (input.documentStatus === 'SATISFIED') return 'NONE';
  if (input.documentStatus === 'PENDING_ISSUE' && input.verifiedSameKeyRetry) {
    return 'IDEMPOTENT_RETRY';
  }
  return 'RECONCILE_TIMEOUT';
}

/**
 * Calls idempotentRetry only when selectFiscalRecoveryOperation says so.
 * Otherwise asks the same document id for status. Does not allocate a new document.
 */
export async function invokeFiscalRecovery(
  adapter: FiscalProviderAdapter,
  documentStatus: string,
  issue: FiscalAdapterIssueInput,
): Promise<{
  operation: 'IDEMPOTENT_RETRY' | 'RECONCILE_TIMEOUT';
  result: FiscalAdapterResult;
}> {
  const selected = selectFiscalRecoveryOperation({
    documentStatus,
    verifiedSameKeyRetry: adapter.verifiedSameKeyRetry === true,
  });
  if (selected === 'IDEMPOTENT_RETRY') {
    return { operation: selected, result: await adapter.idempotentRetry(issue) };
  }
  return {
    operation: 'RECONCILE_TIMEOUT',
    result: await adapter.reconcileTimeoutAfterSuccess({
      fiscalDocumentId: issue.fiscalDocumentId,
      issueIdempotencyKey: issue.issueIdempotencyKey,
    }),
  };
}

/** Production default until a provider adapter is configured — fail closed, never fake SATISFIED. */
export function unavailableFiscalProviderAdapter(): FiscalProviderAdapter {
  const unavailable = async (): Promise<FiscalAdapterResult> => ({
    attemptStatus: 'ADAPTER_UNAVAILABLE',
    evidenceClass: 'ADAPTER_UNAVAILABLE',
    verificationStatus: 'UNVERIFIED',
    rawProviderStatus: 'ADAPTER_UNAVAILABLE',
    diagnosticMetadata: { reason: 'No FiscalProviderAdapter configured' },
  });
  return {
    adapterIdentity: 'millq.fiscal.unavailable',
    issue: unavailable,
    queryStatus: unavailable,
    retrieveEvidence: unavailable,
    idempotentRetry: unavailable,
    reconcileTimeoutAfterSuccess: unavailable,
  };
}

/**
 * Test-only adapter. Must never be registered on production HTTP routes (ADR-0014 D28 / ADR-0038 A8).
 */
export function testSatisfyingFiscalProviderAdapter(
  evidenceClass: FiscalEvidenceClass = 'AUTHORITY_ACCEPTED',
): FiscalProviderAdapter {
  const ok = async (input: { fiscalDocumentId: string }): Promise<FiscalAdapterResult> => ({
    attemptStatus: 'SUCCEEDED',
    evidenceClass,
    verificationStatus: 'VERIFIED',
    rawProviderStatus: 'TEST_ACCEPTED',
    providerReference: `test:${input.fiscalDocumentId}`,
    diagnosticMetadata: { testOnly: true },
  });
  return {
    adapterIdentity: 'millq.fiscal.test-satisfying',
    issue: ok,
    queryStatus: ok,
    retrieveEvidence: ok,
    idempotentRetry: ok,
    reconcileTimeoutAfterSuccess: ok,
  };
}
