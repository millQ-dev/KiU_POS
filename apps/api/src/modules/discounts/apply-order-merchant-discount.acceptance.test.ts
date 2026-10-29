/**
 * ADR-0051 ApplyOrderMerchantDiscount v1 — acceptance (disposable millq_ci_pos_* PostgreSQL only).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { resolvePinPepper } from '../../config.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import {
  authInjectHeaders,
  loginPosSession,
  TEST_ORIGIN,
} from '../../test/financial-auth-harness.js';
import { registerIdentityRoutes } from '../../routes/identity.js';
import { registerPosRoutes } from '../../routes/pos.js';
import {
  IdentityService,
  ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
  PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
  PERMISSION_POS_OPERATE,
} from '../identity/index.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsReceiptService } from '../procurement/goods-receipt-service.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeDiscount = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

const CASHIER_PIN = '111111';
const OTHER_CASHIER_PIN = '222222';
const MANAGER_PIN = '333333';

type Request =
  | { mode: 'FIXED_MINOR'; amountMinor: string; reason: string }
  | { mode: 'PERCENT'; percentBasisPoints: number; percent: string; reason: string };

describeDiscount('ADR-0051 ApplyOrderMerchantDiscount v1 (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let orders: OrdersService;
  let app: FastifyInstance;
  let terminalId: string;
  let cashierHeaders: Record<string, string>;
  let otherCashierHeaders: Record<string, string>;
  let managerHeaders: Record<string, string>;

  async function truncate() {
    await pool.query(`
      TRUNCATE
        identity_notification_outbox, identity_audit_event,
        identity_approval_request, identity_login_challenge,
        identity_session, identity_access_grant, identity_auth_throttle,
        identity_network_throttle,
        identity_pin_credential, workforce_employee, identity_user, terminal,
        operational_fact_feed, audit_record,
        order_line_commercial_snapshot, order_commercial_snapshot,
        sales_order_commercial_line_terms, sales_order_commercial_terms,
        sales_order_line, sales_order,
        settlement_check_line_allocation, settlement_check, settlement_group,
        catalog_item, warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    orders = new OrdersService(pool);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  // Fixture + sessions are created once (PIN login is network-throttled); each test opens its own orders.
  beforeEach(async () => {
    if (app) return;
    await truncate();
    fx = await seedBlockCFixture(pool);
    terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name) VALUES ($1,$2,$3,'T1','Terminal 1')`,
      [terminalId, fx.tenantId, fx.outletId],
    );
    const pepper = resolvePinPepper({
      NODE_ENV: 'test',
      PORT: 3000,
      LOG_LEVEL: 'error',
      DATABASE_URL,
      CORS_ORIGINS: TEST_ORIGIN,
    } as never);
    const identity = new IdentityService(pool, pepper);
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Cashier',
      pin: CASHIER_PIN,
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Other Cashier',
      pin: OTHER_CASHIER_PIN,
      grants: [{ permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId }],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Manager',
      pin: MANAGER_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE, outletId: fx.outletId },
      ],
    });
    app = Fastify({ logger: false });
    await app.register(cookie);
    await registerIdentityRoutes(app, pool, {
      pepper,
      cookieSecure: false,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
    });
    await registerPosRoutes(app, pool, {
      pepper,
      allowedOrigins: [TEST_ORIGIN],
      isProduction: false,
      databaseUrl: DATABASE_URL,
    });
    await app.ready();
    cashierHeaders = authInjectHeaders(await loginPosSession(app, pool, fx, CASHIER_PIN));
    otherCashierHeaders = authInjectHeaders(await loginPosSession(app, pool, fx, OTHER_CASHIER_PIN));
    managerHeaders = authInjectHeaders(await loginPosSession(app, pool, fx, MANAGER_PIN));
  });

  /** OPEN order, egg 60000 + milk 40000 = 100000 eligible basis (cap 20000). */
  async function openAcceptedOrder(opts?: { accept?: boolean }) {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    if (opts?.accept !== false) {
      await acceptFinalMerchandiseTerms(orders, o.orderId, {
        idempotencyKey: `base-${randomUUID()}`,
        grossByCatalogItemId: { [fx.eggItemId]: '60000', [fx.milkItemId]: '40000' },
      });
    }
    return o.orderId;
  }

  async function requestApproval(
    orderId: string,
    request: Request,
    headers: Record<string, string> = cashierHeaders,
  ): Promise<string> {
    const operationFingerprint =
      request.mode === 'FIXED_MINOR'
        ? { orderId, mode: request.mode, amountMinor: request.amountMinor, reason: request.reason }
        : {
            orderId,
            mode: request.mode,
            percentBasisPoints: request.percentBasisPoints,
            reason: request.reason,
          };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/approval-requests',
      headers,
      payload: {
        outletId: fx.outletId,
        terminalId,
        operationType: ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
        operationFingerprint,
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json().approvalRequestId as string;
  }

  async function decide(approvalRequestId: string, headers = managerHeaders) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/identity/approval-requests/${approvalRequestId}/decide`,
      headers,
      payload: { decision: 'APPROVE' },
    });
  }

  async function approvedRequest(orderId: string, request: Request): Promise<string> {
    const id = await requestApproval(orderId, request);
    expect((await decide(id)).statusCode).toBe(200);
    return id;
  }

  function applyBody(
    request: Request,
    approvalRequestId: string | undefined,
    idempotencyKey = `disc-${randomUUID()}`,
  ) {
    return {
      terminalId,
      idempotencyKey,
      mode: request.mode,
      ...(request.mode === 'FIXED_MINOR'
        ? { amountMinor: request.amountMinor }
        : { percent: request.percent }),
      reason: request.reason,
      ...(approvalRequestId ? { approvalRequestId } : {}),
    };
  }

  async function apply(
    orderId: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = cashierHeaders,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/apply-merchant-discount`,
      headers,
      payload: body,
    });
  }

  async function discountOnOrder(orderId: string): Promise<string | null> {
    const r = await pool.query<{ d: string }>(
      `SELECT order_merchant_funded_discount_minor AS d FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    return r.rows[0]?.d ?? null;
  }

  async function approvalStatus(id: string): Promise<string> {
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM identity_approval_request WHERE approval_request_id = $1`,
      [id],
    );
    return r.rows[0]!.status;
  }

  /** COMPLETED order (stocked milk, FINAL terms, written off) — economic facts must stay frozen. */
  async function completeMilkOrder(): Promise<string> {
    const receipts = new GoodsReceiptService(pool);
    const draft = await receipts.createDraft({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      warehouseId: fx.warehouseId,
      supplierId: fx.supplierId,
      supplierDocumentNumber: `MILK-DISC-${randomUUID()}`,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      businessDate: '2026-01-01',
      businessOrder: 1,
      actorId: fx.actorId,
      lines: [
        {
          lineNumber: 1,
          catalogItemId: fx.milkItemId,
          supplierItemId: fx.milkSupplierItemId,
          inputKind: 'FIXED_PACKAGE',
          packageCount: 5,
          acceptedBaseQuantity: '5',
          baseUnit: 'L',
          dimension: 'VOLUME',
          unitPriceMinor: '10000',
          lineAcquisitionCostMinor: '50000',
        },
      ],
    });
    await receipts.post(draft!.goodsReceiptId, {
      idempotencyKey: `recv-disc-${draft!.goodsReceiptId}`,
      actorId: fx.actorId,
    });
    const completing = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    const o = await completing.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await completing.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await acceptFinalMerchandiseTerms(completing, o.orderId, {
      idempotencyKey: `base-${randomUUID()}`,
      defaultGrossMinor: '40000',
    });
    await completing.completeOrder({
      orderId: o.orderId,
      idempotencyKey: `complete-${randomUUID()}`,
      businessDate: '2026-03-10',
      businessOrder: 1,
    });
    return o.orderId;
  }

  const fixed = (amountMinor: string, reason = 'Regular guest'): Request => ({
    mode: 'FIXED_MINOR',
    amountMinor,
    reason,
  });

  it('migration 038 registers the approver permission', async () => {
    const perms = await pool.query(
      `SELECT 1 FROM identity_permission WHERE permission_key = 'orders.merchant_discount.approve'`,
    );
    expect(perms.rowCount).toBe(1);
  });

  it('happy path: manager-approved fixed discount re-accepts commercial terms atomically', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('10000');
    const approvalId = await approvedRequest(orderId, request);

    const res = await apply(orderId, applyBody(request, approvalId, 'disc-happy-0001'));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'applied',
      mode: 'FIXED_MINOR',
      discountMinor: '10000',
      eligibleBasisMinor: '100000',
      certainty: 'FINAL',
      netMerchandiseSalesMinor: '90000',
      approvalRequestId: approvalId,
    });
    const allocated = body.lines.map(
      (l: { allocatedOrderMerchantDiscountMinor: string }) => l.allocatedOrderMerchantDiscountMinor,
    );
    expect(allocated.sort()).toEqual(['4000', '6000']);

    expect(await discountOnOrder(orderId)).toBe('10000');
    expect(await approvalStatus(approvalId)).toBe('CONSUMED');
    const terms = await pool.query<{ idempotency_key: string; provenance_json: Record<string, unknown> }>(
      `SELECT idempotency_key, provenance_json FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    expect(terms.rows[0]!.idempotency_key).toBe('disc-happy-0001');
    expect(terms.rows[0]!.provenance_json.merchantDiscount).toMatchObject({
      reason: 'Regular guest',
      approvalRequestId: approvalId,
      discountMinor: '10000',
    });
    const audit = await pool.query(
      `SELECT payload FROM identity_audit_event
       WHERE event_type = 'ORDER_MERCHANT_DISCOUNT_APPLIED' AND subject_ref = $1`,
      [orderId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.payload).toMatchObject({ discountMinor: '10000', reason: 'Regular guest' });

    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/commercial-status`,
      headers: cashierHeaders,
    });
    expect(status.json().commercialState).toBe('ACCEPTED');
  });

  it('percent mode applies and a later approved discount replaces (never stacks)', async () => {
    const orderId = await openAcceptedOrder();
    const pct: Request = { mode: 'PERCENT', percent: '15', percentBasisPoints: 1500, reason: 'Birthday' };
    const first = await apply(orderId, applyBody(pct, await approvedRequest(orderId, pct)));
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ discountMinor: '15000', percentBasisPoints: 1500 });

    const second = fixed('5000', 'Manager goodwill');
    const res = await apply(orderId, applyBody(second, await approvedRequest(orderId, second)));
    expect(res.statusCode).toBe(201);
    expect(await discountOnOrder(orderId)).toBe('5000');
    const prov = await pool.query<{ provenance_json: { merchantDiscount: { priorOrderDiscountMinor: string } } }>(
      `SELECT provenance_json FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    expect(prov.rows[0]!.provenance_json.merchantDiscount.priorOrderDiscountMinor).toBe('15000');
  });

  it('exactly 20% is accepted; above 20% is rejected and leaves approval + terms untouched', async () => {
    const okOrder = await openAcceptedOrder();
    const atCap = fixed('20000');
    expect(
      (await apply(okOrder, applyBody(atCap, await approvedRequest(okOrder, atCap)))).statusCode,
    ).toBe(201);

    const orderId = await openAcceptedOrder();
    const over = fixed('20001');
    const approvalId = await approvedRequest(orderId, over);
    const rejected = await apply(orderId, applyBody(over, approvalId));
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe('DISCOUNT_EXCEEDS_CAP');
    expect(await discountOnOrder(orderId)).toBe('0');
    expect(await approvalStatus(approvalId)).toBe('APPROVED');

    const pctOver: Request = {
      mode: 'PERCENT',
      percent: '20.01',
      percentBasisPoints: 2001,
      reason: 'Too much',
    };
    const pctRes = await apply(orderId, applyBody(pctOver, await approvedRequest(orderId, pctOver)));
    expect(pctRes.statusCode).toBe(400);
    expect(pctRes.json().error).toBe('DISCOUNT_EXCEEDS_CAP');
  });

  it('empty / whitespace reason is rejected', async () => {
    const orderId = await openAcceptedOrder();
    for (const reason of ['', '   ']) {
      const request = fixed('1000', reason);
      const res = await apply(orderId, applyBody(request, await approvedRequest(orderId, request)));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('DISCOUNT_REASON_REQUIRED');
    }
    expect(await discountOnOrder(orderId)).toBe('0');
  });

  it('padded reason still matches ApprovalRequest fingerprint after trim', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('2500', '  Guest goodwill  ');
    const approvalRequestId = await approvedRequest(orderId, request);
    const res = await apply(orderId, applyBody(request, approvalRequestId));
    expect(res.statusCode).toBe(201);
    expect(res.json().reason).toBe('Guest goodwill');
    expect(await discountOnOrder(orderId)).toBe('2500');
    expect(await approvalStatus(approvalRequestId)).toBe('CONSUMED');
  });

  it('approval evidence is mandatory and must be a valid, bound, single-use APPROVED request', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('3000');

    const missing = await apply(orderId, applyBody(request, undefined));
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error).toBe('APPROVAL_REQUIRED');

    const pending = await requestApproval(orderId, request);
    const pendingRes = await apply(orderId, applyBody(request, pending));
    expect(pendingRes.statusCode).toBe(403);
    expect(pendingRes.json().error).toBe('AUTH_EVIDENCE_INVALID');

    const approvedForOther = await approvedRequest(orderId, fixed('1000'));
    const mismatch = await apply(orderId, applyBody(request, approvedForOther));
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error).toBe('AUTH_EVIDENCE_INVALID');

    const otherCashierRes = await apply(orderId, applyBody(fixed('1000'), approvedForOther), otherCashierHeaders);
    expect(otherCashierRes.statusCode).toBe(403);

    const good = await approvedRequest(orderId, request);
    expect((await apply(orderId, applyBody(request, good))).statusCode).toBe(201);
    const replay = await apply(orderId, applyBody(request, good));
    expect(replay.statusCode).toBe(403);
    expect(replay.json().error).toBe('AUTH_EVIDENCE_INVALID');
  });

  it('only a holder of orders.merchant_discount.approve can approve; self-approval is forbidden', async () => {
    const orderId = await openAcceptedOrder();
    const id = await requestApproval(orderId, fixed('2000'));
    const peer = await decide(id, otherCashierHeaders);
    expect(peer.statusCode).toBe(403);
    const self = await decide(id, cashierHeaders);
    expect(self.statusCode).toBe(403);
    expect(await approvalStatus(id)).toBe('PENDING');
  });

  it('idempotent retry returns duplicate without a second consume; key reuse with other semantics conflicts', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('7000');
    const approvalId = await approvedRequest(orderId, request);
    const body = applyBody(request, approvalId, 'disc-idem-0001');
    expect((await apply(orderId, body)).statusCode).toBe(201);
    const retry = await apply(orderId, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe('duplicate');
    expect(retry.json().discountMinor).toBe('7000');

    const audit = await pool.query(
      `SELECT 1 FROM identity_audit_event WHERE event_type = 'ORDER_MERCHANT_DISCOUNT_APPLIED' AND subject_ref = $1`,
      [orderId],
    );
    expect(audit.rowCount).toBe(1);

    const other = fixed('8000');
    const otherApproval = await approvedRequest(orderId, other);
    const conflict = await apply(orderId, applyBody(other, otherApproval, 'disc-idem-0001'));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('IDEMPOTENCY_CONFLICT');
    expect(await approvalStatus(otherApproval)).toBe('APPROVED');
    expect(await discountOnOrder(orderId)).toBe('7000');
  });

  it('concurrent applies with one approval: exactly one wins', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('4000');
    const approvalId = await approvedRequest(orderId, request);
    const results = await Promise.all([
      apply(orderId, applyBody(request, approvalId, 'disc-race-0001')),
      apply(orderId, applyBody(request, approvalId, 'disc-race-0002')),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 403]);
    expect(await discountOnOrder(orderId)).toBe('4000');
  });

  it('rejects non-OPEN orders and live-settlement orders without mutating terms', async () => {
    const cancelled = await openAcceptedOrder();
    const request = fixed('1000');
    const cancelledApproval = await approvedRequest(cancelled, request);
    await orders.cancelOrder({ orderId: cancelled, reason: 'guest left' });
    const cancelledRes = await apply(cancelled, applyBody(request, cancelledApproval));
    expect(cancelledRes.statusCode).toBe(409);
    expect(cancelledRes.json().error).toBe('ORDER_IMMUTABLE');
    expect(await approvalStatus(cancelledApproval)).toBe('APPROVED');

    const completed = await completeMilkOrder();
    const completedApproval = await approvedRequest(completed, request);
    const completedRes = await apply(completed, applyBody(request, completedApproval));
    expect(completedRes.statusCode).toBe(409);
    expect(completedRes.json().error).toBe('ORDER_IMMUTABLE');
    expect(await discountOnOrder(completed)).toBe('0');
    expect(await approvalStatus(completedApproval)).toBe('APPROVED');

    const paying = await openAcceptedOrder();
    const payingApproval = await approvedRequest(paying, request);
    const settle = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${paying}/open-settlement`,
      headers: cashierHeaders,
      payload: { idempotencyKey: `settle-${randomUUID()}` },
    });
    expect(settle.statusCode).toBe(200);
    const payingRes = await apply(paying, applyBody(request, payingApproval));
    expect(payingRes.statusCode).toBe(409);
    expect(payingRes.json().error).toBe('SETTLEMENT_EDIT_LOCKED');
    expect(await discountOnOrder(paying)).toBe('0');
    expect(await approvalStatus(payingApproval)).toBe('APPROVED');
  });

  it('requires accepted FINAL commercial terms', async () => {
    const orderId = await openAcceptedOrder({ accept: false });
    const request = fixed('1000');
    const res = await apply(orderId, applyBody(request, await approvedRequest(orderId, request)));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('COMMERCIAL_TERMS_NOT_ACCEPTED');
  });

  it('narrow command: no commercial-terms fields, no tenant injection, no raw setOrderCommercialTerms route', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('1000');
    const approvalId = await approvedRequest(orderId, request);
    for (const extra of [
      { orderMerchantFundedDiscountMinor: '99999' },
      { lineTerms: [] },
      { tenantId: randomUUID() },
      { certainty: 'UNKNOWN' },
    ]) {
      const res = await apply(orderId, { ...applyBody(request, approvalId), ...extra });
      expect(res.statusCode).toBe(400);
    }
    expect(await discountOnOrder(orderId)).toBe('0');
    for (const url of [
      `/api/v1/orders/${orderId}/commercial-terms`,
      `/api/v1/orders/${orderId}/set-commercial-terms`,
    ]) {
      const res = await app.inject({ method: 'POST', url, headers: cashierHeaders, payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });

  it('requires an authenticated pos.operate principal in the order tenant', async () => {
    const orderId = await openAcceptedOrder();
    const request = fixed('1000');
    const approvalId = await approvedRequest(orderId, request);
    const unauth = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/apply-merchant-discount`,
      headers: { origin: TEST_ORIGIN },
      payload: applyBody(request, approvalId),
    });
    expect(unauth.statusCode).toBe(401);
  });
});
