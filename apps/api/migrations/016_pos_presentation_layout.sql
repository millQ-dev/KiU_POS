-- P1.1: POS Presentation Runtime (ADR-0031)
-- LayoutDefinition → immutable LayoutPublication → LayoutAssignment
-- MenuPage / MenuSlot / Quick Access ≤10. No price/availability/stock columns.
-- Terminal/TerminalGroup DEFERRED. No Floor/Table. No widget DSL.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- LayoutDefinition (editable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layout_definition (
  layout_definition_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT layout_definition_code_nonempty_chk CHECK (length(trim(code)) > 0),
  CONSTRAINT layout_definition_name_nonempty_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT layout_definition_tenant_code_uq UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_layout_definition_tenant
  ON layout_definition (tenant_id);

CREATE TABLE IF NOT EXISTS layout_definition_page (
  layout_definition_page_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  layout_definition_id UUID NOT NULL REFERENCES layout_definition (layout_definition_id) ON DELETE CASCADE,
  page_code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  color_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT layout_definition_page_code_uq UNIQUE (layout_definition_id, page_code),
  CONSTRAINT layout_definition_page_order_uq UNIQUE (layout_definition_id, sort_order)
);

CREATE TABLE IF NOT EXISTS layout_definition_slot (
  layout_definition_slot_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  layout_definition_id UUID NOT NULL REFERENCES layout_definition (layout_definition_id) ON DELETE CASCADE,
  zone TEXT NOT NULL CHECK (zone IN ('PAGE', 'QUICK_ACCESS')),
  layout_definition_page_id UUID REFERENCES layout_definition_page (layout_definition_page_id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  position INTEGER NOT NULL CHECK (position >= 1),
  label_override TEXT,
  color_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT layout_definition_slot_zone_chk CHECK (
    (zone = 'PAGE' AND layout_definition_page_id IS NOT NULL)
    OR (zone = 'QUICK_ACCESS' AND layout_definition_page_id IS NULL AND position BETWEEN 1 AND 10)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_definition_slot_page_pos
  ON layout_definition_slot (layout_definition_id, layout_definition_page_id, position)
  WHERE zone = 'PAGE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_definition_slot_qa_pos
  ON layout_definition_slot (layout_definition_id, position)
  WHERE zone = 'QUICK_ACCESS';

-- ---------------------------------------------------------------------------
-- LayoutPublication (immutable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layout_publication (
  layout_publication_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  layout_definition_id UUID NOT NULL REFERENCES layout_definition (layout_definition_id),
  publication_version INTEGER NOT NULL CHECK (publication_version > 0),
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  CONSTRAINT layout_publication_def_version_uq UNIQUE (layout_definition_id, publication_version),
  CONSTRAINT layout_publication_idem_uq UNIQUE (tenant_id, layout_definition_id, idempotency_key),
  CONSTRAINT layout_publication_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX IF NOT EXISTS idx_layout_publication_tenant_def
  ON layout_publication (tenant_id, layout_definition_id);

CREATE TABLE IF NOT EXISTS layout_publication_page (
  layout_publication_page_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  layout_publication_id UUID NOT NULL REFERENCES layout_publication (layout_publication_id),
  page_code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  color_token TEXT,
  CONSTRAINT layout_publication_page_code_uq UNIQUE (layout_publication_id, page_code),
  CONSTRAINT layout_publication_page_order_uq UNIQUE (layout_publication_id, sort_order)
);

CREATE TABLE IF NOT EXISTS layout_publication_slot (
  layout_publication_slot_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  layout_publication_id UUID NOT NULL REFERENCES layout_publication (layout_publication_id),
  zone TEXT NOT NULL CHECK (zone IN ('PAGE', 'QUICK_ACCESS')),
  layout_publication_page_id UUID REFERENCES layout_publication_page (layout_publication_page_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  position INTEGER NOT NULL CHECK (position >= 1),
  label_override TEXT,
  color_token TEXT,
  CONSTRAINT layout_publication_slot_zone_chk CHECK (
    (zone = 'PAGE' AND layout_publication_page_id IS NOT NULL)
    OR (zone = 'QUICK_ACCESS' AND layout_publication_page_id IS NULL AND position BETWEEN 1 AND 10)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_publication_slot_page_pos
  ON layout_publication_slot (layout_publication_id, layout_publication_page_id, position)
  WHERE zone = 'PAGE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_publication_slot_qa_pos
  ON layout_publication_slot (layout_publication_id, position)
  WHERE zone = 'QUICK_ACCESS';

CREATE INDEX IF NOT EXISTS idx_layout_publication_slot_catalog
  ON layout_publication_slot (layout_publication_id, catalog_item_id);

COMMENT ON TABLE layout_publication IS
  'Immutable LayoutPublication (ADR-0031). Corrections require a new publication.';
COMMENT ON TABLE layout_publication_slot IS
  'Frozen presentation slots. No price/availability/stock columns.';

-- Immutability: reject UPDATE/DELETE on published rows; INSERT only during publish.
CREATE OR REPLACE FUNCTION layout_publication_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: LayoutPublication rows cannot be updated or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION layout_publication_child_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: LayoutPublication pages/slots cannot be mutated'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION layout_publication_child_guard_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.layout_publish', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: LayoutPublication children cannot be inserted outside PublishLayout'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_layout_publication_immutable ON layout_publication;
CREATE TRIGGER trg_layout_publication_immutable
  BEFORE UPDATE OR DELETE ON layout_publication
  FOR EACH ROW EXECUTE FUNCTION layout_publication_reject_mutation();

DROP TRIGGER IF EXISTS trg_layout_publication_page_immutable ON layout_publication_page;
CREATE TRIGGER trg_layout_publication_page_immutable
  BEFORE UPDATE OR DELETE ON layout_publication_page
  FOR EACH ROW EXECUTE FUNCTION layout_publication_child_reject_mutation();

DROP TRIGGER IF EXISTS trg_layout_publication_slot_immutable ON layout_publication_slot;
CREATE TRIGGER trg_layout_publication_slot_immutable
  BEFORE UPDATE OR DELETE ON layout_publication_slot
  FOR EACH ROW EXECUTE FUNCTION layout_publication_child_reject_mutation();

DROP TRIGGER IF EXISTS trg_layout_publication_page_insert_guard ON layout_publication_page;
CREATE TRIGGER trg_layout_publication_page_insert_guard
  BEFORE INSERT ON layout_publication_page
  FOR EACH ROW EXECUTE FUNCTION layout_publication_child_guard_insert();

DROP TRIGGER IF EXISTS trg_layout_publication_slot_insert_guard ON layout_publication_slot;
CREATE TRIGGER trg_layout_publication_slot_insert_guard
  BEFORE INSERT ON layout_publication_slot
  FOR EACH ROW EXECUTE FUNCTION layout_publication_child_guard_insert();

-- ---------------------------------------------------------------------------
-- LayoutAssignment (Tenant / Brand / Outlet; LegalEntity excluded)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layout_assignment (
  layout_assignment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  layout_publication_id UUID NOT NULL REFERENCES layout_publication (layout_publication_id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('TENANT', 'BRAND', 'OUTLET')),
  brand_id UUID REFERENCES brand (brand_id),
  outlet_id UUID REFERENCES outlet (outlet_id),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  CONSTRAINT layout_assignment_scope_chk CHECK (
    (scope_kind = 'TENANT' AND brand_id IS NULL AND outlet_id IS NULL)
    OR (scope_kind = 'BRAND' AND brand_id IS NOT NULL AND outlet_id IS NULL)
    OR (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL AND brand_id IS NULL)
  ),
  CONSTRAINT layout_assignment_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT layout_assignment_idem_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_layout_assignment_tenant_scope
  ON layout_assignment (tenant_id, scope_kind, effective_from);

CREATE INDEX IF NOT EXISTS idx_layout_assignment_publication
  ON layout_assignment (layout_publication_id);

ALTER TABLE layout_assignment DROP CONSTRAINT IF EXISTS layout_assignment_tenant_overlap_excl;
ALTER TABLE layout_assignment ADD CONSTRAINT layout_assignment_tenant_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope_kind = 'TENANT');

ALTER TABLE layout_assignment DROP CONSTRAINT IF EXISTS layout_assignment_brand_overlap_excl;
ALTER TABLE layout_assignment ADD CONSTRAINT layout_assignment_brand_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    brand_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope_kind = 'BRAND' AND brand_id IS NOT NULL);

ALTER TABLE layout_assignment DROP CONSTRAINT IF EXISTS layout_assignment_outlet_overlap_excl;
ALTER TABLE layout_assignment ADD CONSTRAINT layout_assignment_outlet_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    outlet_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope_kind = 'OUTLET' AND outlet_id IS NOT NULL);
