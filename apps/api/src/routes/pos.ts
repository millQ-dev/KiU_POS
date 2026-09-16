import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { GoodsIssueService } from '../modules/inventory/goods-issue-service.js';
import { OrdersService } from '../modules/orders/orders-service.js';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
  PosSelectionService,
  PosSurfaceResolver,
  PublishedImmutableError,
} from '../modules/pos/index.js';

function mapError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof DomainValidationError) {
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof PublishedImmutableError) {
    return { status: 409, body: { error: err.code, message: err.message } };
  }
  if (err instanceof IdempotencyConflictError) {
    return { status: 409, body: { error: err.code, message: err.message } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.code, message: err.message } };
  }
  // Orders / Menu may throw same-shaped errors from sibling modules
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const code = String((err as { code: unknown }).code);
    const message = String((err as { message: unknown }).message);
    if (code === 'NOT_FOUND') return { status: 404, body: { error: code, message } };
    if (code && code !== 'undefined') return { status: 400, body: { error: code, message } };
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    return { status: 400, body: { error: 'VALIDATION', message: String(err) } };
  }
  throw err;
}

async function enrichOrderLines(pool: pg.Pool, order: Awaited<ReturnType<OrdersService['getOrder']>>) {
  if (order.lines.length === 0) return { ...order, lines: [] as Array<(typeof order.lines)[number] & { catalogItemName: string }> };
  const ids = [...new Set(order.lines.map((l) => l.catalogItemId))];
  const names = await pool.query<{ catalog_item_id: string; name: string }>(
    `SELECT catalog_item_id, name FROM catalog_item WHERE catalog_item_id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(names.rows.map((r) => [r.catalog_item_id, r.name]));
  return {
    ...order,
    lines: order.lines.map((l) => ({
      ...l,
      catalogItemName: byId.get(l.catalogItemId) ?? 'Unknown item',
    })),
  };
}

export async function registerPosRoutes(app: FastifyInstance, pool: pg.Pool) {
  const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
  const surfaceResolver = new PosSurfaceResolver(pool);
  const selection = new PosSelectionService(pool, orders);

  app.post('/api/v1/pos/surface/resolve', async (req, reply) => {
    try {
      const surface = await surfaceResolver.resolvePosSurface(req.body);
      return surface;
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/pos/select-count', async (req, reply) => {
    try {
      const result = await selection.selectPosCountTap(req.body);
      const order = await enrichOrderLines(pool, result.order);
      return { ...result, order };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/orders', async (req, reply) => {
    try {
      const order = await orders.openOrder(req.body);
      return reply.code(201).send(await enrichOrderLines(pool, order));
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get<{ Params: { orderId: string } }>('/api/v1/orders/:orderId', async (req, reply) => {
    try {
      const order = await orders.getOrder(req.params.orderId);
      return await enrichOrderLines(pool, order);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}

/**
 * Development-only outlet context bootstrap — NOT production authorization.
 * Enabled when NODE_ENV !== 'production' or ALLOW_DEV_CASHIER_BOOTSTRAP=1.
 */
export async function registerDevCashierBootstrapRoutes(app: FastifyInstance, pool: pg.Pool) {
  const allowed =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_CASHIER_BOOTSTRAP === '1';

  app.get('/api/v1/dev/cashier-contexts', async (_req, reply) => {
    if (!allowed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Dev bootstrap disabled' });
    }
    const rows = await pool.query<{
      tenant_id: string;
      tenant_name: string;
      brand_id: string;
      brand_name: string;
      outlet_id: string;
      outlet_name: string;
      legal_entity_id: string;
      legal_entity_name: string;
    }>(
      `SELECT t.tenant_id, t.name AS tenant_name,
              b.brand_id, b.name AS brand_name,
              o.outlet_id, o.name AS outlet_name,
              le.legal_entity_id, le.name AS legal_entity_name
       FROM outlet o
       JOIN brand b ON b.brand_id = o.brand_id
       JOIN tenant t ON t.tenant_id = o.tenant_id
       JOIN legal_entity le ON le.legal_entity_id = o.legal_entity_id
       ORDER BY t.name, b.name, o.name
       LIMIT 50`,
    );
    return {
      mode: 'DEVELOPMENT_BOOTSTRAP',
      warning:
        'Not production authorization. Selects tenant/brand/outlet topology for local cashier shell only.',
      contexts: rows.rows.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        brandId: r.brand_id,
        brandName: r.brand_name,
        outletId: r.outlet_id,
        outletName: r.outlet_name,
        legalEntityId: r.legal_entity_id,
        legalEntityName: r.legal_entity_name,
        orderChannel: 'DIRECT',
      })),
    };
  });
}
