import { describe, expect, it } from 'vitest';
import type {
  FiscalAdapterIssueInput,
  FiscalAdapterResult,
  FiscalProviderAdapter,
} from './fiscal-provider-adapter.js';
import { resolveFiscalProviderAdapter } from './resolve-fiscal-adapter.js';
import { executeSandboxFiscalAttempt } from './sandbox-fiscal-attempt.js';
import type { FiscalIntentKey } from './fiscal-intent-recovery.js';
import type { SandboxProviderBinding } from './sandbox-provider-binding.js';

const intent: FiscalIntentKey = {
  legalEntityId: 'le-a',
  fiscalDocumentId: 'doc-1',
  semanticHash: 'tax-hash-1',
  providerCode: 'VIETTEL_SINVOICE',
};

const issueInput: FiscalAdapterIssueInput = {
  fiscalDocumentId: 'doc-1',
  legalEntityId: 'le-a',
  settlementGroupId: 'sg-1',
  orderId: 'order-1',
  paymentCollectionEventId: 'pce-1',
  collectionBusinessTime: '2026-10-30T00:00:00.000Z',
  taxOrderSnapshotId: 'tax-1',
  taxSemanticFingerprint: 'tax-hash-1',
  documentAmountMinor: '1000',
  currencyCode: 'VND',
  issueIdempotencyKey: 'idem-1',
};

function binding(overrides: Partial<SandboxProviderBinding> = {}): SandboxProviderBinding {
  return {
    tenantId: 'tenant-a',
    legalEntityId: 'le-a',
    providerCode: 'VIETTEL_SINVOICE',
    environment: 'SANDBOX',
    enabled: true,
    credentialRef: 'vault://fiscal/le-a',
    ...overrides,
  };
}

function countingAdapter(): FiscalProviderAdapter & { readonly calls: string[] } {
  const calls: string[] = [];
  const result = (status: FiscalAdapterResult['attemptStatus'], evidence: FiscalAdapterResult['evidenceClass']): FiscalAdapterResult => ({
    attemptStatus: status,
    evidenceClass: evidence,
    verificationStatus: 'VERIFIED',
    rawProviderStatus: status,
    providerReference: 'synthetic-ref',
  });
  return {
    calls,
    adapterIdentity: 'millq.fiscal.sandbox.synthetic',
    async issue() {
      calls.push('ISSUE');
      return result('TIMEOUT', 'TRANSPORT_TIMEOUT');
    },
    async queryStatus() {
      calls.push('QUERY_STATUS');
      return result('TIMEOUT', 'UNKNOWN');
    },
    async retrieveEvidence() {
      calls.push('RETRIEVE_EVIDENCE');
      return result('TIMEOUT', 'UNKNOWN');
    },
    async idempotentRetry() {
      calls.push('IDEMPOTENT_RETRY');
      return result('SUCCEEDED', 'PROVIDER_CONFIRMED_ISSUED');
    },
    async reconcileTimeoutAfterSuccess() {
      calls.push('RECONCILE_TIMEOUT');
      return result('TIMEOUT', 'UNKNOWN');
    },
  };
}

async function run(
  overrides: Partial<Parameters<typeof executeSandboxFiscalAttempt>[0]> = {},
  adapter = countingAdapter(),
) {
  const report = await executeSandboxFiscalAttempt({
    bindings: [binding()],
    tenantId: 'tenant-a',
    providerCode: 'VIETTEL_SINVOICE',
    intent,
    situation: 'FIRST_ISSUE',
    idempotencyContract: 'UNVERIFIED',
    semanticHashUnchanged: true,
    issueInput,
    adapter,
    ...overrides,
  });
  return { report, adapter };
}

describe('sandbox fiscal foundation', () => {
  it('keeps the production resolver unavailable', () => {
    const resolved = resolveFiscalProviderAdapter({
      isProduction: true,
      allowFiscalTestAdapterEnv: '1',
      databaseUrl: 'postgresql://millq:millq@localhost:5432/millq_ci_pos_fisc1',
      nodeEnv: 'production',
    });
    expect(resolved.mode).toBe('unavailable');
    expect(resolved.adapter.adapterIdentity).toBe('millq.fiscal.unavailable');
  });

  it('issues once for an enabled SANDBOX binding and does not treat the result as fiscal success', async () => {
    const { report, adapter } = await run();
    expect(report.binding.outcome).toBe('SELECTED');
    expect(report.adapterInvoked).toBe('ISSUE');
    expect(adapter.calls).toEqual(['ISSUE']);
    expect(report.fiscalDocumentId).toBe('doc-1');
    expect(report.treatedAsFiscalSuccess).toBe(false);
    expect(report.checkoutGateEffect).toBe('UNCHANGED');
    expect(report.result?.verificationStatus).toBe('UNVERIFIED');
  });

  it('denies a different LegalEntity without calling the adapter', async () => {
    const { report, adapter } = await run({
      intent: { ...intent, legalEntityId: 'le-b' },
      issueInput: { ...issueInput, legalEntityId: 'le-b' },
    });
    expect(report.binding).toEqual({ outcome: 'DENIED', reason: 'WRONG_LEGAL_ENTITY' });
    expect(adapter.calls).toEqual([]);
  });

  it('denies a cross-tenant binding without calling the adapter', async () => {
    const { report, adapter } = await run({ tenantId: 'tenant-b' });
    expect(report.binding).toEqual({ outcome: 'DENIED', reason: 'CROSS_TENANT' });
    expect(adapter.calls).toEqual([]);
  });

  it('refuses PRODUCTION even when the binding is enabled', async () => {
    const { report, adapter } = await run({
      bindings: [binding({ environment: 'PRODUCTION', enabled: true })],
    });
    expect(report.binding).toEqual({ outcome: 'DENIED', reason: 'PRODUCTION_FORBIDDEN' });
    expect(adapter.calls).toEqual([]);
  });

  it('denies an unconfigured provider and an unknown provider code', async () => {
    const missing = await run({ bindings: [] });
    expect(missing.report.binding).toEqual({ outcome: 'DENIED', reason: 'UNCONFIGURED' });
    expect(missing.adapter.calls).toEqual([]);

    const unknown = await run({ providerCode: 'VNPT' });
    expect(unknown.report.binding).toEqual({ outcome: 'DENIED', reason: 'UNKNOWN_PROVIDER' });
    expect(unknown.adapter.calls).toEqual([]);
  });

  it('leaves a disabled SANDBOX binding unselected', async () => {
    const { report, adapter } = await run({ bindings: [binding({ enabled: false })] });
    expect(report.binding).toEqual({ outcome: 'DENIED', reason: 'DISABLED' });
    expect(adapter.calls).toEqual([]);
  });

  it('keeps one fiscal intent when the same intent is repeated', async () => {
    const adapter = countingAdapter();
    const first = await run({ situation: 'FIRST_ISSUE' }, adapter);
    const second = await run({ situation: 'REPEATED_INTENT' }, adapter);
    expect(first.report.fiscalDocumentId).toBe(second.report.fiscalDocumentId);
    expect(second.report.recovery?.action).toBe('RECONCILE_SAME_INTENT');
    expect(second.report.adapterInvoked).toBe('RECONCILE_TIMEOUT');
    expect(adapter.calls).toEqual(['ISSUE', 'RECONCILE_TIMEOUT']);
  });

  it('reconciles an unresolved timeout instead of issuing again', async () => {
    const { report, adapter } = await run({ situation: 'TIMEOUT_UNRESOLVED' });
    expect(report.recovery?.action).toBe('RECONCILE_SAME_INTENT');
    expect(report.adapterInvoked).toBe('RECONCILE_TIMEOUT');
    expect(adapter.calls).toEqual(['RECONCILE_TIMEOUT']);
    expect(report.result?.evidenceClass).toBe('UNKNOWN');
    expect(report.result?.verificationStatus).toBe('UNVERIFIED');
  });

  it('does not issue after a crash before attempt persistence', async () => {
    const { report, adapter } = await run({
      situation: 'CRASH_BEFORE_ATTEMPT_PERSISTENCE',
    });
    expect(report.recovery?.action).toBe('RECONCILE_SAME_INTENT');
    expect(report.adapterInvoked).toBe('RECONCILE_TIMEOUT');
    expect(adapter.calls).not.toContain('ISSUE');
    expect(adapter.calls).not.toContain('IDEMPOTENT_RETRY');
  });

  it('does not switch providers for an unresolved intent', async () => {
    const { report, adapter } = await run({
      providerCode: 'MISA_MEINVOICE',
      situation: 'TIMEOUT_UNRESOLVED',
      bindings: [
        binding(),
        binding({ providerCode: 'MISA_MEINVOICE', credentialRef: 'vault://fiscal/le-a-misa' }),
      ],
    });
    expect(report.binding.outcome).toBe('SELECTED');
    expect(report.recovery?.action).toBe('DENY_PROVIDER_SWITCH');
    expect(adapter.calls).toEqual([]);
    expect(report.fiscalDocumentId).toBe('doc-1');
  });

  it('retries the same document only when a written idempotency contract is supplied', async () => {
    const { report, adapter } = await run({
      situation: 'TIMEOUT_UNRESOLVED',
      idempotencyContract: 'SAFE_SAME_KEY_RETRY',
    });
    expect(report.recovery).toMatchObject({
      action: 'ALLOW_IDEMPOTENT_RETRY',
      fiscalDocumentId: 'doc-1',
      providerCode: 'VIETTEL_SINVOICE',
    });
    expect(adapter.calls).toEqual(['IDEMPOTENT_RETRY']);
    expect(report.treatedAsFiscalSuccess).toBe(false);
    expect(report.result?.verificationStatus).toBe('UNVERIFIED');
  });
});
