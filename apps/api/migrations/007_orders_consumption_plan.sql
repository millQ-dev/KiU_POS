-- Block D1.3A: Orders Foundation & Consumption Plan (ADR-0025)
-- Orders SoT + RecipeGraphResolver + ConsumptionPlanSnapshot schema.
-- Successful operational CompleteOrder (COMPLETED + GoodsIssue) is D1.3B only.
-- NO GoodsIssue / InventoryMovement tables or effects in this migration.

-- Authoritative Outlet → default sales/issue warehouse (ADR-0025 §11).
ALTER TABLE outlet
  ADD COLUMN IF NOT EXISTS default_sales_issue_warehouse_id UUID
    REFERENCES warehouse (warehouse_id);

-- ADR-0009 direction: CatalogItem RecipeProfile → RecipeSpecification (not Recipe → sellable).
-- product_variant_id reserved for later variant-specific binding (NULL = item-level default).
CREATE TABLE IF NOT EXISTS catalog_item_recipe_profile (
  catalog_item_recipe_profile_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  product_variant_id UUID NULL,
  recipe_specification_id UUID NOT NULL REFERENCES recipe_specification (recipe_specification_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_item_recipe_profile_variant_future_chk CHECK (
    product_variant_id IS NULL
  )
);

-- One item-level default recipe binding per CatalogItem (variant bindings later).
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_item_recipe_profile_item_default
  ON catalog_item_recipe_profile (tenant_id, catalog_item_id)
  WHERE product_variant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_item_recipe_profile_recipe
  ON catalog_item_recipe_profile (recipe_specification_id);

COMMENT ON TABLE catalog_item_recipe_profile IS
  'Minimal CatalogItem RecipeProfile binding (ADR-0009). Sellable→Recipe direction. Variant column reserved.';

-- Orders module SoT (table name sales_order — SQL keyword safe).
-- Status COMPLETED is reserved for D1.3B atomic CompleteOrder+GoodsIssue.
CREATE TABLE IF NOT EXISTS sales_order (
  order_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  channel TEXT NOT NULL DEFAULT 'DIRECT',
  business_date DATE,
  business_time TEXT,
  business_order INTEGER CHECK (business_order IS NULL OR business_order >= 0),
  actor_id UUID,
  device_id UUID,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  complete_idempotency_key TEXT,
  complete_semantic_fingerprint TEXT,
  resolved_issue_warehouse_id UUID REFERENCES warehouse (warehouse_id),
  consumption_plan_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_order_cancel_reason_chk CHECK (
    status <> 'CANCELLED' OR cancel_reason IS NOT NULL
  ),
  CONSTRAINT sales_order_completed_fields_chk CHECK (
    status <> 'COMPLETED'
    OR (
      completed_at IS NOT NULL
      AND consumption_plan_id IS NOT NULL
      AND resolved_issue_warehouse_id IS NOT NULL
      AND business_date IS NOT NULL
      AND business_order IS NOT NULL
      AND complete_idempotency_key IS NOT NULL
      AND complete_semantic_fingerprint IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_order_tenant_status
  ON sales_order (tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_order_complete_idempotency
  ON sales_order (legal_entity_id, complete_idempotency_key)
  WHERE complete_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_order_line (
  order_line_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES sales_order (order_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  quantity TEXT NOT NULL,
  unit TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('MASS', 'VOLUME', 'COUNT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_line_order
  ON sales_order_line (order_id);

-- Immutable ConsumptionPlanSnapshot schema (Orders-owned).
-- Rows are written only inside D1.3B atomic CompleteOrder after GoodsIssue port succeeds.
CREATE TABLE IF NOT EXISTS consumption_plan_snapshot (
  consumption_plan_id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES sales_order (order_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  resolved_issue_warehouse_id UUID NOT NULL REFERENCES warehouse (warehouse_id),
  provenance_hash TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sales_order
  DROP CONSTRAINT IF EXISTS sales_order_consumption_plan_fk;
ALTER TABLE sales_order
  ADD CONSTRAINT sales_order_consumption_plan_fk
  FOREIGN KEY (consumption_plan_id) REFERENCES consumption_plan_snapshot (consumption_plan_id);

CREATE TABLE IF NOT EXISTS consumption_plan_line (
  consumption_plan_line_id UUID PRIMARY KEY,
  consumption_plan_id UUID NOT NULL REFERENCES consumption_plan_snapshot (consumption_plan_id) ON DELETE CASCADE,
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id),
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  sold_catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  sold_quantity TEXT NOT NULL,
  sold_unit TEXT NOT NULL,
  sold_dimension TEXT NOT NULL CHECK (sold_dimension IN ('MASS', 'VOLUME', 'COUNT')),
  root_kind TEXT NOT NULL CHECK (root_kind IN ('RECIPE_VERSION', 'PREPARATION_VERSION', 'DIRECT_STOCK')),
  root_recipe_version_id UUID REFERENCES recipe_version (recipe_version_id),
  root_preparation_version_id UUID REFERENCES preparation_version (preparation_version_id),
  applied_strategy TEXT NOT NULL CHECK (
    applied_strategy IN ('EXPLODE_RECIPE_ON_SALE', 'CONSUME_FINISHED_ITEM', 'DIRECT_STOCK_OUT')
  ),
  UNIQUE (consumption_plan_id, order_line_id),
  CONSTRAINT consumption_plan_line_root_chk CHECK (
    (root_kind = 'RECIPE_VERSION' AND root_recipe_version_id IS NOT NULL AND root_preparation_version_id IS NULL)
    OR (root_kind = 'PREPARATION_VERSION' AND root_preparation_version_id IS NOT NULL AND root_recipe_version_id IS NULL)
    OR (root_kind = 'DIRECT_STOCK' AND root_recipe_version_id IS NULL AND root_preparation_version_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS consumption_plan_resolved_version (
  consumption_plan_resolved_version_id UUID PRIMARY KEY,
  consumption_plan_id UUID NOT NULL REFERENCES consumption_plan_snapshot (consumption_plan_id) ON DELETE CASCADE,
  consumption_plan_line_id UUID NOT NULL REFERENCES consumption_plan_line (consumption_plan_line_id) ON DELETE CASCADE,
  version_kind TEXT NOT NULL CHECK (version_kind IN ('RECIPE_VERSION', 'PREPARATION_VERSION')),
  recipe_version_id UUID REFERENCES recipe_version (recipe_version_id),
  preparation_version_id UUID REFERENCES preparation_version (preparation_version_id),
  materialization_mode TEXT CHECK (materialization_mode IS NULL OR materialization_mode IN ('VIRTUAL', 'STOCK_TRACKED')),
  CONSTRAINT consumption_plan_resolved_version_ref_chk CHECK (
    (version_kind = 'RECIPE_VERSION' AND recipe_version_id IS NOT NULL AND preparation_version_id IS NULL)
    OR (version_kind = 'PREPARATION_VERSION' AND preparation_version_id IS NOT NULL AND recipe_version_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS consumption_plan_physical_leaf (
  consumption_plan_physical_leaf_id UUID PRIMARY KEY,
  consumption_plan_id UUID NOT NULL REFERENCES consumption_plan_snapshot (consumption_plan_id) ON DELETE CASCADE,
  consumption_plan_line_id UUID NOT NULL REFERENCES consumption_plan_line (consumption_plan_line_id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  quantity_base TEXT NOT NULL,
  unit_base TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('MASS', 'VOLUME', 'COUNT')),
  leaf_path TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consumption_plan_leaf_plan
  ON consumption_plan_physical_leaf (consumption_plan_id);

COMMENT ON TABLE sales_order IS
  'Orders SoT (ADR-0025). OPEN/CANCELLED in D1.3A. COMPLETED only via D1.3B atomic CompleteOrder+GoodsIssue.';
COMMENT ON TABLE consumption_plan_snapshot IS
  'Immutable sale consumption plan. Persisted only in D1.3B CompleteOrder after Inventory GoodsIssue succeeds.';
COMMENT ON COLUMN outlet.default_sales_issue_warehouse_id IS
  'Authoritative default sales/issue warehouse for the Outlet (ADR-0025 §11). Not client-chosen.';
