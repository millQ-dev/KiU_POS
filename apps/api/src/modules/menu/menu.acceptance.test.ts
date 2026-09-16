/**
 * M1.1 — Menu Configuration & Resolution Runtime (ADR-0029)
 * OPTION A: Menu resolves UNIT price only; grossMerchandiseMinor is explicit caller input.
 * NO commercial Money×Quantity rounding.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import {
  buildMenuResolvedCommercialTermsInput,
  DomainValidationError,
  localBusinessDateIso,
  MenuResolver,
  MenuService,
  PublishedImmutableError,
} from './index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const TZ = 'Asia/Ho_Chi_Minh';

/** Local 2026-09-17 00:30 +07 = 2026-09-16T17:30:00.000Z */
const LOCAL_SEPT17_0030 = '2026-09-16T17:30:00.000Z';
/** Local 2026-09-16 23:30 +07 = 2026-09-16T16:30:00.000Z */
const LOCAL_SEPT16_2330 = '2026-09-16T16:30:00.000Z';

let pool: pg.Pool;
let fx: BlockCFixture;
let menu: MenuService;
let resolver: MenuResolver;
let orders: OrdersService;
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
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function setTz() {
  await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: TZ });
}

async function publishDefault(catalogItemIds: string[]) {
  const def = await menu.createMenuDefinition({
    tenantId: fx.tenantId,
    code: `m-${seq}`,
    name: 'Test Menu',
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
  return { def, pub };
}

function ctx(overrides: Partial<{ businessDateTime: string; orderChannel: string; brandId: string }> = {}) {
  return {
    tenantId: fx.tenantId,
    brandId: overrides.brandId ?? fx.brandId,
    outletId: fx.outletId,
    orderChannel: overrides.orderChannel ?? 'DIRECT',
    businessDateTime: overrides.businessDateTime ?? LOCAL_SEPT17_0030,
  };
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  menu = new MenuService(pool);
  resolver = new MenuResolver(pool);
  orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateBusiness();
  fx = await seedBlockCFixture(pool);
  await setTz();
});

describe('M1.1 Menu Configuration & Resolution Runtime', () => {
  it('1–5 — create definition, publish immutable publication, freeze membership, new pub can differ', async () => {
    const def = await menu.createMenuDefinition({
      tenantId: fx.tenantId,
      code: 'main',
      name: 'Main',
    });
    await menu.setMenuDefinitionItems({
      menuDefinitionId: def.menuDefinitionId,
      catalogItemIds: [fx.milkItemId],
    });
    const pub1 = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: idem('p1'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(pub1.publicationVersion).toBe(1);
    expect(pub1.catalogItemIds).toEqual([fx.milkItemId]);

    await expect(menu.tryMutatePublicationMembership(pub1.menuPublicationId, fx.oilItemId)).rejects.toBeInstanceOf(
      PublishedImmutableError,
    );
    await expect(
      pool.query(`DELETE FROM menu_publication_item WHERE menu_publication_id = $1`, [
        pub1.menuPublicationId,
      ]),
    ).rejects.toThrow(/PUBLISHED_IMMUTABLE/);
    await expect(
      pool.query(`UPDATE menu_publication SET published_at = NOW() WHERE menu_publication_id = $1`, [
        pub1.menuPublicationId,
      ]),
    ).rejects.toThrow(/PUBLISHED_IMMUTABLE/);

    // Membership still frozen after draft edit
    await menu.setMenuDefinitionItems({
      menuDefinitionId: def.menuDefinitionId,
      catalogItemIds: [fx.milkItemId, fx.oilItemId],
    });
    const frozen = await pool.query<{ catalog_item_id: string }>(
      `SELECT catalog_item_id FROM menu_publication_item WHERE menu_publication_id = $1`,
      [pub1.menuPublicationId],
    );
    expect(frozen.rows.map((r) => r.catalog_item_id)).toEqual([fx.milkItemId]);

    await expect(
      pool.query(
        `INSERT INTO menu_publication_item (menu_publication_item_id, tenant_id, menu_publication_id, catalog_item_id)
         VALUES ($1,$2,$3,$4)`,
        [randomUUID(), fx.tenantId, pub1.menuPublicationId, fx.oilItemId],
      ),
    ).rejects.toThrow(/PUBLISHED_IMMUTABLE/);

    const pub2 = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: idem('p2'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(pub2.publicationVersion).toBe(2);
    expect(pub2.catalogItemIds.sort()).toEqual([fx.milkItemId, fx.oilItemId].sort());

    const same = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: 'retry-same-key',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(same.publicationVersion).toBe(3);

    const dup = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: 'retry-same-key',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.menuPublicationId).toBe(same.menuPublicationId);
  });

  it('6–11 — Tenant < Brand < Outlet precedence; LegalEntity ignored', async () => {
    const { pub: pubTenant } = await publishDefault([fx.milkItemId]);
    const { pub: pubBrand } = await publishDefault([fx.milkItemId, fx.oilItemId]);
    const { pub: pubOutlet } = await publishDefault([fx.meatItemId]);

    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pubTenant.menuPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('a-t'),
    });
    let resolved = await resolver.resolveMenu({ salesContext: ctx() });
    expect(resolved.menuPublicationId).toBe(pubTenant.menuPublicationId);

    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pubBrand.menuPublicationId,
      scopeKind: 'BRAND',
      brandId: fx.brandId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('a-b'),
    });
    resolved = await resolver.resolveMenu({ salesContext: ctx() });
    expect(resolved.menuPublicationId).toBe(pubBrand.menuPublicationId);

    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pubOutlet.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('a-o'),
    });
    resolved = await resolver.resolveMenu({ salesContext: ctx() });
    expect(resolved.menuPublicationId).toBe(pubOutlet.menuPublicationId);
    expect(resolved.items.map((i) => i.catalogItemId)).toEqual([fx.meatItemId]);

    // LegalEntity change must not alter winner — no legal_entity on assignment
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'menu_assignment' AND column_name = 'legal_entity_id'`,
    );
    expect(cols.rowCount).toBe(0);

    // Same outlet, other LE does not create alternate assignment path
    await pool.query(`UPDATE outlet SET legal_entity_id = $1 WHERE outlet_id = $2`, [
      fx.otherLegalEntityId,
      fx.outletId,
    ]);
    const afterLe = await resolver.resolveMenu({ salesContext: ctx() });
    expect(afterLe.menuPublicationId).toBe(pubOutlet.menuPublicationId);
  });

  it('12–15 — effectiveFrom inclusive / effectiveTo exclusive; overlap ambiguous', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    const from = '2026-09-17T00:00:00.000Z';
    const to = '2026-09-18T00:00:00.000Z';
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: from,
      effectiveTo: to,
      idempotencyKey: idem('eff'),
    });

    await expect(
      resolver.resolveMenu({ salesContext: ctx({ businessDateTime: '2026-09-16T23:59:59.999Z' }) }),
    ).rejects.toMatchObject({ code: 'MENU_NOT_ASSIGNED' });

    const atFrom = await resolver.resolveMenu({
      salesContext: ctx({ businessDateTime: from }),
    });
    expect(atFrom.menuPublicationId).toBe(pub.menuPublicationId);

    const inside = await resolver.resolveMenu({
      salesContext: ctx({ businessDateTime: '2026-09-17T12:00:00.000Z' }),
    });
    expect(inside.menuPublicationId).toBe(pub.menuPublicationId);

    await expect(
      resolver.resolveMenu({ salesContext: ctx({ businessDateTime: to }) }),
    ).rejects.toMatchObject({ code: 'MENU_NOT_ASSIGNED' });

    await expect(
      menu.assignMenu({
        tenantId: fx.tenantId,
        menuPublicationId: pub.menuPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-09-17T12:00:00.000Z',
        effectiveTo: '2026-09-19T00:00:00.000Z',
        idempotencyKey: idem('overlap'),
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_MENU_ASSIGNMENT' });
  });

  it('16–20 — default AVAILABLE; explicit unavailable; specificity; stock ignored', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('av'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr'),
    });

    let item = await resolver.resolveMenuItem({
      salesContext: ctx(),
      catalogItemId: fx.milkItemId,
    });
    expect(item.availabilityStatus).toBe('AVAILABLE');
    expect(item.availabilityProvenance.source).toBe('DEFAULT_MEMBERSHIP');

    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      availabilityStatus: 'UNAVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('unav'),
    });
    item = await resolver.resolveMenuItem({ salesContext: ctx(), catalogItemId: fx.milkItemId });
    expect(item.availabilityStatus).toBe('UNAVAILABLE');

    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      availabilityStatus: 'AVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('av-out'),
    });
    item = await resolver.resolveMenuItem({ salesContext: ctx(), catalogItemId: fx.milkItemId });
    expect(item.availabilityStatus).toBe('AVAILABLE');
    expect(item.availabilityProvenance.source).toBe('AVAILABILITY_RULE');

    // Fake stock balance must not affect menu availability
    await pool.query(
      `INSERT INTO inventory_balance (
         tenant_id, legal_entity_id, warehouse_id, catalog_item_id,
         quantity_on_hand, quantity_reserved, carrying_amount_minor_units,
         currency_code, minor_unit_exponent, carrying_certainty
       ) VALUES ($1,$2,$3,$4,'0','0','0','VND',0,'FINAL')
       ON CONFLICT DO NOTHING`,
      [fx.tenantId, fx.legalEntityId, fx.warehouseId, fx.milkItemId],
    ).catch(async () => {
      // schema may differ — ensure SELECT path never joins balance in resolver
      const bal = await pool.query(`SELECT to_regclass('inventory_balance') AS t`);
      expect(bal.rows[0]?.t).toBeTruthy();
    });
    item = await resolver.resolveMenuItem({ salesContext: ctx(), catalogItemId: fx.milkItemId });
    expect(item.availabilityStatus).toBe('AVAILABLE');

    await expect(
      menu.activateAvailabilityRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        availabilityStatus: 'UNAVAILABLE',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: idem('amb-av'),
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_AVAILABILITY_RULE' });
  });

  it('21–29 — PriceRule Money; missing ≠ zero; precedence; channel; currency', async () => {
    const { pub } = await publishDefault([fx.milkItemId, fx.oilItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr-a'),
    });

    const milk = await resolver.resolveMenuItem({
      salesContext: ctx(),
      catalogItemId: fx.milkItemId,
    });
    expect(milk.price.status).toBe('PRICE_UNAVAILABLE');

    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '50000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr-t'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr-o'),
    });
    let item = await resolver.resolveMenuItem({ salesContext: ctx(), catalogItemId: fx.milkItemId });
    expect(item.price.status).toBe('RESOLVED');
    if (item.price.status === 'RESOLVED') {
      expect(item.price.quote.resolvedUnitPriceMinor).toBe('100000');
      expect(item.price.quote.currencyCode).toBe('VND');
      expect(item.price.quote.minorUnitExponent).toBe(0);
      expect(item.price.quote.priceRuleId).toBeTruthy();
    }

    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.oilItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '20000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      orderChannel: 'DELIVERY',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('pr-ch'),
    });
    const oilDirect = await resolver.resolveMenuItem({
      salesContext: ctx({ orderChannel: 'DIRECT' }),
      catalogItemId: fx.oilItemId,
    });
    expect(oilDirect.price.status).toBe('PRICE_UNAVAILABLE');
    const oilDel = await resolver.resolveMenuItem({
      salesContext: ctx({ orderChannel: 'DELIVERY' }),
      catalogItemId: fx.oilItemId,
    });
    expect(oilDel.price.status).toBe('RESOLVED');

    await expect(
      menu.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '99999',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: idem('pr-amb'),
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_PRICE_RULE' });
  });

  it('30–31 — Outlet IANA timezone + positive-offset UTC-boundary (no toISOString date slice)', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    // Effective from local Sept 17 00:00 +07 = 2026-09-16T17:00:00Z
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-09-16T17:00:00.000Z',
      idempotencyKey: idem('tz'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('tz-pr'),
    });

    const before = await expect(
      resolver.resolveMenu({ salesContext: ctx({ businessDateTime: LOCAL_SEPT16_2330 }) }),
    ).rejects.toMatchObject({ code: 'MENU_NOT_ASSIGNED' });
    void before;

    const atLocal0030 = await resolver.resolveMenu({
      salesContext: ctx({ businessDateTime: LOCAL_SEPT17_0030 }),
    });
    expect(atLocal0030.localBusinessDate).toBe('2026-09-17');
    // Forbidden anti-pattern would yield 2026-09-16 from UTC:
    expect(new Date(LOCAL_SEPT17_0030).toISOString().slice(0, 10)).toBe('2026-09-16');
    expect(atLocal0030.localBusinessDate).not.toBe(
      new Date(LOCAL_SEPT17_0030).toISOString().slice(0, 10),
    );
    expect(localBusinessDateIso(new Date(LOCAL_SEPT17_0030), TZ)).toBe('2026-09-17');
  });

  it('32–35 — invalid context + cross-tenant rejected', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('xt'),
    });

    await expect(
      resolver.resolveMenu({
        salesContext: {
          tenantId: randomUUID(),
          brandId: fx.brandId,
          outletId: fx.outletId,
          orderChannel: 'DIRECT',
          businessDateTime: LOCAL_SEPT17_0030,
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SALES_CONTEXT' });

    const otherBrand = randomUUID();
    await pool.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Other')`, [
      otherBrand,
      fx.tenantId,
    ]);
    await expect(
      resolver.resolveMenu({ salesContext: ctx({ brandId: otherBrand }) }),
    ).rejects.toMatchObject({ code: 'INVALID_SALES_CONTEXT' });

    const otherTenant = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1,'X')`, [otherTenant]);
    await expect(
      menu.activatePriceRule({
        tenantId: otherTenant,
        catalogItemId: fx.milkItemId,
        scopeKind: 'TENANT',
        amountMinor: '1',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: idem('xt-pr'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SALES_CONTEXT' });

    await expect(
      menu.assignMenu({
        tenantId: otherTenant,
        menuPublicationId: pub.menuPublicationId,
        scopeKind: 'TENANT',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: idem('xt-as'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SALES_CONTEXT' });
  });

  it('36–39 — resolveMenu provenance; resolveMenuItem same kernel', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    const asg = await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('prov'),
    });
    const pr = await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'BRAND',
      brandId: fx.brandId,
      amountMinor: '77777',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('prov-pr'),
    });

    const menuRes = await resolver.resolveMenu({ salesContext: ctx() });
    expect(menuRes.menuPublicationId).toBe(pub.menuPublicationId);
    expect(menuRes.menuAssignmentId).toBe(asg.menuAssignmentId);

    const item = await resolver.resolveMenuItem({
      salesContext: ctx(),
      catalogItemId: fx.milkItemId,
    });
    expect(item.menuPublicationId).toBe(menuRes.menuPublicationId);
    expect(item.price.status).toBe('RESOLVED');
    if (item.price.status === 'RESOLVED') {
      expect(item.price.quote.priceRuleId).toBe(pr.priceRuleId);
      expect(item.price.quote.menuAssignmentId).toBe(asg.menuAssignmentId);
      expect(item.availabilityProvenance.source).toBe('DEFAULT_MEMBERSHIP');
    }
  });

  it('40–51 — Orders explicit-gross integration; no silent reprice; line mutation', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('ord-a'),
    });
    const pr1 = await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '100000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-09-17T00:00:00.000Z',
      idempotencyKey: idem('ord-pr'),
    });
    void pr1;
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '120000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-09-17T00:00:00.000Z',
      idempotencyKey: idem('ord-pr2'),
    });

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '2',
      unit: 'L',
      dimension: 'VOLUME',
    });

    const resolved = await resolver.resolveOrderLinesFromMenu({
      orderId: order.orderId,
      salesContext: ctx({ businessDateTime: '2026-09-16T12:00:00.000Z' }),
    });
    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0]!.quantity).toBe('2');
    expect(resolved.lines[0]!.resolvedUnitPriceMinor).toBe('100000');

    // OPTION A: caller supplies explicitCommercialGrossMinor — NOT derived by M1.1
    const explicitCommercialGrossMinor = '200000';
    const termsInput = buildMenuResolvedCommercialTermsInput({
      orderId: order.orderId,
      idempotencyKey: idem('terms'),
      resolvedLines: resolved.lines,
      explicitLineCommercialAmounts: [
        {
          orderLineId: resolved.lines[0]!.orderLineId,
          grossMerchandiseMinor: explicitCommercialGrossMinor,
        },
      ],
    });
    expect(termsInput.lineTerms[0]!.grossMerchandiseMinor).toBe(explicitCommercialGrossMinor);
    expect(termsInput.lineTerms[0]!.resolvedUnitPriceMinor).toBe('100000');
    expect(JSON.stringify(termsInput)).toContain('EXPLICIT_GROSS_ONLY');

    await orders.setOrderCommercialTerms(termsInput);

    // New price window active — accepted OPEN terms must NOT silently mutate
    const termsStill = await pool.query<{
      resolved_unit_price_minor: string;
      gross_merchandise_minor: string;
    }>(
      `SELECT resolved_unit_price_minor, gross_merchandise_minor
       FROM sales_order_commercial_line_terms WHERE order_id = $1`,
      [order.orderId],
    );
    expect(termsStill.rows[0]!.gross_merchandise_minor).toBe('200000');
    expect(termsStill.rows[0]!.resolved_unit_price_minor).toBe('100000');

    // Explicit reprice: new unit quote + caller supplies new explicit gross
    const reResolved = await resolver.resolveOrderLinesFromMenu({
      orderId: order.orderId,
      salesContext: ctx({ businessDateTime: '2026-09-17T01:00:00.000Z' }),
    });
    expect(reResolved.lines[0]!.resolvedUnitPriceMinor).toBe('120000');
    const explicitRepriceGrossMinor = '240000';
    await orders.setOrderCommercialTerms(
      buildMenuResolvedCommercialTermsInput({
        orderId: order.orderId,
        idempotencyKey: idem('reprice'),
        resolvedLines: reResolved.lines,
        explicitLineCommercialAmounts: [
          {
            orderLineId: reResolved.lines[0]!.orderLineId,
            grossMerchandiseMinor: explicitRepriceGrossMinor,
          },
        ],
      }),
    );
    const afterReprice = await pool.query<{
      gross_merchandise_minor: string;
      resolved_unit_price_minor: string;
    }>(
      `SELECT gross_merchandise_minor, resolved_unit_price_minor
       FROM sales_order_commercial_line_terms WHERE order_id = $1`,
      [order.orderId],
    );
    expect(afterReprice.rows[0]!.gross_merchandise_minor).toBe('240000');
    expect(afterReprice.rows[0]!.resolved_unit_price_minor).toBe('120000');

    // Line mutation invalidates terms
    await orders.updateOrderLine({
      orderId: order.orderId,
      orderLineId: reResolved.lines[0]!.orderLineId,
      quantity: '3',
    });
    await expect(
      orders.completeOrder({
        orderId: order.orderId,
        idempotencyKey: idem('stale'),
        businessDate: '2026-09-17',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_TERMS_REQUIRED' });

    // Re-resolution restores path for re-acceptance (quantity preserved; unit price still 120000)
    const restored = await resolver.resolveOrderLinesFromMenu({
      orderId: order.orderId,
      salesContext: ctx({ businessDateTime: '2026-09-17T01:00:00.000Z' }),
    });
    expect(restored.lines[0]!.quantity).toBe('3');
    expect(restored.lines[0]!.resolvedUnitPriceMinor).toBe('120000');
    await orders.setOrderCommercialTerms(
      buildMenuResolvedCommercialTermsInput({
        orderId: order.orderId,
        idempotencyKey: idem('restore'),
        resolvedLines: restored.lines,
        explicitLineCommercialAmounts: [
          {
            orderLineId: restored.lines[0]!.orderLineId,
            grossMerchandiseMinor: '360000',
          },
        ],
      }),
    );
  });

  it('41–43 — absent / unavailable / price-unavailable reject commercial resolution', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('fail'),
    });

    const orderAbsent = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: orderAbsent.orderId,
      catalogItemId: fx.oilItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await expect(
      resolver.resolveOrderLinesFromMenu({ orderId: orderAbsent.orderId, salesContext: ctx() }),
    ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' });

    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('fail-pr'),
    });
    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      availabilityStatus: 'UNAVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('fail-av'),
    });
    const orderUnav = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: orderUnav.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '0.333333333333',
      unit: 'L',
      dimension: 'VOLUME',
    });
    // Fractional qty still resolves unit price path until availability fails
    await expect(
      resolver.resolveOrderLinesFromMenu({ orderId: orderUnav.orderId, salesContext: ctx() }),
    ).rejects.toMatchObject({ code: 'ITEM_UNAVAILABLE' });

    // Price unavailable: membership + available, no rule — use fresh publication without price
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    await setTz();
    const { pub: pubNoPrice } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pubNoPrice.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('fail-np'),
    });
    const orderNoPrice = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: orderNoPrice.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '0.5',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await expect(
      resolver.resolveOrderLinesFromMenu({ orderId: orderNoPrice.orderId, salesContext: ctx() }),
    ).rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });

  it('44 — fractional MASS/VOLUME: unit price resolves; M1.1 never computes gross', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('frac'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('frac-pr'),
    });
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '0.333333333333',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const resolved = await resolver.resolveOrderLinesFromMenu({
      orderId: order.orderId,
      salesContext: ctx(),
    });
    expect(resolved.lines[0]!.resolvedUnitPriceMinor).toBe('10000');
    expect(resolved.lines[0]!.quantity).toBe('0.333333333333');
    // Static invariant: helper source must not multiply
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./order-commercial-from-menu.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/resolvedUnitPriceMinor\s*\*|quantity.*amountMinor|amountMinor.*quantity/);
    expect(src).toContain('MUST NOT compute');
  });

  it('45 — one Order currency enforced', async () => {
    const { pub } = await publishDefault([fx.milkItemId, fx.oilItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('cur'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'TENANT',
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('cur-v'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.oilItemId,
      scopeKind: 'TENANT',
      amountMinor: '100',
      currencyCode: 'USD',
      minorUnitExponent: 2,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('cur-u'),
    });
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.oilItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    await expect(
      resolver.resolveOrderLinesFromMenu({ orderId: order.orderId, salesContext: ctx() }),
    ).rejects.toMatchObject({ code: 'ORDER_COMMERCIAL_CURRENCY_MISMATCH' });
  });

  it('47 — Menu module does not write sales_order_commercial_terms', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./menu-resolver.ts', import.meta.url), 'utf8'),
    );
    const svc = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./menu-service.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/INSERT INTO sales_order_commercial/);
    expect(svc).not.toMatch(/INSERT INTO sales_order_commercial/);
  });

  it('52 — CompleteOrder does not invoke MenuResolver', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../orders/orders-service.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/MenuResolver|resolveMenu|resolveOrderLinesFromMenu/);
  });

  it('OUTLET_TIMEZONE_REQUIRED when timezone missing', async () => {
    await pool.query(`UPDATE outlet SET timezone = NULL WHERE outlet_id = $1`, [fx.outletId]);
    const { pub } = await publishDefault([fx.milkItemId]);
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('notz'),
    });
    await expect(resolver.resolveMenu({ salesContext: ctx() })).rejects.toMatchObject({
      code: 'OUTLET_TIMEZONE_REQUIRED',
    });
  });

  it('channel wildcard vs specific same-scope overlap rejected at write', async () => {
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('ch-global'),
    });
    await expect(
      menu.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId: fx.milkItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor: '20000',
        currencyCode: 'VND',
        minorUnitExponent: 0,
        orderChannel: 'DIRECT',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: idem('ch-direct'),
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_PRICE_RULE' });
  });

  it('MENU_PUBLICATION_NOT_EFFECTIVE when publication outside interval', async () => {
    const def = await menu.createMenuDefinition({
      tenantId: fx.tenantId,
      code: 'eff-pub',
      name: 'Eff',
    });
    await menu.setMenuDefinitionItems({
      menuDefinitionId: def.menuDefinitionId,
      catalogItemIds: [fx.milkItemId],
    });
    const pub = await menu.publishMenu({
      menuDefinitionId: def.menuDefinitionId,
      idempotencyKey: idem('eff-pub'),
      effectiveFrom: '2026-10-01T00:00:00.000Z',
      effectiveTo: '2026-11-01T00:00:00.000Z',
    });
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('eff-asg'),
    });
    await expect(resolver.resolveMenu({ salesContext: ctx() })).rejects.toMatchObject({
      code: 'MENU_PUBLICATION_NOT_EFFECTIVE',
    });
  });

  it('concurrency — overlapping assignment activation rejects', async () => {
    const { pub } = await publishDefault([fx.milkItemId]);
    const a = menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2027-01-01T00:00:00.000Z',
      idempotencyKey: idem('c1'),
    });
    const b = menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: pub.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      effectiveTo: '2027-06-01T00:00:00.000Z',
      idempotencyKey: idem('c2'),
    });
    const results = await Promise.allSettled([a, b]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const fail = rejected[0]!;
    expect(fail.status).toBe('rejected');
    if (fail.status === 'rejected') {
      expect((fail.reason as DomainValidationError).code).toBe('AMBIGUOUS_MENU_ASSIGNMENT');
    }
  });
});
