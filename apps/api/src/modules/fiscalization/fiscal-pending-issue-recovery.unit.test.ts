import { describe, expect, it } from 'vitest';
import {
  invokeFiscalRecovery,
  testSatisfyingFiscalProviderAdapter,
  unavailableFiscalProviderAdapter,
  type FiscalAdapterIssueInput,
  type FiscalAdapterResult,
  type FiscalProviderAdapter,
} from './fiscal-provider-adapter.js';
import {
  defaultC0SatisfactionProfile,
  evidenceSatisfiesProfile,
} from './fiscal-satisfaction-profile.js';
import { selectSandboxProviderBinding } from './sandbox-provider-binding.js';

const documentId = 'doc-same';
const issueKey = 'idem-same';

const issue: FiscalAdapterIssueInput = {
  fiscalDocumentId: documentId,
  legalEntityId: 'le-a',
  settlementGroupId: 'sg-1',
  orderId: 'order-1',
  paymentCollectionEventId: 'pce-1',
  collectionBusinessTime: '2026-10-30T00:00:00.000Z',
  taxOrderSnapshotId: 'tax-1',
  taxSemanticFingerprint: 'tax-hash-1',
  documentAmountMinor: '1000',
  currencyCode: 'VND',
  issueIdempotencyKey: issueKey,
};

function spyAdapter(verifiedSameKeyRetry?: true): FiscalProviderAdapter & { calls: string[] } {
  const calls: string[] = [];
  const unknown = async (): Promise<FiscalAdapterResult> => ({
    attemptStatus: 'TIMEOUT',
    evidenceClass: 'UNKNOWN',
    verificationStatus: 'UNVERIFIED',
    rawProviderStatus: 'UNKNOWN',
  });
  return {
    calls,
    adapterIdentity: 'millq.fiscal.recovery-spy',
    ...(verifiedSameKeyRetry ? { verifiedSameKeyRetry } : {}),
    async issue() {
      calls.push('ISSUE');
      return unknown();
    },
    async queryStatus() {
      calls.push('QUERY_STATUS');
      return unknown();
    },
    async retrieveEvidence() {
      calls.push('RETRIEVE_EVIDENCE');
      return unknown();
    },
    async idempotentRetry(input) {
      calls.push(`IDEMPOTENT_RETRY:${input.fiscalDocumentId}`);
      return {
        attemptStatus: 'SUCCEEDED',
        evidenceClass: 'AUTHORITY_ACCEPTED',
        verificationStatus: 'VERIFIED',
        rawProviderStatus: 'RETRY_ACCEPTED',
      };
    },
    async reconcileTimeoutAfterSuccess(input) {
      calls.push(`RECONCILE_TIMEOUT:${input.fiscalDocumentId}`);
      return unknown();
    },
  };
}

describe('PENDING_ISSUE recovery', () => {
  it('does not reissue after a crash when the adapter only has a method named idempotentRetry', async () => {
    const adapter = spyAdapter();
    const first = await invokeFiscalRecovery(adapter, 'PENDING_ISSUE', issue);
    expect(first.operation).toBe('RECONCILE_TIMEOUT');
    expect(first.result.evidenceClass).toBe('UNKNOWN');
    expect(first.result.verificationStatus).toBe('UNVERIFIED');
    expect(adapter.calls).toEqual([`RECONCILE_TIMEOUT:${documentId}`]);
    expect(
      evidenceSatisfiesProfile(defaultC0SatisfactionProfile(), {
        evidenceClass: first.result.evidenceClass,
        verificationStatus: first.result.verificationStatus,
      }),
    ).toBe(false);
  });

  it('reconciles a timeout-after-success document even when same-key retry is verified', async () => {
    const adapter = spyAdapter(true);
    const recovered = await invokeFiscalRecovery(adapter, 'ISSUED_PENDING_EVIDENCE', issue);
    expect(recovered.operation).toBe('RECONCILE_TIMEOUT');
    expect(adapter.calls).toEqual([`RECONCILE_TIMEOUT:${documentId}`]);
  });

  it('repeats reconciliation on the same document id and still does not issue', async () => {
    const adapter = spyAdapter();
    await invokeFiscalRecovery(adapter, 'PENDING_ISSUE', issue);
    await invokeFiscalRecovery(adapter, 'PENDING_ISSUE', issue);
    expect(adapter.calls).toEqual([
      `RECONCILE_TIMEOUT:${documentId}`,
      `RECONCILE_TIMEOUT:${documentId}`,
    ]);
  });

  it('retries the same document only when verifiedSameKeyRetry is exactly true', async () => {
    const adapter = spyAdapter(true);
    const recovered = await invokeFiscalRecovery(adapter, 'PENDING_ISSUE', issue);
    expect(recovered.operation).toBe('IDEMPOTENT_RETRY');
    expect(adapter.calls).toEqual([`IDEMPOTENT_RETRY:${documentId}`]);
  });

  it('does not treat the production or disposable test adapters as verified retry', async () => {
    const unavailable = unavailableFiscalProviderAdapter();
    const disposable = testSatisfyingFiscalProviderAdapter();
    expect(unavailable.verifiedSameKeyRetry).toBeUndefined();
    expect(disposable.verifiedSameKeyRetry).toBeUndefined();
    const pending = await invokeFiscalRecovery(unavailable, 'PENDING_ISSUE', issue);
    expect(pending.operation).toBe('RECONCILE_TIMEOUT');
    expect(pending.result.evidenceClass).toBe('ADAPTER_UNAVAILABLE');
    expect(pending.result.verificationStatus).toBe('UNVERIFIED');
  });

  it('denies a wrong LegalEntity and a cross-tenant request before any provider call', () => {
    const bindings = [
      {
        tenantId: 'tenant-a',
        legalEntityId: 'le-a',
        providerCode: 'VIETTEL_SINVOICE' as const,
        environment: 'SANDBOX' as const,
        enabled: true,
        credentialRef: 'vault://fiscal/le-a',
      },
    ];
    expect(
      selectSandboxProviderBinding(bindings, {
        tenantId: 'tenant-a',
        legalEntityId: 'le-b',
        providerCode: 'VIETTEL_SINVOICE',
      }),
    ).toEqual({ outcome: 'DENIED', reason: 'WRONG_LEGAL_ENTITY' });
    expect(
      selectSandboxProviderBinding(bindings, {
        tenantId: 'tenant-b',
        legalEntityId: 'le-a',
        providerCode: 'VIETTEL_SINVOICE',
      }),
    ).toEqual({ outcome: 'DENIED', reason: 'CROSS_TENANT' });
  });

  it('keeps an unknown provider outcome unresolved under the current satisfaction profile', () => {
    expect(
      evidenceSatisfiesProfile(defaultC0SatisfactionProfile(), {
        evidenceClass: 'UNKNOWN',
        verificationStatus: 'UNVERIFIED',
      }),
    ).toBe(false);
    expect(
      evidenceSatisfiesProfile(defaultC0SatisfactionProfile(), {
        evidenceClass: 'AUTHORITY_ACCEPTED',
        verificationStatus: 'VERIFIED',
      }),
    ).toBe(true);
  });
});
