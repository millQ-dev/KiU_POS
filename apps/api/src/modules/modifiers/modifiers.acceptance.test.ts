/**
 * ADR-0049 Modifier v1 — schema + configureOrderLine mandatory fail-closed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { OrdersService } from '../orders/orders-service.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { ModifiersService, ModifierDomainError } from './index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeModifiers = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

describeModifiers('ADR-0049 modifiers (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let orders: OrdersService;
  let modifiers: ModifiersService;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    modifiers = new ModifiersService(pool);
    const gi = new GoodsIssueService(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: gi });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE
        order_line_modifier_selection, order_line_configuration,
        modifier_option_recipe_delta, catalog_item_modifier_group,
        modifier_option, modifier_group,
        sales_order_line, sales_order,
        catalog_item, warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
  });

  it('migration exposes modifier tables and permissions', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'modifier_group','modifier_option','modifier_option_recipe_delta',
           'catalog_item_modifier_group','order_line_configuration','order_line_modifier_selection'
         )`,
    );
    expect(tables.rowCount).toBe(6);
    const perms = await pool.query(
      `SELECT permission_key FROM identity_permission
       WHERE permission_key IN ('menu.modifiers.configure','orders.line_configure')`,
    );
    expect(perms.rowCount).toBe(2);
  });

  it('required milk group cannot be skipped; oat selection stores additive price', async () => {
    const cappuccino = fx.milkItemId;
    const groupId = randomUUID();
    const optOat = randomUUID();
    await pool.query(
      `INSERT INTO modifier_group (
         modifier_group_id, tenant_id, code, name, selection_mode, min_select, max_select, ask_every_time
       ) VALUES ($1,$2,'milk','Milk','SINGLE',1,1,TRUE)`,
      [groupId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO modifier_option (
         modifier_option_id, tenant_id, modifier_group_id, code, name, sort_order, is_default, price_adjustment_minor,
         kitchen_instruction_code
       ) VALUES ($1,$2,$3,'oat','Oat milk',1,FALSE,'5000','MILK_OAT')`,
      [optOat, fx.tenantId, groupId],
    );
    await pool.query(
      `INSERT INTO catalog_item_modifier_group (
         catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
       ) VALUES ($1,$2,$3,$4,TRUE,1)`,
      [randomUUID(), fx.tenantId, cappuccino, groupId],
    );

    const opened = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    const withLine = await orders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: cappuccino,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
    });
    const lineId = withLine.lines[0]!.orderLineId;

    await expect(
      modifiers.configureOrderLine({
        orderId: opened.orderId,
        orderLineId: lineId,
        selections: [],
      }),
    ).rejects.toBeInstanceOf(ModifierDomainError);

    const ok = await modifiers.configureOrderLine({
      orderId: opened.orderId,
      orderLineId: lineId,
      selections: [{ modifierGroupId: groupId, modifierOptionId: optOat }],
    });
    expect(ok.additivePriceAdjustmentMinor).toBe('5000');
    expect(ok.kitchenInstructions).toContain('MILK_OAT');
    expect(ok.configurationFingerprint.length).toBe(64);
  });
});
