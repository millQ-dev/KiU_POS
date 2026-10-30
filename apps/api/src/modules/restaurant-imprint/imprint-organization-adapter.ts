import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  FactPath,
  ImprintClaimOrigin,
  ImprintFieldState,
  ImprintSensitivity,
  canonicalImprintValue,
  type RegisteredFactPath,
} from '@millq/contracts';
import { ImprintServiceError } from './errors.js';
import {
  ImprintClaimService,
  ImprintInternalAuthority,
  ImprintScope,
} from './imprint-claim-service.js';
import type { AppendOutcome } from './imprint-persistence.js';

type OutletSource = {
  outlet_id: string;
  tenant_id: string;
  brand_id: string;
  legal_entity_id: string;
  name: string;
};

type ClaimDraft = {
  factPath: RegisteredFactPath;
  origin: 'OBSERVED' | 'CONFIGURED';
  sensitivityClass: 'PUBLIC_REFERENCE' | 'INTERNAL_REFERENCE';
  sourceEntityType: string;
  sourceEntityId: string;
  sourceRevision: string;
  value: unknown;
};

/**
 * Read-only Organization → Imprint adapter (ADR-0054 I-05).
 * Writes only imprint_* rows through the claim service. No Organization mutations.
 */
export class ImprintOrganizationAdapter {
  private readonly claims: ImprintClaimService;
  private readonly authority = ImprintInternalAuthority.forOrganizationAdapter();

  constructor(private readonly pool: pg.Pool) {
    this.claims = new ImprintClaimService(pool);
  }

  async syncOutlet(tenantId: string, outletId: string): Promise<{
    outcomes: AppendOutcome[];
    watermark: string | null;
    degraded: boolean;
  }> {
    const scope = await ImprintScope.openInternal(this.pool, this.authority, tenantId, outletId);
    const source = await this.readOutlet(scope);
    if (!source) {
      throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', 'outlet is outside the caller tenant');
    }

    const drafts: ClaimDraft[] = [];
    let degraded = false;

    const identity = this.identityDraft(source);
    if (identity) drafts.push(identity);
    else degraded = true;

    drafts.push(this.brandDraft(source));
    drafts.push(this.legalEntityDraft(source));

    const capabilities = await this.capabilitiesDraft(scope);
    if (capabilities === 'DEGRADED') degraded = true;
    else if (capabilities) drafts.push(capabilities);

    const warehouses = await this.warehouseDraft(scope);
    if (warehouses === 'DEGRADED') degraded = true;
    else if (warehouses) drafts.push(warehouses);

    const assertions: Array<Record<string, unknown> & { factPath: string; revision: string }> = [];
    for (const draft of drafts) {
      const next = await this.prepareAssertion(scope, draft);
      if (next) assertions.push(next);
    }

    if (assertions.length === 0) {
      if (degraded) {
        await this.claims.recordSourceFailure(scope, {
          sourceModule: 'organization',
          errorCode: 'IMPRINT_SOURCE_SCHEMA_LIMIT',
          freshness: 'DEGRADED',
        });
      }
      return { outcomes: [], watermark: null, degraded };
    }

    const watermark = contentRevision(
      assertions.map((row) => `${row.factPath}:${row.revision}`).join('\n'),
    );
    const result = await this.claims.commitCheckpoint(scope, {
      sourceModule: 'organization',
      cursorName: 'organization_outlet',
      watermark,
      assertions,
    });
    if (degraded) {
      await this.claims.recordSourceFailure(scope, {
        sourceModule: 'organization',
        errorCode: 'IMPRINT_SOURCE_SCHEMA_LIMIT',
        freshness: 'DEGRADED',
      });
    }
    return { outcomes: result.outcomes, watermark: result.watermark, degraded };
  }

  private async readOutlet(scope: ImprintScope): Promise<OutletSource | null> {
    const result = await this.pool.query<OutletSource>(
      `SELECT outlet_id, tenant_id, brand_id, legal_entity_id, name
       FROM outlet
       WHERE outlet_id = $1 AND tenant_id = $2`,
      [scope.outletId, scope.tenantId],
    );
    return result.rows[0] ?? null;
  }

  private identityDraft(source: OutletSource): ClaimDraft | null {
    if (source.name.length < 1 || source.name.length > 80) return null;
    return {
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      sourceEntityType: 'Outlet',
      sourceEntityId: source.outlet_id,
      sourceRevision: contentRevision(`identity:${source.outlet_id}:${source.name}`),
      value: { outletId: source.outlet_id, name: source.name },
    };
  }

  private brandDraft(source: OutletSource): ClaimDraft {
    return {
      factPath: FactPath.OutletBrandRef,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      sourceEntityType: 'Brand',
      sourceEntityId: source.brand_id,
      sourceRevision: contentRevision(`brand:${source.brand_id}`),
      value: { brandId: source.brand_id },
    };
  }

  private legalEntityDraft(source: OutletSource): ClaimDraft {
    return {
      factPath: FactPath.OutletLegalEntityRef,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      sourceEntityType: 'LegalEntity',
      sourceEntityId: source.legal_entity_id,
      sourceRevision: contentRevision(`legal:${source.legal_entity_id}`),
      value: { legalEntityId: source.legal_entity_id },
    };
  }

  private async capabilitiesDraft(
    scope: ImprintScope,
  ): Promise<ClaimDraft | null | 'DEGRADED'> {
    const result = await this.pool.query<{ capability_key: string }>(
      `SELECT capability_key
       FROM outlet_capability_config
       WHERE tenant_id = $1 AND outlet_id = $2 AND enabled = TRUE
       ORDER BY capability_key`,
      [scope.tenantId, scope.outletId],
    );
    const keys = result.rows.map((row) => row.capability_key);
    if (keys.length > 4 || keys.some((key) => key.length > 32 || !/^[a-z][a-z0-9_.]{0,31}$/.test(key))) {
      return 'DEGRADED';
    }
    return {
      factPath: FactPath.OutletCapabilities,
      origin: ImprintClaimOrigin.Configured,
      sensitivityClass: ImprintSensitivity.InternalReference,
      sourceEntityType: 'OutletCapabilityConfig',
      sourceEntityId: scope.outletId,
      sourceRevision: contentRevision(`capabilities:${keys.join(',')}`),
      value: { keys },
    };
  }

  private async warehouseDraft(
    scope: ImprintScope,
  ): Promise<ClaimDraft | null | 'DEGRADED'> {
    const result = await this.pool.query<{ warehouse_id: string }>(
      `SELECT warehouse_id
       FROM warehouse
       WHERE tenant_id = $1 AND outlet_id = $2
       ORDER BY warehouse_id`,
      [scope.tenantId, scope.outletId],
    );
    const warehouseIds = result.rows.map((row) => row.warehouse_id);
    if (warehouseIds.length > 4) return 'DEGRADED';
    return {
      factPath: FactPath.WarehouseRefs,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.InternalReference,
      sourceEntityType: 'Warehouse',
      sourceEntityId: scope.outletId,
      sourceRevision: contentRevision(`warehouses:${warehouseIds.join(',')}`),
      value: { warehouseIds },
    };
  }

  private async prepareAssertion(
    scope: ImprintScope,
    draft: ClaimDraft,
  ): Promise<(Record<string, unknown> & { factPath: string; revision: string }) | null> {
    let canonical: string;
    try {
      canonical = canonicalImprintValue(draft.factPath, draft.value);
    } catch {
      return null;
    }
    const current = await this.claims.resolveField(scope, draft.factPath);
    if (
      current.fieldState === ImprintFieldState.Known &&
      current.canonicalValue === canonical &&
      current.claimId
    ) {
      return null;
    }
    // Bind the content fingerprint to the live claim so a later revert does not
    // collide with an earlier superseded source_revision identity.
    const sourceRevision = `${draft.sourceRevision}:${current.claimId ?? 'genesis'}`;
    const body: Record<string, unknown> & { factPath: string; revision: string } = {
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      factPath: draft.factPath,
      revision: sourceRevision,
      origin: draft.origin,
      sensitivityClass: draft.sensitivityClass,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: draft.sourceEntityType,
        sourceEntityId: draft.sourceEntityId,
        sourceRevision,
      },
      value: draft.value,
    };
    if (current.fieldState === ImprintFieldState.Known && current.claimId) {
      body.supersedesClaimId = current.claimId;
    }
    return body;
  }
}

function contentRevision(material: string): string {
  return createHash('sha256').update(material, 'utf8').digest('hex');
}
