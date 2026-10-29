-- ADR-0052 M3: a published REPLACE yield is quantity + unit + dimension together, or absent.
ALTER TABLE modifier_option_recipe_delta
  ADD COLUMN IF NOT EXISTS replacement_quantity TEXT,
  ADD COLUMN IF NOT EXISTS replacement_unit TEXT,
  ADD COLUMN IF NOT EXISTS replacement_dimension TEXT;

ALTER TABLE modifier_option_recipe_delta
  DROP CONSTRAINT IF EXISTS modifier_option_recipe_delta_shape_chk;

ALTER TABLE modifier_option_recipe_delta
  ADD CONSTRAINT modifier_option_recipe_delta_shape_chk CHECK (
    (delta_kind = 'REMOVE_COMPONENT' AND target_catalog_item_id IS NOT NULL
      AND replacement_catalog_item_id IS NULL AND add_catalog_item_id IS NULL
      AND replacement_quantity IS NULL AND replacement_unit IS NULL AND replacement_dimension IS NULL)
    OR (delta_kind = 'REPLACE_COMPONENT' AND target_catalog_item_id IS NOT NULL
      AND replacement_catalog_item_id IS NOT NULL AND add_catalog_item_id IS NULL
      AND (
        (replacement_quantity IS NULL AND replacement_unit IS NULL AND replacement_dimension IS NULL)
        OR (replacement_quantity IS NOT NULL AND replacement_unit IS NOT NULL
            AND replacement_dimension IN ('MASS', 'VOLUME', 'COUNT'))
      ))
    OR (delta_kind = 'ADD_COMPONENT' AND add_catalog_item_id IS NOT NULL
      AND add_quantity IS NOT NULL AND add_unit IS NOT NULL AND add_dimension IS NOT NULL
      AND target_catalog_item_id IS NULL AND replacement_catalog_item_id IS NULL
      AND replacement_quantity IS NULL AND replacement_unit IS NULL AND replacement_dimension IS NULL)
  );
