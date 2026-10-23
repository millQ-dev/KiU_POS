/**
 * P0 GoodsReceipt integrity: concurrent post/edit/reverse + HTTP actor attribution.
 * Uses local test DB (migrate + TRUNCATE). Not production/staging.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsReceiptService } from './goods-receipt-service.js';
import { PostedImmutableError } from './errors.js';
import {
  authInjectHeaders,
  TEST_ORIGIN,
  TEST_PIN,
} from '../../test/financial-auth-harness.js';
import { resolvePinPepper } from '../../config.js';
import {
  IdentityService,
  PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
  SESSION_COOKIE_NAME,
} from '../identity/index.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from '../../routes/identity.js';
import { registerGoodsReceiptRoutes } from '../../routes/goods-receipts.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: TEST_ORIGIN,
} as never);

let pool: pg.Pool;
let fx: BlockCFixture;
let service: GoodsReceiptService;
let identity: IdentityService;
let companyCode: string;
let authenticatedUserId: string;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      cash_shift,
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
      identity_network_throttle,
      identity_pin_credential, workforce_employee, identity_user, terminal,
      operational_fact_feed, audit_record,
      inventory_balance, inventory_movement,
      goods_receipt_line, goods_receipt,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

function milkLine(overrides: Partial<{ packageCount: number; unitPriceMinor: string }> = {}) {
  const packageCount = overrides.packageCount ?? 6;
  const unitPriceMinor = overrides.unitPriceMinor ?? '10000';
  return {
    lineNumber: 1,
    catalogItemId: fx.milkItemId,
    supplierItemId: fx.milkSupplierItemId,
    inputKind: 'FIXED_PACKAGE' as const,
    packageCount,
    acceptedBaseQuantity: String(packageCount),
    baseUnit: 'L',
    dimension: 'VOLUME' as const,
    unitPriceMinor,
    lineAcquisitionCostMinor: String(Number(unitPriceMinor) * packageCount),
  };
}

function draftBase(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: 'P0-1',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    businessDate: '2026-03-01',
    businessOrder: 1,
    actorId: fx.actorId,
    lines: [milkLine()],
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerCompanyIdentityRoutes(app, pool);
  await registerIdentityRoutes(app, pool, {
    pepper: PEPPER,
    cookieSecure: false,
    allowedOrigins: [TEST_ORIGIN],
    isProduction: false,
  });
  await registerGoodsReceiptRoutes(app, pool, {
    pepper: PEPPER,
    allowedOrigins: [TEST_ORIGIN],
    isProduction: false,
  });
  await app.ready();
  return app;
}

async function loginWithPin(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/identity/pin/authenticate',
    payload: { companyCode, pin: TEST_PIN, channel: 'TERMINAL' },
    headers: { origin: TEST_ORIGIN },
  });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) throw new Error('session cookie missing');
  return match[1];
}

describe('GoodsReceipt P0 integrity (PostgreSQL)', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    service = new GoodsReceiptService(pool);
    identity = new IdentityService(pool, PEPPER);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    companyCode = fx.tenantId.replace(/-/g, '').toUpperCase();
    const user = await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'P0 Actor',
      pin: TEST_PIN,
      grants: [
        {
          permissionKey: PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
          outletId: null,
          terminalId: null,
        },
      ],
    });
    authenticatedUserId = user.userId;
  });

  it('HTTP create/post/reverse ignore client actorId (principal wins)', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app);
    const spoof = randomUUID();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: authInjectHeaders(token),
      payload: {
        ...draftBase({ actorId: spoof, supplierDocumentNumber: 'HTTP-ACTOR' }),
        // tenantId may be omitted; route sets from principal
        tenantId: fx.tenantId,
      },
    });
    expect(create.statusCode).toBe(201);
    const doc = create.json() as { goodsReceiptId: string };
    const header = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM goods_receipt WHERE goods_receipt_id = $1`,
      [doc.goodsReceiptId],
    );
    expect(header.rows[0]?.actor_id).toBe(authenticatedUserId);
    expect(header.rows[0]?.actor_id).not.toBe(spoof);

    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${doc.goodsReceiptId}/post`,
      headers: authInjectHeaders(token),
      payload: { idempotencyKey: 'http-post-1', actorId: spoof },
    });
    expect(post.statusCode).toBe(200);
    const posted = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM goods_receipt WHERE goods_receipt_id = $1`,
      [doc.goodsReceiptId],
    );
    expect(posted.rows[0]?.actor_id).toBe(authenticatedUserId);

    const audit = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM audit_record
       WHERE aggregate_id = $1 AND action = 'GOODS_RECEIPT_POSTED'`,
      [doc.goodsReceiptId],
    );
    expect(audit.rows[0]?.actor_id).toBe(authenticatedUserId);

    const rev = await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${doc.goodsReceiptId}/reverse`,
      headers: authInjectHeaders(token),
      payload: { idempotencyKey: 'http-rev-1', actorId: spoof },
    });
    expect(rev.statusCode).toBe(200);
    const revDoc = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM goods_receipt WHERE reverses_goods_receipt_id = $1`,
      [doc.goodsReceiptId],
    );
    expect(revDoc.rows[0]?.actor_id).toBe(authenticatedUserId);
    await app.close();
  });

  it('concurrent reverse with different keys yields one OUT set', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'REV-RACE' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'rev-race-post', actorId: fx.actorId });

    const results = await Promise.allSettled([
      service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'rev-a', actorId: fx.actorId }),
      service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'rev-b', actorId: fx.actorId }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const created = fulfilled.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 'created',
    );
    expect(created.length).toBe(1);

    const outs = await pool.query(
      `SELECT movement_id FROM inventory_movement
       WHERE source_document_type = 'GoodsReceiptReversal'
         AND catalog_item_id = $1`,
      [fx.milkItemId],
    );
    expect(outs.rowCount).toBe(1);

    const reverses = await pool.query(
      `SELECT goods_receipt_id FROM goods_receipt WHERE reverses_goods_receipt_id = $1`,
      [draft!.goodsReceiptId],
    );
    expect(reverses.rowCount).toBe(1);
  });

  it('post after concurrent draft edit uses locked lines (no stale IN qty)', async () => {
    const draft = await service.createDraft(
      draftBase({ supplierDocumentNumber: 'POST-STALE', lines: [milkLine({ packageCount: 6 })] }),
    );
    const id = draft!.goodsReceiptId;

    // Barrier: start post and edit nearly together.
    const edit = service.updateDraft(id, {
      lines: [milkLine({ packageCount: 2 })],
      actorId: fx.actorId,
    });
    const post = service.post(id, { idempotencyKey: 'post-stale-1', actorId: fx.actorId });

    const settled = await Promise.allSettled([edit, post]);
    const postResult = settled[1];

    // One of: post wins then edit fails; or edit wins then post uses qty=2.
    if (postResult.status === 'rejected') {
      expect(postResult.reason).toBeInstanceOf(PostedImmutableError);
      const stillDraft = await service.get(id);
      expect(stillDraft?.status).toBe('DRAFT');
      expect(stillDraft?.lines[0]?.acceptedBaseQuantity).toBe('2');
    } else {
      expect(postResult.value.status === 'created' || postResult.value.status === 'duplicate').toBe(
        true,
      );
      const posted = await service.get(id);
      expect(posted?.status).toBe('POSTED');
      const qty = posted!.lines[0]!.acceptedBaseQuantity;
      const ins = await pool.query<{ quantity: string }>(
        `SELECT quantity FROM inventory_movement
         WHERE source_document_id = $1 AND direction = 'IN'`,
        [id],
      );
      expect(ins.rowCount).toBe(1);
      expect(ins.rows[0]?.quantity).toBe(qty);
      expect(qty === '6' || qty === '2').toBe(true);
    }
  });

  it('updateDraft after post does not rewrite lines', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'IMM' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'imm-post', actorId: fx.actorId });
    await expect(
      service.updateDraft(draft!.goodsReceiptId, {
        lines: [milkLine({ packageCount: 99 })],
        actorId: fx.actorId,
      }),
    ).rejects.toBeInstanceOf(PostedImmutableError);
    const doc = await service.get(draft!.goodsReceiptId);
    expect(doc?.lines[0]?.acceptedBaseQuantity).toBe('6');
  });
});
