import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
  PublishedImmutableError,
} from './errors.js';
import {
  assignLayoutSchema,
  createLayoutDefinitionSchema,
  publishLayoutSchema,
  setLayoutPagesSchema,
  setLayoutSlotsSchema,
  type AssignLayoutInput,
  type CreateLayoutDefinitionInput,
  type LayoutScopeKind,
  type PublishLayoutInput,
  type SetLayoutPagesInput,
  type SetLayoutSlotsInput,
} from './types.js';

function fingerprint(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function parseInstant(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new DomainValidationError('INVALID_PRESENTATION_CONTEXT', `Invalid instant: ${iso}`);
  }
  return d;
}

function assertScopeIds(
  scopeKind: LayoutScopeKind,
  brandId: string | undefined,
  outletId: string | undefined,
): void {
  if (scopeKind === 'TENANT') {
    if (brandId || outletId) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'TENANT scope must not set brand/outlet',
      );
    }
  } else if (scopeKind === 'BRAND') {
    if (!brandId || outletId) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'BRAND scope requires brandId only',
      );
    }
  } else if (scopeKind === 'OUTLET') {
    if (!outletId || brandId) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'OUTLET scope requires outletId only',
      );
    }
  }
}

function isExclusionViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23P01'
  );
}

async function assertCatalogItemInTenant(
  client: PoolClient,
  tenantId: string,
  catalogItemId: string,
): Promise<void> {
  const r = await client.query(`SELECT 1 FROM catalog_item WHERE catalog_item_id = $1 AND tenant_id = $2`, [
    catalogItemId,
    tenantId,
  ]);
  if (r.rowCount !== 1) {
    throw new DomainValidationError(
      'LAYOUT_TARGET_INVALID',
      'CatalogItem not found in tenant (cross-tenant rejected)',
    );
  }
}

export class LayoutService {
  constructor(private readonly pool: Pool) {}

  async createLayoutDefinition(raw: unknown) {
    const cmd = createLayoutDefinitionSchema.parse(raw) as CreateLayoutDefinitionInput;
    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO layout_definition (layout_definition_id, tenant_id, code, name)
         VALUES ($1,$2,$3,$4)`,
        [id, cmd.tenantId, cmd.code, cmd.name],
      );
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        throw new DomainValidationError(
          'LAYOUT_DEFINITION_CODE_CONFLICT',
          'LayoutDefinition code already exists for tenant',
        );
      }
      throw err;
    }
    return { layoutDefinitionId: id, tenantId: cmd.tenantId, code: cmd.code, name: cmd.name };
  }

  async setLayoutPages(raw: unknown) {
    const cmd = setLayoutPagesSchema.parse(raw) as SetLayoutPagesInput;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const def = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM layout_definition WHERE layout_definition_id = $1 FOR UPDATE`,
        [cmd.layoutDefinitionId],
      );
      if (def.rowCount !== 1) throw new NotFoundError('LayoutDefinition not found');
      const tenantId = def.rows[0]!.tenant_id;

      const codes = new Set<string>();
      const orders = new Set<number>();
      for (const p of cmd.pages) {
        if (codes.has(p.pageCode)) {
          throw new DomainValidationError('LAYOUT_TARGET_INVALID', `Duplicate pageCode ${p.pageCode}`);
        }
        if (orders.has(p.sortOrder)) {
          throw new DomainValidationError('LAYOUT_TARGET_INVALID', `Duplicate page sortOrder ${p.sortOrder}`);
        }
        codes.add(p.pageCode);
        orders.add(p.sortOrder);
      }

      await client.query(`DELETE FROM layout_definition_slot WHERE layout_definition_id = $1`, [
        cmd.layoutDefinitionId,
      ]);
      await client.query(`DELETE FROM layout_definition_page WHERE layout_definition_id = $1`, [
        cmd.layoutDefinitionId,
      ]);
      for (const p of cmd.pages) {
        await client.query(
          `INSERT INTO layout_definition_page (
             layout_definition_page_id, tenant_id, layout_definition_id,
             page_code, label, sort_order, color_token
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            tenantId,
            cmd.layoutDefinitionId,
            p.pageCode,
            p.label,
            p.sortOrder,
            p.colorToken ?? null,
          ],
        );
      }
      await client.query(`UPDATE layout_definition SET updated_at = NOW() WHERE layout_definition_id = $1`, [
        cmd.layoutDefinitionId,
      ]);
      await client.query('COMMIT');
      return { layoutDefinitionId: cmd.layoutDefinitionId, pageCount: cmd.pages.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async setLayoutSlots(raw: unknown) {
    const cmd = setLayoutSlotsSchema.parse(raw) as SetLayoutSlotsInput;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const def = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM layout_definition WHERE layout_definition_id = $1 FOR UPDATE`,
        [cmd.layoutDefinitionId],
      );
      if (def.rowCount !== 1) throw new NotFoundError('LayoutDefinition not found');
      const tenantId = def.rows[0]!.tenant_id;

      const pages = await client.query<{
        layout_definition_page_id: string;
        page_code: string;
      }>(
        `SELECT layout_definition_page_id, page_code FROM layout_definition_page
         WHERE layout_definition_id = $1`,
        [cmd.layoutDefinitionId],
      );
      const pageByCode = new Map(pages.rows.map((p) => [p.page_code, p.layout_definition_page_id]));

      const qaPositions = new Set<number>();
      const pagePositions = new Map<string, Set<number>>();

      for (const s of cmd.slots) {
        await assertCatalogItemInTenant(client, tenantId, s.catalogItemId);
        if (s.zone === 'QUICK_ACCESS') {
          if (s.pageCode) {
            throw new DomainValidationError(
              'LAYOUT_TARGET_INVALID',
              'QUICK_ACCESS slots must not set pageCode',
            );
          }
          if (s.position < 1 || s.position > 10) {
            throw new DomainValidationError(
              'LAYOUT_TARGET_INVALID',
              'Quick Access position must be 1..10',
            );
          }
          if (qaPositions.has(s.position)) {
            throw new DomainValidationError(
              'LAYOUT_TARGET_INVALID',
              `Duplicate Quick Access position ${s.position}`,
            );
          }
          qaPositions.add(s.position);
        } else {
          if (!s.pageCode) {
            throw new DomainValidationError('LAYOUT_TARGET_INVALID', 'PAGE slots require pageCode');
          }
          if (!pageByCode.has(s.pageCode)) {
            throw new DomainValidationError(
              'LAYOUT_TARGET_INVALID',
              `Unknown pageCode ${s.pageCode}`,
            );
          }
          const set = pagePositions.get(s.pageCode) ?? new Set<number>();
          if (set.has(s.position)) {
            throw new DomainValidationError(
              'LAYOUT_TARGET_INVALID',
              `Duplicate position ${s.position} on page ${s.pageCode}`,
            );
          }
          set.add(s.position);
          pagePositions.set(s.pageCode, set);
        }
      }

      if (qaPositions.size > 10) {
        throw new DomainValidationError('LAYOUT_TARGET_INVALID', 'Quick Access max 10 positions');
      }

      await client.query(`DELETE FROM layout_definition_slot WHERE layout_definition_id = $1`, [
        cmd.layoutDefinitionId,
      ]);
      for (const s of cmd.slots) {
        await client.query(
          `INSERT INTO layout_definition_slot (
             layout_definition_slot_id, tenant_id, layout_definition_id, zone,
             layout_definition_page_id, catalog_item_id, position, label_override, color_token
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            tenantId,
            cmd.layoutDefinitionId,
            s.zone,
            s.zone === 'PAGE' ? pageByCode.get(s.pageCode!)! : null,
            s.catalogItemId,
            s.position,
            s.labelOverride ?? null,
            s.colorToken ?? null,
          ],
        );
      }
      await client.query(`UPDATE layout_definition SET updated_at = NOW() WHERE layout_definition_id = $1`, [
        cmd.layoutDefinitionId,
      ]);
      await client.query('COMMIT');
      return {
        layoutDefinitionId: cmd.layoutDefinitionId,
        slotCount: cmd.slots.length,
        quickAccessCount: qaPositions.size,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async publishLayout(raw: unknown) {
    const cmd = publishLayoutSchema.parse(raw) as PublishLayoutInput;
    const effectiveFrom = parseInstant(cmd.effectiveFrom);
    const effectiveTo = cmd.effectiveTo != null ? parseInstant(cmd.effectiveTo) : null;
    if (effectiveTo && !(effectiveTo.getTime() > effectiveFrom.getTime())) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'effectiveTo must be after effectiveFrom',
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const def = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM layout_definition WHERE layout_definition_id = $1 FOR UPDATE`,
        [cmd.layoutDefinitionId],
      );
      if (def.rowCount !== 1) throw new NotFoundError('LayoutDefinition not found');
      const tenantId = def.rows[0]!.tenant_id;

      const pages = await client.query<{
        layout_definition_page_id: string;
        page_code: string;
        label: string;
        sort_order: number;
        color_token: string | null;
      }>(
        `SELECT layout_definition_page_id, page_code, label, sort_order, color_token
         FROM layout_definition_page
         WHERE layout_definition_id = $1
         ORDER BY sort_order, page_code`,
        [cmd.layoutDefinitionId],
      );
      if (pages.rowCount === 0) {
        throw new DomainValidationError('EMPTY_LAYOUT', 'Cannot publish LayoutDefinition without pages');
      }

      const slots = await client.query<{
        zone: 'PAGE' | 'QUICK_ACCESS';
        layout_definition_page_id: string | null;
        catalog_item_id: string;
        position: number;
        label_override: string | null;
        color_token: string | null;
      }>(
        `SELECT zone, layout_definition_page_id, catalog_item_id, position, label_override, color_token
         FROM layout_definition_slot
         WHERE layout_definition_id = $1
         ORDER BY zone, position`,
        [cmd.layoutDefinitionId],
      );

      const semanticFingerprint = fingerprint({
        layoutDefinitionId: cmd.layoutDefinitionId,
        pages: pages.rows,
        slots: slots.rows,
        effectiveFrom: cmd.effectiveFrom,
        effectiveTo: cmd.effectiveTo ?? null,
      });

      const existing = await client.query<{
        layout_publication_id: string;
        publication_version: number;
        semantic_fingerprint: string;
      }>(
        `SELECT layout_publication_id, publication_version, semantic_fingerprint
         FROM layout_publication
         WHERE tenant_id = $1 AND layout_definition_id = $2 AND idempotency_key = $3`,
        [tenantId, cmd.layoutDefinitionId, cmd.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (row.semantic_fingerprint !== semanticFingerprint) {
          throw new IdempotencyConflictError(
            'PublishLayout idempotency key already used with different semantics',
          );
        }
        await client.query('COMMIT');
        return {
          layoutPublicationId: row.layout_publication_id,
          layoutDefinitionId: cmd.layoutDefinitionId,
          publicationVersion: row.publication_version,
          duplicate: true as const,
        };
      }

      const ver = await client.query<{ v: number }>(
        `SELECT COALESCE(MAX(publication_version), 0)::int AS v
         FROM layout_publication WHERE layout_definition_id = $1`,
        [cmd.layoutDefinitionId],
      );
      const publicationVersion = (ver.rows[0]?.v ?? 0) + 1;
      const layoutPublicationId = randomUUID();

      await client.query(
        `INSERT INTO layout_publication (
           layout_publication_id, tenant_id, layout_definition_id, publication_version,
           idempotency_key, semantic_fingerprint, effective_from, effective_to, actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          layoutPublicationId,
          tenantId,
          cmd.layoutDefinitionId,
          publicationVersion,
          cmd.idempotencyKey,
          semanticFingerprint,
          effectiveFrom.toISOString(),
          effectiveTo?.toISOString() ?? null,
          cmd.actorId ?? null,
        ],
      );

      await client.query(`SELECT set_config('app.layout_publish', '1', true)`);
      const pageIdMap = new Map<string, string>();
      for (const p of pages.rows) {
        const pubPageId = randomUUID();
        pageIdMap.set(p.layout_definition_page_id, pubPageId);
        await client.query(
          `INSERT INTO layout_publication_page (
             layout_publication_page_id, tenant_id, layout_publication_id,
             page_code, label, sort_order, color_token
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            pubPageId,
            tenantId,
            layoutPublicationId,
            p.page_code,
            p.label,
            p.sort_order,
            p.color_token,
          ],
        );
      }
      for (const s of slots.rows) {
        await client.query(
          `INSERT INTO layout_publication_slot (
             layout_publication_slot_id, tenant_id, layout_publication_id, zone,
             layout_publication_page_id, catalog_item_id, position, label_override, color_token
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            tenantId,
            layoutPublicationId,
            s.zone,
            s.layout_definition_page_id ? pageIdMap.get(s.layout_definition_page_id)! : null,
            s.catalog_item_id,
            s.position,
            s.label_override,
            s.color_token,
          ],
        );
      }
      await client.query(`SELECT set_config('app.layout_publish', '0', true)`);
      await client.query('COMMIT');
      return {
        layoutPublicationId,
        layoutDefinitionId: cmd.layoutDefinitionId,
        publicationVersion,
        duplicate: false as const,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async tryMutatePublication(layoutPublicationId: string): Promise<never> {
    const r = await this.pool.query(
      `SELECT 1 FROM layout_publication WHERE layout_publication_id = $1`,
      [layoutPublicationId],
    );
    if (r.rowCount !== 1) throw new NotFoundError('LayoutPublication not found');
    throw new PublishedImmutableError();
  }

  async assignLayout(raw: unknown) {
    const cmd = assignLayoutSchema.parse(raw) as AssignLayoutInput;
    assertScopeIds(cmd.scopeKind, cmd.brandId, cmd.outletId);
    const effectiveFrom = parseInstant(cmd.effectiveFrom);
    const effectiveTo = cmd.effectiveTo != null ? parseInstant(cmd.effectiveTo) : null;
    if (effectiveTo && !(effectiveTo.getTime() > effectiveFrom.getTime())) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'effectiveTo must be after effectiveFrom',
      );
    }

    const semanticFingerprint = fingerprint({
      layoutPublicationId: cmd.layoutPublicationId,
      scopeKind: cmd.scopeKind,
      brandId: cmd.brandId ?? null,
      outletId: cmd.outletId ?? null,
      effectiveFrom: cmd.effectiveFrom,
      effectiveTo: cmd.effectiveTo ?? null,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pub = await client.query(
        `SELECT 1 FROM layout_publication WHERE layout_publication_id = $1 AND tenant_id = $2`,
        [cmd.layoutPublicationId, cmd.tenantId],
      );
      if (pub.rowCount !== 1) {
        throw new DomainValidationError(
          'INVALID_PRESENTATION_CONTEXT',
          'LayoutPublication not found in tenant (cross-tenant rejected)',
        );
      }

      if (cmd.scopeKind === 'BRAND' && cmd.brandId) {
        const b = await client.query(`SELECT 1 FROM brand WHERE brand_id = $1 AND tenant_id = $2`, [
          cmd.brandId,
          cmd.tenantId,
        ]);
        if (b.rowCount !== 1) {
          throw new DomainValidationError(
            'INVALID_PRESENTATION_CONTEXT',
            'Brand not in tenant (cross-tenant rejected)',
          );
        }
      }
      if (cmd.scopeKind === 'OUTLET' && cmd.outletId) {
        const o = await client.query(`SELECT 1 FROM outlet WHERE outlet_id = $1 AND tenant_id = $2`, [
          cmd.outletId,
          cmd.tenantId,
        ]);
        if (o.rowCount !== 1) {
          throw new DomainValidationError(
            'INVALID_PRESENTATION_CONTEXT',
            'Outlet not in tenant (cross-tenant rejected)',
          );
        }
      }

      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
        `layout_assignment:${cmd.tenantId}`,
      ]);

      const existing = await client.query<{
        layout_assignment_id: string;
        semantic_fingerprint: string;
      }>(
        `SELECT layout_assignment_id, semantic_fingerprint FROM layout_assignment
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [cmd.tenantId, cmd.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (row.semantic_fingerprint !== semanticFingerprint) {
          throw new IdempotencyConflictError(
            'AssignLayout idempotency key already used with different semantics',
          );
        }
        await client.query('COMMIT');
        return { layoutAssignmentId: row.layout_assignment_id, duplicate: true as const };
      }

      const layoutAssignmentId = randomUUID();
      try {
        await client.query(
          `INSERT INTO layout_assignment (
             layout_assignment_id, tenant_id, layout_publication_id, scope_kind,
             brand_id, outlet_id, effective_from, effective_to,
             idempotency_key, semantic_fingerprint, actor_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            layoutAssignmentId,
            cmd.tenantId,
            cmd.layoutPublicationId,
            cmd.scopeKind,
            cmd.brandId ?? null,
            cmd.outletId ?? null,
            effectiveFrom.toISOString(),
            effectiveTo?.toISOString() ?? null,
            cmd.idempotencyKey,
            semanticFingerprint,
            cmd.actorId ?? null,
          ],
        );
      } catch (err) {
        if (isExclusionViolation(err)) {
          throw new DomainValidationError(
            'AMBIGUOUS_LAYOUT_ASSIGNMENT',
            'Overlapping LayoutAssignment at the same operational specificity',
          );
        }
        throw err;
      }
      await client.query('COMMIT');
      return { layoutAssignmentId, duplicate: false as const };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
