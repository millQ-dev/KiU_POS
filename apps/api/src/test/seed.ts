import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export type BlockCFixture = {
  tenantId: string;
  legalEntityId: string;
  otherLegalEntityId: string;
  brandId: string;
  outletId: string;
  warehouseId: string;
  otherWarehouseId: string;
  supplierId: string;
  milkItemId: string;
  oilItemId: string;
  meatItemId: string;
  eggItemId: string;
  milkPackId: string;
  oilPackId: string;
  meatPackId: string;
  eggPackId: string;
  milkSupplierItemId: string;
  oilSupplierItemId: string;
  meatSupplierItemId: string;
  eggSupplierItemId: string;
  actorId: string;
};

export async function seedBlockCFixture(pool: pg.Pool): Promise<BlockCFixture> {
  const ids = {
    tenantId: randomUUID(),
    legalEntityId: randomUUID(),
    otherLegalEntityId: randomUUID(),
    brandId: randomUUID(),
    outletId: randomUUID(),
    warehouseId: randomUUID(),
    otherWarehouseId: randomUUID(),
    supplierId: randomUUID(),
    milkItemId: randomUUID(),
    oilItemId: randomUUID(),
    meatItemId: randomUUID(),
    eggItemId: randomUUID(),
    milkPackId: randomUUID(),
    oilPackId: randomUUID(),
    meatPackId: randomUUID(),
    eggPackId: randomUUID(),
    milkSupplierItemId: randomUUID(),
    oilSupplierItemId: randomUUID(),
    meatSupplierItemId: randomUUID(),
    eggSupplierItemId: randomUUID(),
    actorId: randomUUID(),
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO tenant (tenant_id, name) VALUES ($1, 'MillQ Demo')`, [ids.tenantId]);
    await client.query(`INSERT INTO legal_entity (legal_entity_id, tenant_id, name) VALUES ($1,$2,'LE A'), ($3,$2,'LE B')`, [
      ids.legalEntityId,
      ids.tenantId,
      ids.otherLegalEntityId,
    ]);
    await client.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Brand')`, [
      ids.brandId,
      ids.tenantId,
    ]);
    await client.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name) VALUES ($1,$2,$3,$4,'Outlet')`,
      [ids.outletId, ids.tenantId, ids.brandId, ids.legalEntityId],
    );
    await client.query(
      `INSERT INTO warehouse (warehouse_id, tenant_id, legal_entity_id, outlet_id, name) VALUES
        ($1,$2,$3,$4,'Kitchen'),
        ($5,$2,$6,NULL,'Other LE WH')`,
      [
        ids.warehouseId,
        ids.tenantId,
        ids.legalEntityId,
        ids.outletId,
        ids.otherWarehouseId,
        ids.otherLegalEntityId,
      ],
    );
    await client.query(
      `UPDATE outlet SET default_sales_issue_warehouse_id = $1 WHERE outlet_id = $2`,
      [ids.warehouseId, ids.outletId],
    );
    await client.query(`INSERT INTO supplier (supplier_id, tenant_id, name) VALUES ($1,$2,'Supplier A')`, [
      ids.supplierId,
      ids.tenantId,
    ]);

    await client.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension) VALUES
        ($1,$5,'Milk','L','VOLUME'),
        ($2,$5,'Oil','L','VOLUME'),
        ($3,$5,'Meat','kg','MASS'),
        ($4,$5,'Eggs','ea','COUNT')`,
      [ids.milkItemId, ids.oilItemId, ids.meatItemId, ids.eggItemId, ids.tenantId],
    );

    // Milk: 1 L bottle (units_per_package=1); receive N bottles → N L
    await client.query(
      `INSERT INTO supplier_pack (supplier_pack_id, tenant_id, name, pack_kind, units_per_package, unit_quantity, unit, dimension, to_base_unit, factor_per_unit)
       VALUES ($1,$2,'1L milk bottle','FIXED',1,'1','L','VOLUME','L','1')`,
      [ids.milkPackId, ids.tenantId],
    );
    // Oil: one supplier case = 12 × 0.75 L → 9 L when packageCount=1
    await client.query(
      `INSERT INTO supplier_pack (supplier_pack_id, tenant_id, name, pack_kind, units_per_package, unit_quantity, unit, dimension, to_base_unit, factor_per_unit)
       VALUES ($1,$2,'12x0.75L oil','FIXED',12,'0.75','L','VOLUME','L','1')`,
      [ids.oilPackId, ids.tenantId],
    );
    await client.query(
      `INSERT INTO supplier_pack (supplier_pack_id, tenant_id, name, pack_kind, units_per_package, dimension, to_base_unit)
       VALUES ($1,$2,'Variable meat','VARIABLE_WEIGHT',1,'MASS','kg')`,
      [ids.meatPackId, ids.tenantId],
    );
    await client.query(
      `INSERT INTO supplier_pack (supplier_pack_id, tenant_id, name, pack_kind, units_per_package, unit_quantity, unit, dimension, to_base_unit, factor_per_unit)
       VALUES ($1,$2,'Egg piece','COUNT',1,'1','ea','COUNT','ea','1')`,
      [ids.eggPackId, ids.tenantId],
    );

    await client.query(
      `INSERT INTO supplier_item (supplier_item_id, supplier_id, catalog_item_id, supplier_pack_id, external_sku, external_name) VALUES
        ($1,$5,$6,$7,'MILK-1L','Da Lat Fresh Milk 1L'),
        ($2,$5,$8,$9,'OIL-12','Oil case 12x0.75'),
        ($3,$5,$10,$11,'MEAT-VW','Meat packs'),
        ($4,$5,$12,$13,'EGG-EA','Eggs')`,
      [
        ids.milkSupplierItemId,
        ids.oilSupplierItemId,
        ids.meatSupplierItemId,
        ids.eggSupplierItemId,
        ids.supplierId,
        ids.milkItemId,
        ids.milkPackId,
        ids.oilItemId,
        ids.oilPackId,
        ids.meatItemId,
        ids.meatPackId,
        ids.eggItemId,
        ids.eggPackId,
      ],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return ids;
}
