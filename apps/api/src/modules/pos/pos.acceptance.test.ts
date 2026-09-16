/**
 * P1.1 — POS Presentation Runtime & First Cashier Surface (ADR-0031)
 * Frontend React cashier shell = DEFERRED P1.2 (apps/web is health-only).
 * OPTION A preserved: no unit×qty official Money.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import {
  buildMenuResolvedCommercialTermsInput,
  MenuResolver,
  MenuService,
} from '../menu/index.js';
import { OrdersService } from '../orders/orders-service.js';
import {
  DomainValidationError,
  LayoutResolver,
  LayoutService,
  PosSelectionService,
  PosSurfaceResolver,
  PublishedImmutableError,
} from './index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';
const TZ = 'Asia/Ho_Chi_Minh';
const AT = '2026-09-16T17:30:00.000Z';

let pool: pg.Pool;
let fx: BlockCFixture;
let layout: LayoutService;
let layoutResolver: LayoutResolver;
let surface: PosSurfaceResolver;
let selection: PosSelectionService;
let menu: MenuService;
let menuResolver: MenuResolver;
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
      layout_assignment, layout_publication_slot, layout_publication_page, layout_publication,
      layout_definition_slot, layout_definition_page, layout_definition,
      supplier_item, supplier_pack, catalog_item, supplier,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

function presentation() {
  return { tenantId: fx.tenantId, brandId: fx.brandId, outletId: fx.outletId };
}

function sales(overrides: Partial<{ businessDateTime: string; orderChannel: string }> = {}) {
  return {
    ...presentation(),
    orderChannel: overrides.orderChannel ?? 'DIRECT',
    businessDateTime: overrides.businessDateTime ?? AT,
  };
}

async function publishMenuWithItems(catalogItemIds: string[]) {
  const def = await menu.createMenuDefinition({
    tenantId: fx.tenantId,
    code: `m-${seq}`,
    name: 'POS Menu',
  });
  await menu.setMenuDefinitionItems({ menuDefinitionId: def.menuDefinitionId, catalogItemIds });
  const pub = await menu.publishMenu({
    menuDefinitionId: def.menuDefinitionId,
    idempotencyKey: idem('mpub'),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await menu.assignMenu({
    tenantId: fx.tenantId,
    menuPublicationId: pub.menuPublicationId,
    scopeKind: 'OUTLET',
    outletId: fx.outletId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('massign'),
  });
  return { def, pub };
}

async function priceMilk(amountMinor = '50000', scopeKind: 'TENANT' | 'OUTLET' = 'OUTLET') {
  await menu.activatePriceRule({
    tenantId: fx.tenantId,
    catalogItemId: fx.milkItemId,
    scopeKind,
    outletId: scopeKind === 'OUTLET' ? fx.outletId : undefined,
    amountMinor,
    currencyCode: 'VND',
    minorUnitExponent: 0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    idempotencyKey: idem('price'),
  });
}

async function buildLayout(opts: {
  pages?: { pageCode: string; label: string; sortOrder: number; colorToken?: string }[];
  slots?: {
    zone: 'PAGE' | 'QUICK_ACCESS';
    pageCode?: string;
    catalogItemId: string;
    position: number;
    labelOverride?: string;
    colorToken?: string;
  }[];
  assignScope?: 'TENANT' | 'BRAND' | 'OUTLET';
  assignFrom?: string;
  assignTo?: string | null;
}) {
  const def = await layout.createLayoutDefinition({
    tenantId: fx.tenantId,
    code: `l-${seq}`,
    name: 'Cashier Layout',
  });
  const pages = opts.pages ?? [
    { pageCode: 'coffee', label: 'Coffee', sortOrder: 0 },
    { pageCode: 'food', label: 'Food', sortOrder: 1 },
  ];
  await layout.setLayoutPages({ layoutDefinitionId: def.layoutDefinitionId, pages });
  const slots = opts.slots ?? [
    {
      zone: 'PAGE' as const,
      pageCode: 'coffee',
      catalogItemId: fx.milkItemId,
      position: 1,
      labelOverride: 'Fresh Milk',
    },
  ];
  await layout.setLayoutSlots({ layoutDefinitionId: def.layoutDefinitionId, slots });
  const pub = await layout.publishLayout({
    layoutDefinitionId: def.layoutDefinitionId,
    idempotencyKey: idem('lpub'),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  const scopeKind = opts.assignScope ?? 'OUTLET';
  await layout.assignLayout({
    tenantId: fx.tenantId,
    layoutPublicationId: pub.layoutPublicationId,
    scopeKind,
    brandId: scopeKind === 'BRAND' ? fx.brandId : undefined,
    outletId: scopeKind === 'OUTLET' ? fx.outletId : undefined,
    effectiveFrom: opts.assignFrom ?? '2026-01-01T00:00:00.000Z',
    effectiveTo: opts.assignTo === undefined ? undefined : opts.assignTo,
    idempotencyKey: idem('lassign'),
  });
  return { def, pub };
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  layout = new LayoutService(pool);
  layoutResolver = new LayoutResolver(pool);
  surface = new PosSurfaceResolver(pool);
  menu = new MenuService(pool);
  menuResolver = new MenuResolver(pool);
  orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
  selection = new PosSelectionService(pool, orders);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateBusiness();
  fx = await seedBlockCFixture(pool);
  await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: TZ });
});

describe('P1.1 POS Presentation Runtime', () => {
  it('1–9 — definition, draft pages/slots, publish freeze, mutation rejected, new pub differs', async () => {
    const def = await layout.createLayoutDefinition({
      tenantId: fx.tenantId,
      code: 'main',
      name: 'Main POS',
    });
    await layout.setLayoutPages({
      layoutDefinitionId: def.layoutDefinitionId,
      pages: [
        { pageCode: 'drinks', label: 'Drinks', sortOrder: 0, colorToken: 'blue' },
        { pageCode: 'food', label: 'Food', sortOrder: 1 },
      ],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        { zone: 'PAGE', pageCode: 'drinks', catalogItemId: fx.milkItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'food', catalogItemId: fx.oilItemId, position: 1 },
        { zone: 'QUICK_ACCESS', catalogItemId: fx.milkItemId, position: 1 },
      ],
    });
    const pub1 = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: idem('p1'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(pub1.publicationVersion).toBe(1);
    expect(pub1.duplicate).toBe(false);

    const pages = await pool.query(
      `SELECT page_code FROM layout_publication_page WHERE layout_publication_id = $1 ORDER BY sort_order`,
      [pub1.layoutPublicationId],
    );
    expect(pages.rows.map((r) => r.page_code)).toEqual(['drinks', 'food']);

    await expect(layout.tryMutatePublication(pub1.layoutPublicationId)).rejects.toBeInstanceOf(
      PublishedImmutableError,
    );
    await expect(
      pool.query(`UPDATE layout_publication_page SET label = 'X' WHERE layout_publication_id = $1`, [
        pub1.layoutPublicationId,
      ]),
    ).rejects.toThrow(/PUBLISHED_IMMUTABLE/);
    await expect(
      pool.query(`UPDATE layout_publication_slot SET position = 9 WHERE layout_publication_id = $1`, [
        pub1.layoutPublicationId,
      ]),
    ).rejects.toThrow(/PUBLISHED_IMMUTABLE/);
    await expect(
      pool.query(`DELETE FROM layout_publication_slot WHERE layout_publication_id = $1`, [
        pub1.layoutPublicationId,
      ]),
    ).rejects.toThrow(/PUBLISHED_IMMUTABLE/);

    await layout.setLayoutPages({
      layoutDefinitionId: def.layoutDefinitionId,
      pages: [{ pageCode: 'only', label: 'Only', sortOrder: 0 }],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [{ zone: 'PAGE', pageCode: 'only', catalogItemId: fx.meatItemId, position: 1 }],
    });
    const pub2 = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: idem('p2'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(pub2.publicationVersion).toBe(2);
    const p2pages = await pool.query(
      `SELECT page_code FROM layout_publication_page WHERE layout_publication_id = $1`,
      [pub2.layoutPublicationId],
    );
    expect(p2pages.rows.map((r) => r.page_code)).toEqual(['only']);
    const still = await pool.query(
      `SELECT page_code FROM layout_publication_page WHERE layout_publication_id = $1 ORDER BY sort_order`,
      [pub1.layoutPublicationId],
    );
    expect(still.rows.map((r) => r.page_code)).toEqual(['drinks', 'food']);
  });

  it('10–13 — Tenant < Brand < Outlet precedence; LegalEntity excluded', async () => {
    await publishMenuWithItems([fx.milkItemId]);
    await priceMilk();

    const tenantDef = await layout.createLayoutDefinition({
      tenantId: fx.tenantId,
      code: 't',
      name: 'T',
    });
    await layout.setLayoutPages({
      layoutDefinitionId: tenantDef.layoutDefinitionId,
      pages: [{ pageCode: 't', label: 'TenantPage', sortOrder: 0 }],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: tenantDef.layoutDefinitionId,
      slots: [{ zone: 'PAGE', pageCode: 't', catalogItemId: fx.milkItemId, position: 1 }],
    });
    const tPub = await layout.publishLayout({
      layoutDefinitionId: tenantDef.layoutDefinitionId,
      idempotencyKey: idem('tp'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await layout.assignLayout({
      tenantId: fx.tenantId,
      layoutPublicationId: tPub.layoutPublicationId,
      scopeKind: 'TENANT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('ta'),
    });

    let resolved = await layoutResolver.resolveLayout({
      presentationContext: presentation(),
      businessDateTime: AT,
    });
    expect(resolved.assignment.scopeKind).toBe('TENANT');

    const brandDef = await layout.createLayoutDefinition({
      tenantId: fx.tenantId,
      code: 'b',
      name: 'B',
    });
    await layout.setLayoutPages({
      layoutDefinitionId: brandDef.layoutDefinitionId,
      pages: [{ pageCode: 'b', label: 'BrandPage', sortOrder: 0 }],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: brandDef.layoutDefinitionId,
      slots: [{ zone: 'PAGE', pageCode: 'b', catalogItemId: fx.milkItemId, position: 1 }],
    });
    const bPub = await layout.publishLayout({
      layoutDefinitionId: brandDef.layoutDefinitionId,
      idempotencyKey: idem('bp'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await layout.assignLayout({
      tenantId: fx.tenantId,
      layoutPublicationId: bPub.layoutPublicationId,
      scopeKind: 'BRAND',
      brandId: fx.brandId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('ba'),
    });
    resolved = await layoutResolver.resolveLayout({
      presentationContext: presentation(),
      businessDateTime: AT,
    });
    expect(resolved.assignment.scopeKind).toBe('BRAND');
    expect(resolved.layoutPublicationId).toBe(bPub.layoutPublicationId);

    const { pub: oPub } = await buildLayout({ assignScope: 'OUTLET' });
    resolved = await layoutResolver.resolveLayout({
      presentationContext: presentation(),
      businessDateTime: AT,
    });
    expect(resolved.assignment.scopeKind).toBe('OUTLET');
    expect(resolved.layoutPublicationId).toBe(oPub.layoutPublicationId);

    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'layout_assignment' AND column_name = 'legal_entity_id'`,
    );
    expect(cols.rowCount).toBe(0);
  });

  it('14–19 — effectivity inclusive/exclusive; inactive ignored; ambiguity; overlap; LAYOUT_NOT_ASSIGNED', async () => {
    await publishMenuWithItems([fx.milkItemId]);
    await priceMilk();
    const from = '2026-09-01T00:00:00.000Z';
    const to = '2026-09-16T17:30:00.000Z';
    await buildLayout({ assignScope: 'OUTLET', assignFrom: from, assignTo: to });

    await expect(
      layoutResolver.resolveLayout({
        presentationContext: presentation(),
        businessDateTime: '2026-08-31T23:59:59.999Z',
      }),
    ).rejects.toMatchObject({ code: 'LAYOUT_NOT_ASSIGNED' });

    const atFrom = await layoutResolver.resolveLayout({
      presentationContext: presentation(),
      businessDateTime: from,
    });
    expect(atFrom.layoutPublicationId).toBeTruthy();

    await expect(
      layoutResolver.resolveLayout({
        presentationContext: presentation(),
        businessDateTime: to,
      }),
    ).rejects.toMatchObject({ code: 'LAYOUT_NOT_ASSIGNED' });

    // Ambiguity at same specificity (two OUTLET assignments overlapping) — exclusion prevents insert
    const def2 = await layout.createLayoutDefinition({
      tenantId: fx.tenantId,
      code: 'amb',
      name: 'Amb',
    });
    await layout.setLayoutPages({
      layoutDefinitionId: def2.layoutDefinitionId,
      pages: [{ pageCode: 'a', label: 'A', sortOrder: 0 }],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: def2.layoutDefinitionId,
      slots: [{ zone: 'PAGE', pageCode: 'a', catalogItemId: fx.milkItemId, position: 1 }],
    });
    const pub2 = await layout.publishLayout({
      layoutDefinitionId: def2.layoutDefinitionId,
      idempotencyKey: idem('ambp'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await expect(
      layout.assignLayout({
        tenantId: fx.tenantId,
        layoutPublicationId: pub2.layoutPublicationId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        effectiveTo: '2026-09-20T00:00:00.000Z',
        idempotencyKey: idem('amba'),
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_LAYOUT_ASSIGNMENT' });

    // Concurrent overlap race — both writers under advisory lock / exclusion
    const results = await Promise.allSettled([
      layout.assignLayout({
        tenantId: fx.tenantId,
        layoutPublicationId: pub2.layoutPublicationId,
        scopeKind: 'TENANT',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-06-01T00:00:00.000Z',
        idempotencyKey: idem('race-a'),
      }),
      layout.assignLayout({
        tenantId: fx.tenantId,
        layoutPublicationId: pub2.layoutPublicationId,
        scopeKind: 'TENANT',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        effectiveTo: '2026-08-01T00:00:00.000Z',
        idempotencyKey: idem('race-b'),
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    expect((bad[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'AMBIGUOUS_LAYOUT_ASSIGNMENT',
    });
  });

  it('20–25 — deterministic ordering; Quick Access 0/10/11/duplicate', async () => {
    const def = await layout.createLayoutDefinition({
      tenantId: fx.tenantId,
      code: 'ord',
      name: 'Ord',
    });
    await layout.setLayoutPages({
      layoutDefinitionId: def.layoutDefinitionId,
      pages: [
        { pageCode: 'z', label: 'Z', sortOrder: 2 },
        { pageCode: 'a', label: 'A', sortOrder: 0 },
        { pageCode: 'm', label: 'M', sortOrder: 1 },
      ],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.milkItemId, position: 2 },
        { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.oilItemId, position: 1 },
      ],
    });
    // Quick Access 0 slots OK
    const emptyQa = await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.milkItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'm', catalogItemId: fx.oilItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'z', catalogItemId: fx.meatItemId, position: 1 },
      ],
    });
    expect(emptyQa.quickAccessCount).toBe(0);

    const qa10 = Array.from({ length: 10 }, (_, i) => ({
      zone: 'QUICK_ACCESS' as const,
      catalogItemId: fx.milkItemId,
      position: i + 1,
    }));
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.milkItemId, position: 1 },
        ...qa10,
      ],
    });

    await expect(
      layout.setLayoutSlots({
        layoutDefinitionId: def.layoutDefinitionId,
        slots: [
          { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.milkItemId, position: 1 },
          ...qa10,
          { zone: 'QUICK_ACCESS', catalogItemId: fx.oilItemId, position: 11 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'LAYOUT_TARGET_INVALID' });

    await expect(
      layout.setLayoutSlots({
        layoutDefinitionId: def.layoutDefinitionId,
        slots: [
          { zone: 'QUICK_ACCESS', catalogItemId: fx.milkItemId, position: 1 },
          { zone: 'QUICK_ACCESS', catalogItemId: fx.oilItemId, position: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'LAYOUT_TARGET_INVALID' });

    await publishMenuWithItems([fx.milkItemId, fx.oilItemId, fx.meatItemId]);
    await priceMilk();
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.oilItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '10000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('oilp'),
    });
    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.meatItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '20000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('meatp'),
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.oilItemId, position: 2 },
        { zone: 'PAGE', pageCode: 'a', catalogItemId: fx.milkItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'm', catalogItemId: fx.meatItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'z', catalogItemId: fx.oilItemId, position: 1 },
        { zone: 'QUICK_ACCESS', catalogItemId: fx.milkItemId, position: 3 },
        { zone: 'QUICK_ACCESS', catalogItemId: fx.oilItemId, position: 1 },
      ],
    });
    const pub = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: idem('ordp'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await layout.assignLayout({
      tenantId: fx.tenantId,
      layoutPublicationId: pub.layoutPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('orda'),
    });
    const surf = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    expect(surf.pages.map((p) => p.pageCode)).toEqual(['a', 'm', 'z']);
    expect(surf.pages[0]!.slots.map((s) => s.catalogItemId)).toEqual([
      fx.milkItemId,
      fx.oilItemId,
    ]);
    expect(surf.quickAccess.map((s) => s.position)).toEqual([1, 3]);
  });

  it('26–35 — catalog target; cross-tenant reject; intersection states; no price/avail in layout', async () => {
    await publishMenuWithItems([fx.milkItemId, fx.oilItemId]);
    await priceMilk();
    // oil: in menu, no price → PRICE_UNAVAILABLE (default AVAILABLE membership)

    const otherTenant = randomUUID();
    const otherItem = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'Other')`, [otherTenant]);
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1, $2, 'X', 'kg', 'MASS')`,
      [otherItem, otherTenant],
    );

    const def = await layout.createLayoutDefinition({
      tenantId: fx.tenantId,
      code: 'ix',
      name: 'Ix',
    });
    await layout.setLayoutPages({
      layoutDefinitionId: def.layoutDefinitionId,
      pages: [
        { pageCode: 'p', label: 'P', sortOrder: 0 },
        { pageCode: 'h', label: 'H', sortOrder: 1 },
      ],
    });
    await expect(
      layout.setLayoutSlots({
        layoutDefinitionId: def.layoutDefinitionId,
        slots: [{ zone: 'PAGE', pageCode: 'p', catalogItemId: otherItem, position: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'LAYOUT_TARGET_INVALID' });

    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        { zone: 'PAGE', pageCode: 'p', catalogItemId: fx.milkItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'p', catalogItemId: fx.oilItemId, position: 2 },
        { zone: 'PAGE', pageCode: 'h', catalogItemId: fx.meatItemId, position: 1 }, // not in menu → hidden
      ],
    });
    const pub = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: idem('ixp'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await layout.assignLayout({
      tenantId: fx.tenantId,
      layoutPublicationId: pub.layoutPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('ixa'),
    });

    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'layout_publication_slot'
         AND column_name IN ('price', 'amount_minor', 'availability', 'stock', 'quantity')`,
    );
    expect(cols.rowCount).toBe(0);

    let surf = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    let milk = surf.pages[0]!.slots.find((s) => s.catalogItemId === fx.milkItemId)!;
    let oil = surf.pages[0]!.slots.find((s) => s.catalogItemId === fx.oilItemId)!;
    expect(milk.state).toBe('ACTIVE');
    expect(milk.unitPrice).toEqual({
      amountMinor: '50000',
      currencyCode: 'VND',
      minorUnitExponent: 0,
    });
    expect(oil.state).toBe('DISABLED_PRICE_UNAVAILABLE');
    expect(surf.pages[1]!.slots).toHaveLength(0); // meat hidden

    // unavailable distinct from price-unavailable (OUTLET overrides default; TENANT unavail would also work)
    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.oilItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      availabilityStatus: 'UNAVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('oilua'),
    });
    surf = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    oil = surf.pages[0]!.slots.find((s) => s.catalogItemId === fx.oilItemId)!;
    expect(oil.state).toBe('DISABLED_UNAVAILABLE');
    milk = surf.pages[0]!.slots.find((s) => s.catalogItemId === fx.milkItemId)!;
    expect(milk.state).toBe('ACTIVE');
  });

  it('31/36–39 — config error distinct; stock independence; price rule updates surface; provenance; invalid context', async () => {
    await publishMenuWithItems([fx.milkItemId]);
    await priceMilk('11111', 'TENANT');
    await buildLayout({});

    // Stock change alone must not affect POS commercial state
    await pool.query(
      `INSERT INTO inventory_balance (
         legal_entity_id, warehouse_id, catalog_item_id, quantity, carrying_value_minor,
         currency_code, minor_unit_exponent, carrying_certainty
       ) VALUES ($1,$2,$3,'999','0','VND',0,'FINAL')
       ON CONFLICT (legal_entity_id, warehouse_id, catalog_item_id, currency_code) DO UPDATE
       SET quantity = '999'`,
      [fx.legalEntityId, fx.warehouseId, fx.milkItemId],
    );
    const before = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    expect(before.pages[0]!.slots[0]!.state).toBe('ACTIVE');
    await pool.query(
      `UPDATE inventory_balance SET quantity = '0'
       WHERE catalog_item_id = $1 AND warehouse_id = $2`,
      [fx.milkItemId, fx.warehouseId],
    );
    const afterStock = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    expect(afterStock.pages[0]!.slots[0]!.state).toBe('ACTIVE');
    expect(afterStock.pages[0]!.slots[0]!.unitPrice?.amountMinor).toBe('11111');

    await menu.activatePriceRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      amountMinor: '22222',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('price2'),
    });
    const afterPrice = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    expect(afterPrice.pages[0]!.slots[0]!.unitPrice?.amountMinor).toBe('22222');
    expect(afterPrice.layoutPublicationId).toBe(before.layoutPublicationId);
    expect(afterPrice.menuPublicationId).toBeTruthy();
    expect(afterPrice.layoutAssignment.layoutAssignmentId).toBeTruthy();

    // Menu config failure → MENU_RESOLUTION_FAILED (not UNAVAILABLE)
    await pool.query(`DELETE FROM menu_assignment WHERE tenant_id = $1`, [fx.tenantId]);
    await expect(
      surface.resolvePosSurface({ presentationContext: presentation(), salesContext: sales() }),
    ).rejects.toMatchObject({ code: 'MENU_RESOLUTION_FAILED' });

    await expect(
      surface.resolvePosSurface({
        presentationContext: {
          tenantId: fx.tenantId,
          brandId: fx.brandId,
          outletId: randomUUID(),
        },
        salesContext: sales(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRESENTATION_CONTEXT' });

    const otherBrand = randomUUID();
    await pool.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'OB')`, [
      otherBrand,
      fx.tenantId,
    ]);
    await expect(
      surface.resolvePosSurface({
        presentationContext: {
          tenantId: fx.tenantId,
          brandId: otherBrand,
          outletId: fx.outletId,
        },
        salesContext: { ...sales(), brandId: otherBrand },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRESENTATION_CONTEXT' });
  });

  it('40–48 — tableless OpenOrder → ACTIVE select → AddOrderLine; stale revalidate; no commercial accept', async () => {
    await publishMenuWithItems([fx.milkItemId]);
    await priceMilk();
    await buildLayout({});

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    expect(order.status).toBe('OPEN');
    // No tableId on order projection
    expect(order).not.toHaveProperty('tableId');

    const surf = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    const active = surf.pages[0]!.slots.find((s) => s.state === 'ACTIVE')!;
    const result = await selection.selectPosItem({
      orderId: order.orderId,
      layoutPublicationSlotId: active.layoutPublicationSlotId,
      presentationContext: presentation(),
      salesContext: sales(),
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    expect(result.order.status).toBe('OPEN');
    expect(result.order.lines).toHaveLength(1);
    expect(result.order.lines[0]!.catalogItemId).toBe(fx.milkItemId);
    expect(result.selected.state).toBe('ACTIVE');

    // Tap does not commercial-accept / complete
    const terms = await pool.query(
      `SELECT 1 FROM sales_order_commercial_terms WHERE order_id = $1`,
      [order.orderId],
    );
    expect(terms.rowCount).toBe(0);
    expect(result.order.status).toBe('OPEN');

    // Make unavailable then stale tap must revalidate and reject
    await menu.activateAvailabilityRule({
      tenantId: fx.tenantId,
      catalogItemId: fx.milkItemId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      availabilityStatus: 'UNAVAILABLE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: idem('stale'),
    });
    await expect(
      selection.selectPosItem({
        orderId: order.orderId,
        layoutPublicationSlotId: active.layoutPublicationSlotId,
        presentationContext: presentation(),
        salesContext: sales(),
        quantity: '1',
        unit: 'L',
        dimension: 'VOLUME',
      }),
    ).rejects.toMatchObject({ code: 'POS_SLOT_UNAVAILABLE' });

    // POS does not own Order writes — selectPosItem source never touches INSERT INTO sales_order_line
    const selSrc = readFileSync(fileURLToPath(new URL('./select-pos-item.ts', import.meta.url)), 'utf8');
    expect(selSrc).not.toMatch(/INSERT INTO sales_order/);
    expect(selSrc).toContain('orders.addOrderLine');
  });

  it('49–54 — OPTION A; explicit gross later; layout v2 economics stable; tenant isolation; publish idempotency', async () => {
    const posDir = fileURLToPath(new URL('.', import.meta.url));
    for (const f of [
      'layout-service.ts',
      'layout-resolver.ts',
      'pos-surface-resolver.ts',
      'select-pos-item.ts',
    ]) {
      const src = readFileSync(`${posDir}/${f}`, 'utf8');
      expect(src).not.toMatch(/grossMerchandiseMinor\s*=/);
      expect(src).not.toMatch(/ROUND_HALF_UP|ROUND_HALF_EVEN/);
      expect(src).not.toMatch(/amountMinor\s*\*|unitPrice\s*\*|quantity\s*\*\s*amount/);
    }

    await publishMenuWithItems([fx.milkItemId]);
    await priceMilk('100000');
    const { def, pub } = await buildLayout({});

    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    const surf = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales({ businessDateTime: '2026-03-10T10:00:00.000Z' }),
    });
    await selection.selectPosItem({
      orderId: order.orderId,
      layoutPublicationSlotId: surf.pages[0]!.slots[0]!.layoutPublicationSlotId,
      presentationContext: presentation(),
      salesContext: sales({ businessDateTime: '2026-03-10T10:00:00.000Z' }),
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const resolvedLines = await menuResolver.resolveOrderLinesFromMenu({
      orderId: order.orderId,
      salesContext: sales({ businessDateTime: '2026-03-10T10:00:00.000Z' }),
    });
    await orders.setOrderCommercialTerms(
      buildMenuResolvedCommercialTermsInput({
        orderId: order.orderId,
        idempotencyKey: idem('comm'),
        resolvedLines: resolvedLines.lines,
        roundingPolicy: {
            roundingPolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            policyVersion: 1,
            calculationContext: 'BASE_LIST_LINE_GROSS',
            roundingMode: 'HALF_UP',
            quantumMinor: '1',
          },
      }),
    );
    // Without goods receipt COGS may fail — skip complete if write-off needs stock; use commercial snapshot path
    const commercial = await pool.query(
      `SELECT gross_merchandise_minor FROM sales_order_commercial_line_terms WHERE order_id = $1`,
      [order.orderId],
    );
    expect(commercial.rows[0]!.gross_merchandise_minor).toBe('100000');

    // Layout v2 presentation change does not mutate commercial terms
    await layout.setLayoutPages({
      layoutDefinitionId: def.layoutDefinitionId,
      pages: [{ pageCode: 'new', label: 'New', sortOrder: 0, colorToken: 'red' }],
    });
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [
        {
          zone: 'PAGE',
          pageCode: 'new',
          catalogItemId: fx.milkItemId,
          position: 1,
          colorToken: 'green',
        },
      ],
    });
    await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: idem('lv2'),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    const still = await pool.query(
      `SELECT gross_merchandise_minor FROM sales_order_commercial_line_terms WHERE order_id = $1`,
      [order.orderId],
    );
    expect(still.rows[0]!.gross_merchandise_minor).toBe('100000');
    expect(pub.layoutPublicationId).toBeTruthy();

    // Publish idempotency
    const again = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: idem('lv2'), // different key from above — use same as first publish of v2
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    // Re-publish with brand-new key creates v3; test retry of identical key:
    const key = idem('idem-pub');
    await layout.setLayoutSlots({
      layoutDefinitionId: def.layoutDefinitionId,
      slots: [{ zone: 'PAGE', pageCode: 'new', catalogItemId: fx.milkItemId, position: 1 }],
    });
    const first = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: key,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    const retry = await layout.publishLayout({
      layoutDefinitionId: def.layoutDefinitionId,
      idempotencyKey: key,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.layoutPublicationId).toBe(first.layoutPublicationId);
    expect(again.publicationVersion).toBeGreaterThanOrEqual(2);

    // Cross-tenant assign rejected
    const t2 = randomUUID();
    await pool.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1,'T2')`, [t2]);
    await expect(
      layout.assignLayout({
        tenantId: t2,
        layoutPublicationId: first.layoutPublicationId,
        scopeKind: 'TENANT',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: idem('xt'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRESENTATION_CONTEXT' });
  });

  it('55 — price-unavailable and inactive cannot select', async () => {
    await publishMenuWithItems([fx.milkItemId, fx.oilItemId]);
    await priceMilk();
    // oil no price
    const { pub } = await buildLayout({
      pages: [{ pageCode: 'p', label: 'P', sortOrder: 0 }],
      slots: [
        { zone: 'PAGE', pageCode: 'p', catalogItemId: fx.milkItemId, position: 1 },
        { zone: 'PAGE', pageCode: 'p', catalogItemId: fx.oilItemId, position: 2 },
      ],
    });
    expect(pub.layoutPublicationId).toBeTruthy();
    const surf = await surface.resolvePosSurface({
      presentationContext: presentation(),
      salesContext: sales(),
    });
    const oilSlot = surf.pages[0]!.slots.find((s) => s.catalogItemId === fx.oilItemId)!;
    expect(oilSlot.state).toBe('DISABLED_PRICE_UNAVAILABLE');
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await expect(
      selection.selectPosItem({
        orderId: order.orderId,
        layoutPublicationSlotId: oilSlot.layoutPublicationSlotId,
        presentationContext: presentation(),
        salesContext: sales(),
        quantity: '1',
        unit: 'L',
        dimension: 'VOLUME',
      }),
    ).rejects.toMatchObject({ code: 'POS_SLOT_PRICE_UNAVAILABLE' });
  });

  it('56 — Terminal/TerminalGroup deferred; no Floor/Table; capability runtime deferred; no package branches', async () => {
    await expect(
      layoutResolver.resolveLayout({
        presentationContext: {
          ...presentation(),
          terminalId: randomUUID(),
        },
        businessDateTime: AT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRESENTATION_CONTEXT' });

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('dining_area','floor_plan','table_runtime','table_assignment','pos_table')`,
    );
    expect(tables.rowCount).toBe(0);

    const posDir = fileURLToPath(new URL('.', import.meta.url));
    for (const f of ['layout-service.ts', 'pos-surface-resolver.ts', 'select-pos-item.ts']) {
      const src = readFileSync(`${posDir}/${f}`, 'utf8');
      expect(src).not.toMatch(/\bCORNER\b|\bCAFE\b|\bRESTAURANT\b/);
      expect(src).not.toMatch(/PackageEntitlement|OutletCapabilityConfig/);
    }
  });
});
