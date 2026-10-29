-- ADR-0049 Modifier Groups & Effective Recipe v1 (PO ACCEPT 2026-10-28).
-- Disposable/CI first — no production migrate GO.
-- Menu Configuration owns versioned groups/options; Orders owns line configuration snapshots.

INSERT INTO identity_permission (permission_key, description) VALUES
  (
    'menu.modifiers.configure',
    'Publish and bind ModifierGroup / ModifierOption for Menu Configuration'
  ),
  (
    'orders.line_configure',
    'Select modifier options on an OPEN OrderLine within published groups'
  )
ON CONFLICT DO NOTHING;

-- Editable group identity (Menu Configuration)
CREATE TABLE IF NOT EXISTS modifier_group (
  modifier_group_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  selection_mode TEXT NOT NULL CHECK (selection_mode IN ('SINGLE', 'MULTI')),
  min_select INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select INTEGER NOT NULL CHECK (max_select >= 0),
  ask_every_time BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT modifier_group_tenant_code_uq UNIQUE (tenant_id, code),
  CONSTRAINT modifier_group_code_nonempty_chk CHECK (length(trim(code)) > 0),
  CONSTRAINT modifier_group_name_nonempty_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT modifier_group_minmax_chk CHECK (max_select >= min_select)
);

CREATE INDEX IF NOT EXISTS idx_modifier_group_tenant
  ON modifier_group (tenant_id);

CREATE TABLE IF NOT EXISTS modifier_option (
  modifier_option_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  modifier_group_id UUID NOT NULL REFERENCES modifier_group (modifier_group_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  price_adjustment_minor TEXT NOT NULL DEFAULT '0',
  kitchen_instruction_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT modifier_option_group_code_uq UNIQUE (modifier_group_id, code),
  CONSTRAINT modifier_option_code_nonempty_chk CHECK (length(trim(code)) > 0),
  CONSTRAINT modifier_option_name_nonempty_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT modifier_option_price_digits_chk CHECK (price_adjustment_minor ~ '^-?[0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_modifier_option_group
  ON modifier_option (modifier_group_id);

-- Structured Effective Recipe deltas (ADR-0049) — applied at resolve time; not a second ledger
CREATE TABLE IF NOT EXISTS modifier_option_recipe_delta (
  modifier_option_recipe_delta_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  modifier_option_id UUID NOT NULL REFERENCES modifier_option (modifier_option_id) ON DELETE CASCADE,
  delta_kind TEXT NOT NULL CHECK (delta_kind IN ('REMOVE_COMPONENT', 'REPLACE_COMPONENT', 'ADD_COMPONENT')),
  target_catalog_item_id UUID REFERENCES catalog_item (catalog_item_id),
  replacement_catalog_item_id UUID REFERENCES catalog_item (catalog_item_id),
  add_catalog_item_id UUID REFERENCES catalog_item (catalog_item_id),
  add_quantity TEXT,
  add_unit TEXT,
  add_dimension TEXT CHECK (add_dimension IS NULL OR add_dimension IN ('MASS', 'VOLUME', 'COUNT')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT modifier_option_recipe_delta_shape_chk CHECK (
    (delta_kind = 'REMOVE_COMPONENT' AND target_catalog_item_id IS NOT NULL
      AND replacement_catalog_item_id IS NULL AND add_catalog_item_id IS NULL)
    OR (delta_kind = 'REPLACE_COMPONENT' AND target_catalog_item_id IS NOT NULL
      AND replacement_catalog_item_id IS NOT NULL AND add_catalog_item_id IS NULL)
    OR (delta_kind = 'ADD_COMPONENT' AND add_catalog_item_id IS NOT NULL
      AND add_quantity IS NOT NULL AND add_unit IS NOT NULL AND add_dimension IS NOT NULL
      AND target_catalog_item_id IS NULL AND replacement_catalog_item_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_modifier_option_recipe_delta_option
  ON modifier_option_recipe_delta (modifier_option_id);

-- Bind group to sellable catalog item (Menu Configuration)
CREATE TABLE IF NOT EXISTS catalog_item_modifier_group (
  catalog_item_modifier_group_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  modifier_group_id UUID NOT NULL REFERENCES modifier_group (modifier_group_id),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT catalog_item_modifier_group_uq UNIQUE (catalog_item_id, modifier_group_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_modifier_group_item
  ON catalog_item_modifier_group (catalog_item_id);

-- OrderLine configuration snapshot (immutable once commercially accepted — enforced in service)
CREATE TABLE IF NOT EXISTS order_line_configuration (
  order_line_configuration_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id) ON DELETE CASCADE,
  configuration_fingerprint TEXT NOT NULL,
  additive_price_adjustment_minor TEXT NOT NULL DEFAULT '0',
  kitchen_instructions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- ADR-0049 #9: freeze resolved Effective Recipe deltas with the configuration (no live re-resolve).
  effective_recipe_deltas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  frozen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_line_configuration_line_uq UNIQUE (order_line_id),
  CONSTRAINT order_line_configuration_price_digits_chk CHECK (additive_price_adjustment_minor ~ '^-?[0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_order_line_configuration_order
  ON order_line_configuration (order_id);

CREATE TABLE IF NOT EXISTS order_line_modifier_selection (
  order_line_modifier_selection_id UUID PRIMARY KEY,
  order_line_configuration_id UUID NOT NULL REFERENCES order_line_configuration (order_line_configuration_id) ON DELETE CASCADE,
  modifier_group_id UUID NOT NULL REFERENCES modifier_group (modifier_group_id),
  modifier_option_id UUID NOT NULL REFERENCES modifier_option (modifier_option_id),
  CONSTRAINT order_line_modifier_selection_uq UNIQUE (order_line_configuration_id, modifier_group_id, modifier_option_id)
);

CREATE INDEX IF NOT EXISTS idx_order_line_modifier_selection_config
  ON order_line_modifier_selection (order_line_configuration_id);

COMMENT ON TABLE modifier_group IS
  'ADR-0049 Menu Configuration ModifierGroup (editable). Publish bindings via catalog_item_modifier_group.';
COMMENT ON TABLE modifier_option_recipe_delta IS
  'Structured Effective Recipe component deltas for a ModifierOption — not a financial ledger.';
COMMENT ON TABLE order_line_configuration IS
  'Per-OrderLine modifier configuration snapshot. Freeze before/at commercial accept; no live menu rewrite after Complete.';
