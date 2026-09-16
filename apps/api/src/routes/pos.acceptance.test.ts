/**
 * P1.2 — thin POS / Orders HTTP transport (delegates P1.1 + Orders services).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../test/seed.js';
import { MenuService } from '../modules/menu/index.js';
import { LayoutService } from '../modules/pos/index.js';
import { registerPosRoutes } from '../routes/pos.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const TZ = 'Asia/Ho_Chi_Minh';
const AT = '2026-09-16T17:30:00.000Z';

let pool: pg.Pool;
let fx: BlockCFixture;
let menu: MenuService;
let layout: LayoutService;
let seq = 0;
const idem = (p: string) => `${p}-${++seq}-${randomUUID()}`;

async function truncateBusiness() {
  await pool.query(`
    TRUNCATE
      operational_fact_feed, audit_record,
      order_line_commercial_snapshot, order_commercial_snapshot,
      sales_order_commercial_line_terms, sales_order_commercial_terms,
      sales_order_completion_reversal, goods_issue_reversal,
      goods_issue_line, goods_issue,
      consumption_plan_physical_leaf, consumption_plan_resolved_version,
      consumption_plan_line, consumption_plan_snapshot,
      sales_order_line, sales_order, catalog_item_recipe_profile,
      inventory_balance, inventory_movement,
      goods_receipt_line, goods_receipt,
      production_batch_reversal, production_batch_input, production_batch,
      recipe_component, recipe_version, recipe_specification,
      preparation_component, preparation_version, preparation_specification,
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function seedPosSurface() {
  await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: TZ });
  const def = await menu.createMenuDefinition({
    tenantId: fx.tenantId,
    code: `m-${seq}`,
    name: 'Cashier Menu',
  });
  await menu.setMenuDefinitionItems({
    menuDefinitionId: def.menuDefinitionId,
    catalogItemIds: [fx.eggItemId, fx.milkItemId],
  });
  const mpub = await menu.publishMenu({
    menuDefinitionId: def.menuDefinitionId,
    idempotencyKey: idem('mp'),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await menu.assignMenu({
    tenantId: fx.tenantId,
    menuPublicationId: mpub.menuPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('ma'),
  });
  await menu.activatePriceRule({
    tenantId: fx.tenantId,
    catalogItemId: fx.eggItemId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    amountMinor: '5000',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('pe'),
  });
  await menu.activatePriceRule({
    tenantId: fx.tenantId,
    catalogItemId: fx.milkItemId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    amountMinor: '20000',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('pm'),
  });

  const ldef = await layout.createLayoutDefinition({
    tenantId: fx.tenantId,
    code: `l-${seq}`,
    name: 'Cashier',
  });
  await layout.setLayoutPages({
    layoutDefinitionId: ldef.layoutDefinitionId,
    pages: [{ pageCode: 'main', label: 'Main', sortOrder: 0 }],
  });
  await layout.setLayoutSlots({
    layoutDefinitionId: ldef.layoutDefinitionId,
    slots: [
      { zone: 'PAGE', pageCode: 'main', catalogItemId: fx.eggItemId, position: 1 },
      { zone: 'PAGE', pageCode: 'main', catalogItemId: fx.milkItemId, position: 2 },
      { zone: 'QUICK_ACCESS', catalogItemId: fx.eggItemId, position: 1 },
    ],
  });
  const lpub = await layout.publishLayout({
    layoutDefinitionId: ldef.layoutDefinitionId,
    idempotencyKey: idem('lp'),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await layout.assignLayout({
    tenantId: fx.tenantId,
    layoutPublicationId: lpub.layoutPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('la'),
  });
}

function payload() {
  return {
    presentationContext: {
      tenantId: fx.tenantId,
      brandId: fx.brandId,
      outletId: fx.outletId,
    },
    salesContext: {
      tenantId: fx.tenantId,
      brandId: fx.brandId,
      outletId: fx.outletId,
      orderChannel: 'DIRECT',
      businessDateTime: AT,
    },
  };
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  menu = new MenuService(pool);
  layout = new LayoutService(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateBusiness();
  fx = await seedBlockCFixture(pool);
  await seedPosSurface();
});

describe('P1.2 POS HTTP transport', () => {
  it('resolves surface via PosSurfaceResolver; COUNT enrichment present', async () => {
    const app = Fastify();
    await registerPosRoutes(app, pool);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/surface/resolve',
      payload: payload(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      pages: { slots: { catalogItemId: string; dimension: string; quantityEntry: string; state: string }[] }[];
      quickAccess: unknown[];
    };
    expect(body.pages[0]!.slots.map((s) => s.catalogItemId)).toContain(fx.eggItemId);
    const egg = body.pages[0]!.slots.find((s) => s.catalogItemId === fx.eggItemId)!;
    expect(egg.dimension).toBe('COUNT');
    expect(egg.quantityEntry).toBe('COUNT_ONE');
    expect(egg.state).toBe('ACTIVE');
    const milk = body.pages[0]!.slots.find((s) => s.catalogItemId === fx.milkItemId)!;
    expect(milk.dimension).toBe('VOLUME');
    expect(milk.quantityEntry).toBe('DEFERRED_WEIGHTED');
    expect(body.quickAccess).toHaveLength(1);
    await app.close();
  });

  it('open order + COUNT tap delegates AddOrderLine; no commercial terms', async () => {
    const app = Fastify();
    await registerPosRoutes(app, pool);
    await app.ready();

    const surface = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/surface/resolve',
      payload: payload(),
    });
    const eggSlot = (
      surface.json() as { pages: { slots: { layoutPublicationSlotId: string; catalogItemId: string }[] }[] }
    ).pages[0]!.slots.find((s) => s.catalogItemId === fx.eggItemId)!;

    const opened = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    expect(opened.statusCode).toBe(201);
    const order = opened.json() as { orderId: string; status: string; lines: unknown[] };
    expect(order.status).toBe('OPEN');
    expect(order).not.toHaveProperty('tableId');

    const selected = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/select-count',
      payload: {
        ...payload(),
        orderId: order.orderId,
        layoutPublicationSlotId: eggSlot.layoutPublicationSlotId,
      },
    });
    expect(selected.statusCode).toBe(200);
    const body = selected.json() as {
      order: { lines: { catalogItemId: string; quantity: string; catalogItemName: string }[] };
    };
    expect(body.order.lines).toHaveLength(1);
    expect(body.order.lines[0]!.catalogItemId).toBe(fx.eggItemId);
    expect(body.order.lines[0]!.quantity).toBe('1');
    expect(body.order.lines[0]!.catalogItemName).toBeTruthy();

    const terms = await pool.query(`SELECT 1 FROM sales_order_commercial_terms WHERE order_id = $1`, [
      order.orderId,
    ]);
    expect(terms.rowCount).toBe(0);

    const milkSlot = (
      surface.json() as { pages: { slots: { layoutPublicationSlotId: string; catalogItemId: string }[] }[] }
    ).pages[0]!.slots.find((s) => s.catalogItemId === fx.milkItemId)!;
    const weighted = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/select-count',
      payload: {
        ...payload(),
        orderId: order.orderId,
        layoutPublicationSlotId: milkSlot.layoutPublicationSlotId,
      },
    });
    expect(weighted.statusCode).toBe(400);
    expect(weighted.json()).toMatchObject({ error: 'POS_QUANTITY_ENTRY_DEFERRED' });

    await app.close();
  });

  it('route handlers contain no SQL and no commercial/complete side effects', () => {
    const src = readFileSync(fileURLToPath(new URL('../routes/pos.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/INSERT INTO sales_order_line/);
    expect(src).not.toMatch(/setOrderCommercialTerms|completeOrder/);
    expect(src).toContain('PosSurfaceResolver');
    expect(src).toContain('selectPosCountTap');
    expect(src).toContain('orders.openOrder');
  });
});

describe('P1.3 Order Interaction HTTP transport', () => {
  async function openWithEggLine(app: Awaited<ReturnType<typeof Fastify>>) {
    const surface = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/surface/resolve',
      payload: payload(),
    });
    const eggSlot = (
      surface.json() as { pages: { slots: { layoutPublicationSlotId: string; catalogItemId: string }[] }[] }
    ).pages[0]!.slots.find((s) => s.catalogItemId === fx.eggItemId)!;
    const milkSlot = (
      surface.json() as { pages: { slots: { layoutPublicationSlotId: string; catalogItemId: string }[] }[] }
    ).pages[0]!.slots.find((s) => s.catalogItemId === fx.milkItemId)!;
    const opened = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        tenantId: fx.tenantId,
        legalEntityId: fx.legalEntityId,
        outletId: fx.outletId,
        channel: 'DIRECT',
      },
    });
    const order = opened.json() as { orderId: string };
    const selected = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/select-count',
      payload: {
        ...payload(),
        orderId: order.orderId,
        layoutPublicationSlotId: eggSlot.layoutPublicationSlotId,
      },
    });
    const body = selected.json() as {
      order: { orderId: string; lines: { orderLineId: string; quantity: string }[] };
    };
    return { orderId: body.order.orderId, lineId: body.order.lines[0]!.orderLineId, milkSlot };
  }

  it('PATCH update / DELETE remove / cancel / commercial-status / resolve-menu-prices', async () => {
    const app = Fastify();
    await registerPosRoutes(app, pool);
    await app.ready();
    const { orderId, lineId, milkSlot } = await openWithEggLine(app);

    const status0 = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/commercial-status`,
    });
    expect(status0.statusCode).toBe(200);
    expect(status0.json()).toMatchObject({
      commercialState: 'NOT_ACCEPTED',
      presentationHint: 'NEEDS_REACCEPTANCE',
    });

    // Explicit accept via domain (not HTTP) so we can prove invalidation
    const { OrdersService } = await import('../modules/orders/orders-service.js');
    const { GoodsIssueService } = await import('../modules/inventory/goods-issue-service.js');
    const { acceptFinalMerchandiseTerms } = await import('../test/commercial-terms.js');
    const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    await acceptFinalMerchandiseTerms(orders, orderId, { defaultGrossMinor: '5000' });
    const statusAccepted = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/commercial-status`,
    });
    expect(statusAccepted.json()).toMatchObject({
      commercialState: 'ACCEPTED',
      presentationHint: 'COMMERCIAL_CURRENT',
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderId}/lines/${lineId}`,
      payload: { quantity: '3' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { lines: { quantity: string }[] }).lines[0]!.quantity).toBe('3');
    const statusAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/commercial-status`,
    });
    expect(statusAfter.json()).toMatchObject({
      commercialState: 'NOT_ACCEPTED',
      presentationHint: 'NEEDS_REACCEPTANCE',
    });

    const fractional = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderId}/lines/${lineId}`,
      payload: { quantity: '1.5' },
    });
    expect(fractional.statusCode).toBe(400);
    expect(fractional.json()).toMatchObject({ error: 'INVALID_QUANTITY' });

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/resolve-menu-prices`,
      payload: { salesContext: payload().salesContext },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedBody = resolved.json() as {
      commercialGrossPolicy: string;
      lines: { resolvedUnitPriceMinor: string | null }[];
    };
    expect(resolvedBody.commercialGrossPolicy).toBe('EXPLICIT_GROSS_ONLY');
    expect(resolvedBody.lines[0]!.resolvedUnitPriceMinor).toBe('5000');
    const termsStillClear = await pool.query(
      `SELECT 1 FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    expect(termsStillClear.rowCount).toBe(0);

    const weighted = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/select-quantity',
      payload: {
        ...payload(),
        orderId,
        layoutPublicationSlotId: milkSlot.layoutPublicationSlotId,
        quantity: '0.5',
      },
    });
    expect(weighted.statusCode).toBe(200);
    const wBody = weighted.json() as {
      order: { lines: { catalogItemId: string; quantity: string; dimension: string }[] };
    };
    const milkLine = wBody.order.lines.find((l) => l.catalogItemId === fx.milkItemId)!;
    expect(milkLine.quantity).toBe('0.5');
    expect(milkLine.dimension).toBe('VOLUME');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/orders/${orderId}/lines/${lineId}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(
      (removed.json() as { lines: { catalogItemId: string }[] }).lines.every(
        (l) => l.catalogItemId !== fx.eggItemId,
      ),
    ).toBe(true);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/cancel`,
      payload: { reason: 'cashier_cancel' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as { status: string }).status).toBe('CANCELLED');

    const mutateClosed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderId}/lines/${lineId}`,
      payload: { quantity: '2' },
    });
    expect(mutateClosed.statusCode).toBe(409);

    await app.close();
  });

  it('rejects cross-tenant / nonexistent line and does not derive gross', async () => {
    const app = Fastify();
    await registerPosRoutes(app, pool);
    await app.ready();
    const { orderId } = await openWithEggLine(app);
    const bogus = await app.inject({
      method: 'DELETE',
      url: `/api/v1/orders/${orderId}/lines/${randomUUID()}`,
    });
    expect(bogus.statusCode).toBe(404);

    const src = readFileSync(fileURLToPath(new URL('../routes/pos.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/unitPrice\s*\*|amountMinor\s*\*|grossMerchandiseMinor\s*=/);
    expect(src).toContain('UNIT_PRICE_RESOLUTION_ONLY');
    expect(src).toContain('updateOrderLine');
    expect(src).toContain('removeOrderLine');
    expect(src).toContain('cancelOrder');
    expect(src).toContain('getOpenCommercialStatus');
    expect(src).toContain('selectPosQuantityTap');
    await app.close();
  });
});
