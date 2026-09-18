/**
 * Guest QR Menu — read-only public surface acceptance (A–F).
 * Reuses MenuResolver / DIRECT; no Order/Payment/Fiscal writes on GET.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { MenuService } from '../menu/index.js';
import { CAPABILITY_GUEST_QR, GuestMenuProjectionService } from './index.js';
import { registerGuestMenuRoutes } from '../../routes/guest-menu.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const TZ = 'Asia/Ho_Chi_Minh';
const LOCAL_SEPT17_0030 = '2026-09-16T17:30:00.000Z';

let pool: pg.Pool;
let fx: BlockCFixture;
let menu: MenuService;
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
      public_menu_link, outlet_capability_config,
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

async function enableCapability() {
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

function assertPublicDtoSafe(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/cogs|COGS|recipe|supplier|margin|profit|employee|warehouse/i);
  expect(json).not.toContain(fx.tenantId);
  expect(json).not.toContain(fx.outletId);
  expect(json).not.toContain(fx.brandId);
  expect(json).not.toContain(fx.milkItemId);
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  menu = new MenuService(pool);
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

describe('Guest QR Menu read-only surface', () => {
  it('A — opaque token resolve / invalid / revoked / cross-tenant isolation', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableCapability();
    await priceMilk('15000');

    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      language: 'en',
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dto.outlet.name.length).toBeGreaterThan(0);
    expect(dto.items.length).toBe(1);

    await expect(guest.resolveGuestMenu({ opaqueToken: 'not-a-valid-token!!!!' })).rejects.toMatchObject({
      code: 'PUBLIC_MENU_TOKEN_INVALID',
    });
    await expect(
      guest.resolveGuestMenu({ opaqueToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    ).rejects.toMatchObject({ code: 'PUBLIC_MENU_TOKEN_INVALID' });

    await guest.linkService.revokeLink(link.publicMenuLinkId);
    await expect(guest.resolveGuestMenu({ opaqueToken: link.opaqueToken })).rejects.toMatchObject({
      code: 'PUBLIC_MENU_TOKEN_REVOKED',
    });

    // Tenant B fixture
    const fxB = await seedBlockCFixture(pool);
    await menu.setOutletTimezone({ tenantId: fxB.tenantId, outletId: fxB.outletId, timezone: TZ });
    // re-seed wiped nothing — wait, seed creates NEW tenant without truncate. Need separate approach.
    // Use second outlet under same DB: create tenant B rows manually via another seed after NOT truncating A.
    // seedBlockCFixture inserts new tenant — both coexist.
    const defB = await menu.createMenuDefinition({
      tenantId: fxB.tenantId,
      code: 'b-menu',
      name: 'B',
    });
    await menu.setMenuDefinitionItems({
      menuDefinitionId: defB.menuDefinitionId,
      catalogItemIds: [fxB.milkItemId],
    });
    const pubB = await menu.publishMenu({
      menuDefinitionId: defB.menuDefinitionId,
      idempotencyKey: idem('pub-b'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await menu.assignMenu({
      tenantId: fxB.tenantId,
      menuPublicationId: pubB.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fxB.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('asg-b'),
    });
    await guest.linkService.setOutletCapability({
      tenantId: fxB.tenantId,
      outletId: fxB.outletId,
      capabilityKey: CAPABILITY_GUEST_QR,
      enabled: true,
    });
    await menu.activatePriceRule({
      tenantId: fxB.tenantId,
      catalogItemId: fxB.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '99999',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr-b'),
    });
    const linkB = await guest.linkService.createLink({
      tenantId: fxB.tenantId,
      outletId: fxB.outletId,
    });
    const dtoB = await guest.resolveGuestMenu({
      opaqueToken: linkB.opaqueToken,
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dtoB.items[0]!.price).toMatchObject({ status: 'AVAILABLE', amountMinor: '99999' });
    // Token A (revoked) still cannot resolve; token B cannot be used to see tenant A ids
    assertPublicDtoSafe(dtoB as unknown as Record<string, unknown>);
    expect(JSON.stringify(dtoB)).not.toContain(fx.tenantId);
  });

  it('B — published visible; unpublished invisible; price/availability from MenuResolver', async () => {
    const pub = await publishAndAssign([fx.milkItemId]);
    await enableCapability();
    await priceMilk('22000');
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.oilItemId,
      scopeKind: 'TENANT',
      amountMinor: '5000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr-oil'),
    });

    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]!.price).toEqual({
      status: 'AVAILABLE',
      amountMinor: '22000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(dto.menuPublicationVersion).toBe(pub.publicationVersion);

    const oilRef = createHash('sha256')
      .update(`${fx.tenantId}:${fx.oilItemId}`, 'utf8')
      .digest('hex')
      .slice(0, 16);
    expect(dto.items.map((i) => i.publicItemRef)).not.toContain(oilRef);

    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      availabilityStatus: 'UNAVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('unav'),
    });
    const dto2 = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dto2.items[0]!.availability).toBe('UNAVAILABLE');
  });

  it('C — later PriceRule changes guest output; accepted commercial terms unchanged', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableCapability();
    await priceMilk('10000', '2026-01-01T00:00:00.000Z', LOCAL_SEPT17_0030);

    const { OrdersService } = await import('../orders/orders-service.js');
    const { GoodsIssueService } = await import('../inventory/goods-issue-service.js');
    const {
      MenuResolver,
      buildMenuResolvedCommercialTermsInput,
    } = await import('../menu/index.js');
    const orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    const resolver = new MenuResolver(pool);

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    // Resolve just before cutover so first price still applies
    const beforeCutover = '2026-09-16T17:29:00.000Z';
    const priced = await resolver.resolveOrderLinesFromMenu({
      orderId: order.orderId,
      salesContext: {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
        orderChannel: 'DIRECT',
        businessDateTime: beforeCutover,
      },
    });
    expect(priced.lines[0]!.resolvedUnitPriceMinor).toBe('10000');
    await orders.setOrderCommercialTerms(
      buildMenuResolvedCommercialTermsInput({
        orderId: order.orderId,
        idempotencyKey: idem('terms'),
        resolvedLines: priced.lines,
        roundingPolicy: {
          roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          policyVersion: 1,
          calculationContext: 'BASE_LIST_LINE_GROSS',
          roundingMode: 'HALF_UP',
          quantumMinor: '1',
        },
      }),
    );

    await priceMilk('77777', LOCAL_SEPT17_0030);

    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dto.items[0]!.price).toMatchObject({ amountMinor: '77777' });

    const terms = await pool.query<{ resolved_unit_price_minor: string }>(
      `SELECT resolved_unit_price_minor FROM sales_order_commercial_line_terms WHERE order_id = $1`,
      [order.orderId],
    );
    expect(terms.rowCount).toBeGreaterThan(0);
    expect(terms.rows[0]!.resolved_unit_price_minor).toBe('10000');
  });

  it('D — generic outlet QR and optional tableRef', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableCapability();
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
      businessDateTime: LOCAL_SEPT17_0030,
    });
    const t = await guest.resolveGuestMenu({
      opaqueToken: table.opaqueToken,
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(g.tableRef).toBeNull();
    expect(t.tableRef).toBe('12');
    expect(g.items.length).toBe(t.items.length);
  });

  it('E — response omits cost/supplier/recipe/employee/internal ids', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableCapability();
    await priceMilk('10000');
    const mediaId = randomUUID();
    await pool.query(
      `INSERT INTO presentation_media_asset
         (media_asset_id, tenant_id, storage_key, public_url, mime_type, status)
       VALUES ($1,$2,'k','https://cdn.example/milk.jpg','image/jpeg','ACTIVE')`,
      [mediaId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO catalog_item_presentation
         (catalog_item_id, locale, name, description, media_asset_id)
       VALUES ($1,'en','Fresh Milk','Cold milk',$2),
              ($1,'ru','Свежее молоко','Холодное',$2)`,
      [fx.milkItemId, mediaId],
    );
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: link.opaqueToken,
      language: 'ru',
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dto.language).toBe('ru');
    expect(dto.items[0]!.name).toBe('Свежее молоко');
    expect(dto.items[0]!.imageUrl).toBe('https://cdn.example/milk.jpg');
    assertPublicDtoSafe(dto as unknown as Record<string, unknown>);
  });

  it('F — GET guest menu creates zero Orders / Payments / Fiscal docs', async () => {
    await publishAndAssign([fx.milkItemId]);
    await enableCapability();
    await priceMilk('10000');
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });

    const before = await pool.query<{
      orders: string;
      payments: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM sales_order) AS orders,
        (SELECT count(*)::text FROM payment) AS payments
    `);

    const app = Fastify();
    await registerGuestMenuRoutes(app, pool);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/guest-menu/${link.opaqueToken}?lang=en`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    assertPublicDtoSafe(body);
    await app.close();

    const after = await pool.query<{
      orders: string;
      payments: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM sales_order) AS orders,
        (SELECT count(*)::text FROM payment) AS payments
    `);
    expect(after.rows[0]!.orders).toBe(before.rows[0]!.orders);
    expect(after.rows[0]!.payments).toBe(before.rows[0]!.payments);

    const fiscalTables = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%fiscal%'
    `);
    for (const t of fiscalTables.rows) {
      const c = await pool.query(`SELECT count(*)::int AS n FROM ${t.table_name}`);
      expect(c.rows[0]!.n).toBe(0);
    }
  });

  it('capability disabled fails closed; rotate invalidates old token', async () => {
    await publishAndAssign([fx.milkItemId]);
    await priceMilk('10000');
    // capability off
    const link = await guest.linkService.createLink({
      tenantId: fx.tenantId,
      outletId: fx.outletId,
    });
    await expect(guest.resolveGuestMenu({ opaqueToken: link.opaqueToken })).rejects.toMatchObject({
      code: 'GUEST_MENU_CAPABILITY_DISABLED',
    });

    await enableCapability();
    const rotated = await guest.linkService.rotateLink(link.publicMenuLinkId);
    await expect(guest.resolveGuestMenu({ opaqueToken: link.opaqueToken })).rejects.toMatchObject({
      code: 'PUBLIC_MENU_TOKEN_REVOKED',
    });
    const dto = await guest.resolveGuestMenu({
      opaqueToken: rotated.opaqueToken,
      businessDateTime: LOCAL_SEPT17_0030,
    });
    expect(dto.items).toHaveLength(1);
  });
});
