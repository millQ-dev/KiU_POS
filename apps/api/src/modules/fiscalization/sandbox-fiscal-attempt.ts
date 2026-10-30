/**
 * Local sandbox attempt. Uses FiscalProviderAdapter. Does not open a network
 * connection and does not mark FiscalCheckoutGate satisfied.
 */

import type { FiscalAdapterIssueInput, FiscalAdapterResult, FiscalProviderAdapter } from './fiscal-provider-adapter.js';
import {
  decideFiscalIntentRecovery,
  type FiscalIntentKey,
  type IntentRecoveryDecision,
  type IntentRecoverySituation,
  type ProviderIdempotencyContract,
} from './fiscal-intent-recovery.js';
import {
  selectSandboxProviderBinding,
  type SandboxBindingDecision,
  type SandboxProviderBinding,
} from './sandbox-provider-binding.js';

export type SandboxAttemptSituation = 'FIRST_ISSUE' | IntentRecoverySituation;

export type SandboxAdapterInvocation =
  | 'NONE'
  | 'ISSUE'
  | 'IDEMPOTENT_RETRY'
  | 'RECONCILE_TIMEOUT';

export type SandboxAttemptReport = {
  readonly binding: SandboxBindingDecision;
  readonly recovery: IntentRecoveryDecision | null;
  readonly adapterInvoked: SandboxAdapterInvocation;
  readonly result: FiscalAdapterResult | null;
  readonly fiscalDocumentId: string;
  readonly treatedAsFiscalSuccess: false;
  readonly checkoutGateEffect: 'UNCHANGED';
};

const blocked = (reason: string): FiscalAdapterResult => ({
  attemptStatus: 'ADAPTER_UNAVAILABLE',
  evidenceClass: 'ADAPTER_UNAVAILABLE',
  verificationStatus: 'UNVERIFIED',
  rawProviderStatus: reason,
  diagnosticMetadata: { sandboxLocal: true, network: false },
});

export async function executeSandboxFiscalAttempt(input: {
  readonly bindings: readonly SandboxProviderBinding[];
  readonly tenantId: string;
  readonly providerCode: string;
  readonly intent: FiscalIntentKey;
  readonly situation: SandboxAttemptSituation;
  readonly idempotencyContract: ProviderIdempotencyContract;
  readonly semanticHashUnchanged: boolean;
  readonly issueInput: FiscalAdapterIssueInput;
  readonly adapter: FiscalProviderAdapter;
}): Promise<SandboxAttemptReport> {
  const binding = selectSandboxProviderBinding(input.bindings, {
    tenantId: input.tenantId,
    legalEntityId: input.intent.legalEntityId,
    providerCode: input.providerCode,
  });
  const base = {
    binding,
    fiscalDocumentId: input.intent.fiscalDocumentId,
    treatedAsFiscalSuccess: false as const,
    checkoutGateEffect: 'UNCHANGED' as const,
  };

  if (
    input.issueInput.fiscalDocumentId !== input.intent.fiscalDocumentId ||
    input.issueInput.legalEntityId !== input.intent.legalEntityId ||
    input.issueInput.taxSemanticFingerprint !== input.intent.semanticHash
  ) {
    return {
      ...base,
      recovery: { action: 'CONFLICT_PAYLOAD', fiscalDocumentId: input.intent.fiscalDocumentId },
      adapterInvoked: 'NONE',
      result: blocked('FISCAL_INTENT_CONFLICT'),
    };
  }

  if (binding.outcome === 'DENIED') {
    return {
      ...base,
      recovery: null,
      adapterInvoked: 'NONE',
      result: blocked(binding.reason),
    };
  }

  if (input.situation === 'FIRST_ISSUE') {
    const result = await input.adapter.issue(input.issueInput);
    return { ...base, recovery: null, adapterInvoked: 'ISSUE', result: unsatisfied(result) };
  }

  const recovery = decideFiscalIntentRecovery({
    original: input.intent,
    requestedProviderCode: input.providerCode,
    semanticHashUnchanged: input.semanticHashUnchanged,
    situation: input.situation,
    idempotencyContract: input.idempotencyContract,
  });

  if (recovery.action === 'DENY_PROVIDER_SWITCH' || recovery.action === 'CONFLICT_PAYLOAD') {
    return { ...base, recovery, adapterInvoked: 'NONE', result: blocked(recovery.action) };
  }

  if (recovery.action === 'ALLOW_IDEMPOTENT_RETRY') {
    const result = await input.adapter.idempotentRetry(input.issueInput);
    return { ...base, recovery, adapterInvoked: 'IDEMPOTENT_RETRY', result: unsatisfied(result) };
  }

  const result = await input.adapter.reconcileTimeoutAfterSuccess({
    fiscalDocumentId: input.intent.fiscalDocumentId,
    issueIdempotencyKey: input.issueInput.issueIdempotencyKey,
  });
  return { ...base, recovery, adapterInvoked: 'RECONCILE_TIMEOUT', result: unsatisfied(result) };
}

function unsatisfied(result: FiscalAdapterResult): FiscalAdapterResult {
  return {
    ...result,
    verificationStatus: 'UNVERIFIED',
    diagnosticMetadata: {
      ...(result.diagnosticMetadata ?? {}),
      sandboxLocal: true,
      legalSufficiency: 'G2-11-OPEN',
    },
  };
}
