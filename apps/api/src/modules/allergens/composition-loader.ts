import type { Pool, PoolClient } from 'pg';
import type {
  Composition,
  KitchenHandlingPolicy,
  LeafAllergenProfile,
} from './allergen-resolution.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

type ComponentRow = {
  component_kind: 'CATALOG_ITEM' | 'PREPARATION_VERSION';
  catalog_item_id: string | null;
  nested_preparation_version_id: string | null;
};

const MAX_PREPARATION_DEPTH = 16;

const UNKNOWN_COMPOSITION: Composition = { known: false, leafIds: [] };

async function expandPreparation(
  q: Queryable,
  preparationVersionId: string,
  stack: readonly string[],
  out: string[],
): Promise<boolean> {
  if (stack.length >= MAX_PREPARATION_DEPTH || stack.includes(preparationVersionId)) return false;
  const prep = await q.query<{ status: string }>(
    `SELECT status FROM preparation_version WHERE preparation_version_id = $1`,
    [preparationVersionId],
  );
  if (prep.rows[0]?.status !== 'PUBLISHED') return false;
  const comps = await q.query<ComponentRow>(
    `SELECT component_kind, catalog_item_id, nested_preparation_version_id
     FROM preparation_component WHERE preparation_version_id = $1 ORDER BY line_number`,
    [preparationVersionId],
  );
  return expandComponents(q, comps.rows, [...stack, preparationVersionId], out);
}

async function expandComponents(
  q: Queryable,
  rows: readonly ComponentRow[],
  stack: readonly string[],
  out: string[],
): Promise<boolean> {
  for (const c of rows) {
    if (c.component_kind === 'CATALOG_ITEM' && c.catalog_item_id) {
      out.push(c.catalog_item_id);
    } else if (c.nested_preparation_version_id) {
      if (!(await expandPreparation(q, c.nested_preparation_version_id, stack, out))) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Flatten a sold CatalogItem into composition leaves (ADR-0024: consume Recipe/Preparation data,
 * never own it). Any gap (profile without published recipe, unpublished/cyclic preparation) is
 * reported as unknown composition rather than guessed.
 */
export async function loadBaseComposition(
  q: Queryable,
  tenantId: string,
  catalogItemId: string,
): Promise<Composition> {
  const profile = await q.query<{ recipe_specification_id: string }>(
    `SELECT recipe_specification_id FROM catalog_item_recipe_profile
     WHERE tenant_id = $1 AND catalog_item_id = $2 AND product_variant_id IS NULL`,
    [tenantId, catalogItemId],
  );
  if (profile.rows[0]) {
    const recipe = await q.query<{ recipe_version_id: string }>(
      `SELECT recipe_version_id FROM recipe_version
       WHERE recipe_specification_id = $1 AND status = 'PUBLISHED'
       ORDER BY version_number DESC LIMIT 1`,
      [profile.rows[0].recipe_specification_id],
    );
    if (!recipe.rows[0]) return UNKNOWN_COMPOSITION;
    const comps = await q.query<ComponentRow>(
      `SELECT component_kind, catalog_item_id, nested_preparation_version_id
       FROM recipe_component WHERE recipe_version_id = $1 ORDER BY line_number`,
      [recipe.rows[0].recipe_version_id],
    );
    const out: string[] = [];
    const ok = await expandComponents(q, comps.rows, [], out);
    return ok ? { known: true, leafIds: out } : UNKNOWN_COMPOSITION;
  }

  const stockRoots = await q.query<{ preparation_version_id: string }>(
    `SELECT DISTINCT ON (pv.preparation_specification_id) pv.preparation_version_id
     FROM preparation_version pv
     JOIN preparation_specification ps ON ps.preparation_specification_id = pv.preparation_specification_id
     WHERE ps.tenant_id = $1 AND pv.status = 'PUBLISHED'
       AND pv.materialization_mode = 'STOCK_TRACKED' AND pv.output_catalog_item_id = $2
     ORDER BY pv.preparation_specification_id, pv.version_number DESC`,
    [tenantId, catalogItemId],
  );
  if (stockRoots.rows.length > 1) return UNKNOWN_COMPOSITION;
  if (stockRoots.rows[0]) {
    const out: string[] = [];
    const ok = await expandPreparation(q, stockRoots.rows[0].preparation_version_id, [], out);
    return ok ? { known: true, leafIds: out } : UNKNOWN_COMPOSITION;
  }
  // Resale / purchased item: the item itself is the leaf; its own declaration decides.
  return { known: true, leafIds: [catalogItemId] };
}

export async function loadLeafProfiles(
  q: Queryable,
  tenantId: string,
  leafIds: readonly string[],
): Promise<Map<string, LeafAllergenProfile>> {
  const profiles = new Map<string, LeafAllergenProfile>();
  const ids = [...new Set(leafIds)];
  if (ids.length === 0) return profiles;
  const heads = await q.query<{ catalog_item_id: string; declaration_status: 'COMPLETE' | 'INCOMPLETE' }>(
    `SELECT catalog_item_id, declaration_status FROM catalog_item_allergen_profile
     WHERE tenant_id = $1 AND catalog_item_id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  for (const h of heads.rows) {
    profiles.set(h.catalog_item_id, { declarationStatus: h.declaration_status, declared: new Map() });
  }
  const decls = await q.query<{
    catalog_item_id: string;
    allergen_code: string;
    exposure: 'CONTAINS' | 'MAY_CONTAIN' | 'CROSS_CONTAMINATION_RISK';
  }>(
    `SELECT catalog_item_id, allergen_code, exposure FROM catalog_item_allergen_declaration
     WHERE tenant_id = $1 AND catalog_item_id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  for (const d of decls.rows) {
    (profiles.get(d.catalog_item_id)?.declared as Map<string, typeof d.exposure> | undefined)?.set(
      d.allergen_code,
      d.exposure,
    );
  }
  return profiles;
}

export async function loadKitchenPolicies(
  q: Queryable,
  tenantId: string,
  allergenCodes: readonly string[],
): Promise<Map<string, KitchenHandlingPolicy>> {
  const policies = new Map<string, KitchenHandlingPolicy>();
  if (allergenCodes.length === 0) return policies;
  const res = await q.query<{
    allergen_code: string;
    modification_permitted: boolean;
    handling_code: string | null;
  }>(
    `SELECT allergen_code, modification_permitted, handling_code
     FROM allergen_kitchen_handling_policy
     WHERE tenant_id = $1 AND allergen_code = ANY($2::text[])`,
    [tenantId, [...allergenCodes]],
  );
  for (const r of res.rows) {
    policies.set(r.allergen_code, {
      modificationPermitted: r.modification_permitted,
      handlingCode: r.handling_code,
    });
  }
  return policies;
}
