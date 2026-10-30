import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  FactPath,
  ImprintClaimOrigin,
  ImprintFieldState,
  ImprintSensitivity,
  canonicalImprintValue,
} from '@millq/contracts';
import { ImprintServiceError } from './errors.js';
import {
  ImprintClaimService,
  ImprintInternalAuthority,
  ImprintScope,
} from './imprint-claim-service.js';
import type { AppendOutcome } from './imprint-persistence.js';

type OutletScopeRow = {
  outlet_id: string;
  tenant_id: string;
  legal_entity_id: string;
};

export type GoodsReceiptSourceRow = {
  goods_receipt_id: string;
  status: 'POSTED' | 'REVERSED';
  business_date: string;
  business_order: number;
  posted_at: string | null;
  warehouse_id: string;
};

/**
 * Chronology for procurement.last_posted_receipt_ref (ADR-0054 I-06):
 * - Candidates are primary GoodsReceipt rows (reverses_goods_receipt_id IS NULL)
 *   with status POSTED or REVERSED only. DRAFT is never evidence. CORRECTED is not
 *   a Stage 1 runtime path and is never selected or invented.
 * - Reverse companion documents are excluded; the primary receipt keeps its id and
 *   becomes REVERSED after an authoritative reverse re-read.
 * - Scope: outlet tenant + outlet legal_entity + warehouse with explicit non-NULL
 *   matching outlet_id (and matching legal_entity). Shared/NULL warehouses are out.
 * - Order: business_date DESC, business_order DESC, then posted_at DESC NULLS LAST,
 *   then goods_receipt_id DESC. Ingestion order is never used as chronology.
 */
export function pickLastPostedReceipt(
  rows: readonly GoodsReceiptSourceRow[],
): GoodsReceiptSourceRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort(compareReceiptChronology).at(0) ?? null;
}

function compareReceiptChronology(left: GoodsReceiptSourceRow, right: GoodsReceiptSourceRow): number {
  if (left.business_date !== right.business_date) {
    return right.business_date < left.business_date ? -1 : 1;
  }
  if (left.business_order !== right.business_order) {
    return right.business_order - left.business_order;
  }
  const leftPosted = left.posted_at ?? '';
  const rightPosted = right.posted_at ?? '';
  if (leftPosted !== rightPosted) {
    if (!leftPosted) return 1;
    if (!rightPosted) return -1;
    return rightPosted < leftPosted ? -1 : 1;
  }
  return right.goods_receipt_id < left.goods_receipt_id ? -1 : 1;
}

/**
 * Read-only Procurement → Imprint adapter (ADR-0054 I-06).
 * Writes only imprint_* rows through the claim service. No Procurement mutations.
 */
export class ImprintGoodsReceiptAdapter {
  private readonly claims: ImprintClaimService;
  private readonly authority = ImprintInternalAuthority.forProcurementAdapter();

  constructor(private readonly pool: pg.Pool) {
    this.claims = new ImprintClaimService(pool);
  }

  async syncOutlet(tenantId: string, outletId: string): Promise<{
    outcomes: AppendOutcome[];
    watermark: string | null;
    degraded: boolean;
    invalidated: boolean;
  }> {
    const scope = await ImprintScope.openInternal(this.pool, this.authority, tenantId, outletId);
    let outlet: OutletScopeRow;
    let receipt: GoodsReceiptSourceRow | null;
    try {
      const found = await this.readOutlet(scope);
      if (!found) {
        throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', 'outlet is outside the caller tenant');
      }
      outlet = found;
      receipt = await this.readLastPostedReceipt(outlet);
    } catch (err) {
      if (err instanceof ImprintServiceError && err.code === 'IMPRINT_SCOPE_DENIED') throw err;
      await this.claims.recordSourceFailure(scope, {
        sourceModule: 'procurement',
        errorCode: 'IMPRINT_SOURCE_READ_FAILED',
        freshness: 'STALE',
      });
      return { outcomes: [], watermark: null, degraded: true, invalidated: false };
    }

    const current = await this.claims.resolveField(scope, FactPath.LastPostedReceiptRef);

    if (!receipt) {
      let invalidated = false;
      if (current.fieldState === ImprintFieldState.Known && current.claimId) {
        const priorId =
          current.value &&
          typeof current.value === 'object' &&
          'goodsReceiptId' in current.value &&
          typeof (current.value as { goodsReceiptId: unknown }).goodsReceiptId === 'string'
            ? (current.value as { goodsReceiptId: string }).goodsReceiptId
            : current.claimId;
        await this.claims.invalidateAssertion(scope, {
          tenantId: scope.tenantId,
          outletId: scope.outletId,
          factPath: FactPath.LastPostedReceiptRef,
          invalidatesClaimId: current.claimId,
          origin: ImprintClaimOrigin.Observed,
          provenance: {
            sourceModule: 'procurement',
            sourceEntityType: 'GoodsReceipt',
            sourceEntityId: priorId,
            sourceRevision: `missing:${priorId}:${current.claimId}`,
          },
        });
        invalidated = true;
      }
      const watermark = contentRevision(`procurement:empty:${scope.outletId}`);
      await this.claims.commitCheckpoint(scope, {
        sourceModule: 'procurement',
        cursorName: 'goods_receipt_last_posted',
        watermark,
        assertions: [],
      });
      return { outcomes: [], watermark, degraded: false, invalidated };
    }

    const value = {
      goodsReceiptId: receipt.goods_receipt_id,
      postingStatus: receipt.status,
    };
    let canonical: string;
    try {
      canonical = canonicalImprintValue(FactPath.LastPostedReceiptRef, value);
    } catch {
      await this.claims.recordSourceFailure(scope, {
        sourceModule: 'procurement',
        errorCode: 'IMPRINT_SOURCE_SCHEMA_LIMIT',
        freshness: 'DEGRADED',
      });
      return { outcomes: [], watermark: null, degraded: true, invalidated: false };
    }

    if (
      current.fieldState === ImprintFieldState.Known &&
      current.canonicalValue === canonical &&
      current.claimId
    ) {
      return { outcomes: [], watermark: null, degraded: false, invalidated: false };
    }

    const contentHash = contentRevision(
      [
        receipt.goods_receipt_id,
        receipt.status,
        receipt.business_date,
        String(receipt.business_order),
        receipt.posted_at ?? '',
        receipt.warehouse_id,
      ].join(':'),
    );
    const anchor =
      current.claimId ??
      (await this.claims.latestAssertionClaimId(scope, FactPath.LastPostedReceiptRef)) ??
      'genesis';
    const sourceRevision = `${contentHash}:${anchor}`;
    const assertion: Record<string, unknown> = {
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      factPath: FactPath.LastPostedReceiptRef,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.InternalReference,
      provenance: {
        sourceModule: 'procurement',
        sourceEntityType: 'GoodsReceipt',
        sourceEntityId: receipt.goods_receipt_id,
        sourceRevision,
      },
      value,
    };
    if (current.fieldState === ImprintFieldState.Known && current.claimId) {
      assertion.supersedesClaimId = current.claimId;
    }

    const watermark = contentRevision(`${FactPath.LastPostedReceiptRef}:${sourceRevision}`);
    const result = await this.claims.commitCheckpoint(scope, {
      sourceModule: 'procurement',
      cursorName: 'goods_receipt_last_posted',
      watermark,
      assertions: [assertion],
    });
    return {
      outcomes: result.outcomes,
      watermark: result.watermark,
      degraded: false,
      invalidated: false,
    };
  }

  private async readOutlet(scope: ImprintScope): Promise<OutletScopeRow | null> {
    const result = await this.pool.query<OutletScopeRow>(
      `SELECT outlet_id, tenant_id, legal_entity_id
       FROM outlet
       WHERE outlet_id = $1 AND tenant_id = $2`,
      [scope.outletId, scope.tenantId],
    );
    return result.rows[0] ?? null;
  }

  private async readLastPostedReceipt(outlet: OutletScopeRow): Promise<GoodsReceiptSourceRow | null> {
    const result = await this.pool.query<{
      goods_receipt_id: string;
      status: string;
      business_date: Date | string;
      business_order: number;
      posted_at: Date | string | null;
      warehouse_id: string;
    }>(
      `SELECT gr.goods_receipt_id,
              gr.status,
              gr.business_date,
              gr.business_order,
              gr.posted_at,
              gr.warehouse_id
       FROM goods_receipt gr
       INNER JOIN warehouse w
         ON w.warehouse_id = gr.warehouse_id
        AND w.tenant_id = gr.tenant_id
        AND w.legal_entity_id = gr.legal_entity_id
       WHERE gr.tenant_id = $1
         AND gr.legal_entity_id = $2
         AND w.outlet_id = $3
         AND gr.reverses_goods_receipt_id IS NULL
         AND gr.status IN ('POSTED', 'REVERSED')`,
      [outlet.tenant_id, outlet.legal_entity_id, outlet.outlet_id],
    );

    const rows: GoodsReceiptSourceRow[] = [];
    for (const row of result.rows) {
      if (row.status !== 'POSTED' && row.status !== 'REVERSED') continue;
      rows.push({
        goods_receipt_id: row.goods_receipt_id,
        status: row.status,
        business_date: asIsoDate(row.business_date),
        business_order: row.business_order,
        posted_at: row.posted_at == null ? null : asTimestamptz(row.posted_at),
        warehouse_id: row.warehouse_id,
      });
    }
    return pickLastPostedReceipt(rows);
  }
}

function asIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asTimestamptz(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function contentRevision(material: string): string {
  return createHash('sha256').update(material, 'utf8').digest('hex');
}
