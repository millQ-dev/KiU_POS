/**
 * ADR-0054 I-05 Organization adapter acceptance. Disposable millq_ci_pos_* only.
 * Read-only Organization → Imprint. No HTTP, no migration, no source-domain writes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { FactPath, ImprintClaimOrigin, ImprintFieldState } from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import type { AuthenticatedPrincipal } from '../identity/identity-service.js';
import { ImprintClaimService, ImprintInternalAuthority, ImprintScope } from './imprint-claim-service.js';
import { ImprintOrganizationAdapter } from './imprint-organization-adapter.js';
import { ImprintPersistence } from './imprint-persistence.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeImprint = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

function principal(tenantId: string): AuthenticatedPrincipal {
  return {
    sessionId: randomUUID(),
    tenantId,
    userId: randomUUID(),
    employeeId: null,
    displayName: 'imprint-i05',
    channel: 'TERMINAL',
  };
}

describeImprint('restaurant imprint organization adapter (disposable PG)', () => {
  let pool: pg.Pool;
  let adapter: ImprintOrganizationAdapter;
  let service: ImprintClaimService;
  let store: ImprintPersistence;
  let tenantId: string;
  let otherTenantId: string;
  let brandId: string;
  let legalId: string;
  let otherBrandId: string;
  let otherLegalId: string;
  let otherOutletId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    adapter = new ImprintOrganizationAdapter(pool);
    service = new ImprintClaimService(pool);
    store = new ImprintPersistence(pool);
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    brandId = randomUUID();
    legalId = randomUUID();
    otherBrandId = randomUUID();
    otherLegalId = randomUUID();
    otherOutletId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'A'), ($2, 'B')`, [
        tenantId,
        otherTenantId,
      ]);
      await client.query(
        `INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1, $2, 'LE A'), ($3, $4, 'LE B')`,
        [legalId, tenantId, otherLegalId, otherTenantId],
      );
      await client.query(
        `INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1, $2, 'Brand A'), ($3, $4, 'Brand B')`,
        [brandId, tenantId, otherBrandId, otherTenantId],
      );
      await client.query(
        `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
         VALUES ($1, $2, $3, $4, 'Foreign')`,
        [otherOutletId, otherTenantId, otherBrandId, otherLegalId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createOutlet(name: string): Promise<string> {
    const outletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1, $2, $3, $4, $5)`,
      [outletId, tenantId, brandId, legalId, name],
    );
    return outletId;
  }

  it('opens only a sealed internal authority for adapters', async () => {
    const outletId = await createOutlet('Scope Cafe');
    await expect(
      ImprintScope.openInternal(pool, { kind: 'ORGANIZATION_ADAPTER' } as never, tenantId, outletId),
    ).rejects.toMatchObject({ code: 'IMPRINT_SCOPE_DENIED' });
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forOrganizationAdapter(),
      tenantId,
      outletId,
    );
    expect(scope.authority).toBe('INTERNAL');
    await expect(
      ImprintScope.openInternal(
        pool,
        ImprintInternalAuthority.forOrganizationAdapter(),
        tenantId,
        otherOutletId,
      ),
    ).rejects.toMatchObject({ code: 'IMPRINT_SCOPE_DENIED' });
  });

  it('rejects supersede of an invalidated claim', async () => {
    const outletId = await createOutlet('Lifecycle');
    const scope = await ImprintScope.open(pool, principal(tenantId), outletId);
    const first = await service.appendAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: 'PUBLIC_REFERENCE',
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'life-1',
      },
      value: { outletId, name: 'Lifecycle' },
    });
    await service.invalidateAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      invalidatesClaimId: first.claimId,
      origin: ImprintClaimOrigin.Observed,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'life-off',
      },
    });
    await expect(
      service.supersedeAssertion(scope, {
        tenantId,
        outletId,
        factPath: FactPath.OutletIdentity,
        origin: ImprintClaimOrigin.Observed,
        sensitivityClass: 'PUBLIC_REFERENCE',
        provenance: {
          sourceModule: 'organization',
          sourceEntityType: 'Outlet',
          sourceEntityId: outletId,
          sourceRevision: 'life-2',
        },
        value: { outletId, name: 'Resurrected' },
        supersedesClaimId: first.claimId,
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_LIFECYCLE_REJECTED' });
    const current = await service.resolveField(scope, FactPath.OutletIdentity);
    expect(current.fieldState).toBe(ImprintFieldState.Unknown);
    expect(current.canonicalValue).toBeNull();
  });

  it('populates accepted Organization paths for a scoped outlet', async () => {
    const outletId = await createOutlet('Cafe One');
    const matched = randomUUID();
    const orphan = randomUUID();
    await pool.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name)
       VALUES ($1, $2, $3, $4, 'Matched'), ($5, $2, $3, NULL, 'Orphan')`,
      [matched, tenantId, legalId, outletId, orphan],
    );
    await pool.query(
      `INSERT INTO outlet_capability_config (tenant_id, outlet_id, capability_key, enabled)
       VALUES ($1, $2, 'guest_menu.qr', TRUE), ($1, $2, 'offline.sync', FALSE)`,
      [tenantId, outletId],
    );

    const first = await adapter.syncOutlet(tenantId, outletId);
    expect(first.degraded).toBe(false);
    expect(first.outcomes.some((row) => row.outcome === 'INSERTED')).toBe(true);

    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forOrganizationAdapter(),
      tenantId,
      outletId,
    );
    expect(await service.resolveField(scope, FactPath.OutletIdentity)).toMatchObject({
      fieldState: ImprintFieldState.Known,
      sourceAuthoritative: true,
    });
    expect((await service.resolveField(scope, FactPath.OutletIdentity)).canonicalValue).toContain(
      'Cafe One',
    );
    expect(await service.resolveField(scope, FactPath.OutletBrandRef)).toMatchObject({
      fieldState: ImprintFieldState.Known,
    });
    expect(
      (await service.resolveField(scope, FactPath.OutletBrandRef)).canonicalValue,
    ).toContain(brandId);
    expect(
      (await service.resolveField(scope, FactPath.OutletLegalEntityRef)).canonicalValue,
    ).toContain(legalId);
    expect(
      (await service.resolveField(scope, FactPath.OutletCapabilities)).canonicalValue,
    ).toContain('guest_menu.qr');
    expect(
      (await service.resolveField(scope, FactPath.OutletCapabilities)).canonicalValue,
    ).not.toContain('offline.sync');
    const warehouses = await service.resolveField(scope, FactPath.WarehouseRefs);
    expect(warehouses.canonicalValue).toContain(matched);
    expect(warehouses.canonicalValue).not.toContain(orphan);
    expect(await service.resolveField(scope, FactPath.ActiveTerminalRefs)).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
      value: null,
    });
    expect(await store.countClaims(otherTenantId, otherOutletId)).toBe(0);
  });

  it('repeats deterministically and can revert to an earlier source value', async () => {
    const outletId = await createOutlet('Before');
    const first = await adapter.syncOutlet(tenantId, outletId);
    const second = await adapter.syncOutlet(tenantId, outletId);
    expect(second.outcomes).toEqual([]);
    expect(await store.readCursor(tenantId, outletId, 'organization', 'organization_outlet')).toBe(
      first.watermark,
    );

    await pool.query(`UPDATE outlet SET name = 'After' WHERE outlet_id = $1 AND tenant_id = $2`, [
      outletId,
      tenantId,
    ]);
    const third = await adapter.syncOutlet(tenantId, outletId);
    expect(third.outcomes.some((row) => row.outcome === 'INSERTED')).toBe(true);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forOrganizationAdapter(),
      tenantId,
      outletId,
    );
    expect((await service.resolveField(scope, FactPath.OutletIdentity)).canonicalValue).toContain(
      'After',
    );

    await pool.query(`UPDATE outlet SET name = 'Before' WHERE outlet_id = $1 AND tenant_id = $2`, [
      outletId,
      tenantId,
    ]);
    const fourth = await adapter.syncOutlet(tenantId, outletId);
    expect(fourth.outcomes.some((row) => row.outcome === 'INSERTED')).toBe(true);
    const reverted = await service.resolveField(scope, FactPath.OutletIdentity);
    expect(reverted.canonicalValue).toContain('Before');
    expect(reverted.canonicalValue).not.toContain('After');
    expect(await store.countClaims(tenantId, outletId)).toBeGreaterThan(2);
  });

  it('restores an identity after invalidation without colliding with genesis', async () => {
    const outletId = await createOutlet('Restore');
    await adapter.syncOutlet(tenantId, outletId);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forOrganizationAdapter(),
      tenantId,
      outletId,
    );
    const live = await service.resolveField(scope, FactPath.OutletIdentity);
    expect(live.claimId).toBeTruthy();
    await service.invalidateAssertion(scope, {
      tenantId,
      outletId,
      factPath: FactPath.OutletIdentity,
      invalidatesClaimId: live.claimId!,
      origin: ImprintClaimOrigin.Observed,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: outletId,
        sourceRevision: 'restore-off',
      },
    });
    expect((await service.resolveField(scope, FactPath.OutletIdentity)).fieldState).toBe(
      ImprintFieldState.Unknown,
    );
    const restored = await adapter.syncOutlet(tenantId, outletId);
    expect(restored.outcomes.some((row) => row.outcome === 'INSERTED')).toBe(true);
    expect((await service.resolveField(scope, FactPath.OutletIdentity)).canonicalValue).toContain(
      'Restore',
    );
  });

  it('denies another tenant and does not invent a truncated oversize name', async () => {
    const outletId = await createOutlet('Short');
    await expect(adapter.syncOutlet(otherTenantId, outletId)).rejects.toMatchObject({
      code: 'IMPRINT_SCOPE_DENIED',
    });
    expect(await store.countClaims(otherTenantId, otherOutletId)).toBe(0);

    await adapter.syncOutlet(tenantId, outletId);
    await pool.query(`UPDATE outlet SET name = $3 WHERE outlet_id = $1 AND tenant_id = $2`, [
      outletId,
      tenantId,
      'x'.repeat(81),
    ]);
    const result = await adapter.syncOutlet(tenantId, outletId);
    expect(result.degraded).toBe(true);
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forOrganizationAdapter(),
      tenantId,
      outletId,
    );
    const identity = await service.resolveField(scope, FactPath.OutletIdentity);
    expect(identity.canonicalValue).toContain('Short');
    expect(identity.canonicalValue).not.toContain('xxx');
  });

  it('rolls back a rejected organization checkpoint without advancing the cursor', async () => {
    const outletId = await createOutlet('Rollback');
    await adapter.syncOutlet(tenantId, outletId);
    const before = await store.readCursor(tenantId, outletId, 'organization', 'organization_outlet');
    const scope = await ImprintScope.openInternal(
      pool,
      ImprintInternalAuthority.forOrganizationAdapter(),
      tenantId,
      outletId,
    );
    await expect(
      service.commitCheckpoint(scope, {
        sourceModule: 'organization',
        cursorName: 'organization_outlet',
        watermark: 'wm-bad',
        assertions: [
          {
            tenantId,
            outletId,
            factPath: FactPath.OutletIdentity,
            origin: ImprintClaimOrigin.Observed,
            sensitivityClass: 'PUBLIC_REFERENCE',
            provenance: {
              sourceModule: 'organization',
              sourceEntityType: 'Outlet',
              sourceEntityId: outletId,
              sourceRevision: 'bad-1',
            },
            value: { outletId, name: 'Rollback Next' },
            supersedesClaimId: randomUUID(),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_LIFECYCLE_REJECTED' });
    expect(await store.readCursor(tenantId, outletId, 'organization', 'organization_outlet')).toBe(
      before,
    );
  });
});
