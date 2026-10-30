/**
 * ADR-0054 I-04 claim service acceptance. Disposable millq_ci_pos_* PostgreSQL only.
 * Contract validation runs before I-02 persistence. No HTTP route and no migration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { FactPath, ImprintClaimOrigin, ImprintFieldState, ImprintSensitivity } from '@millq/contracts';
import { runMigrations } from '../../db/migrate.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import type { AuthenticatedPrincipal } from '../identity/identity-service.js';
import { ImprintClaimService, ImprintScope } from './imprint-claim-service.js';
import { ImprintServiceError } from './errors.js';
import { ImprintPersistence } from './imprint-persistence.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeImprint = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

function principal(tenantId: string): AuthenticatedPrincipal {
  return {
    sessionId: randomUUID(),
    tenantId,
    userId: randomUUID(),
    employeeId: null,
    displayName: 'imprint-service',
    channel: 'TERMINAL',
  };
}

describeImprint('restaurant imprint claim service (disposable PG)', () => {
  let pool: pg.Pool;
  let service: ImprintClaimService;
  let store: ImprintPersistence;
  let tenantId: string;
  let otherTenantId: string;
  let otherOutletId: string;
  let brandA: string;
  let legalA: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    service = new ImprintClaimService(pool);
    store = new ImprintPersistence(pool);
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    otherOutletId = randomUUID();
    legalA = randomUUID();
    brandA = randomUUID();
    const legalB = randomUUID();
    const brandB = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'Imprint A'), ($2, 'Imprint B')`, [
        tenantId,
        otherTenantId,
      ]);
      await client.query(
        `INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1, $2, 'LE A'), ($3, $4, 'LE B')`,
        [legalA, tenantId, legalB, otherTenantId],
      );
      await client.query(
        `INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1, $2, 'Brand A'), ($3, $4, 'Brand B')`,
        [brandA, tenantId, brandB, otherTenantId],
      );
      await client.query(
        `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
         VALUES ($1, $2, $3, $4, 'Outlet B')`,
        [otherOutletId, otherTenantId, brandB, legalB],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function freshScope(): Promise<ImprintScope> {
    const outletId = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1, $2, $3, $4, 'Outlet')`,
      [outletId, tenantId, brandA, legalA],
    );
    return ImprintScope.open(pool, principal(tenantId), outletId);
  }

  function identity(
    local: ImprintScope,
    name: string,
    sourceRevision: string,
    extras: Record<string, unknown> = {},
  ) {
    return {
      tenantId: local.tenantId,
      outletId: local.outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: ImprintSensitivity.PublicReference,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: local.outletId,
        sourceRevision,
        observedAt: '2020-01-01T00:00:00.000Z',
      },
      value: { outletId: local.outletId, name },
      businessDate: '2020-01-01',
      ...extras,
    };
  }

  it('stores a typed claim and drops caller-supplied business time', async () => {
    const local = await freshScope();
    const inserted = await service.appendAssertion(local, identity(local, 'Cafe', 'svc-1'));
    expect(inserted.outcome).toBe('INSERTED');
    const row = await pool.query<{ observed_at: Date | null; business_date: Date | null }>(
      `SELECT observed_at, business_date FROM imprint_claim WHERE claim_id = $1`,
      [inserted.claimId],
    );
    expect(row.rows[0]?.observed_at).toBeNull();
    expect(row.rows[0]?.business_date).toBeNull();
    const current = await service.resolveField(local, FactPath.OutletIdentity);
    expect(current.fieldState).toBe(ImprintFieldState.Known);
    expect(current.canonicalValue).toContain('Cafe');
    expect(current.resolverVersion).toBe('imprint-snapshot-1');
  });

  it('blocks an unknown path before persistence', async () => {
    const local = await freshScope();
    await expect(
      service.appendAssertion(
        local,
        identity(local, 'Nope', 'svc-unknown', { factPath: 'menu.item.price' }),
      ),
    ).rejects.toMatchObject({ code: 'IMPRINT_PATH_UNREGISTERED' });
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(0);
  });

  it('blocks an invalid value, missing provenance, and a sensitivity mismatch', async () => {
    const local = await freshScope();
    await expect(service.appendAssertion(local, identity(local, '', 'svc-bad-value'))).rejects.toBeInstanceOf(
      ImprintServiceError,
    );
    const missing = identity(local, 'Cafe', 'svc-missing');
    delete (missing.provenance as { sourceRevision?: string }).sourceRevision;
    await expect(service.appendAssertion(local, missing)).rejects.toMatchObject({
      code: 'IMPRINT_PROVENANCE_REJECTED',
    });
    await expect(
      service.appendAssertion(
        local,
        identity(local, 'Cafe', 'svc-sensitive', {
          sensitivityClass: ImprintSensitivity.InternalReference,
        }),
      ),
    ).rejects.toMatchObject({ code: 'IMPRINT_SENSITIVITY_REJECTED' });
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(0);
  });

  it('denies another tenant outlet and a payload tenant that disagrees with the principal', async () => {
    const local = await freshScope();
    await expect(ImprintScope.open(pool, principal(tenantId), otherOutletId)).rejects.toMatchObject({
      code: 'IMPRINT_SCOPE_DENIED',
    });
    await expect(
      service.appendAssertion(
        local,
        identity(local, 'Cafe', 'svc-foreign', { tenantId: otherTenantId }),
      ),
    ).rejects.toMatchObject({ code: 'IMPRINT_SCOPE_DENIED' });
    expect(await store.countClaims(otherTenantId, otherOutletId)).toBe(0);
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(0);
  });

  it('treats a repeated claim as a duplicate', async () => {
    const local = await freshScope();
    const first = await service.appendAssertion(local, identity(local, 'Cafe', 'svc-dup'));
    const second = await service.appendAssertion(local, identity(local, 'Cafe', 'svc-dup'));
    expect(second).toEqual({ outcome: 'DUPLICATE', claimId: first.claimId });
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(1);
  });

  it('quarantines a conflicting payload for the same source identity', async () => {
    const local = await freshScope();
    await service.appendAssertion(local, identity(local, 'Cafe', 'svc-conflict'));
    const conflict = await service.appendAssertion(local, identity(local, 'Other', 'svc-conflict'));
    expect(conflict.outcome).toBe('CONFLICT');
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(1);
    expect(await store.countConflicts(local.tenantId, local.outletId)).toBe(1);
  });

  it('keeps history when a claim is superseded and drops it from the current resolution', async () => {
    const local = await freshScope();
    const original = await service.appendAssertion(local, identity(local, 'Cafe', 'svc-lineage'));
    const other = await ImprintScope.open(pool, principal(otherTenantId), otherOutletId);
    await expect(
      service.supersedeAssertion(other, {
        tenantId: otherTenantId,
        outletId: otherOutletId,
        factPath: FactPath.OutletIdentity,
        origin: ImprintClaimOrigin.Observed,
        sensitivityClass: ImprintSensitivity.PublicReference,
        provenance: {
          sourceModule: 'organization',
          sourceEntityType: 'Outlet',
          sourceEntityId: otherOutletId,
          sourceRevision: 'svc-cross',
        },
        value: { outletId: otherOutletId, name: 'Stolen' },
        supersedesClaimId: original.claimId,
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_LIFECYCLE_REJECTED' });
    expect(await store.countClaims(otherTenantId, otherOutletId)).toBe(0);
    const next = await service.supersedeAssertion(
      local,
      identity(local, 'Cafe Next', 'svc-lineage-2', { supersedesClaimId: original.claimId }),
    );
    expect(next.outcome).toBe('INSERTED');
    const historical = await service.readClaim(local, original.claimId);
    expect(historical?.active).toBe(false);
    expect(historical?.canonicalValue).toContain('"name":"Cafe"');
    const current = await service.resolveField(local, FactPath.OutletIdentity);
    expect(current.claimId).toBe(next.claimId);
    expect(current.canonicalValue).toContain('Cafe Next');
    expect(await service.readClaim(other, original.claimId)).toBeNull();
  });

  it('excludes an invalidated claim from the current resolution', async () => {
    const local = await freshScope();
    const claim = await service.appendAssertion(local, identity(local, 'Alone', 'svc-invalidate'));
    await expect(
      service.invalidateAssertion(local, {
        tenantId: local.tenantId,
        outletId: local.outletId,
        factPath: FactPath.OutletBrandRef,
        invalidatesClaimId: claim.claimId,
        origin: ImprintClaimOrigin.Observed,
        sensitivityClass: ImprintSensitivity.PublicReference,
        provenance: {
          sourceModule: 'organization',
          sourceEntityType: 'Brand',
          sourceEntityId: brandA,
          sourceRevision: 'svc-wrong-path',
        },
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_LIFECYCLE_REJECTED' });
    expect((await service.readClaim(local, claim.claimId))?.active).toBe(true);
    await service.invalidateAssertion(local, {
      tenantId: local.tenantId,
      outletId: local.outletId,
      factPath: FactPath.OutletIdentity,
      invalidatesClaimId: claim.claimId,
      origin: ImprintClaimOrigin.Observed,
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: local.outletId,
        sourceRevision: 'svc-invalidate-off',
      },
    });
    expect((await service.readClaim(local, claim.claimId))?.active).toBe(false);
    const current = await service.resolveField(local, FactPath.OutletIdentity);
    expect(current).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
      claimId: null,
      canonicalValue: null,
    });
  });

  it('rolls back a checkpoint when a later claim is rejected', async () => {
    const local = await freshScope();
    await expect(
      service.commitCheckpoint(local, {
        sourceModule: 'organization',
        cursorName: 'outletidentity',
        watermark: 'wm-fail',
        assertions: [
          identity(local, 'Batch', 'svc-batch'),
          identity(local, 'Batch Next', 'svc-batch-2', { supersedesClaimId: randomUUID() }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_LIFECYCLE_REJECTED' });
    expect(
      await store.readCursor(local.tenantId, local.outletId, 'organization', 'outletidentity'),
    ).toBeNull();
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(0);
  });

  it('keeps one claim when two conflicting writes race', async () => {
    const local = await freshScope();
    const [left, right] = await Promise.all([
      service.appendAssertion(local, identity(local, 'Race A', 'svc-race')),
      service.appendAssertion(local, identity(local, 'Race B', 'svc-race')),
    ]);
    expect([left.outcome, right.outcome].sort()).toEqual(['CONFLICT', 'INSERTED']);
    const rows = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM imprint_claim
       WHERE tenant_id = $1 AND outlet_id = $2 AND source_revision = 'svc-race' AND claim_effect = 'ASSERTION'`,
      [local.tenantId, local.outletId],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('does not let a declared claim override an observed claim', async () => {
    const local = await freshScope();
    await service.appendAssertion(
      local,
      identity(local, 'Draft name', 'svc-declared', { origin: ImprintClaimOrigin.Declared }),
    );
    await service.appendAssertion(local, identity(local, 'Cafe Observed', 'svc-observed'));
    const current = await service.resolveField(local, FactPath.OutletIdentity);
    expect(current.origin).toBe(ImprintClaimOrigin.Observed);
    expect(current.sourceAuthoritative).toBe(true);
    expect(current.canonicalValue).toContain('Cafe Observed');
  });

  it('leaves active terminal refs unknown', async () => {
    const local = await freshScope();
    await expect(
      service.appendAssertion(local, {
        tenantId: local.tenantId,
        outletId: local.outletId,
        factPath: FactPath.ActiveTerminalRefs,
        origin: ImprintClaimOrigin.Observed,
        sensitivityClass: ImprintSensitivity.InternalReference,
        provenance: {
          sourceModule: 'organization',
          sourceEntityType: 'Terminal',
          sourceEntityId: local.outletId,
          sourceRevision: 'svc-terminal',
        },
        value: { terminalIds: [local.outletId] },
      }),
    ).rejects.toMatchObject({ code: 'IMPRINT_PATH_UNAVAILABLE' });
    expect(await store.countClaims(local.tenantId, local.outletId)).toBe(0);
    const current = await service.resolveField(local, FactPath.ActiveTerminalRefs);
    expect(current).toMatchObject({
      fieldState: ImprintFieldState.Unknown,
      value: null,
      canonicalValue: null,
      claimId: null,
    });
  });

  it('advances a checkpoint once for the same claims', async () => {
    const local = await freshScope();
    const body = {
      sourceModule: 'organization',
      cursorName: 'outletidentityok',
      watermark: 'wm-ok',
      assertions: [identity(local, 'Checkpoint', 'svc-cursor')],
    };
    const first = await service.commitCheckpoint(local, body);
    const second = await service.commitCheckpoint(local, body);
    expect(first.outcomes[0]?.outcome).toBe('INSERTED');
    expect(second.outcomes[0]?.outcome).toBe('DUPLICATE');
    expect(
      await store.readCursor(local.tenantId, local.outletId, 'organization', 'outletidentityok'),
    ).toBe('wm-ok');
  });
});
