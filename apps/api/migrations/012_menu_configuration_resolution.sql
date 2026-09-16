-- M1.1: Menu Configuration & Resolution Runtime (ADR-0029)
-- MenuDefinition (editable) → immutable MenuPublication → MenuAssignment
-- AvailabilityRule / PriceRule + Outlet IANA timezone.
-- NO POS layout. NO Promotions/Loyalty. NO stock→availability. NO commercial Money×Qty.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Authoritative Outlet commercial timezone (ADR-0029 §6).
-- Nullable transition: missing → runtime OUTLET_TIMEZONE_REQUIRED (no silent UTC backfill).
ALTER TABLE outlet
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN outlet.timezone IS
  'Authoritative IANA timezone for commercial schedule / business-datetime evaluation (ADR-0029). NULL = unresolved; do not invent UTC.';

-- ---------------------------------------------------------------------------
-- MenuDefinition (editable identity; not runtime commercial truth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_definition (
  menu_definition_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_definition_code_nonempty_chk CHECK (length(trim(code)) > 0),
  CONSTRAINT menu_definition_name_nonempty_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT menu_definition_tenant_code_uq UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_menu_definition_tenant
  ON menu_definition (tenant_id);

CREATE TABLE IF NOT EXISTS menu_definition_item (
  menu_definition_item_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  menu_definition_id UUID NOT NULL REFERENCES menu_definition (menu_definition_id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_definition_item_unique UNIQUE (menu_definition_id, catalog_item_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_definition_item_catalog
  ON menu_definition_item (tenant_id, catalog_item_id);

-- ---------------------------------------------------------------------------
-- MenuPublication (immutable published version)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_publication (
  menu_publication_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  menu_definition_id UUID NOT NULL REFERENCES menu_definition (menu_definition_id),
  publication_version INTEGER NOT NULL CHECK (publication_version > 0),
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  CONSTRAINT menu_publication_def_version_uq UNIQUE (menu_definition_id, publication_version),
  CONSTRAINT menu_publication_idem_uq UNIQUE (tenant_id, menu_definition_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_menu_publication_tenant_def
  ON menu_publication (tenant_id, menu_definition_id);

CREATE TABLE IF NOT EXISTS menu_publication_item (
  menu_publication_item_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  menu_publication_id UUID NOT NULL REFERENCES menu_publication (menu_publication_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  CONSTRAINT menu_publication_item_unique UNIQUE (menu_publication_id, catalog_item_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_publication_item_catalog
  ON menu_publication_item (menu_publication_id, catalog_item_id);

COMMENT ON TABLE menu_publication IS
  'Immutable MenuPublication (ADR-0029). Membership frozen at publish; corrections require a new publication.';
COMMENT ON TABLE menu_publication_item IS
  'Frozen CatalogItem membership for a MenuPublication. No POS layout / stock / COGS fields.';

-- Enforce publication immutability at the database boundary.
CREATE OR REPLACE FUNCTION menu_publication_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: MenuPublication rows cannot be updated or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION menu_publication_item_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: MenuPublication membership cannot be mutated'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_publication_immutable ON menu_publication;
CREATE TRIGGER trg_menu_publication_immutable
  BEFORE UPDATE OR DELETE ON menu_publication
  FOR EACH ROW EXECUTE FUNCTION menu_publication_reject_mutation();

DROP TRIGGER IF EXISTS trg_menu_publication_item_immutable ON menu_publication_item;
CREATE TRIGGER trg_menu_publication_item_immutable
  BEFORE UPDATE OR DELETE ON menu_publication_item
  FOR EACH ROW EXECUTE FUNCTION menu_publication_item_reject_mutation();

-- ---------------------------------------------------------------------------
-- MenuAssignment (publication → operational scope + business-effective interval)
-- LegalEntity is NOT a scope. Terminal/TerminalGroup deferred (no runtime entities).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_assignment (
  menu_assignment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  menu_publication_id UUID NOT NULL REFERENCES menu_publication (menu_publication_id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('TENANT', 'BRAND', 'OUTLET')),
  brand_id UUID REFERENCES brand (brand_id),
  outlet_id UUID REFERENCES outlet (outlet_id),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  CONSTRAINT menu_assignment_scope_chk CHECK (
    (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
    OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
    OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL)
  ),
  CONSTRAINT menu_assignment_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT menu_assignment_idem_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_menu_assignment_tenant_scope
  ON menu_assignment (tenant_id, scope_kind, effective_from);

CREATE INDEX IF NOT EXISTS idx_menu_assignment_publication
  ON menu_assignment (menu_publication_id);

CREATE INDEX IF NOT EXISTS idx_menu_assignment_outlet
  ON menu_assignment (outlet_id)
  WHERE outlet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_menu_assignment_brand
  ON menu_assignment (brand_id)
  WHERE brand_id IS NOT NULL;

-- Concurrency-safe same-specificity overlap prevention (ADR-0029).
ALTER TABLE menu_assignment DROP CONSTRAINT IF EXISTS menu_assignment_tenant_overlap_excl;
ALTER TABLE menu_assignment ADD CONSTRAINT menu_assignment_tenant_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope_kind = 'TENANT');

ALTER TABLE menu_assignment DROP CONSTRAINT IF EXISTS menu_assignment_brand_overlap_excl;
ALTER TABLE menu_assignment ADD CONSTRAINT menu_assignment_brand_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    brand_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope_kind = 'BRAND' AND brand_id IS NOT NULL);

ALTER TABLE menu_assignment DROP CONSTRAINT IF EXISTS menu_assignment_outlet_overlap_excl;
ALTER TABLE menu_assignment ADD CONSTRAINT menu_assignment_outlet_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    outlet_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- AvailabilityRule (immutable rows; corrections = new rule row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_rule (
  availability_rule_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('TENANT', 'BRAND', 'OUTLET')),
  brand_id UUID REFERENCES brand (brand_id),
  outlet_id UUID REFERENCES outlet (outlet_id),
  availability_status TEXT NOT NULL CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  order_channel TEXT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  CONSTRAINT availability_rule_scope_chk CHECK (
    (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
    OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
    OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL)
  ),
  CONSTRAINT availability_rule_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT availability_rule_idem_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_availability_rule_lookup
  ON availability_rule (tenant_id, catalog_item_id, scope_kind, effective_from);

ALTER TABLE availability_rule DROP CONSTRAINT IF EXISTS availability_rule_overlap_excl;
ALTER TABLE availability_rule ADD CONSTRAINT availability_rule_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    catalog_item_id WITH =,
    scope_kind WITH =,
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE(order_channel, '') WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
-- PriceRule (base/list Money only — not promo/loyalty)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_rule (
  price_rule_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('TENANT', 'BRAND', 'OUTLET')),
  brand_id UUID REFERENCES brand (brand_id),
  outlet_id UUID REFERENCES outlet (outlet_id),
  amount_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  order_channel TEXT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  CONSTRAINT price_rule_scope_chk CHECK (
    (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
    OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
    OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL)
  ),
  CONSTRAINT price_rule_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT price_rule_amount_digits_chk CHECK (amount_minor ~ '^[0-9]+$'),
  CONSTRAINT price_rule_currency_chk CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT price_rule_idem_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_price_rule_lookup
  ON price_rule (tenant_id, catalog_item_id, scope_kind, effective_from);

ALTER TABLE price_rule DROP CONSTRAINT IF EXISTS price_rule_overlap_excl;
ALTER TABLE price_rule ADD CONSTRAINT price_rule_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    catalog_item_id WITH =,
    scope_kind WITH =,
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE(order_channel, '') WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

COMMENT ON TABLE price_rule IS
  'Base/list PriceRule (ADR-0029). Full Money. Missing price ≠ zero. Not promotion/loyalty.';
COMMENT ON TABLE availability_rule IS
  'Commercial AvailabilityRule (ADR-0029). Default AVAILABLE on membership when no rule. Not inventory stock.';
