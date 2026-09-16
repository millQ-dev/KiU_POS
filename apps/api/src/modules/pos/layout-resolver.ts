import type { Pool, PoolClient } from 'pg';
import { isEffectiveAt, SCOPE_RANK } from '../menu/effective-time.js';
import { DomainValidationError } from './errors.js';
import {
  validatePresentationContext,
  type ValidatedPresentationContext,
} from './presentation-context.js';
import { resolveLayoutSchema, type LayoutScopeKind, type PresentationContextInput } from './types.js';

export type LayoutAssignmentProvenance = {
  readonly layoutAssignmentId: string;
  readonly scopeKind: LayoutScopeKind;
  readonly brandId: string | null;
  readonly outletId: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
};

export type ResolvedLayout = {
  readonly presentationContext: ValidatedPresentationContext;
  readonly businessDateTime: string;
  readonly layoutPublicationId: string;
  readonly layoutDefinitionId: string;
  readonly publicationVersion: number;
  readonly assignment: LayoutAssignmentProvenance;
};

type AssignmentRow = {
  layout_assignment_id: string;
  layout_publication_id: string;
  layout_definition_id: string;
  scope_kind: LayoutScopeKind;
  brand_id: string | null;
  outlet_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
  publication_version: number;
  publication_effective_from: Date;
  publication_effective_to: Date | null;
};

function pickHighestSpecificity(rows: AssignmentRow[]): AssignmentRow {
  let bestRank = -1;
  const winners: AssignmentRow[] = [];
  for (const row of rows) {
    const rank = SCOPE_RANK[row.scope_kind];
    if (rank > bestRank) {
      bestRank = rank;
      winners.length = 0;
      winners.push(row);
    } else if (rank === bestRank) {
      winners.push(row);
    }
  }
  if (winners.length === 0) {
    throw new DomainValidationError('LAYOUT_NOT_ASSIGNED', 'No effective LayoutAssignment');
  }
  if (winners.length > 1) {
    throw new DomainValidationError(
      'AMBIGUOUS_LAYOUT_ASSIGNMENT',
      'Multiple LayoutAssignments at the same winning specificity',
    );
  }
  return winners[0]!;
}

export class LayoutResolver {
  constructor(private readonly pool: Pool) {}

  async resolveLayout(raw: unknown): Promise<ResolvedLayout> {
    const cmd = resolveLayoutSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      return await this.resolveLayoutKernel(client, cmd.presentationContext, cmd.businessDateTime);
    } finally {
      client.release();
    }
  }

  /** Kernel used by PosSurfaceResolver (shared client optional). */
  async resolveLayoutKernel(
    client: PoolClient,
    presentationContext: PresentationContextInput,
    businessDateTimeIso: string,
  ): Promise<ResolvedLayout> {
    const ctx = await validatePresentationContext(client, presentationContext);
    const at = new Date(businessDateTimeIso);
    if (Number.isNaN(at.getTime())) {
      throw new DomainValidationError('INVALID_PRESENTATION_CONTEXT', 'Invalid businessDateTime');
    }

    const rows = await client.query<AssignmentRow>(
      `SELECT a.layout_assignment_id, a.layout_publication_id, a.scope_kind,
              a.brand_id, a.outlet_id, a.effective_from, a.effective_to,
              p.layout_definition_id, p.publication_version,
              p.effective_from AS publication_effective_from,
              p.effective_to AS publication_effective_to
       FROM layout_assignment a
       JOIN layout_publication p ON p.layout_publication_id = a.layout_publication_id
       WHERE a.tenant_id = $1
         AND p.tenant_id = $1
         AND (
           a.scope_kind = 'TENANT'
           OR (a.scope_kind = 'BRAND' AND a.brand_id = $2)
           OR (a.scope_kind = 'OUTLET' AND a.outlet_id = $3)
         )`,
      [ctx.tenantId, ctx.brandId, ctx.outletId],
    );

    const effectiveAssignments = rows.rows.filter((r) =>
      isEffectiveAt(at, new Date(r.effective_from), r.effective_to ? new Date(r.effective_to) : null),
    );
    if (effectiveAssignments.length === 0) {
      throw new DomainValidationError(
        'LAYOUT_NOT_ASSIGNED',
        'No effective LayoutAssignment for PresentationContext',
      );
    }

    const winner = pickHighestSpecificity(effectiveAssignments);

    if (
      !isEffectiveAt(
        at,
        new Date(winner.publication_effective_from),
        winner.publication_effective_to ? new Date(winner.publication_effective_to) : null,
      )
    ) {
      throw new DomainValidationError(
        'LAYOUT_PUBLICATION_NOT_EFFECTIVE',
        'Winning LayoutAssignment points to a LayoutPublication outside its effective interval',
      );
    }

    return {
      presentationContext: ctx,
      businessDateTime: businessDateTimeIso,
      layoutPublicationId: winner.layout_publication_id,
      layoutDefinitionId: winner.layout_definition_id,
      publicationVersion: winner.publication_version,
      assignment: {
        layoutAssignmentId: winner.layout_assignment_id,
        scopeKind: winner.scope_kind,
        brandId: winner.brand_id,
        outletId: winner.outlet_id,
        effectiveFrom: new Date(winner.effective_from).toISOString(),
        effectiveTo: winner.effective_to ? new Date(winner.effective_to).toISOString() : null,
      },
    };
  }
}
