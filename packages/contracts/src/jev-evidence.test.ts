import { describe, expect, it } from 'vitest';
import {
  buildEvidenceBundle,
  prepareModelGatewayRequest,
  parseEvidenceItem,
  EvidenceFreshness,
  EvidenceKind,
  EvidenceSensitivity,
  EvidenceStatus,
  EvidenceVerification,
  JevContractError,
  JEV_EVIDENCE_POLICY_VERSION,
  type ApprovedModelRegistryEntry,
  type EvidenceBundle,
} from './jev-evidence.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OUTLET = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const FACT_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_ID = '55555555-5555-4555-8555-555555555555';
const RECO_ID = '66666666-6666-4666-8666-666666666666';
const BRAND_ID = '77777777-7777-4777-8777-777777777777';
const BUNDLE_ID = '88888888-8888-4888-8888-888888888888';
const REQUEST_ID = '99999999-9999-4999-8999-999999999999';

const RESOLVER = 'imprint-snapshot-1';

function operationalFactItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: EvidenceKind.OperationalFact,
    verification: EvidenceVerification.SourceVerified,
    factId: FACT_ID,
    factType: 'GoodsReceived',
    tenantId: TENANT,
    outletId: OUTLET,
    status: EvidenceStatus.Known,
    freshness: EvidenceFreshness.Fresh,
    sensitivity: EvidenceSensitivity.InternalReference,
    requiredProcessingAuthorization: null,
    recordedAt: '2026-10-30T03:00:00.000Z',
    observedAt: '2026-10-30T02:59:00.000Z',
    provenance: {
      sourceModule: 'procurement',
      sourceEntityType: 'GoodsReceipt',
      sourceEntityId: FACT_ID,
      sourceRevision: 'rev-1',
    },
    resolverVersion: RESOLVER,
    usableForInference: true,
    ...overrides,
  };
}

function declaredClaimItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: EvidenceKind.DeclaredClaim,
    verification: EvidenceVerification.Unverified,
    claimId: CLAIM_ID,
    factPath: 'organization.outlet.brand_ref',
    origin: 'DECLARED',
    tenantId: TENANT,
    outletId: OUTLET,
    status: EvidenceStatus.Known,
    freshness: EvidenceFreshness.Fresh,
    sensitivity: EvidenceSensitivity.PublicReference,
    requiredProcessingAuthorization: null,
    recordedAt: '2026-10-30T03:00:00.000Z',
    provenance: {
      sourceModule: 'organization',
      sourceEntityType: 'Brand',
      sourceEntityId: BRAND_ID,
      sourceRevision: 'rev-1',
    },
    resolverVersion: RESOLVER,
    usableForInference: false,
    ...overrides,
  };
}

function recommendationItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: EvidenceKind.InferredRecommendation,
    verification: EvidenceVerification.Inferred,
    recommendationId: RECO_ID,
    recommendationType: 'STOCKOUT_RISK',
    assertsOperationalAuthority: false,
    tenantId: TENANT,
    outletId: OUTLET,
    status: EvidenceStatus.Known,
    freshness: EvidenceFreshness.Fresh,
    sensitivity: EvidenceSensitivity.InternalReference,
    requiredProcessingAuthorization: null,
    recordedAt: '2026-10-30T03:00:00.000Z',
    provenance: {
      sourceModule: 'intelligence',
      sourceEntityType: 'Recommendation',
      sourceEntityId: RECO_ID,
      sourceRevision: 'rev-1',
    },
    resolverVersion: RESOLVER,
    usableForInference: false,
    ...overrides,
  };
}

function bundle(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    bundleId: BUNDLE_ID,
    tenantId: TENANT,
    authorizedOutletId: OUTLET,
    policyVersion: JEV_EVIDENCE_POLICY_VERSION,
    resolverVersion: RESOLVER,
    builtAt: '2026-10-30T03:00:00.000Z',
    authorizedProcessingGrants: [],
    items,
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(JevContractError);
    expect((error as JevContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected JevContractError ${code} but none was thrown`);
}

describe('buildEvidenceBundle — positive', () => {
  it('builds a scoped bundle mixing facts, claims, and recommendations', () => {
    const result = buildEvidenceBundle(
      bundle([operationalFactItem(), declaredClaimItem(), recommendationItem()]),
    );
    expect(result.tenantId).toBe(TENANT);
    expect(result.authorizedOutletId).toBe(OUTLET);
    expect(result.items).toHaveLength(3);
    expect(result.degraded).toBe(false);
  });

  it('distinguishes the four evidence kinds via parseEvidenceItem', () => {
    expect(parseEvidenceItem(operationalFactItem()).kind).toBe(EvidenceKind.OperationalFact);
    expect(parseEvidenceItem(declaredClaimItem()).kind).toBe(EvidenceKind.DeclaredClaim);
    expect(
      parseEvidenceItem(
        declaredClaimItem({
          kind: EvidenceKind.Goal,
          origin: 'TARGET',
          factPath: 'organization.outlet.capabilities',
        }),
      ).kind,
    ).toBe(EvidenceKind.Goal);
    expect(parseEvidenceItem(recommendationItem()).kind).toBe(EvidenceKind.InferredRecommendation);
  });

  it('marks the bundle degraded when an input is stale (and not usable for inference)', () => {
    const result = buildEvidenceBundle(
      bundle([
        declaredClaimItem({
          freshness: EvidenceFreshness.Stale,
          usableForInference: false,
        }),
      ]),
    );
    expect(result.degraded).toBe(true);
  });

  it('accepts a sensitive item when its required authorization is granted', () => {
    const result = buildEvidenceBundle(
      bundle(
        [
          declaredClaimItem({
            sensitivity: EvidenceSensitivity.Sensitive,
            requiredProcessingAuthorization: 'imprint.read.provenance',
          }),
        ],
        { authorizedProcessingGrants: ['imprint.read.provenance'] },
      ),
    );
    expect(result.items).toHaveLength(1);
  });

  it('prepares a ModelGateway request from a validated bundle without invoking a model', () => {
    const built = buildEvidenceBundle(bundle([operationalFactItem()]));
    const registry: ApprovedModelRegistryEntry[] = [
      { purpose: 'stockout_forecast', schemaId: 'stockout.v1', approved: true },
    ];
    const request = prepareModelGatewayRequest({
      requestId: REQUEST_ID,
      purpose: 'stockout_forecast',
      schemaId: 'stockout.v1',
      bundle: built,
      registry,
    });
    expect(request.bundleId).toBe(BUNDLE_ID);
    expect(request.evidence.items).toHaveLength(1);
  });
});

describe('buildEvidenceBundle — negative (required)', () => {
  it('rejects cross-tenant evidence input', () => {
    expectCode(
      () => buildEvidenceBundle(bundle([operationalFactItem({ tenantId: OTHER_TENANT })])),
      'JEV_TENANT_SCOPE',
    );
  });

  it('rejects evidence outside the authorized outlet', () => {
    expectCode(
      () => buildEvidenceBundle(bundle([operationalFactItem({ outletId: OTHER_TENANT })])),
      'JEV_TENANT_SCOPE',
    );
  });

  it('rejects stale evidence marked usable for inference', () => {
    expectCode(
      () => parseEvidenceItem(operationalFactItem({ freshness: EvidenceFreshness.Stale })),
      'JEV_STALE_EVIDENCE',
    );
  });

  it('rejects an unregistered fact path', () => {
    expectCode(
      () => parseEvidenceItem(declaredClaimItem({ factPath: 'organization.outlet.not_registered' })),
      'JEV_UNREGISTERED_FIELD',
    );
  });

  it('rejects an item missing provenance', () => {
    expectCode(
      () => parseEvidenceItem(declaredClaimItem({ provenance: undefined })),
      'JEV_ITEM_REJECTED',
    );
  });

  it('rejects sensitive data without a granted processing authorization', () => {
    expectCode(
      () =>
        buildEvidenceBundle(
          bundle([
            declaredClaimItem({
              sensitivity: EvidenceSensitivity.Sensitive,
              requiredProcessingAuthorization: 'imprint.read.provenance',
            }),
          ]),
        ),
      'JEV_PROCESSING_AUTHORIZATION_REQUIRED',
    );
  });

  it('rejects a recommendation that claims operational authority', () => {
    expectCode(
      () => parseEvidenceItem(recommendationItem({ assertsOperationalAuthority: true })),
      'JEV_RECOMMENDATION_AUTHORITY',
    );
  });
});

describe('prepareModelGatewayRequest — negative', () => {
  it('rejects a purpose/schema the approved registry does not authorize', () => {
    const built = buildEvidenceBundle(bundle([operationalFactItem()]));
    expectCode(
      () =>
        prepareModelGatewayRequest({
          requestId: REQUEST_ID,
          purpose: 'stockout_forecast',
          schemaId: 'stockout.v1',
          bundle: built as EvidenceBundle,
          registry: [{ purpose: 'stockout_forecast', schemaId: 'stockout.v1', approved: false }],
        }),
      'JEV_MODEL_PURPOSE_NOT_APPROVED',
    );
  });
});
