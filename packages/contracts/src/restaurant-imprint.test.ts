import { describe, expect, it } from 'vitest';
import {
  FactPath,
  FACT_PATH_REGISTRY,
  IMPRINT_RESOLVER_VERSION,
  ImprintClaimOrigin,
  ImprintContractError,
  ImprintFieldState,
  ImprintSensitivity,
  canonicalImprintValue,
  listRegisteredFactPaths,
  parseImprintAssertion,
  parseImprintConflict,
  parseImprintInvalidation,
  parseImprintSnapshotField,
  parseImprintWatermark,
  resolveImprintField,
} from './index.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OUTLET = '00000000-0000-4000-8000-000000000002';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
const BRAND = '00000000-0000-4000-8000-000000000003';
const CLAIM_A = '00000000-0000-4000-8000-000000000010';
const CLAIM_B = '00000000-0000-4000-8000-000000000011';

const provenance = {
  sourceModule: 'organization',
  sourceEntityType: 'Brand',
  sourceEntityId: BRAND,
  sourceRevision: 'rev-1',
};

function brandAssertion(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    outletId: OUTLET,
    factPath: FactPath.OutletBrandRef,
    origin: ImprintClaimOrigin.Observed,
    sensitivityClass: ImprintSensitivity.PublicReference,
    provenance,
    value: { brandId: BRAND },
    ...overrides,
  };
}

function codeOf(input: unknown): string {
  try {
    parseImprintAssertion(input);
  } catch (error) {
    return error instanceof ImprintContractError ? error.code : 'OTHER';
  }
  return 'ACCEPTED';
}

describe('restaurant imprint fact path registry', () => {
  it('registers the ADR-0054 paths and no others', () => {
    expect(listRegisteredFactPaths()).toEqual([
      FactPath.WarehouseRefs,
      FactPath.ActiveTerminalRefs,
      FactPath.OutletBrandRef,
      FactPath.OutletCapabilities,
      FactPath.OutletIdentity,
      FactPath.OutletLegalEntityRef,
      FactPath.LastPostedReceiptRef,
    ]);
  });

  it('keeps one resolver version on every path', () => {
    expect(IMPRINT_RESOLVER_VERSION).toBe('imprint-snapshot-1');
    for (const entry of Object.values(FACT_PATH_REGISTRY)) {
      expect(entry.resolverVersion).toBe(IMPRINT_RESOLVER_VERSION);
      expect(entry.retentionClass).toBe('OUTLET_LIFETIME');
      expect(entry.provenanceRequired).toBe(true);
    }
    expect(FACT_PATH_REGISTRY[FactPath.ActiveTerminalRefs].stage1).toBe('UNKNOWN');
  });

  it('rejects an unknown fact path at ingress', () => {
    expect(codeOf(brandAssertion({ factPath: 'menu.item.price' }))).toBe(
      'IMPRINT_PATH_UNREGISTERED',
    );
  });

  it('rejects a value that does not match the path schema', () => {
    expect(
      codeOf(
        brandAssertion({
          factPath: FactPath.LastPostedReceiptRef,
          sensitivityClass: ImprintSensitivity.InternalReference,
          provenance: {
            sourceModule: 'procurement',
            sourceEntityType: 'GoodsReceipt',
            sourceEntityId: BRAND,
            sourceRevision: 'rev-1',
          },
          value: { goodsReceiptId: BRAND, postingStatus: 'DRAFT' },
        }),
      ),
    ).toBe('IMPRINT_VALUE_REJECTED');
  });

  it('rejects an origin the path does not allow', () => {
    expect(codeOf(brandAssertion({ origin: ImprintClaimOrigin.Declared }))).toBe(
      'IMPRINT_ORIGIN_REJECTED',
    );
  });

  it('rejects a source module that does not own the path', () => {
    expect(
      codeOf(
        brandAssertion({
          provenance: { ...provenance, sourceModule: 'procurement' },
        }),
      ),
    ).toBe('IMPRINT_ORIGIN_REJECTED');
  });

  it('rejects a claim without provenance', () => {
    const input = brandAssertion();
    delete (input as { provenance?: unknown }).provenance;
    expect(codeOf(input)).toBe('IMPRINT_PROVENANCE_REJECTED');
  });

  it('rejects an identity value for a different outlet', () => {
    expect(
      codeOf(
        brandAssertion({
          factPath: FactPath.OutletIdentity,
          provenance: {
            sourceModule: 'organization',
            sourceEntityType: 'Outlet',
            sourceEntityId: OUTLET,
            sourceRevision: 'rev-1',
          },
          value: { outletId: BRAND, name: 'Cafe' },
        }),
      ),
    ).toBe('IMPRINT_VALUE_REJECTED');
  });

  it('rejects provenance that names a different source entity', () => {
    expect(
      codeOf(
        brandAssertion({
          provenance: { ...provenance, sourceEntityId: OUTLET },
        }),
      ),
    ).toBe('IMPRINT_ORIGIN_REJECTED');
    expect(
      codeOf(
        brandAssertion({
          factPath: FactPath.OutletLegalEntityRef,
          provenance: {
            sourceModule: 'organization',
            sourceEntityType: 'LegalEntity',
            sourceEntityId: OUTLET,
            sourceRevision: 'rev-1',
          },
          value: { legalEntityId: BRAND },
        }),
      ),
    ).toBe('IMPRINT_ORIGIN_REJECTED');
    expect(
      codeOf(
        brandAssertion({
          factPath: FactPath.LastPostedReceiptRef,
          sensitivityClass: ImprintSensitivity.InternalReference,
          provenance: {
            sourceModule: 'procurement',
            sourceEntityType: 'GoodsReceipt',
            sourceEntityId: OUTLET,
            sourceRevision: 'rev-1',
          },
          value: { goodsReceiptId: BRAND, postingStatus: 'POSTED' },
        }),
      ),
    ).toBe('IMPRINT_ORIGIN_REJECTED');
  });

  it('rejects a sensitivity class that disagrees with the registry', () => {
    expect(
      codeOf(brandAssertion({ sensitivityClass: ImprintSensitivity.InternalReference })),
    ).toBe('IMPRINT_SENSITIVITY_REJECTED');
  });

  it('does not accept a value for a path that stays UNKNOWN', () => {
    expect(
      codeOf(
        brandAssertion({
          factPath: FactPath.ActiveTerminalRefs,
          sensitivityClass: ImprintSensitivity.InternalReference,
          provenance: {
            ...provenance,
            sourceEntityType: 'Terminal',
          },
          value: { terminalIds: [BRAND] },
        }),
      ),
    ).toBe('IMPRINT_PATH_UNAVAILABLE');
  });

  it('rejects UNKNOWN when a fabricated value is attached', () => {
    expect(() =>
      parseImprintSnapshotField({
        factPath: FactPath.OutletBrandRef,
        fieldState: ImprintFieldState.Unknown,
        value: { brandId: BRAND },
      }),
    ).toThrow(expect.objectContaining({ code: 'IMPRINT_UNKNOWN_VALUE' }));
  });

  it('encodes the same canonical value for any key order', () => {
    const left = canonicalImprintValue(FactPath.OutletIdentity, {
      name: 'Cafe',
      outletId: OUTLET,
    });
    const right = canonicalImprintValue(FactPath.OutletIdentity, {
      outletId: OUTLET,
      name: 'Cafe',
    });
    expect(left).toBe(right);
    expect(left).toBe(`{"name":"Cafe","outletId":"${OUTLET}"}`);
  });

  it('sorts reference lists before encoding', () => {
    const encoded = canonicalImprintValue(FactPath.WarehouseRefs, {
      warehouseIds: [CLAIM_B, CLAIM_A],
    });
    expect(encoded).toBe(`{"warehouseIds":["${CLAIM_A}","${CLAIM_B}"]}`);
  });

  it('rejects a claim that calls itself verified', () => {
    expect(codeOf(brandAssertion({ verificationState: 'VERIFIED' }))).toBe(
      'IMPRINT_VERIFICATION_REJECTED',
    );
  });

  it('keeps a human claim visible and not source-authoritative', () => {
    const claim = parseImprintAssertion(
      brandAssertion({
        factPath: FactPath.OutletIdentity,
        origin: ImprintClaimOrigin.Declared,
        provenance: {
          sourceModule: 'organization',
          sourceEntityType: 'Outlet',
          sourceEntityId: OUTLET,
          sourceRevision: 'note-1',
        },
        value: { outletId: OUTLET, name: 'Cafe' },
      }),
    );
    expect(claim.sourceAuthoritative).toBe(false);
    expect(claim.origin).toBe(ImprintClaimOrigin.Declared);
    expect(claim.verificationState).toBe('UNVERIFIED');
  });

  it('lets an observed claim outrank a declared claim', () => {
    const declared = canonicalImprintValue(FactPath.OutletIdentity, {
      outletId: OUTLET,
      name: 'Draft name',
    });
    const observed = canonicalImprintValue(FactPath.OutletIdentity, {
      outletId: OUTLET,
      name: 'Cafe',
    });
    const resolved = resolveImprintField({
      tenantId: TENANT,
      outletId: OUTLET,
      factPath: FactPath.OutletIdentity,
      claims: [
        {
          tenantId: TENANT,
          outletId: OUTLET,
          factPath: FactPath.OutletIdentity,
          claimId: CLAIM_A,
          origin: ImprintClaimOrigin.Declared,
          canonicalValue: declared,
        },
        {
          tenantId: TENANT,
          outletId: OUTLET,
          factPath: FactPath.OutletIdentity,
          claimId: CLAIM_B,
          origin: ImprintClaimOrigin.Observed,
          canonicalValue: observed,
        },
      ],
    });
    expect(resolved.fieldState).toBe(ImprintFieldState.Known);
    expect(resolved.canonicalValue).toBe(observed);
    expect(resolved.sourceAuthoritative).toBe(true);
    expect(resolved.origin).toBe(ImprintClaimOrigin.Observed);
  });

  it('returns UNKNOWN with no value when nothing was read', () => {
    const resolved = resolveImprintField({
      tenantId: TENANT,
      outletId: OUTLET,
      factPath: FactPath.OutletIdentity,
      claims: [],
    });
    expect(resolved).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
      value: null,
      canonicalValue: null,
      claimId: null,
    });
  });

  it('returns CONFLICT without choosing a value', () => {
    const first = canonicalImprintValue(FactPath.OutletBrandRef, { brandId: BRAND });
    const second = canonicalImprintValue(FactPath.OutletBrandRef, { brandId: OUTLET });
    const resolved = resolveImprintField({
      tenantId: TENANT,
      outletId: OUTLET,
      factPath: FactPath.OutletBrandRef,
      claims: [
        {
          tenantId: TENANT,
          outletId: OUTLET,
          factPath: FactPath.OutletBrandRef,
          claimId: CLAIM_A,
          origin: ImprintClaimOrigin.Observed,
          canonicalValue: first,
        },
        {
          tenantId: TENANT,
          outletId: OUTLET,
          factPath: FactPath.OutletBrandRef,
          claimId: CLAIM_B,
          origin: ImprintClaimOrigin.Observed,
          canonicalValue: second,
        },
      ],
    });
    expect(resolved.fieldState).toBe(ImprintFieldState.Conflict);
    expect(resolved.value).toBeNull();
    expect(resolved.canonicalValue).toBeNull();
  });

  it('refuses another tenant without returning that tenant value', () => {
    const foreign = canonicalImprintValue(FactPath.OutletBrandRef, { brandId: BRAND });
    expect(() =>
      resolveImprintField({
        tenantId: TENANT,
        outletId: OUTLET,
        factPath: FactPath.OutletBrandRef,
        claims: [
          {
            tenantId: OTHER_TENANT,
            outletId: OUTLET,
            factPath: FactPath.OutletBrandRef,
            claimId: CLAIM_A,
            origin: ImprintClaimOrigin.Observed,
            canonicalValue: foreign,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'IMPRINT_TENANT_SCOPE' }));
    try {
      resolveImprintField({
        tenantId: TENANT,
        outletId: OUTLET,
        factPath: FactPath.OutletBrandRef,
        claims: [
          {
            tenantId: OTHER_TENANT,
            outletId: OUTLET,
            factPath: FactPath.OutletBrandRef,
            claimId: CLAIM_A,
            origin: ImprintClaimOrigin.Observed,
            canonicalValue: foreign,
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ImprintContractError);
      expect((error as Error).message).not.toContain(foreign);
      expect((error as Error).message).not.toContain(OTHER_TENANT);
    }
  });

  it('accepts an invalidation without a replacement value', () => {
    const invalidation = parseImprintInvalidation({
      tenantId: TENANT,
      outletId: OUTLET,
      factPath: FactPath.OutletBrandRef,
      invalidatesClaimId: CLAIM_A,
      origin: ImprintClaimOrigin.Observed,
      provenance,
    });
    expect(invalidation.effect).toBe('INVALIDATION');
    expect(invalidation.resolverVersion).toBe(IMPRINT_RESOLVER_VERSION);
  });

  it('records a conflict as fingerprints only', () => {
    const conflict = parseImprintConflict({
      tenantId: TENANT,
      outletId: OUTLET,
      factPath: FactPath.OutletBrandRef,
      existingClaimId: CLAIM_A,
      existingFingerprint: 'a'.repeat(64),
      rejectedFingerprint: 'b'.repeat(64),
    });
    expect(conflict.existingFingerprint).not.toBe(conflict.rejectedFingerprint);
  });

  it('rejects a cursor name the persistence layer would reject', () => {
    expect(() =>
      parseImprintWatermark({
        tenantId: TENANT,
        outletId: OUTLET,
        sourceModule: 'organization',
        cursorName: 'batch-1',
        watermark: 'wm-1',
        freshness: 'FRESH',
      }),
    ).toThrow(expect.objectContaining({ code: 'IMPRINT_VALUE_REJECTED' }));
  });
});
