-- C1.1: Commercial RoundingPolicy runtime (ADR-0030 BASE_LIST_LINE_GROSS)
-- No production default policy seed.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- LegalEntity jurisdiction for policy selection (ADR-0030 §9).
ALTER TABLE legal_entity
  ADD COLUMN IF NOT EXISTS jurisdiction_code TEXT;

UPDATE legal_entity
SET jurisdiction_code = 'VN'
WHERE jurisdiction_code IS NULL;

ALTER TABLE legal_entity
  ALTER COLUMN jurisdiction_code SET DEFAULT 'VN';

ALTER TABLE legal_entity
  ALTER COLUMN jurisdiction_code SET NOT NULL;

ALTER TABLE legal_entity
  DROP CONSTRAINT IF EXISTS legal_entity_jurisdiction_code_chk;

ALTER TABLE legal_entity
  ADD CONSTRAINT legal_entity_jurisdiction_code_chk
  CHECK (jurisdiction_code ~ '^[A-Z]{2}$');

COMMENT ON COLUMN legal_entity.jurisdiction_code IS
  'ISO-like jurisdiction code for commercial RoundingPolicy selection (ADR-0030). Not Menu/Layout inheritance.';

-- Versioned RoundingPolicy (immutable row once inserted; correction = new version row).
CREATE TABLE IF NOT EXISTS commercial_rounding_policy (
  rounding_policy_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  jurisdiction_code TEXT NOT NULL,
  calculation_context TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  rounding_mode TEXT NOT NULL,
  quantum_minor TEXT NOT NULL CHECK (quantum_minor ~ '^[1-9][0-9]*$'),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT commercial_rounding_policy_context_chk CHECK (
    calculation_context = 'BASE_LIST_LINE_GROSS'
  ),
  CONSTRAINT commercial_rounding_policy_mode_chk CHECK (
    rounding_mode IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP')
  ),
  CONSTRAINT commercial_rounding_policy_jurisdiction_chk CHECK (
    jurisdiction_code ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT commercial_rounding_policy_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT commercial_rounding_policy_version_uq UNIQUE (
    tenant_id, legal_entity_id, jurisdiction_code, calculation_context, policy_version
  )
);

-- Prevent overlapping effective intervals for the same selection key.
ALTER TABLE commercial_rounding_policy
  DROP CONSTRAINT IF EXISTS commercial_rounding_policy_no_overlap;

ALTER TABLE commercial_rounding_policy
  ADD CONSTRAINT commercial_rounding_policy_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    legal_entity_id WITH =,
    jurisdiction_code WITH =,
    calculation_context WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

CREATE INDEX IF NOT EXISTS commercial_rounding_policy_lookup_idx
  ON commercial_rounding_policy (
    tenant_id, legal_entity_id, jurisdiction_code, calculation_context, effective_from
  );

COMMENT ON TABLE commercial_rounding_policy IS
  'ADR-0030 RoundingPolicy versions for BASE_LIST_LINE_GROSS. No silent production seed.';

-- Policy definition rows are immutable after insert (correction = new version row).
CREATE OR REPLACE FUNCTION commercial_rounding_policy_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'COMMERCIAL_ROUNDING_POLICY_IMMUTABLE: RoundingPolicy rows cannot be updated or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS commercial_rounding_policy_no_update ON commercial_rounding_policy;
CREATE TRIGGER commercial_rounding_policy_no_update
  BEFORE UPDATE ON commercial_rounding_policy
  FOR EACH ROW
  EXECUTE FUNCTION commercial_rounding_policy_forbid_mutation();

DROP TRIGGER IF EXISTS commercial_rounding_policy_no_delete ON commercial_rounding_policy;
CREATE TRIGGER commercial_rounding_policy_no_delete
  BEFORE DELETE ON commercial_rounding_policy
  FOR EACH ROW
  EXECUTE FUNCTION commercial_rounding_policy_forbid_mutation();

-- D1.4B OPEN line terms: optional rounding provenance (NULL = legacy explicit-gross OPTION A).
ALTER TABLE sales_order_commercial_line_terms
  ADD COLUMN IF NOT EXISTS exact_unrounded_minor_basis TEXT,
  ADD COLUMN IF NOT EXISTS rounding_delta TEXT,
  ADD COLUMN IF NOT EXISTS rounding_policy_id UUID,
  ADD COLUMN IF NOT EXISTS rounding_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS rounding_mode TEXT,
  ADD COLUMN IF NOT EXISTS quantum_minor TEXT,
  ADD COLUMN IF NOT EXISTS calculation_context TEXT;

ALTER TABLE sales_order_commercial_line_terms
  DROP CONSTRAINT IF EXISTS sales_order_commercial_line_terms_rounding_ctx_chk;

ALTER TABLE sales_order_commercial_line_terms
  ADD CONSTRAINT sales_order_commercial_line_terms_rounding_ctx_chk CHECK (
    calculation_context IS NULL OR calculation_context = 'BASE_LIST_LINE_GROSS'
  );

COMMENT ON COLUMN sales_order_commercial_line_terms.exact_unrounded_minor_basis IS
  'ADR-0030 exactUnroundedMinorBasis (canonical decimal). NULL for legacy explicit-gross rows.';
COMMENT ON COLUMN sales_order_commercial_line_terms.rounding_delta IS
  'ADR-0030 roundingDelta = roundedGross − exact basis (sub-minor). NULL for legacy rows.';

-- Frozen snapshot lines: same optional provenance (legacy NULL).
ALTER TABLE order_line_commercial_snapshot
  ADD COLUMN IF NOT EXISTS exact_unrounded_minor_basis TEXT,
  ADD COLUMN IF NOT EXISTS rounding_delta TEXT,
  ADD COLUMN IF NOT EXISTS rounding_policy_id UUID,
  ADD COLUMN IF NOT EXISTS rounding_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS rounding_mode TEXT,
  ADD COLUMN IF NOT EXISTS quantum_minor TEXT,
  ADD COLUMN IF NOT EXISTS calculation_context TEXT;
