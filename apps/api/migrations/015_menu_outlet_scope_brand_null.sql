-- M1.1: OUTLET scope must not carry brand_id (prevents overlap bypass).
ALTER TABLE menu_assignment DROP CONSTRAINT IF EXISTS menu_assignment_scope_chk;
ALTER TABLE menu_assignment ADD CONSTRAINT menu_assignment_scope_chk CHECK (
  (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
  OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
  OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL AND brand_id IS NULL)
);

ALTER TABLE availability_rule DROP CONSTRAINT IF EXISTS availability_rule_scope_chk;
ALTER TABLE availability_rule ADD CONSTRAINT availability_rule_scope_chk CHECK (
  (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
  OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
  OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL AND brand_id IS NULL)
);

ALTER TABLE price_rule DROP CONSTRAINT IF EXISTS price_rule_scope_chk;
ALTER TABLE price_rule ADD CONSTRAINT price_rule_scope_chk CHECK (
  (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
  OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
  OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL AND brand_id IS NULL)
);
