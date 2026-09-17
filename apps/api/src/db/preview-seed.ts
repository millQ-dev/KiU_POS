import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { MenuService } from '../modules/menu/menu-service.js';
import { LayoutService } from '../modules/pos/layout-service.js';

const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  legalEntity: '20000000-0000-4000-8000-000000000002',
  brand: '20000000-0000-4000-8000-000000000003',
  outlet: '20000000-0000-4000-8000-000000000004',
  warehouse: '20000000-0000-4000-8000-000000000005',
  cappuccino: '20000000-0000-4000-8000-000000000011',
  americano: '20000000-0000-4000-8000-000000000012',
  croissant: '20000000-0000-4000-8000-000000000013',
  sandwich: '20000000-0000-4000-8000-000000000014',
  water: '20000000-0000-4000-8000-000000000015',
  sizeGroup: '20000000-0000-4000-8000-000000000021',
  milkGroup: '20000000-0000-4000-8000-000000000022',
  sizeMedium: '20000000-0000-4000-8000-000000000031',
  sizeLarge: '20000000-0000-4000-8000-000000000032',
  milkRegular: '20000000-0000-4000-8000-000000000033',
  milkOat: '20000000-0000-4000-8000-000000000034',
} as const;

const priceByItem = [
  [ids.cappuccino, '65000'],
  [ids.americano, '55000'],
  [ids.croissant, '45000'],
  [ids.sandwich, '95000'],
  [ids.water, '25000'],
] as const;

export async function seedPreviewFixture(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'KiU Vietnam Preview')`, [ids.tenant]);
    await client.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code)
       VALUES ($1,$2,'KiU Vietnam Preview LLC','VN')`,
      [ids.legalEntity, ids.tenant],
    );
    await client.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Little Saigon Cafe')`, [
      ids.brand,
      ids.tenant,
    ]);
    await client.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Thao Dien Counter')`,
      [ids.outlet, ids.tenant, ids.brand, ids.legalEntity],
    );
    await client.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name)
       VALUES ($1,$2,$3,$4,'Thao Dien Kitchen')`,
      [ids.warehouse, ids.tenant, ids.legalEntity, ids.outlet],
    );
    await client.query(`UPDATE outlet SET default_sales_issue_warehouse_id = $1 WHERE outlet_id = $2`, [
      ids.warehouse,
      ids.outlet,
    ]);
    await client.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension, requires_production)
       VALUES
         ($1,$6,'Cappuccino','ea','COUNT',TRUE),
         ($2,$6,'Americano','ea','COUNT',TRUE),
         ($3,$6,'Croissant','ea','COUNT',TRUE),
         ($4,$6,'Chicken Sandwich','ea','COUNT',TRUE),
         ($5,$6,'Water','ea','COUNT',FALSE)`,
      [ids.cappuccino, ids.americano, ids.croissant, ids.sandwich, ids.water, ids.tenant],
    );
    await client.query(`UPDATE outlet SET timezone = 'Asia/Ho_Chi_Minh' WHERE outlet_id = $1`, [ids.outlet]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await pool.query(
    `INSERT INTO modifier_group (modifier_group_id, tenant_id, code, label)
     VALUES ($1,$3,'SIZE','Size'), ($2,$3,'MILK','Milk')`,
    [ids.sizeGroup, ids.milkGroup, ids.tenant],
  );
  await pool.query(
    `INSERT INTO modifier_option
       (modifier_option_id, modifier_group_id, label, price_delta_minor, currency_code, minor_unit_exponent, position)
     VALUES
       ($1,$5,'Medium','0','VND',0,1),
       ($2,$5,'Large','10000','VND',0,2),
       ($3,$6,'Regular','0','VND',0,1),
       ($4,$6,'Oat','10000','VND',0,2)`,
    [ids.sizeMedium, ids.sizeLarge, ids.milkRegular, ids.milkOat, ids.sizeGroup, ids.milkGroup],
  );
  await pool.query(
    `INSERT INTO catalog_item_modifier_group
       (catalog_item_id, modifier_group_id, position, min_selections, max_selections)
     VALUES
       ($1,$2,1,1,1),
       ($1,$3,2,0,1)`,
    [ids.cappuccino, ids.sizeGroup, ids.milkGroup],
  );

  const menu = new MenuService(pool);
  const menuDefinition = await menu.createMenuDefinition({
    tenantId: ids.tenant,
    code: 'preview-main',
    name: 'Preview Main Menu',
  });
  await menu.setMenuDefinitionItems({
    menuDefinitionId: menuDefinition.menuDefinitionId,
    catalogItemIds: [ids.cappuccino, ids.americano, ids.croissant, ids.sandwich, ids.water],
  });
  const menuPublication = await menu.publishMenu({
    menuDefinitionId: menuDefinition.menuDefinitionId,
    idempotencyKey: 'preview-menu-v1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await menu.assignMenu({
    tenantId: ids.tenant,
    menuPublicationId: menuPublication.menuPublicationId,
    scopeKind: 'OUTLET',
    outletId: ids.outlet,
    idempotencyKey: 'preview-menu-assignment-v1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  for (const [catalogItemId, amountMinor] of priceByItem) {
    await menu.activatePriceRule({
      tenantId: ids.tenant,
      catalogItemId,
      scopeKind: 'OUTLET',
      outletId: ids.outlet,
      amountMinor,
      currencyCode: 'VND',
      minorUnitExponent: 0,
      orderChannel: 'DIRECT',
      idempotencyKey: `preview-price-${catalogItemId}`,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
  }

  const layout = new LayoutService(pool);
  const layoutDefinition = await layout.createLayoutDefinition({
    tenantId: ids.tenant,
    code: 'preview-counter',
    name: 'Preview Counter',
  });
  await layout.setLayoutPages({
    layoutDefinitionId: layoutDefinition.layoutDefinitionId,
    pages: [
      { pageCode: 'COFFEE', label: 'Coffee', sortOrder: 1, colorToken: 'amber' },
      { pageCode: 'FOOD', label: 'Food', sortOrder: 2, colorToken: 'coral' },
    ],
  });
  await layout.setLayoutSlots({
    layoutDefinitionId: layoutDefinition.layoutDefinitionId,
    slots: [
      { zone: 'QUICK_ACCESS', catalogItemId: ids.cappuccino, position: 1, labelOverride: 'Cappuccino' },
      { zone: 'QUICK_ACCESS', catalogItemId: ids.americano, position: 2, labelOverride: 'Americano' },
      { zone: 'QUICK_ACCESS', catalogItemId: ids.croissant, position: 3, labelOverride: 'Croissant' },
      { zone: 'PAGE', pageCode: 'COFFEE', catalogItemId: ids.cappuccino, position: 1 },
      { zone: 'PAGE', pageCode: 'COFFEE', catalogItemId: ids.americano, position: 2 },
      { zone: 'PAGE', pageCode: 'FOOD', catalogItemId: ids.croissant, position: 1 },
      { zone: 'PAGE', pageCode: 'FOOD', catalogItemId: ids.sandwich, position: 2 },
      { zone: 'PAGE', pageCode: 'FOOD', catalogItemId: ids.water, position: 3 },
    ],
  });
  const layoutPublication = await layout.publishLayout({
    layoutDefinitionId: layoutDefinition.layoutDefinitionId,
    idempotencyKey: 'preview-layout-v1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  await layout.assignLayout({
    tenantId: ids.tenant,
    layoutPublicationId: layoutPublication.layoutPublicationId,
    scopeKind: 'OUTLET',
    outletId: ids.outlet,
    idempotencyKey: 'preview-layout-assignment-v1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });

  console.log(JSON.stringify({ fixture: 'preview-v1', tenantId: ids.tenant, outletId: ids.outlet }));
}
