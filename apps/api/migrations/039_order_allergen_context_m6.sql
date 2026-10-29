-- ADR-0050 Order-local Allergen Resolution (M6), delta on ADR-0024 (PO ACCEPT 2026-10-28).
-- Disposable/CI first — no production migrate GO.
--
-- Privacy (ADR-0050 / ADR-0015): allergy context is ORDER-LOCAL. Nothing here references
-- CustomerProfile or any permanent guest identity. No retention beyond the Order lifecycle is
-- introduced; a retention / purge policy and any safety-override catalog remain LEGAL GATE items.
--
-- Safety (ADR-0024): composition data that is missing or incomplete stays UNKNOWN. This schema has
-- no SAFE value; NOT_KNOWN_TO_CONTAIN is only derived when a leaf is explicitly declared COMPLETE.

-- Structured allergen declarations on composition leaves (CatalogItem). Catalog/Recipes remain
-- the composition SoT; the allergen module only reads these rows.
CREATE TABLE IF NOT EXISTS catalog_item_allergen_profile (
  catalog_item_id UUID PRIMARY KEY REFERENCES catalog_item (catalog_item_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  -- COMPLETE: declarations list every allergen the source data knows about; absent codes become
  --           NOT_KNOWN_TO_CONTAIN (not a certification).
  -- INCOMPLETE: absent codes stay UNKNOWN.
  declaration_status TEXT NOT NULL CHECK (declaration_status IN ('COMPLETE', 'INCOMPLETE')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_allergen_profile_tenant
  ON catalog_item_allergen_profile (tenant_id);

CREATE TABLE IF NOT EXISTS catalog_item_allergen_declaration (
  catalog_item_id UUID NOT NULL REFERENCES catalog_item_allergen_profile (catalog_item_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  allergen_code TEXT NOT NULL,
  exposure TEXT NOT NULL CHECK (exposure IN ('CONTAINS', 'MAY_CONTAIN', 'CROSS_CONTAMINATION_RISK')),
  PRIMARY KEY (catalog_item_id, allergen_code),
  CONSTRAINT catalog_item_allergen_declaration_code_chk CHECK (allergen_code ~ '^[A-Z][A-Z0-9_]{1,31}$')
);

-- Kitchen handling policy per allergen (tenant scope). Absence = policy unknown (fail-closed:
-- a modification is never treated as permitted without an explicit row).
CREATE TABLE IF NOT EXISTS allergen_kitchen_handling_policy (
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  allergen_code TEXT NOT NULL,
  modification_permitted BOOLEAN NOT NULL,
  handling_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, allergen_code),
  CONSTRAINT allergen_kitchen_handling_policy_code_chk CHECK (allergen_code ~ '^[A-Z][A-Z0-9_]{1,31}$')
);

-- Current order-local allergen context (one per Order; ask once, revisable while OPEN and unfrozen).
CREATE TABLE IF NOT EXISTS order_allergen_context (
  order_allergen_context_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  capture_choice TEXT NOT NULL CHECK (
    capture_choice IN ('NO_ALLERGIES_CONFIRMED', 'SELECT_ALLERGENS', 'UNABLE_TO_CLARIFY')
  ),
  allergen_codes TEXT[] NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  captured_by UUID,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  frozen_at TIMESTAMPTZ,
  CONSTRAINT order_allergen_context_order_uq UNIQUE (order_id),
  CONSTRAINT order_allergen_context_codes_chk CHECK (
    (capture_choice = 'SELECT_ALLERGENS' AND cardinality(allergen_codes) > 0)
    OR (capture_choice <> 'SELECT_ALLERGENS' AND cardinality(allergen_codes) = 0)
  )
);

-- Append-only audit of every capture / revision (ADR-0024 auditability).
CREATE TABLE IF NOT EXISTS order_allergen_context_event (
  order_allergen_context_event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  capture_choice TEXT NOT NULL,
  allergen_codes TEXT[] NOT NULL DEFAULT '{}',
  actor_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_allergen_context_event_rev_uq UNIQUE (order_id, revision)
);

-- Per-line deterministic resolution snapshot (frozen with the OrderLine at commercial accept).
CREATE TABLE IF NOT EXISTS order_line_allergen_resolution (
  order_line_allergen_resolution_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id) ON DELETE CASCADE,
  context_revision INTEGER NOT NULL CHECK (context_revision > 0),
  configuration_fingerprint TEXT NOT NULL,
  result TEXT NOT NULL CHECK (
    result IN ('AVAILABLE', 'AVAILABLE_WITH_MODIFICATION', 'BLOCKED', 'REQUIRES_CONFIRMATION')
  ),
  resolution_fingerprint TEXT NOT NULL,
  findings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  kitchen_warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_acknowledgements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  frozen_at TIMESTAMPTZ,
  CONSTRAINT order_line_allergen_resolution_line_uq UNIQUE (order_line_id)
);

CREATE INDEX IF NOT EXISTS idx_order_line_allergen_resolution_order
  ON order_line_allergen_resolution (order_id);

-- Human review acknowledgements, bound to the exact resolution fingerprint they reviewed.
CREATE TABLE IF NOT EXISTS order_line_allergen_acknowledgement (
  order_line_allergen_acknowledgement_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id) ON DELETE CASCADE,
  acknowledgement_kind TEXT NOT NULL CHECK (
    acknowledgement_kind IN ('CASHIER_GUEST_INFORMED', 'KITCHEN_ACKNOWLEDGED')
  ),
  resolution_fingerprint TEXT NOT NULL,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_line_allergen_ack_uq UNIQUE (order_line_id, acknowledgement_kind, resolution_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_order_line_allergen_ack_order
  ON order_line_allergen_acknowledgement (order_id);

COMMENT ON TABLE order_allergen_context IS
  'ADR-0050 order-local allergy capture. Not CustomerProfile; no permanent guest allergy CRM.';
COMMENT ON TABLE catalog_item_allergen_profile IS
  'Structured allergen declarations for composition leaves (ADR-0024). Missing/INCOMPLETE stays UNKNOWN, never SAFE.';
COMMENT ON TABLE order_line_allergen_resolution IS
  'Deterministic offer resolution snapshot. Not a safety certification; REQUIRES_CONFIRMATION is never SAFE.';
COMMENT ON TABLE order_line_allergen_acknowledgement IS
  'Human review record bound to a resolution fingerprint. Not a legal override of BLOCKED.';
