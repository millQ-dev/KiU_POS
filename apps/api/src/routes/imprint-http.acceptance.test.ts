/**
 * ADR-0054 I-07 Imprint HTTP read acceptance. Disposable millq_ci_pos_* only.
 * Negative authz: cross-tenant, ungranted, NULL-outlet grant, revoked/expired,
 * invalid session, provenance without grant, pos.operate non-implication.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { FactPath, ImprintClaimOrigin, ImprintFieldState } from '@millq/contracts';
import { runMigrations } from '../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { isPosDisposableDatabaseUrl } from '../test/disposable-database-url.js';
import {
  authInjectHeaders,
  loginPosSession,
  TEST_ORIGIN,
  TEST_PIN,
} from '../test/financial-auth-harness.js';
import { resolvePinPepper } from '../config.js';
import {
  IdentityService,
  PERMISSION_IMPRINT_PROVENANCE_READ,
  PERMISSION_IMPRINT_READ,
  PERMISSION_POS_OPERATE,
  SESSION_COOKIE_NAME,
} from '../modules/identity/index.js';
import { ImprintClaimService, ImprintScope } from '../modules/restaurant-imprint/imprint-claim-service.js';
import { registerIdentityRoutes } from './identity.js';
import { registerImprintRoutes } from './imprint.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeImprintHttp = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL: DATABASE_URL || 'postgresql://x/millq_ci_pos_x',
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

describeImprintHttp('restaurant imprint HTTP read (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let fxB: BlockCFixture;
  let identity: IdentityService;
  let claims: ImprintClaimService;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    identity = new IdentityService(pool, PEPPER);
    claims = new ImprintClaimService(pool);
    app = Fastify({ logger: false });
    await app.register(cookie);
    await registerIdentityRoutes(app, pool, {
      pepper: PEPPER,
      cookieSecure: false,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await registerImprintRoutes(app, pool, {
      pepper: PEPPER,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE
        imprint_projection_error, imprint_snapshot_field, imprint_snapshot_head,
        imprint_projection_revision, imprint_claim_conflict, imprint_ingest_cursor, imprint_claim,
        identity_notification_outbox, identity_audit_event,
        identity_approval_request, identity_login_challenge,
        identity_session, identity_access_grant, identity_auth_throttle,
        identity_network_throttle,
        identity_pin_credential, workforce_employee, identity_user, terminal,
        warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
    fxB = await seedBlockCFixture(pool);
  });

  async function provisionImprintReader(opts: {
    fixture?: BlockCFixture;
    /** Grant outlet_id; pass null for tenant-wide (must be denied by I-07). */
    outletId?: string | null;
    provenance?: boolean;
    pin?: string;
    terminalId?: string | null;
  }): Promise<{ userId: string }> {
    const fixture = opts.fixture ?? fx;
    const imprintOutlet = 'outletId' in opts ? (opts.outletId ?? null) : fixture.outletId;
    const grants: Array<{
      permissionKey: string;
      outletId?: string | null;
      terminalId?: string | null;
    }> = [
      {
        permissionKey: PERMISSION_IMPRINT_READ,
        outletId: imprintOutlet,
        terminalId: opts.terminalId ?? null,
      },
    ];
    if (opts.provenance) {
      grants.push({
        permissionKey: PERMISSION_IMPRINT_PROVENANCE_READ,
        outletId: imprintOutlet,
        terminalId: opts.terminalId ?? null,
      });
    }
    return identity.provisionUserWithPin({
      tenantId: fixture.tenantId,
      displayName: 'Imprint Reader',
      pin: opts.pin ?? TEST_PIN,
      grants,
    });
  }

  async function seedIdentityClaim(fixture: BlockCFixture = fx): Promise<string> {
    const principal = {
      sessionId: randomUUID(),
      tenantId: fixture.tenantId,
      userId: randomUUID(),
      employeeId: null,
      displayName: 'seed',
      channel: 'TERMINAL' as const,
    };
    const scope = await ImprintScope.open(pool, principal, fixture.outletId);
    const result = await claims.appendAssertion(scope, {
      tenantId: fixture.tenantId,
      outletId: fixture.outletId,
      factPath: FactPath.OutletIdentity,
      origin: ImprintClaimOrigin.Observed,
      sensitivityClass: 'PUBLIC_REFERENCE',
      provenance: {
        sourceModule: 'organization',
        sourceEntityType: 'Outlet',
        sourceEntityId: fixture.outletId,
        sourceRevision: `http-seed-${fixture.outletId}`,
      },
      value: { outletId: fixture.outletId, name: 'Seed Cafe' },
    });
    return result.claimId;
  }

  it('returns typed summary for an outlet-scoped imprint.read grant', async () => {
    await seedIdentityClaim();
    await provisionImprintReader({ outletId: fx.outletId });
    const token = await loginPosSession(app, pool, fx);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tenantId: string;
      outletId: string;
      resolverVersion: string;
      includeProvenance: boolean;
      fields: Array<{ factPath: string; fieldState: string; provenance: unknown; value: unknown }>;
    };
    expect(body.tenantId).toBe(fx.tenantId);
    expect(body.outletId).toBe(fx.outletId);
    expect(body.resolverVersion).toBe('imprint-snapshot-1');
    expect(body.includeProvenance).toBe(false);
    const identity = body.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(identity?.fieldState).toBe(ImprintFieldState.Known);
    expect(identity?.provenance).toBeNull();
    expect(JSON.stringify(identity?.value)).toContain('Seed Cafe');
    const terminals = body.fields.find((f) => f.factPath === FactPath.ActiveTerminalRefs);
    expect(terminals?.fieldState).toBe(ImprintFieldState.Unknown);
  });

  it('denies cross-tenant outlet, ungranted outlet, and pos.operate without imprint.read', async () => {
    await provisionImprintReader({ outletId: fx.outletId });
    const tokenA = await loginPosSession(app, pool, fx);
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fxB.outletId}/imprint`,
      headers: authInjectHeaders(tokenA),
    });
    expect(cross.statusCode).toBe(403);

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'POS only',
      pin: '654321',
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });
    const posToken = await loginPosSession(app, pool, fx, '654321');
    const posOnly = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(posToken),
    });
    expect(posOnly.statusCode).toBe(403);

    const sister = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Sister')`,
      [sister, fx.tenantId, fx.brandId, fx.legalEntityId],
    );
    const ungranted = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${sister}/imprint`,
      headers: authInjectHeaders(tokenA),
    });
    expect(ungranted.statusCode).toBe(403);
  });

  it('rejects tenant-wide NULL-outlet imprint grants for I-07', async () => {
    await provisionImprintReader({ outletId: null });
    const token = await loginPosSession(app, pool, fx);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects revoked and expired imprint grants and invalid sessions', async () => {
    const user = await provisionImprintReader({ outletId: fx.outletId });
    await pool.query(
      `UPDATE identity_access_grant SET revoked_at = NOW()
       WHERE tenant_id = $1 AND user_id = $2 AND permission_key = $3`,
      [fx.tenantId, user.userId, PERMISSION_IMPRINT_READ],
    );
    const token = await loginPosSession(app, pool, fx);
    const revoked = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(revoked.statusCode).toBe(403);

    await pool.query(
      `UPDATE identity_access_grant SET revoked_at = NULL, expires_at = NOW() - INTERVAL '1 minute'
       WHERE tenant_id = $1 AND user_id = $2 AND permission_key = $3`,
      [fx.tenantId, user.userId, PERMISSION_IMPRINT_READ],
    );
    const expired = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(expired.statusCode).toBe(403);

    await pool.query(
      `UPDATE identity_session SET revoked_at = NOW() WHERE token_hash IS NOT NULL`,
    );
    const badSession = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(badSession.statusCode).toBe(401);

    const noCookie = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: { origin: TEST_ORIGIN },
    });
    expect(noCookie.statusCode).toBe(401);
  });

  it('denies provenance without imprint.provenance.read and redacts by default', async () => {
    await seedIdentityClaim();
    await provisionImprintReader({ outletId: fx.outletId, provenance: false });
    const token = await loginPosSession(app, pool, fx);
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint?includeProvenance=true`,
      headers: authInjectHeaders(token),
    });
    expect(denied.statusCode).toBe(403);

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'With provenance',
      pin: '111222',
      grants: [
        { permissionKey: PERMISSION_IMPRINT_READ, outletId: fx.outletId },
        { permissionKey: PERMISSION_IMPRINT_PROVENANCE_READ, outletId: fx.outletId },
      ],
    });
    const token2 = await loginPosSession(app, pool, fx, '111222');
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint?includeProvenance=true`,
      headers: authInjectHeaders(token2),
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as {
      includeProvenance: boolean;
      fields: Array<{ factPath: string; provenance: { sourceModule: string } | null }>;
    };
    expect(body.includeProvenance).toBe(true);
    const identityField = body.fields.find((f) => f.factPath === FactPath.OutletIdentity);
    expect(identityField?.provenance?.sourceModule).toBe('organization');
    expect(JSON.stringify(body)).not.toContain('password');
    expect(JSON.stringify(body)).not.toContain(SESSION_COOKIE_NAME);
  });

  it('rejects malformed outletId and tenantId injection', async () => {
    await provisionImprintReader({ outletId: fx.outletId });
    const token = await loginPosSession(app, pool, fx);
    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/not-a-uuid/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(bad.statusCode).toBe(400);

    const injected = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint?tenantId=${fxB.tenantId}`,
      headers: authInjectHeaders(token),
    });
    expect(injected.statusCode).toBe(403);
  });

  it('does not treat a terminal-scoped grant as a broader outlet permission', async () => {
    const terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'t1','T1')`,
      [terminalId, fx.tenantId, fx.outletId],
    );
    await provisionImprintReader({ outletId: fx.outletId, terminalId });
    const token = await loginPosSession(app, pool, fx);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/outlets/${fx.outletId}/imprint`,
      headers: authInjectHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });
});
