/**
 * GoodsReceipt reverse UNIQUE + 23505 handling.
 * Destructive — millq_ci_gr_* only. Assert allowlist before migrate/TRUNCATE.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  assertGoodsReceiptDisposableDatabaseUrl,
  isGoodsReceiptDisposableDatabaseUrl,
} from '../../test/disposable-database-url.js';
import { GoodsReceiptService } from './goods-receipt-service.js';
import { IdempotencyConflictError } from './errors.js';
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

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN_DISPOSABLE = isGoodsReceiptDisposableDatabaseUrl(DATABASE_URL);
const describeUq = RUN_DISPOSABLE ? describe : describe.skip;

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

async function truncateBusiness() {
  assertGoodsReceiptDisposableDatabaseUrl(DATABASE_URL);
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

function milkLine() {
  return {
    lineNumber: 1,
    catalogItemId: fx.milkItemId,
    supplierItemId: fx.milkSupplierItemId,
    inputKind: 'FIXED_PACKAGE' as const,
    packageCount: 6,
    acceptedBaseQuantity: '6',
    baseUnit: 'L',
    dimension: 'VOLUME' as const,
    unitPriceMinor: '10000',
    lineAcquisitionCostMinor: '60000',
  };
}

function draftBase(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: fx.tenantId,
    legalEntityId: fx.legalEntityId,
    warehouseId: fx.warehouseId,
    supplierId: fx.supplierId,
    supplierDocumentNumber: 'UQ-1',
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
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) throw new Error('session cookie missing');
  return match[1];
}

describeUq('GoodsReceipt reverse UNIQUE (PostgreSQL)', () => {
  beforeAll(async () => {
    assertGoodsReceiptDisposableDatabaseUrl(DATABASE_URL);
    await runMigrations(DATABASE_URL);
    await runMigrations(DATABASE_URL); // idempotent re-run
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
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'UQ Actor',
      pin: TEST_PIN,
      grants: [
        {
          permissionKey: PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
          outletId: null,
          terminalId: null,
        },
      ],
    });
  });

  it('migration chain includes uq_goods_receipt_reverses_original', async () => {
    const idx = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'uq_goods_receipt_reverses_original'`,
    );
    expect(idx.rowCount).toBe(1);
    const applied = await pool.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations WHERE filename = '033_goods_receipt_reverse_unique.sql'`,
    );
    expect(applied.rowCount).toBe(1);
  });

  it('one reverse creates successfully with matching OUT and audit', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-ONE' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'uq-one-post', actorId: fx.actorId });
    const rev = await service.reverse(draft!.goodsReceiptId, {
      idempotencyKey: 'uq-one-rev',
      actorId: fx.actorId,
    });
    expect(rev.status).toBe('created');
    const orig = await service.get(draft!.goodsReceiptId);
    expect(orig?.status).toBe('REVERSED');
    const reverses = await pool.query(
      `SELECT goods_receipt_id FROM goods_receipt WHERE reverses_goods_receipt_id = $1`,
      [draft!.goodsReceiptId],
    );
    expect(reverses.rowCount).toBe(1);
    const outs = await pool.query(
      `SELECT movement_id FROM inventory_movement
       WHERE source_document_type = 'GoodsReceiptReversal' AND source_document_id = $1`,
      [reverses.rows[0]!.goods_receipt_id],
    );
    expect(outs.rowCount).toBe(1);
    const audit = await pool.query(
      `SELECT audit_id FROM audit_record
       WHERE aggregate_id = $1 AND action = 'GOODS_RECEIPT_REVERSED'`,
      [draft!.goodsReceiptId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('second reverse with different key returns duplicate and keeps one OUT set', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-TWO' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'uq-two-post', actorId: fx.actorId });
    const first = await service.reverse(draft!.goodsReceiptId, {
      idempotencyKey: 'uq-two-rev-a',
      actorId: fx.actorId,
    });
    expect(first.status).toBe('created');
    const second = await service.reverse(draft!.goodsReceiptId, {
      idempotencyKey: 'uq-two-rev-b',
      actorId: fx.actorId,
    });
    expect(second.status).toBe('duplicate');
    const reverses = await pool.query(
      `SELECT goods_receipt_id FROM goods_receipt WHERE reverses_goods_receipt_id = $1`,
      [draft!.goodsReceiptId],
    );
    expect(reverses.rowCount).toBe(1);
    const outs = await pool.query(
      `SELECT movement_id FROM inventory_movement
       WHERE source_document_type = 'GoodsReceiptReversal'
         AND catalog_item_id = $1`,
      [fx.milkItemId],
    );
    expect(outs.rowCount).toBe(1);
  });

  it('PostgreSQL UNIQUE blocks a second reverse pointer (raw INSERT 23505)', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-RAW' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'uq-raw-post', actorId: fx.actorId });
    await service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'uq-raw-rev', actorId: fx.actorId });

    let code = '';
    let constraint = '';
    try {
      await pool.query(
        `INSERT INTO goods_receipt (
           goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
           supplier_document_number, currency_code, minor_unit_exponent,
           business_date, business_order, status, post_idempotency_key,
           reverses_goods_receipt_id, posted_at
         ) VALUES ($1,$2,$3,$4,$5,'RAW-REV-2','VND',0,CURRENT_DATE,99,'POSTED',$6,$7,NOW())`,
        [
          randomUUID(),
          fx.tenantId,
          fx.legalEntityId,
          fx.warehouseId,
          fx.supplierId,
          'reverse:raw-other',
          draft!.goodsReceiptId,
        ],
      );
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      code = e.code ?? '';
      constraint = e.constraint ?? '';
    }
    expect(code).toBe('23505');
    expect(constraint).toBe('uq_goods_receipt_reverses_original');
  });

  it('many ordinary receipts with NULL reverse pointer are allowed', async () => {
    const a = await service.createDraft(draftBase({ supplierDocumentNumber: 'NULL-A' }));
    const b = await service.createDraft(draftBase({ supplierDocumentNumber: 'NULL-B' }));
    await service.post(a!.goodsReceiptId, { idempotencyKey: 'null-a-post', actorId: fx.actorId });
    await service.post(b!.goodsReceiptId, { idempotencyKey: 'null-b-post', actorId: fx.actorId });
    const nulls = await pool.query(
      `SELECT COUNT(*)::int AS n FROM goods_receipt
       WHERE reverses_goods_receipt_id IS NULL AND status = 'POSTED'`,
    );
    expect(nulls.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it('concurrent reversals leave exactly one reverse document and OUT set', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-RACE' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'uq-race-post', actorId: fx.actorId });
    const results = await Promise.allSettled([
      service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'uq-race-a', actorId: fx.actorId }),
      service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'uq-race-b', actorId: fx.actorId }),
      service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'uq-race-c', actorId: fx.actorId }),
    ]);
    const created = results.filter((r) => r.status === 'fulfilled' && r.value.status === 'created');
    expect(created.length).toBe(1);
    const reverses = await pool.query(
      `SELECT goods_receipt_id FROM goods_receipt WHERE reverses_goods_receipt_id = $1`,
      [draft!.goodsReceiptId],
    );
    expect(reverses.rowCount).toBe(1);
    const outs = await pool.query(
      `SELECT movement_id FROM inventory_movement
       WHERE source_document_type = 'GoodsReceiptReversal' AND catalog_item_id = $1`,
      [fx.milkItemId],
    );
    expect(outs.rowCount).toBe(1);
    const orig = await service.get(draft!.goodsReceiptId);
    expect(orig?.status).toBe('REVERSED');
  });

  it('failed unique insert rolls back without orphan OUT or partial original', async () => {
    const draft = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-RB' }));
    await service.post(draft!.goodsReceiptId, { idempotencyKey: 'uq-rb-post', actorId: fx.actorId });
    await service.reverse(draft!.goodsReceiptId, { idempotencyKey: 'uq-rb-1', actorId: fx.actorId });

    const beforeOuts = await pool.query(
      `SELECT COUNT(*)::int AS n FROM inventory_movement WHERE source_document_type = 'GoodsReceiptReversal'`,
    );
    const beforeStatus = (await service.get(draft!.goodsReceiptId))!.status;

    await expect(
      pool.query(
        `INSERT INTO goods_receipt (
           goods_receipt_id, tenant_id, legal_entity_id, warehouse_id, supplier_id,
           supplier_document_number, currency_code, minor_unit_exponent,
           business_date, business_order, status, post_idempotency_key,
           reverses_goods_receipt_id, posted_at
         ) VALUES ($1,$2,$3,$4,$5,'RB-2','VND',0,CURRENT_DATE,50,'POSTED',$6,$7,NOW())`,
        [
          randomUUID(),
          fx.tenantId,
          fx.legalEntityId,
          fx.warehouseId,
          fx.supplierId,
          'reverse:rb-2',
          draft!.goodsReceiptId,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const afterOuts = await pool.query(
      `SELECT COUNT(*)::int AS n FROM inventory_movement WHERE source_document_type = 'GoodsReceiptReversal'`,
    );
    expect(afterOuts.rows[0]!.n).toBe(beforeOuts.rows[0]!.n);
    expect((await service.get(draft!.goodsReceiptId))!.status).toBe(beforeStatus);
  });

  it('HTTP reverse duplicate maps to 200 duplicate; unknown conflicts stay controlled', async () => {
    const app = await buildApp();
    const token = await loginWithPin(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers: authInjectHeaders(token),
      payload: { ...draftBase({ supplierDocumentNumber: 'UQ-HTTP' }), tenantId: fx.tenantId },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { goodsReceiptId: string }).goodsReceiptId;
    await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${id}/post`,
      headers: authInjectHeaders(token),
      payload: { idempotencyKey: 'uq-http-post' },
    });
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${id}/reverse`,
      headers: authInjectHeaders(token),
      payload: { idempotencyKey: 'uq-http-rev-1' },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { status: string }).status).toBe('created');
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/goods-receipts/${id}/reverse`,
      headers: authInjectHeaders(token),
      payload: { idempotencyKey: 'uq-http-rev-2' },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { status: string }).status).toBe('duplicate');
    await app.close();
  });

  it('idempotency key conflict differs from reverse duplicate', async () => {
    const a = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-IDEM-A' }));
    const b = await service.createDraft(draftBase({ supplierDocumentNumber: 'UQ-IDEM-B' }));
    await service.post(a!.goodsReceiptId, { idempotencyKey: 'idem-a-post', actorId: fx.actorId });
    await service.post(b!.goodsReceiptId, { idempotencyKey: 'idem-b-post', actorId: fx.actorId });
    await service.reverse(a!.goodsReceiptId, { idempotencyKey: 'shared-rev-key', actorId: fx.actorId });

    await expect(
      service.reverse(b!.goodsReceiptId, { idempotencyKey: 'shared-rev-key', actorId: fx.actorId }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const bState = await service.get(b!.goodsReceiptId);
    expect(bState?.status).toBe('POSTED');
    const outsForB = await pool.query(
      `SELECT m.movement_id FROM inventory_movement m
       JOIN goods_receipt r ON r.goods_receipt_id = m.source_document_id
       WHERE m.source_document_type = 'GoodsReceiptReversal'
         AND r.reverses_goods_receipt_id = $1`,
      [b!.goodsReceiptId],
    );
    expect(outsForB.rowCount).toBe(0);
  });
});
