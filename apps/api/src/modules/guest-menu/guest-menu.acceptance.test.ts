/**
 * GUEST1.1 — Guest QR Menu Public Read Projection (permanent tests 1–24).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { MenuResolver, MenuService } from '../menu/index.js';
import { CAPABILITY_GUEST_QR, GuestMenuProjectionService } from './index.js';
import { registerGuestMenuRoutes, registerDevGuestMenuAdminRoutes } from '../../routes/guest-menu.js';
import { registerPosRoutes } from '../../routes/pos.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const TZ = 'Asia/Ho_Chi_Minh';
const LOCAL_SEPT17_0030 = '2026-09-16T17:30:00.000Z';

const ALLOWED_TOP = new Set([
  'language',
  'outlet',
  'brand',
  'tableLabel',
  'categories',
  'items',
]);
const ALLOWED_ITEM = new Set([
  'publicItemRef',
  'name',
  'description',
  'imageUrl',
  'availability',
  'price',
]);
const FORBIDDEN_SUBSTRINGS = [
  'tenantId',
  'brandId',
  'outletId',
  'tableId',
  'catalogItemId',
  'menuPublicationId',
  'menuAssignmentId',
  'priceRuleId',
  'availabilityRuleId',
  'recipe',
  'supplier',
  'warehouse',
  'cogs',
  'COGS',
  'legalEntity',
  'employee',
];

let pool: pg.Pool;
let fx: BlockCFixture;
let menu: MenuService;
let resolver: MenuResolver;
let guest: GuestMenuProjectionService;
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
      public_menu_link, outlet_capability_config, package_entitlement,
      catalog_item_presentation, presentation_media_asset,
      price_rule, availability_rule, menu_assignment,
      menu_publication_item, menu_publication, menu_definition_item, menu_definition,
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function publishAndAssign(catalogItemIds: string[]) {
  const def = await menu.createMenuDefinition({
    tenantId: fx.tenantId,
    code: `gm-${seq}`,
    name: 'Guest Menu',
  });
  await menu.setMenuDefinitionItems({
    menuDefinitionId: def.menuDefinitionId,
    catalogItemIds,
  });
  const pub = await menu.publishMenu({
    menuDefinitionId: def.menuDefinitionId,
    idempotencyKey: idem('pub'),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await menu.assignMenu({
    tenantId: fx.tenantId,
    menuPublicationId: pub.menuPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('asg'),
  });
  return pub;
}

async function enableFullCapability() {
  await guest.linkService.setPackageEntitlement({
    tenantId: fx.tenantId,
    capabilityKey: CAPABILITY_GUEST_QR,
    entitled: true,
  });
  await guest.linkService.setOutletCapability({
    tenantId: fx.tenantId,
    outletId: fx.outletId,
    capabilityKey: CAPABILITY_GUEST_QR,
    enabled: true,
  });
}

async function priceMilk(amountMinor: string, effectiveFrom = '2026-01-01T00:00:00.000Z', effectiveTo?: string) {
  await menu.activatePriceRule({
    tenantId: fx.tenantId,
    catalogItemId: fx.milkItemId,
    scopeKind: 'TENANT',
    amountMinor,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    effectiveFrom,
    ...(effectiveTo ? { effectiveTo } : {}),
    idempotencyKey: idem('pr'),
  });
}

function assertAllowlistedDto(body: Record<string, unknown>) {
  for (const k of Object.keys(body)) {
    expect(ALLOWED_TOP.has(k), `unexpected top field ${k}`).toBe(true);
  }
  const json = JSON.stringify(body);
  for (const s of FORBIDDEN_SUBSTRINGS) {
    expect(json.includes(s), `forbidden substring ${s}`).toBe(false);
  }
  expect(json).not.toContain(fx.tenantId);
  expect(json).not.toContain(fx.outletId);
  expect(json).not.toContain(fx.brandId);
  expect(json).not.toContain(fx.milkItemId);
  for (const item of body.items as Array<Record<string, unknown>>) {
    for (const k of Object.keys(item)) {
      expect(ALLOWED_ITEM.has(k), `unexpected item field ${k}`).toBe(true);
    }
  }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  menu = new MenuService(pool);
  resolver = new MenuResolver(pool);
  guest = new GuestMenuProjectionService(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateBusiness();
  fx = await seedBlockCFixture(pool);
  await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: TZ });
});

describe('GUEST1.1 Guest QR Menu Public Read Projection', () => {
  it('1–3 — valid token; price+availability match MenuResolver exactly', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('22000');
    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      availabilityStatus: 'UNAVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('unav'),
    });

    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const resolved = await resolver.resolveMenu({
      salesContext: {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
        orderChannel: 'DIRECT',
        businessDateTime: LOCAL_SEPT17_0030,
      },
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    expect(dto.items).toHaveLength(resolved.items.length);
    expect(dto.items[0]!.availability).toBe(resolved.items[0]!.availabilityStatus);
    expect(resolved.items[0]!.price.status).toBe('RESOLVED');
    if (resolved.items[0]!.price.status === 'RESOLVED') {
      expect(dto.items[0]!.price).toEqual({
        status: 'AVAILABLE',
        amountMinor: resolved.items[0]!.price.quote.resolvedUnitPriceMinor,
        currencyCode: resolved.items[0]!.price.quote.currencyCode,
        minorUnitExponent: resolved.items[0]!.price.quote.minorUnitExponent,
      });
    }
  });

  it('4–5 — invalid and revoked token denied (same public failure)', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    await guest.linkService.revokeLink(link.publicMenuLinkId);

    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/public/guest-menu/aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const revoked = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}`,
    });
    expect(invalid.statusCode).toBe(404);
    expect(revoked.statusCode).toBe(404);
    expect(invalid.json()).toEqual(revoked.json());
    expect(invalid.json().error).toBe('PUBLIC_MENU_UNAVAILABLE');
    await app.close();
  });

  it('6–7 — outlet capability disabled OR package entitlement missing denied', async () => {
    await publishAndAssign([fx.milkItemId]);
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });

    // package missing, outlet off
    await expect(guest.resolveGuestMenu({ opaqueToken: link.opaqueToken })).rejects.toMatchObject({
      code: 'GUEST_MENU_CAPABILITY_DISABLED',
    });

    await guest.linkService.setPackageEntitlement({
      tenantId: fx.tenantId,
      capabilityKey: CAPABILITY_GUEST_QR,
      entitled: true,
    });
    // package on, outlet still off
    await expect(guest.resolveGuestMenu({ opaqueToken: link.opaqueToken })).rejects.toMatchObject({
      code: 'GUEST_MENU_CAPABILITY_DISABLED',
    });

    await guest.linkService.setOutletCapability({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      capabilityKey: CAPABILITY_GUEST_QR,
      enabled: true,
    });
    await guest.linkService.setPackageEntitlement({
      tenantId: fx.tenantId,
      capabilityKey: CAPABILITY_GUEST_QR,
      entitled: false,
    });
    // outlet on, package revoked
    await expect(guest.resolveGuestMenu({ opaqueToken: link.opaqueToken })).rejects.toMatchObject({
      code: 'GUEST_MENU_CAPABILITY_DISABLED',
    });
  });

  it('8 — cross-tenant attack denied', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const linkA = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });

    const fxB = await seedBlockCFixture(pool);
    await menu.setOutletTimezone({ tenantId: fxB.tenantId, outletId: fxB.outletId, timezone: TZ });
    await guest.linkService.setPackageEntitlement({
      tenantId: fxB.tenantId,
      capabilityKey: CAPABILITY_GUEST_QR,
      entitled: true,
    });
    await guest.linkService.setOutletCapability({
      tenantId: fxB.tenantId,
      outletId: fxB.outletId,
      capabilityKey: CAPABILITY_GUEST_QR,
      enabled: true,
    });

    const dto = await guest.resolveGuestMenu({
      opaqueToken: linkA.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    expect(JSON.stringify(dto)).not.toContain(fxB.tenantId);
    expect(JSON.stringify(dto)).not.toContain(fxB.outletId);
    expect(JSON.stringify(dto)).not.toContain(fx.tenantId);
  });

  it('9–10 — optional table label works; no-table token works', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const generic = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const table = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      tableRef: '12',
    });
    const g = await guest.resolveGuestMenu({
      opaqueToken: generic.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    const t = await guest.resolveGuestMenu({
      opaqueToken: table.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    expect(g.tableLabel).toBeNull();
    expect(t.tableLabel).toBe('12');
  });

  it('11–16 — internal UUIDs / provenance / recipe / COGS / supplier absent', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      tableRef: 'T-9',
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    assertAllowlistedDto(dto as unknown as Record<string, unknown>);
    const milkRef = createHash('sha256')
      .update(`${fx.tenantId}:${fx.milkItemId}`, 'utf8')
      .digest('hex')
      .slice(0, 16);
    expect(dto.items[0]!.publicItemRef).toBe(milkRef);
    expect(dto.items[0]!.publicItemRef).not.toBe(fx.milkItemId);
  });

  it('17–18 — guest cannot supply businessDateTime / tenant / outlet', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    for (const q of [
      `businessDateTime=${encodeURIComponent(LOCAL_SEPT17_0030)}`,
      `tenantId=${fx.tenantId}`,
      `outletId=${fx.outletId}`,
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/guest-menu/${link.opaqueToken}?${q}`,
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('19–20 — guest cannot create Order; public surface has no Payment/Tax/Fiscal write', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });

    const before = await pool.query<{ o: string; p: string }>(`
      SELECT
        (SELECT count(*)::text FROM sales_order) AS o,
        (SELECT count(*)::text FROM payment) AS p
    `);

    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    await registerDevGuestMenuAdminRoutes(app, pool);
    await registerPosRoutes(app, pool);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['referrer-policy']).toBe('no-referrer');
    expect(get.headers['cache-control']).toMatch(/no-store/);
    expect(get.headers['x-robots-tag']).toMatch(/noindex/);

    const postOrder = await app.inject({
      method: 'POST',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}`,
      payload: { createOrder: true },
    });
    expect(postOrder.statusCode).toBe(404);

    const routes = app.printRoutes();
    expect(routes).toContain('guest-menu');
    expect(routes).toContain('dev/');
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/v1/guest-menu/links',
      payload: { tenantId: fx.tenantId, outletId: fx.outletId },
    });
    expect(legacy.statusCode).toBe(404);
    expect(routes).not.toMatch(/public\/.*payment/i);
    expect(routes).not.toMatch(/public\/.*tax/i);
    expect(routes).not.toMatch(/public\/.*fiscal/i);
    expect(routes).not.toMatch(/public\/.*order/i);

    const after = await pool.query<{ o: string; p: string }>(`
      SELECT
        (SELECT count(*)::text FROM sales_order) AS o,
        (SELECT count(*)::text FROM payment) AS p
    `);
    expect(after.rows[0]!.o).toBe(before.rows[0]!.o);
    expect(after.rows[0]!.p).toBe(before.rows[0]!.p);
    await app.close();
  });

  it('21 — MenuPublication immutability unchanged via guest path', async () => {
    const pub = await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    await expect(
      menu.setMenuDefinitionItems({
        menuDefinitionId: (
          await pool.query<{ menu_definition_id: string }>(
            `SELECT menu_definition_id FROM menu_publication WHERE menu_publication_id = $1`,
            [pub.menuPublicationId],
          )
        ).rows[0]!.menu_definition_id,
        catalogItemIds: [fx.oilItemId],
      }),
    ).resolves.toBeTruthy();
    // Publication membership frozen — cannot mutate publication items
    const items = await pool.query(
      `SELECT catalog_item_id FROM menu_publication_item WHERE menu_publication_id = $1`,
      [pub.menuPublicationId],
    );
    expect(items.rows.map((r) => r.catalog_item_id)).toEqual([fx.milkItemId]);
  });

  it('22 — missing price never becomes zero', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    // no price rule
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTimeOverride: LOCAL_SEPT17_0030,
    });
    expect(dto.items[0]!.price).toEqual({ status: 'UNAVAILABLE' });
    expect(JSON.stringify(dto.items[0]!.price)).not.toContain('"0"');
  });

  it('23 — revoked / capability disable takes effect immediately (no stale cache)', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}`,
    });
    expect(ok.statusCode).toBe(200);

    await guest.linkService.revokeLink(link.publicMenuLinkId);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}`,
    });
    expect(afterRevoke.statusCode).toBe(404);

    const link2 = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const ok2 = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link2.opaqueToken}`,
    });
    expect(ok2.statusCode).toBe(200);
    await guest.linkService.setOutletCapability({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      capabilityKey: CAPABILITY_GUEST_QR,
      enabled: false,
    });
    const afterCap = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link2.opaqueToken}`,
    });
    expect(afterCap.statusCode).toBe(404);
    await app.close();
  });

  it('24 — response contains only allowlisted schema + security headers', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableFullCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}?lang=en`,
    });
    expect(res.statusCode).toBe(200);
    assertAllowlistedDto(res.json());
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['cache-control'])).toMatch(/no-store/);
    await app.close();
  });

  it('production NEVER registers /api/v1/dev/guest-menu/* even with ALLOW_DEV_GUEST_MENU_ADMIN=1', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_GUEST_MENU_ADMIN;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_GUEST_MENU_ADMIN = '1';

    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    await registerDevGuestMenuAdminRoutes(app, pool);

    const routes = app.printRoutes();
    expect(routes).not.toContain('guest-menu/links');
    expect(routes).not.toContain('guest-menu/capabilities');
    expect(routes).toContain('public/guest-menu');

    const endpoints = [
      { method: 'POST' as const, url: '/api/v1/dev/guest-menu/links', payload: { tenantId: fx.tenantId, outletId: fx.outletId } },
      {
        method: 'POST' as const,
        url: '/api/v1/dev/guest-menu/capabilities',
        payload: {
          tenantId: fx.tenantId,
          outletId: fx.outletId,
          capabilityKey: CAPABILITY_GUEST_QR,
          enabled: true,
        },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/dev/guest-menu/links/${randomUUID()}/revoke`,
        payload: {},
      },
      {
        method: 'POST' as const,
        url: `/api/v1/dev/guest-menu/links/${randomUUID()}/rotate`,
        payload: {},
      },
    ];
    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: ep.payload,
      });
      expect(res.statusCode, ep.url).toBe(404);
    }

    // Public read remains registered/reachable (may 404 on bad token — not 405).
    const pub = await app.inject({
      method: 'GET',
      url: '/api/v1/public/guest-menu/aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(pub.statusCode).toBe(404);
    expect(pub.json().error).toBe('PUBLIC_MENU_UNAVAILABLE');

    await app.close();
    process.env.NODE_ENV = prevEnv;
    if (prevFlag === undefined) delete process.env.ALLOW_DEV_GUEST_MENU_ADMIN;
    else process.env.ALLOW_DEV_GUEST_MENU_ADMIN = prevFlag;
  });
});
