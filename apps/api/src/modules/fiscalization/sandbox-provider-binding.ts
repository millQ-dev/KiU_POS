/**
 * LegalEntity-scoped SANDBOX binding (ADR-0053 S3, clarifications 2–4).
 * In memory. No vendor call. PRODUCTION cannot be selected.
 * Does not change FiscalCheckoutGate.
 */

export const SANDBOX_PROVIDER_CODES = ['VIETTEL_SINVOICE', 'MISA_MEINVOICE'] as const;

export type SandboxProviderCode = (typeof SANDBOX_PROVIDER_CODES)[number];

export type SandboxProviderBinding = {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly providerCode: SandboxProviderCode;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  readonly enabled: boolean;
  readonly credentialRef: string;
};

export type SandboxBindingRequest = {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly providerCode: string;
};

export type SandboxBindingDenial =
  | 'UNCONFIGURED'
  | 'DISABLED'
  | 'WRONG_LEGAL_ENTITY'
  | 'CROSS_TENANT'
  | 'PRODUCTION_FORBIDDEN'
  | 'UNKNOWN_PROVIDER';

export type SandboxBindingDecision =
  | { readonly outcome: 'SELECTED'; readonly binding: SandboxProviderBinding }
  | { readonly outcome: 'DENIED'; readonly reason: SandboxBindingDenial };

export function isSandboxProviderCode(value: string): value is SandboxProviderCode {
  return (SANDBOX_PROVIDER_CODES as readonly string[]).includes(value);
}

/**
 * Disabled bindings stay disabled. A PRODUCTION row is refused even when enabled.
 * Candidate names are identifiers only. They are not an API contract.
 */
export function selectSandboxProviderBinding(
  bindings: readonly SandboxProviderBinding[],
  request: SandboxBindingRequest,
): SandboxBindingDecision {
  if (!isSandboxProviderCode(request.providerCode)) {
    return { outcome: 'DENIED', reason: 'UNKNOWN_PROVIDER' };
  }
  const code = request.providerCode;
  const exact = bindings.find(
    (binding) =>
      binding.providerCode === code &&
      binding.tenantId === request.tenantId &&
      binding.legalEntityId === request.legalEntityId,
  );
  if (!exact) {
    return denyMissingBinding(bindings, request, code);
  }
  if (exact.environment === 'PRODUCTION') {
    return { outcome: 'DENIED', reason: 'PRODUCTION_FORBIDDEN' };
  }
  if (!exact.enabled) {
    return { outcome: 'DENIED', reason: 'DISABLED' };
  }
  return { outcome: 'SELECTED', binding: exact };
}

function denyMissingBinding(
  bindings: readonly SandboxProviderBinding[],
  request: SandboxBindingRequest,
  code: SandboxProviderCode,
): SandboxBindingDecision {
  const forProvider = bindings.filter((binding) => binding.providerCode === code);
  const sameTenant = forProvider.some(
    (binding) =>
      binding.tenantId === request.tenantId &&
      binding.legalEntityId !== request.legalEntityId,
  );
  if (sameTenant) {
    return { outcome: 'DENIED', reason: 'WRONG_LEGAL_ENTITY' };
  }
  const otherTenant = forProvider.some((binding) => binding.tenantId !== request.tenantId);
  if (otherTenant) {
    return { outcome: 'DENIED', reason: 'CROSS_TENANT' };
  }
  return { outcome: 'DENIED', reason: 'UNCONFIGURED' };
}
