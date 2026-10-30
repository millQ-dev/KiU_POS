import type pg from 'pg';
import {
  FACT_PATH_REGISTRY,
  IMPRINT_RESOLVER_VERSION,
  ImprintFieldState,
  listRegisteredFactPaths,
  type ImprintClaimOriginName,
  type ImprintFieldStateName,
  type ImprintFreshnessName,
  type ImprintPathValue,
  type RegisteredFactPath,
} from '@millq/contracts';
import type { AuthenticatedPrincipal } from '../identity/identity-service.js';
import { ImprintClaimService, ImprintScope } from './imprint-claim-service.js';
import type { SnapshotHead } from './imprint-persistence.js';

export type ImprintHttpField = {
  factPath: RegisteredFactPath;
  fieldState: ImprintFieldStateName;
  claimId: string | null;
  origin: ImprintClaimOriginName | null;
  value: ImprintPathValue | null;
  canonicalValue: string | null;
  sourceAuthoritative: boolean;
  sensitivityClass: string;
  provenance: {
    sourceModule: string;
    sourceEntityType: string;
    sourceEntityId: string;
    sourceRevision: string;
  } | null;
};

export type ImprintHttpSummary = {
  tenantId: string;
  outletId: string;
  resolverVersion: typeof IMPRINT_RESOLVER_VERSION;
  revision: {
    revisionId: string;
    revisionNumber: string;
    freshness: ImprintFreshnessName;
    rebuildInputHash: string;
  } | null;
  includeProvenance: boolean;
  fields: ImprintHttpField[];
};

/**
 * Typed HTTP read projection for Restaurant Imprint (ADR-0054 I-07).
 * Authorization is enforced by the route (outlet-scoped imprint.read).
 */
export class ImprintHttpReadService {
  private readonly claims: ImprintClaimService;

  constructor(private readonly pool: pg.Pool) {
    this.claims = new ImprintClaimService(pool);
  }

  async readOutletSummary(
    principal: AuthenticatedPrincipal,
    outletId: string,
    opts: { includeProvenance: boolean },
  ): Promise<ImprintHttpSummary> {
    const scope = await ImprintScope.open(this.pool, principal, outletId);
    const head = await this.readSnapshotHead(scope.tenantId, scope.outletId);
    const provenanceByClaim = opts.includeProvenance
      ? await this.loadMinimizedProvenance(scope.tenantId, scope.outletId)
      : new Map<string, ImprintHttpField['provenance']>();

    const fields: ImprintHttpField[] = [];
    for (const factPath of listRegisteredFactPaths()) {
      const entry = FACT_PATH_REGISTRY[factPath];
      const resolved = await this.claims.resolveField(scope, factPath);
      let provenance: ImprintHttpField['provenance'] = null;
      if (
        opts.includeProvenance &&
        resolved.fieldState === ImprintFieldState.Known &&
        resolved.claimId
      ) {
        provenance = provenanceByClaim.get(resolved.claimId) ?? null;
      }
      fields.push({
        factPath,
        fieldState: resolved.fieldState,
        claimId: resolved.claimId,
        origin: resolved.origin,
        value: resolved.value,
        canonicalValue: resolved.canonicalValue,
        sourceAuthoritative: resolved.sourceAuthoritative,
        sensitivityClass: entry.sensitivityClass,
        provenance,
      });
    }

    return {
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      resolverVersion: IMPRINT_RESOLVER_VERSION,
      revision: head
        ? {
            revisionId: head.revisionId,
            revisionNumber: head.revisionNumber,
            freshness: head.freshness,
            rebuildInputHash: head.rebuildInputHash,
          }
        : null,
      includeProvenance: opts.includeProvenance,
      fields,
    };
  }

  private async readSnapshotHead(tenantId: string, outletId: string): Promise<SnapshotHead | null> {
    const result = await this.pool.query<{
      revision_id: string;
      revision_number: string;
      freshness: ImprintFreshnessName;
      rebuild_input_hash: string;
    }>(
      `SELECT h.revision_id, r.revision_number::text, h.freshness, r.rebuild_input_hash
       FROM imprint_snapshot_head h
       JOIN imprint_projection_revision r ON r.revision_id = h.revision_id
       WHERE h.tenant_id = $1 AND h.outlet_id = $2`,
      [tenantId, outletId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      revisionId: row.revision_id,
      revisionNumber: row.revision_number,
      freshness: row.freshness,
      rebuildInputHash: row.rebuild_input_hash,
    };
  }

  private async loadMinimizedProvenance(
    tenantId: string,
    outletId: string,
  ): Promise<Map<string, ImprintHttpField['provenance']>> {
    const result = await this.pool.query<{
      claim_id: string;
      source_module: string;
      source_entity_type: string;
      source_entity_id: string;
      source_revision: string;
    }>(
      `SELECT c.claim_id, c.source_module, c.source_entity_type, c.source_entity_id, c.source_revision
       FROM imprint_claim c
       WHERE c.tenant_id = $1 AND c.outlet_id = $2 AND c.claim_effect = 'ASSERTION'
         AND c.canonical_value IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM imprint_claim newer WHERE newer.supersedes_claim_id = c.claim_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM imprint_claim inv
           WHERE inv.invalidates_claim_id = c.claim_id AND inv.claim_effect = 'INVALIDATION'
         )`,
      [tenantId, outletId],
    );
    const map = new Map<string, ImprintHttpField['provenance']>();
    for (const row of result.rows) {
      map.set(row.claim_id, {
        sourceModule: row.source_module,
        sourceEntityType: row.source_entity_type,
        sourceEntityId: row.source_entity_id,
        sourceRevision: row.source_revision,
      });
    }
    return map;
  }
}
