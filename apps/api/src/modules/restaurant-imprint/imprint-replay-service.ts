import type pg from 'pg';
import {
  IMPRINT_RESOLVER_VERSION,
  ImprintFieldState,
  listRegisteredFactPaths,
  type RegisteredFactPath,
} from '@millq/contracts';
import { ImprintServiceError } from './errors.js';
import { ImprintGoodsReceiptAdapter } from './imprint-goods-receipt-adapter.js';
import {
  ImprintClaimService,
  ImprintInternalAuthority,
  ImprintScope,
} from './imprint-claim-service.js';
import { ImprintOrganizationAdapter } from './imprint-organization-adapter.js';
import { ImprintPersistence, type SnapshotHead } from './imprint-persistence.js';
import type { SnapshotFieldInput } from './imprint-rules.js';

export type ImprintReplayField = {
  factPath: RegisteredFactPath;
  fieldState: string;
  claimId: string | null;
  canonicalValue: string | null;
};

export type ImprintReplayResult = {
  head: SnapshotHead;
  fields: ImprintReplayField[];
  resolverVersion: typeof IMPRINT_RESOLVER_VERSION;
  resynced: boolean;
  degraded: boolean;
  sourceFailureRetained: boolean;
};

/**
 * Deterministic outlet snapshot rebuild from claims (+ optional source re-sync).
 * ADR-0054 I-08 — disposable / internal only. No HTTP, no new AccessGrant keys.
 */
export class ImprintReplayService {
  private readonly claims: ImprintClaimService;
  private readonly persistence: ImprintPersistence;
  private readonly organization: ImprintOrganizationAdapter;
  private readonly goodsReceipts: ImprintGoodsReceiptAdapter;
  private readonly authority = ImprintInternalAuthority.forSnapshotRebuild();

  constructor(private readonly pool: pg.Pool) {
    this.claims = new ImprintClaimService(pool);
    this.persistence = new ImprintPersistence(pool);
    this.organization = new ImprintOrganizationAdapter(pool);
    this.goodsReceipts = new ImprintGoodsReceiptAdapter(pool);
  }

  async rebuildOutlet(
    tenantId: string,
    outletId: string,
    opts: { resyncSources?: boolean } = {},
  ): Promise<ImprintReplayResult> {
    const scope = await ImprintScope.openInternal(this.pool, this.authority, tenantId, outletId);
    const prior = await this.readHead(scope.tenantId, scope.outletId);
    let degraded = false;
    let sourceFailureRetained = false;
    const resync = opts.resyncSources === true;

    if (resync) {
      try {
        const org = await this.organization.syncOutlet(scope.tenantId, scope.outletId);
        const procurement = await this.goodsReceipts.syncOutlet(scope.tenantId, scope.outletId);
        degraded = org.degraded || procurement.degraded;
      } catch (err) {
        if (err instanceof ImprintServiceError && err.code === 'IMPRINT_SCOPE_DENIED') throw err;
        await this.claims.recordSourceFailure(scope, {
          sourceModule: 'organization',
          errorCode: 'IMPRINT_SOURCE_READ_FAILED',
          freshness: 'STALE',
        });
        if (!prior) {
          throw new ImprintServiceError(
            'IMPRINT_TRANSACTION_ROLLED_BACK',
            'source resync failed before a snapshot existed',
          );
        }
        return {
          head: { ...prior, freshness: 'STALE' },
          fields: await this.readPublishedFields(prior.revisionId),
          resolverVersion: IMPRINT_RESOLVER_VERSION,
          resynced: false,
          degraded: true,
          sourceFailureRetained: true,
        };
      }
    }

    const fields: SnapshotFieldInput[] = [];
    const projected: ImprintReplayField[] = [];
    for (const factPath of listRegisteredFactPaths()) {
      const resolved = await this.claims.resolveField(scope, factPath);
      const fieldState =
        resolved.fieldState === ImprintFieldState.Known
          ? 'KNOWN'
          : resolved.fieldState === ImprintFieldState.Conflict
            ? 'CONFLICT'
            : 'UNKNOWN';
      const input: SnapshotFieldInput =
        fieldState === 'KNOWN' && resolved.claimId
          ? { factPath, fieldState: 'KNOWN', claimId: resolved.claimId }
          : { factPath, fieldState, claimId: null };
      fields.push(input);
      projected.push({
        factPath,
        fieldState: input.fieldState,
        claimId: input.claimId ?? null,
        canonicalValue: fieldState === 'KNOWN' ? resolved.canonicalValue : null,
      });
    }

    const head = await this.persistence.publishRevision({
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      resolverVersion: IMPRINT_RESOLVER_VERSION,
      fields,
    });

    if (degraded) {
      await this.claims.recordSourceFailure(scope, {
        sourceModule: 'organization',
        errorCode: 'IMPRINT_SOURCE_SCHEMA_LIMIT',
        freshness: 'DEGRADED',
      });
      sourceFailureRetained = true;
      return {
        head: { ...head, freshness: 'DEGRADED' },
        fields: projected,
        resolverVersion: IMPRINT_RESOLVER_VERSION,
        resynced: resync,
        degraded: true,
        sourceFailureRetained,
      };
    }

    return {
      head,
      fields: projected,
      resolverVersion: IMPRINT_RESOLVER_VERSION,
      resynced: resync,
      degraded: false,
      sourceFailureRetained: false,
    };
  }

  private async readHead(tenantId: string, outletId: string): Promise<SnapshotHead | null> {
    const result = await this.pool.query<{
      revision_id: string;
      revision_number: string;
      freshness: 'FRESH' | 'STALE' | 'DEGRADED';
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

  private async readPublishedFields(revisionId: string): Promise<ImprintReplayField[]> {
    const result = await this.pool.query<{
      fact_path: string;
      field_state: string;
      claim_id: string | null;
      canonical_value: string | null;
    }>(
      `SELECT fact_path, field_state, claim_id, canonical_value
       FROM imprint_snapshot_field
       WHERE revision_id = $1
       ORDER BY fact_path`,
      [revisionId],
    );
    return result.rows.map((row) => ({
      factPath: row.fact_path as RegisteredFactPath,
      fieldState: row.field_state,
      claimId: row.claim_id,
      canonicalValue: row.canonical_value,
    }));
  }
}
