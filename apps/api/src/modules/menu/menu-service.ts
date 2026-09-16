import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
  PublishedImmutableError,
} from './errors.js';
import { assertIanaTimezone } from './effective-time.js';
import {
  activateAvailabilityRuleSchema,
  activatePriceRuleSchema,
  assignMenuSchema,
  createMenuDefinitionSchema,
  publishMenuSchema,
  setMenuDefinitionItemsSchema,
  setOutletTimezoneSchema,
  type ActivateAvailabilityRuleInput,
  type ActivatePriceRuleInput,
  type AssignMenuInput,
  type CreateMenuDefinitionInput,
  type MenuScopeKind,
  type PublishMenuInput,
  type SetMenuDefinitionItemsInput,
  type SetOutletTimezoneInput,
} from './types.js';
import { createMoney } from '@millq/domain';

function fingerprint(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function parseInstant(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new DomainValidationError('INVALID_SALES_CONTEXT', `Invalid instant: ${iso}`);
  }
  return d;
}

function assertScopeIds(
  scopeKind: MenuScopeKind,
  brandId: string | undefined,
  outletId: string | undefined,
): void {
  if (scopeKind === 'TENANT') {
    if (brandId || outletId) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'TENANT scope must not set brand/outlet');
    }
  } else if (scopeKind === 'BRAND') {
    if (!brandId || outletId) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'BRAND scope requires brandId only');
    }
  } else if (scopeKind === 'OUTLET') {
    if (!outletId) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'OUTLET scope requires outletId');
    }
  }
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
      'INVALID_SALES_CONTEXT',
      'CatalogItem not found in tenant (cross-tenant rejected)',
    );
  }
}

async function assertPublicationInTenant(
  client: PoolClient,
  tenantId: string,
  menuPublicationId: string,
): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM menu_publication WHERE menu_publication_id = $1 AND tenant_id = $2`,
    [menuPublicationId, tenantId],
  );
  if (r.rowCount !== 1) {
    throw new DomainValidationError(
      'INVALID_SALES_CONTEXT',
      'MenuPublication not found in tenant (cross-tenant rejected)',
    );
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

/**
 * Detect overlapping rules where a global (NULL) channel filter and a specific
 * channel filter would both match the same SalesContext at resolution time.
 */
async function assertNoChannelAwareRuleOverlap(
  client: PoolClient,
  table: 'availability_rule' | 'price_rule',
  args: {
    tenantId: string;
    catalogItemId: string;
    scopeKind: MenuScopeKind;
    brandId: string | null;
    outletId: string | null;
    orderChannel: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  ambiguousCode: string,
): Promise<void> {
  const r = await client.query(
    `SELECT 1
     FROM ${table} r
     WHERE r.tenant_id = $1
       AND r.catalog_item_id = $2
       AND r.scope_kind = $3
       AND COALESCE(r.brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(r.outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND tstzrange(r.effective_from, COALESCE(r.effective_to, 'infinity'::timestamptz), '[)')
           && tstzrange($6::timestamptz, COALESCE($7::timestamptz, 'infinity'::timestamptz), '[)')
       AND (
         r.order_channel IS NULL
         OR $8::text IS NULL
         OR r.order_channel = $8
       )
     LIMIT 1`,
    [
      args.tenantId,
      args.catalogItemId,
      args.scopeKind,
      args.brandId,
      args.outletId,
      args.effectiveFrom.toISOString(),
      args.effectiveTo?.toISOString() ?? null,
      args.orderChannel,
    ],
  );
  if ((r.rowCount ?? 0) > 0) {
    throw new DomainValidationError(
      ambiguousCode,
      'Overlapping rule at same specificity including global vs channel-specific filters',
    );
  }
}

export class MenuService {
  constructor(private readonly pool: Pool) {}

  async setOutletTimezone(raw: unknown) {
    const cmd = setOutletTimezoneSchema.parse(raw) as SetOutletTimezoneInput;
    try {
      assertIanaTimezone(cmd.timezone);
    } catch {
      throw new DomainValidationError('OUTLET_TIMEZONE_REQUIRED', `Invalid IANA timezone: ${cmd.timezone}`);
    }
    const r = await this.pool.query(
      `UPDATE outlet SET timezone = $3
       WHERE outlet_id = $1 AND tenant_id = $2
       RETURNING outlet_id, timezone`,
      [cmd.outletId, cmd.tenantId, cmd.timezone],
    );
    if (r.rowCount !== 1) {
      throw new DomainValidationError(
        'INVALID_SALES_CONTEXT',
        'Outlet not found for tenant (cross-tenant rejected)',
      );
    }
    return { outletId: cmd.outletId, timezone: cmd.timezone };
  }

  async createMenuDefinition(raw: unknown) {
    const cmd = createMenuDefinitionSchema.parse(raw) as CreateMenuDefinitionInput;
    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO menu_definition (menu_definition_id, tenant_id, code, name)
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
        throw new DomainValidationError('MENU_DEFINITION_CODE_CONFLICT', 'MenuDefinition code already exists for tenant');
      }
      throw err;
    }
    return { menuDefinitionId: id, tenantId: cmd.tenantId, code: cmd.code, name: cmd.name };
  }

  async setMenuDefinitionItems(raw: unknown) {
    const cmd = setMenuDefinitionItemsSchema.parse(raw) as SetMenuDefinitionItemsInput;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const def = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM menu_definition WHERE menu_definition_id = $1 FOR UPDATE`,
        [cmd.menuDefinitionId],
      );
      if (def.rowCount !== 1) throw new NotFoundError('MenuDefinition not found');
      const tenantId = def.rows[0]!.tenant_id;
      const unique = [...new Set(cmd.catalogItemIds)];
      for (const catalogItemId of unique) {
        await assertCatalogItemInTenant(client, tenantId, catalogItemId);
      }
      await client.query(`DELETE FROM menu_definition_item WHERE menu_definition_id = $1`, [
        cmd.menuDefinitionId,
      ]);
      for (const catalogItemId of unique) {
        await client.query(
          `INSERT INTO menu_definition_item (menu_definition_item_id, tenant_id, menu_definition_id, catalog_item_id)
           VALUES ($1,$2,$3,$4)`,
          [randomUUID(), tenantId, cmd.menuDefinitionId, catalogItemId],
        );
      }
      await client.query(`UPDATE menu_definition SET updated_at = NOW() WHERE menu_definition_id = $1`, [
        cmd.menuDefinitionId,
      ]);
      await client.query('COMMIT');
      return { menuDefinitionId: cmd.menuDefinitionId, catalogItemIds: unique };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async publishMenu(raw: unknown) {
    const cmd = publishMenuSchema.parse(raw) as PublishMenuInput;
    const effectiveFrom = parseInstant(cmd.effectiveFrom);
    const effectiveTo = cmd.effectiveTo != null ? parseInstant(cmd.effectiveTo) : null;
    if (effectiveTo && !(effectiveTo.getTime() > effectiveFrom.getTime())) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'effectiveTo must be after effectiveFrom');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const def = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM menu_definition WHERE menu_definition_id = $1 FOR UPDATE`,
        [cmd.menuDefinitionId],
      );
      if (def.rowCount !== 1) throw new NotFoundError('MenuDefinition not found');
      const tenantId = def.rows[0]!.tenant_id;

      const items = await client.query<{ catalog_item_id: string }>(
        `SELECT catalog_item_id FROM menu_definition_item
         WHERE menu_definition_id = $1 ORDER BY catalog_item_id`,
        [cmd.menuDefinitionId],
      );
      if (items.rowCount === 0) {
        throw new DomainValidationError('EMPTY_MENU', 'Cannot publish MenuDefinition without membership');
      }
      const catalogItemIds = items.rows.map((r) => r.catalog_item_id);
      const semanticFingerprint = fingerprint({
        menuDefinitionId: cmd.menuDefinitionId,
        catalogItemIds,
        effectiveFrom: cmd.effectiveFrom,
        effectiveTo: cmd.effectiveTo ?? null,
      });

      const existing = await client.query<{
        menu_publication_id: string;
        publication_version: number;
        semantic_fingerprint: string;
      }>(
        `SELECT menu_publication_id, publication_version, semantic_fingerprint
         FROM menu_publication
         WHERE tenant_id = $1 AND menu_definition_id = $2 AND idempotency_key = $3`,
        [tenantId, cmd.menuDefinitionId, cmd.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (row.semantic_fingerprint !== semanticFingerprint) {
          throw new IdempotencyConflictError(
            'PublishMenu idempotency key already used with different membership semantics',
          );
        }
        await client.query('COMMIT');
        return {
          menuPublicationId: row.menu_publication_id,
          menuDefinitionId: cmd.menuDefinitionId,
          publicationVersion: row.publication_version,
          catalogItemIds,
          duplicate: true as const,
        };
      }

      const ver = await client.query<{ v: number }>(
        `SELECT COALESCE(MAX(publication_version), 0)::int AS v
         FROM menu_publication WHERE menu_definition_id = $1`,
        [cmd.menuDefinitionId],
      );
      const publicationVersion = (ver.rows[0]?.v ?? 0) + 1;
      const menuPublicationId = randomUUID();

      await client.query(
        `INSERT INTO menu_publication (
           menu_publication_id, tenant_id, menu_definition_id, publication_version,
           idempotency_key, semantic_fingerprint, actor_id, effective_from, effective_to
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          menuPublicationId,
          tenantId,
          cmd.menuDefinitionId,
          publicationVersion,
          cmd.idempotencyKey,
          semanticFingerprint,
          cmd.actorId ?? null,
          effectiveFrom.toISOString(),
          effectiveTo?.toISOString() ?? null,
        ],
      );
      await client.query(`SELECT set_config('app.menu_publish', '1', true)`);
      for (const catalogItemId of catalogItemIds) {
        await client.query(
          `INSERT INTO menu_publication_item (
             menu_publication_item_id, tenant_id, menu_publication_id, catalog_item_id
           ) VALUES ($1,$2,$3,$4)`,
          [randomUUID(), tenantId, menuPublicationId, catalogItemId],
        );
      }
      await client.query(`SELECT set_config('app.menu_publish', '0', true)`);
      await client.query('COMMIT');
      return {
        menuPublicationId,
        menuDefinitionId: cmd.menuDefinitionId,
        publicationVersion,
        catalogItemIds,
        duplicate: false as const,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Defensive: published membership must never mutate. */
  async assertPublicationImmutable(menuPublicationId: string): Promise<void> {
    const r = await this.pool.query(
      `SELECT 1 FROM menu_publication WHERE menu_publication_id = $1`,
      [menuPublicationId],
    );
    if (r.rowCount !== 1) throw new NotFoundError('MenuPublication not found');
    throw new PublishedImmutableError();
  }

  async tryMutatePublicationMembership(menuPublicationId: string, catalogItemId: string): Promise<never> {
    void catalogItemId;
    await this.assertPublicationImmutable(menuPublicationId);
    throw new PublishedImmutableError();
  }

  async assignMenu(raw: unknown) {
    const cmd = assignMenuSchema.parse(raw) as AssignMenuInput;
    assertScopeIds(cmd.scopeKind, cmd.brandId, cmd.outletId);
    const effectiveFrom = parseInstant(cmd.effectiveFrom);
    const effectiveTo = cmd.effectiveTo != null ? parseInstant(cmd.effectiveTo) : null;
    if (effectiveTo && !(effectiveTo.getTime() > effectiveFrom.getTime())) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'effectiveTo must be after effectiveFrom');
    }

    const semanticFingerprint = fingerprint({
      menuPublicationId: cmd.menuPublicationId,
      scopeKind: cmd.scopeKind,
      brandId: cmd.brandId ?? null,
      outletId: cmd.outletId ?? null,
      effectiveFrom: cmd.effectiveFrom,
      effectiveTo: cmd.effectiveTo ?? null,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await assertPublicationInTenant(client, cmd.tenantId, cmd.menuPublicationId);

      if (cmd.scopeKind === 'BRAND' && cmd.brandId) {
        const b = await client.query(`SELECT 1 FROM brand WHERE brand_id = $1 AND tenant_id = $2`, [
          cmd.brandId,
          cmd.tenantId,
        ]);
        if (b.rowCount !== 1) {
          throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Brand not in tenant');
        }
      }
      if (cmd.scopeKind === 'OUTLET' && cmd.outletId) {
        const o = await client.query(
          `SELECT brand_id FROM outlet WHERE outlet_id = $1 AND tenant_id = $2`,
          [cmd.outletId, cmd.tenantId],
        );
        if (o.rowCount !== 1) {
          throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Outlet not in tenant');
        }
      }

      // Serialize assignment activation per tenant BEFORE idempotency lookup (retry-safe).
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
        `menu_assignment:${cmd.tenantId}`,
      ]);

      const existing = await client.query<{
        menu_assignment_id: string;
        semantic_fingerprint: string;
      }>(
        `SELECT menu_assignment_id, semantic_fingerprint FROM menu_assignment
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [cmd.tenantId, cmd.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (row.semantic_fingerprint !== semanticFingerprint) {
          throw new IdempotencyConflictError(
            'AssignMenu idempotency key already used with different semantics',
          );
        }
        await client.query('COMMIT');
        return { menuAssignmentId: row.menu_assignment_id, duplicate: true as const };
      }

      const menuAssignmentId = randomUUID();
      try {
        await client.query(
          `INSERT INTO menu_assignment (
             menu_assignment_id, tenant_id, menu_publication_id, scope_kind,
             brand_id, outlet_id, effective_from, effective_to,
             idempotency_key, semantic_fingerprint, actor_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            menuAssignmentId,
            cmd.tenantId,
            cmd.menuPublicationId,
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
            'AMBIGUOUS_MENU_ASSIGNMENT',
            'Overlapping MenuAssignment at the same operational specificity',
          );
        }
        throw err;
      }
      await client.query('COMMIT');
      return { menuAssignmentId, duplicate: false as const };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async activateAvailabilityRule(raw: unknown) {
    const cmd = activateAvailabilityRuleSchema.parse(raw) as ActivateAvailabilityRuleInput;
    assertScopeIds(cmd.scopeKind, cmd.brandId, cmd.outletId);
    const effectiveFrom = parseInstant(cmd.effectiveFrom);
    const effectiveTo = cmd.effectiveTo != null ? parseInstant(cmd.effectiveTo) : null;
    if (effectiveTo && !(effectiveTo.getTime() > effectiveFrom.getTime())) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'effectiveTo must be after effectiveFrom');
    }

    const semanticFingerprint = fingerprint({
      catalogItemId: cmd.catalogItemId,
      scopeKind: cmd.scopeKind,
      brandId: cmd.brandId ?? null,
      outletId: cmd.outletId ?? null,
      availabilityStatus: cmd.availabilityStatus,
      orderChannel: cmd.orderChannel ?? null,
      effectiveFrom: cmd.effectiveFrom,
      effectiveTo: cmd.effectiveTo ?? null,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await assertCatalogItemInTenant(client, cmd.tenantId, cmd.catalogItemId);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
        `availability_rule:${cmd.tenantId}`,
      ]);

      const existing = await client.query<{
        availability_rule_id: string;
        semantic_fingerprint: string;
      }>(
        `SELECT availability_rule_id, semantic_fingerprint FROM availability_rule
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [cmd.tenantId, cmd.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (row.semantic_fingerprint !== semanticFingerprint) {
          throw new IdempotencyConflictError(
            'AvailabilityRule idempotency key already used with different semantics',
          );
        }
        await client.query('COMMIT');
        return { availabilityRuleId: row.availability_rule_id, duplicate: true as const };
      }

      await assertNoChannelAwareRuleOverlap(
        client,
        'availability_rule',
        {
          tenantId: cmd.tenantId,
          catalogItemId: cmd.catalogItemId,
          scopeKind: cmd.scopeKind,
          brandId: cmd.brandId ?? null,
          outletId: cmd.outletId ?? null,
          orderChannel: cmd.orderChannel ?? null,
          effectiveFrom,
          effectiveTo,
        },
        'AMBIGUOUS_AVAILABILITY_RULE',
      );

      const availabilityRuleId = randomUUID();
      try {
        await client.query(
          `INSERT INTO availability_rule (
             availability_rule_id, tenant_id, catalog_item_id, scope_kind,
             brand_id, outlet_id, availability_status, order_channel,
             effective_from, effective_to, idempotency_key, semantic_fingerprint, actor_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            availabilityRuleId,
            cmd.tenantId,
            cmd.catalogItemId,
            cmd.scopeKind,
            cmd.brandId ?? null,
            cmd.outletId ?? null,
            cmd.availabilityStatus,
            cmd.orderChannel ?? null,
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
            'AMBIGUOUS_AVAILABILITY_RULE',
            'Overlapping AvailabilityRule at the same specificity/context',
          );
        }
        throw err;
      }
      await client.query('COMMIT');
      return { availabilityRuleId, duplicate: false as const };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async activatePriceRule(raw: unknown) {
    const cmd = activatePriceRuleSchema.parse(raw) as ActivatePriceRuleInput;
    assertScopeIds(cmd.scopeKind, cmd.brandId, cmd.outletId);
    // Validate Money shape (never naked number alone).
    createMoney(cmd.amountMinor, cmd.currencyCode, cmd.minorUnitExponent);

    const effectiveFrom = parseInstant(cmd.effectiveFrom);
    const effectiveTo = cmd.effectiveTo != null ? parseInstant(cmd.effectiveTo) : null;
    if (effectiveTo && !(effectiveTo.getTime() > effectiveFrom.getTime())) {
      throw new DomainValidationError('INVALID_SALES_CONTEXT', 'effectiveTo must be after effectiveFrom');
    }

    const semanticFingerprint = fingerprint({
      catalogItemId: cmd.catalogItemId,
      scopeKind: cmd.scopeKind,
      brandId: cmd.brandId ?? null,
      outletId: cmd.outletId ?? null,
      amountMinor: cmd.amountMinor,
      currencyCode: cmd.currencyCode,
      minorUnitExponent: cmd.minorUnitExponent,
      orderChannel: cmd.orderChannel ?? null,
      effectiveFrom: cmd.effectiveFrom,
      effectiveTo: cmd.effectiveTo ?? null,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await assertCatalogItemInTenant(client, cmd.tenantId, cmd.catalogItemId);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
        `price_rule:${cmd.tenantId}`,
      ]);

      const existing = await client.query<{
        price_rule_id: string;
        semantic_fingerprint: string;
      }>(
        `SELECT price_rule_id, semantic_fingerprint FROM price_rule
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [cmd.tenantId, cmd.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (row.semantic_fingerprint !== semanticFingerprint) {
          throw new IdempotencyConflictError(
            'PriceRule idempotency key already used with different semantics',
          );
        }
        await client.query('COMMIT');
        return { priceRuleId: row.price_rule_id, duplicate: true as const };
      }

      await assertNoChannelAwareRuleOverlap(
        client,
        'price_rule',
        {
          tenantId: cmd.tenantId,
          catalogItemId: cmd.catalogItemId,
          scopeKind: cmd.scopeKind,
          brandId: cmd.brandId ?? null,
          outletId: cmd.outletId ?? null,
          orderChannel: cmd.orderChannel ?? null,
          effectiveFrom,
          effectiveTo,
        },
        'AMBIGUOUS_PRICE_RULE',
      );

      const priceRuleId = randomUUID();
      try {
        await client.query(
          `INSERT INTO price_rule (
             price_rule_id, tenant_id, catalog_item_id, scope_kind,
             brand_id, outlet_id, amount_minor, currency_code, minor_unit_exponent,
             order_channel, effective_from, effective_to,
             idempotency_key, semantic_fingerprint, actor_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            priceRuleId,
            cmd.tenantId,
            cmd.catalogItemId,
            cmd.scopeKind,
            cmd.brandId ?? null,
            cmd.outletId ?? null,
            cmd.amountMinor,
            cmd.currencyCode,
            cmd.minorUnitExponent,
            cmd.orderChannel ?? null,
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
            'AMBIGUOUS_PRICE_RULE',
            'Overlapping PriceRule at the same specificity/context',
          );
        }
        throw err;
      }
      await client.query('COMMIT');
      return { priceRuleId, duplicate: false as const };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
