/**
 * One fiscal intent across timeout, crash, and retry (ADR-0053 clarification 5 and 7).
 *
 * FiscalService.reconcileDocument still calls idempotentRetry while the document
 * is PENDING_ISSUE. This policy is the sandbox rule and is not yet wired into that
 * service path. Default contract is UNVERIFIED, so issue is not repeated.
 */

import type { SandboxProviderCode } from './sandbox-provider-binding.js';

export type FiscalIntentKey = {
  readonly legalEntityId: string;
  readonly fiscalDocumentId: string;
  readonly semanticHash: string;
  readonly providerCode: SandboxProviderCode;
};

export type IntentRecoverySituation =
  | 'TIMEOUT_UNRESOLVED'
  | 'CRASH_BEFORE_ATTEMPT_PERSISTENCE'
  | 'REPEATED_INTENT'
  | 'UNKNOWN_STATUS';

/** UNVERIFIED is the only honest default. SAFE_SAME_KEY_RETRY requires a written provider contract. */
export type ProviderIdempotencyContract = 'UNVERIFIED' | 'SAFE_SAME_KEY_RETRY';

export type IntentRecoveryDecision =
  | {
      readonly action: 'RECONCILE_SAME_INTENT';
      readonly fiscalDocumentId: string;
      readonly providerCode: SandboxProviderCode;
    }
  | {
      readonly action: 'ALLOW_IDEMPOTENT_RETRY';
      readonly fiscalDocumentId: string;
      readonly providerCode: SandboxProviderCode;
    }
  | { readonly action: 'DENY_PROVIDER_SWITCH'; readonly fiscalDocumentId: string }
  | { readonly action: 'CONFLICT_PAYLOAD'; readonly fiscalDocumentId: string };

export function decideFiscalIntentRecovery(input: {
  readonly original: FiscalIntentKey;
  readonly requestedProviderCode: string;
  readonly semanticHashUnchanged: boolean;
  readonly situation: IntentRecoverySituation;
  readonly idempotencyContract: ProviderIdempotencyContract;
}): IntentRecoveryDecision {
  if (input.requestedProviderCode !== input.original.providerCode) {
    return {
      action: 'DENY_PROVIDER_SWITCH',
      fiscalDocumentId: input.original.fiscalDocumentId,
    };
  }
  if (!input.semanticHashUnchanged) {
    return { action: 'CONFLICT_PAYLOAD', fiscalDocumentId: input.original.fiscalDocumentId };
  }
  if (
    input.idempotencyContract === 'SAFE_SAME_KEY_RETRY' &&
    input.situation !== 'REPEATED_INTENT'
  ) {
    return {
      action: 'ALLOW_IDEMPOTENT_RETRY',
      fiscalDocumentId: input.original.fiscalDocumentId,
      providerCode: input.original.providerCode,
    };
  }
  return {
    action: 'RECONCILE_SAME_INTENT',
    fiscalDocumentId: input.original.fiscalDocumentId,
    providerCode: input.original.providerCode,
  };
}
