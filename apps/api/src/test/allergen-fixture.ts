import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { BlockCFixture } from './seed.js';

export type AllergenFixture = {
  latteItemId: string;
  coffeeItemId: string;
  oatDrinkItemId: string;
  milkItemId: string;
  milkGroupId: string;
  dairyOptionId: string;
  oatOptionId: string;
};

/**
 * Latte = coffee + milk (MILK CONTAINS). A required milk modifier group offers a
 * dairy option (no delta) and an oat option (REPLACE milk → oat drink). Kitchen policy permits
 * MILK modification with handling code CLEAN_STEAM_WAND.
 */
export async function seedAllergenFixture(
  pool: pg.Pool,
  fx: BlockCFixture,
): Promise<AllergenFixture> {
  const ids: AllergenFixture = {
    latteItemId: randomUUID(),
    coffeeItemId: randomUUID(),
    oatDrinkItemId: randomUUID(),
    milkItemId: fx.milkItemId,
    milkGroupId: randomUUID(),
    dairyOptionId: randomUUID(),
    oatOptionId: randomUUID(),
  };
  await pool.query(
    `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension) VALUES
      ($1,$4,'Latte','ea','COUNT'),
      ($2,$4,'Coffee beans','kg','MASS'),
      ($3,$4,'Oat drink','L','VOLUME')`,
    [ids.latteItemId, ids.coffeeItemId, ids.oatDrinkItemId, fx.tenantId],
  );
  const recipeSpecId = randomUUID();
  const recipeVersionId = randomUUID();
  await pool.query(
    `INSERT INTO recipe_specification (recipe_specification_id, tenant_id, name) VALUES ($1,$2,'Latte')`,
    [recipeSpecId, fx.tenantId],
  );
  await pool.query(
    `INSERT INTO recipe_version (
       recipe_version_id, recipe_specification_id, version_number, status,
       batch_size_quantity, batch_size_unit, batch_size_dimension, published_at
     ) VALUES ($1,$2,1,'PUBLISHED','1','ea','COUNT', NOW())`,
    [recipeVersionId, recipeSpecId],
  );
  await pool.query(
    `INSERT INTO recipe_component (
       recipe_component_id, recipe_version_id, line_number, component_kind, catalog_item_id,
       quantity, unit, dimension
     ) VALUES
      ($1,$3,1,'CATALOG_ITEM',$4,'0.018','kg','MASS'),
      ($2,$3,2,'CATALOG_ITEM',$5,'0.2','L','VOLUME')`,
    [randomUUID(), randomUUID(), recipeVersionId, ids.coffeeItemId, ids.milkItemId],
  );
  await pool.query(
    `INSERT INTO catalog_item_recipe_profile (
       catalog_item_recipe_profile_id, tenant_id, catalog_item_id, recipe_specification_id
     ) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), fx.tenantId, ids.latteItemId, recipeSpecId],
  );

  for (const leaf of [ids.coffeeItemId, ids.oatDrinkItemId, ids.milkItemId]) {
    await pool.query(
      `INSERT INTO catalog_item_allergen_profile (catalog_item_id, tenant_id, declaration_status)
       VALUES ($1,$2,'COMPLETE')
       ON CONFLICT (catalog_item_id) DO UPDATE
         SET declaration_status = 'COMPLETE', updated_at = NOW()`,
      [leaf, fx.tenantId],
    );
  }
  await pool.query(
    `INSERT INTO catalog_item_allergen_declaration (catalog_item_id, tenant_id, allergen_code, exposure)
     VALUES ($1,$2,'MILK','CONTAINS')`,
    [ids.milkItemId, fx.tenantId],
  );
  await pool.query(
    `INSERT INTO allergen_kitchen_handling_policy (tenant_id, allergen_code, modification_permitted, handling_code)
     VALUES ($1,'MILK',TRUE,'CLEAN_STEAM_WAND')`,
    [fx.tenantId],
  );

  await pool.query(
    `INSERT INTO modifier_group (
       modifier_group_id, tenant_id, code, name, selection_mode, min_select, max_select, ask_every_time
     ) VALUES ($1,$2,'milk','Milk','SINGLE',1,1,TRUE)`,
    [ids.milkGroupId, fx.tenantId],
  );
  await pool.query(
    `INSERT INTO modifier_option (
       modifier_option_id, tenant_id, modifier_group_id, code, name, sort_order, price_adjustment_minor,
       kitchen_instruction_code
     ) VALUES
      ($1,$3,$4,'dairy','Dairy milk',1,'0','MILK_DAIRY'),
      ($2,$3,$4,'oat','Oat drink',2,'5000','MILK_OAT')`,
    [ids.dairyOptionId, ids.oatOptionId, fx.tenantId, ids.milkGroupId],
  );
  await pool.query(
    `INSERT INTO modifier_option_recipe_delta (
       modifier_option_recipe_delta_id, tenant_id, modifier_option_id, delta_kind,
       target_catalog_item_id, replacement_catalog_item_id
     ) VALUES ($1,$2,$3,'REPLACE_COMPONENT',$4,$5)`,
    [randomUUID(), fx.tenantId, ids.oatOptionId, ids.milkItemId, ids.oatDrinkItemId],
  );
  await pool.query(
    `INSERT INTO catalog_item_modifier_group (
       catalog_item_modifier_group_id, tenant_id, catalog_item_id, modifier_group_id, required, sort_order
     ) VALUES ($1,$2,$3,$4,TRUE,1)`,
    [randomUUID(), fx.tenantId, ids.latteItemId, ids.milkGroupId],
  );
  return ids;
}
