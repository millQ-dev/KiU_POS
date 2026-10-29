-- ADR-0054 I-02: Restaurant Imprint persistence foundation.
-- Writes only imprint_* tables. No RLS. No second operational ledger.
-- Claims, conflicts, revisions, snapshot fields, and projection errors are append-only.
-- Ingest cursors and the snapshot head are the only mutable imprint rows.
-- A production database migration still needs a separate PO GO.

CREATE OR REPLACE FUNCTION imprint_require_outlet_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  outlet_tenant UUID;
BEGIN
  SELECT tenant_id INTO outlet_tenant FROM outlet WHERE outlet_id = NEW.outlet_id;
  IF outlet_tenant IS NULL OR outlet_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'IMPRINT_OUTLET_TENANT_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION imprint_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMPRINT_IMMUTABLE: % rows cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION imprint_claim_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_tenant UUID;
  prior_outlet UUID;
  prior_path TEXT;
  prior_effect TEXT;
BEGIN
  IF NEW.supersedes_claim_id IS NOT NULL THEN
    SELECT tenant_id, outlet_id, fact_path, claim_effect
      INTO prior_tenant, prior_outlet, prior_path, prior_effect
      FROM imprint_claim
      WHERE claim_id = NEW.supersedes_claim_id;
    IF prior_effect IS DISTINCT FROM 'ASSERTION'
      OR prior_tenant IS DISTINCT FROM NEW.tenant_id
      OR prior_outlet IS DISTINCT FROM NEW.outlet_id
      OR prior_path IS DISTINCT FROM NEW.fact_path THEN
      RAISE EXCEPTION 'IMPRINT_SUPERSEDE_TARGET'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF NEW.invalidates_claim_id IS NOT NULL THEN
    SELECT tenant_id, outlet_id, fact_path, claim_effect
      INTO prior_tenant, prior_outlet, prior_path, prior_effect
      FROM imprint_claim
      WHERE claim_id = NEW.invalidates_claim_id;
    IF prior_effect IS DISTINCT FROM 'ASSERTION'
      OR prior_tenant IS DISTINCT FROM NEW.tenant_id
      OR prior_outlet IS DISTINCT FROM NEW.outlet_id
      OR prior_path IS DISTINCT FROM NEW.fact_path THEN
      RAISE EXCEPTION 'IMPRINT_INVALIDATION_TARGET'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS imprint_claim (
  claim_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  origin TEXT NOT NULL CHECK (origin IN ('DECLARED', 'CONFIGURED', 'OBSERVED', 'TARGET')),
  claim_effect TEXT NOT NULL CHECK (claim_effect IN ('ASSERTION', 'INVALIDATION')),
  fact_path TEXT NOT NULL CHECK (
    fact_path ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    AND char_length(fact_path) <= 160
  ),
  sensitivity_class TEXT NOT NULL CHECK (sensitivity_class IN ('PUBLIC_REFERENCE', 'INTERNAL_REFERENCE')),
  retention_policy TEXT NOT NULL CHECK (retention_policy = 'OUTLET_LIFETIME'),
  source_module TEXT NOT NULL CHECK (source_module ~ '^[a-z][a-z0-9_-]{0,63}$'),
  source_entity_type TEXT NOT NULL CHECK (
    source_entity_type ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'
  ),
  source_entity_id TEXT NOT NULL CHECK (char_length(source_entity_id) BETWEEN 1 AND 80),
  source_revision TEXT NOT NULL CHECK (char_length(source_revision) BETWEEN 1 AND 128),
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_value TEXT,
  supersedes_claim_id UUID REFERENCES imprint_claim (claim_id),
  invalidates_claim_id UUID REFERENCES imprint_claim (claim_id),
  observed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  business_date DATE,
  business_order TEXT,
  CONSTRAINT imprint_claim_value_chk CHECK (
    canonical_value IS NULL OR (
      char_length(canonical_value) BETWEEN 1 AND 256
      AND canonical_value !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT imprint_claim_effect_chk CHECK (
    (
      claim_effect = 'ASSERTION'
      AND invalidates_claim_id IS NULL
      AND canonical_value IS NOT NULL
    )
    OR (
      claim_effect = 'INVALIDATION'
      AND invalidates_claim_id IS NOT NULL
      AND supersedes_claim_id IS NULL
      AND canonical_value IS NULL
    )
  ),
  CONSTRAINT imprint_claim_effective_window_chk CHECK (
    effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT imprint_claim_business_order_chk CHECK (
    business_order IS NULL OR (
      char_length(business_order) BETWEEN 1 AND 64
      AND business_order !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT imprint_claim_not_self_chk CHECK (
    claim_id IS DISTINCT FROM supersedes_claim_id
    AND claim_id IS DISTINCT FROM invalidates_claim_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS imprint_claim_assertion_identity_uq
  ON imprint_claim (
    tenant_id,
    outlet_id,
    source_module,
    source_entity_type,
    source_entity_id,
    source_revision,
    fact_path
  )
  WHERE claim_effect = 'ASSERTION';

CREATE UNIQUE INDEX IF NOT EXISTS imprint_claim_supersede_uq
  ON imprint_claim (supersedes_claim_id)
  WHERE supersedes_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS imprint_claim_invalidation_uq
  ON imprint_claim (invalidates_claim_id)
  WHERE claim_effect = 'INVALIDATION';

CREATE INDEX IF NOT EXISTS imprint_claim_scope_idx
  ON imprint_claim (tenant_id, outlet_id, fact_path);

DROP TRIGGER IF EXISTS trg_imprint_claim_tenant ON imprint_claim;
CREATE TRIGGER trg_imprint_claim_tenant
  BEFORE INSERT ON imprint_claim
  FOR EACH ROW EXECUTE FUNCTION imprint_require_outlet_tenant();

DROP TRIGGER IF EXISTS trg_imprint_claim_lineage ON imprint_claim;
CREATE TRIGGER trg_imprint_claim_lineage
  BEFORE INSERT ON imprint_claim
  FOR EACH ROW EXECUTE FUNCTION imprint_claim_lineage();

DROP TRIGGER IF EXISTS trg_imprint_claim_immutable ON imprint_claim;
CREATE TRIGGER trg_imprint_claim_immutable
  BEFORE UPDATE OR DELETE ON imprint_claim
  FOR EACH ROW EXECUTE FUNCTION imprint_reject_mutation();

CREATE TABLE IF NOT EXISTS imprint_claim_conflict (
  conflict_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  existing_claim_id UUID NOT NULL REFERENCES imprint_claim (claim_id),
  fact_path TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  existing_fingerprint TEXT NOT NULL CHECK (existing_fingerprint ~ '^[0-9a-f]{64}$'),
  rejected_fingerprint TEXT NOT NULL CHECK (rejected_fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imprint_claim_conflict_distinct_chk CHECK (existing_fingerprint <> rejected_fingerprint)
);

CREATE UNIQUE INDEX IF NOT EXISTS imprint_claim_conflict_rejection_uq
  ON imprint_claim_conflict (tenant_id, outlet_id, existing_claim_id, rejected_fingerprint);

CREATE INDEX IF NOT EXISTS imprint_claim_conflict_scope_idx
  ON imprint_claim_conflict (tenant_id, outlet_id);

DROP TRIGGER IF EXISTS trg_imprint_claim_conflict_tenant ON imprint_claim_conflict;
CREATE TRIGGER trg_imprint_claim_conflict_tenant
  BEFORE INSERT ON imprint_claim_conflict
  FOR EACH ROW EXECUTE FUNCTION imprint_require_outlet_tenant();

DROP TRIGGER IF EXISTS trg_imprint_claim_conflict_immutable ON imprint_claim_conflict;
CREATE TRIGGER trg_imprint_claim_conflict_immutable
  BEFORE UPDATE OR DELETE ON imprint_claim_conflict
  FOR EACH ROW EXECUTE FUNCTION imprint_reject_mutation();

CREATE TABLE IF NOT EXISTS imprint_ingest_cursor (
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  source_module TEXT NOT NULL CHECK (source_module ~ '^[a-z][a-z0-9_-]{0,63}$'),
  cursor_name TEXT NOT NULL CHECK (
    cursor_name ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  watermark TEXT NOT NULL CHECK (
    char_length(watermark) BETWEEN 1 AND 256
    AND watermark !~ '[[:cntrl:]]'
  ),
  advanced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id, source_module, cursor_name)
);

CREATE INDEX IF NOT EXISTS imprint_ingest_cursor_scope_idx
  ON imprint_ingest_cursor (tenant_id, outlet_id);

DROP TRIGGER IF EXISTS trg_imprint_ingest_cursor_tenant ON imprint_ingest_cursor;
CREATE TRIGGER trg_imprint_ingest_cursor_tenant
  BEFORE INSERT OR UPDATE ON imprint_ingest_cursor
  FOR EACH ROW EXECUTE FUNCTION imprint_require_outlet_tenant();

CREATE TABLE IF NOT EXISTS imprint_projection_revision (
  revision_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  revision_number BIGINT NOT NULL CHECK (revision_number > 0),
  resolver_version TEXT NOT NULL CHECK (
    resolver_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  rebuild_input_hash TEXT NOT NULL CHECK (rebuild_input_hash ~ '^[0-9a-f]{64}$'),
  published_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, outlet_id, revision_number)
);

CREATE INDEX IF NOT EXISTS imprint_projection_revision_scope_idx
  ON imprint_projection_revision (tenant_id, outlet_id);

DROP TRIGGER IF EXISTS trg_imprint_projection_revision_tenant ON imprint_projection_revision;
CREATE TRIGGER trg_imprint_projection_revision_tenant
  BEFORE INSERT ON imprint_projection_revision
  FOR EACH ROW EXECUTE FUNCTION imprint_require_outlet_tenant();

DROP TRIGGER IF EXISTS trg_imprint_projection_revision_immutable ON imprint_projection_revision;
CREATE TRIGGER trg_imprint_projection_revision_immutable
  BEFORE UPDATE OR DELETE ON imprint_projection_revision
  FOR EACH ROW EXECUTE FUNCTION imprint_reject_mutation();

CREATE TABLE IF NOT EXISTS imprint_snapshot_field (
  revision_id UUID NOT NULL REFERENCES imprint_projection_revision (revision_id),
  fact_path TEXT NOT NULL CHECK (
    fact_path ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    AND char_length(fact_path) <= 160
  ),
  field_state TEXT NOT NULL CHECK (field_state IN ('KNOWN', 'UNKNOWN', 'CONFLICT', 'STALE', 'DEGRADED')),
  claim_id UUID REFERENCES imprint_claim (claim_id),
  canonical_value TEXT,
  PRIMARY KEY (revision_id, fact_path),
  CONSTRAINT imprint_snapshot_field_shape_chk CHECK (
    (
      field_state = 'KNOWN'
      AND claim_id IS NOT NULL
      AND canonical_value IS NOT NULL
      AND char_length(canonical_value) BETWEEN 1 AND 256
    )
    OR (
      field_state = 'UNKNOWN'
      AND claim_id IS NULL
      AND canonical_value IS NULL
    )
    OR (
      field_state IN ('CONFLICT', 'STALE', 'DEGRADED')
      AND canonical_value IS NULL
    )
  )
);

DROP TRIGGER IF EXISTS trg_imprint_snapshot_field_immutable ON imprint_snapshot_field;
CREATE TRIGGER trg_imprint_snapshot_field_immutable
  BEFORE UPDATE OR DELETE ON imprint_snapshot_field
  FOR EACH ROW EXECUTE FUNCTION imprint_reject_mutation();

CREATE TABLE IF NOT EXISTS imprint_snapshot_head (
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  revision_id UUID NOT NULL REFERENCES imprint_projection_revision (revision_id),
  freshness TEXT NOT NULL CHECK (freshness IN ('FRESH', 'STALE', 'DEGRADED')),
  PRIMARY KEY (tenant_id, outlet_id)
);

CREATE OR REPLACE FUNCTION imprint_head_matches_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rev_tenant UUID;
  rev_outlet UUID;
BEGIN
  SELECT tenant_id, outlet_id INTO rev_tenant, rev_outlet
  FROM imprint_projection_revision
  WHERE revision_id = NEW.revision_id;
  IF rev_tenant IS DISTINCT FROM NEW.tenant_id OR rev_outlet IS DISTINCT FROM NEW.outlet_id THEN
    RAISE EXCEPTION 'IMPRINT_HEAD_REVISION_SCOPE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION imprint_snapshot_field_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rev_tenant UUID;
  rev_outlet UUID;
  claim_tenant UUID;
  claim_outlet UUID;
  claim_path TEXT;
BEGIN
  SELECT tenant_id, outlet_id INTO rev_tenant, rev_outlet
  FROM imprint_projection_revision
  WHERE revision_id = NEW.revision_id;
  IF rev_tenant IS NULL THEN
    RAISE EXCEPTION 'IMPRINT_FIELD_SCOPE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.claim_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id, outlet_id, fact_path INTO claim_tenant, claim_outlet, claim_path
  FROM imprint_claim
  WHERE claim_id = NEW.claim_id;
  IF claim_tenant IS DISTINCT FROM rev_tenant
    OR claim_outlet IS DISTINCT FROM rev_outlet
    OR claim_path IS DISTINCT FROM NEW.fact_path THEN
    RAISE EXCEPTION 'IMPRINT_FIELD_SCOPE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_imprint_snapshot_field_scope ON imprint_snapshot_field;
CREATE TRIGGER trg_imprint_snapshot_field_scope
  BEFORE INSERT ON imprint_snapshot_field
  FOR EACH ROW EXECUTE FUNCTION imprint_snapshot_field_scope();

DROP TRIGGER IF EXISTS trg_imprint_snapshot_head_tenant ON imprint_snapshot_head;
CREATE TRIGGER trg_imprint_snapshot_head_tenant
  BEFORE INSERT OR UPDATE ON imprint_snapshot_head
  FOR EACH ROW EXECUTE FUNCTION imprint_require_outlet_tenant();

DROP TRIGGER IF EXISTS trg_imprint_snapshot_head_revision ON imprint_snapshot_head;
CREATE TRIGGER trg_imprint_snapshot_head_revision
  BEFORE INSERT OR UPDATE ON imprint_snapshot_head
  FOR EACH ROW EXECUTE FUNCTION imprint_head_matches_revision();

CREATE TABLE IF NOT EXISTS imprint_projection_error (
  error_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  source_module TEXT NOT NULL CHECK (source_module ~ '^[a-z][a-z0-9_-]{0,63}$'),
  error_code TEXT NOT NULL CHECK (error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS imprint_projection_error_scope_idx
  ON imprint_projection_error (tenant_id, outlet_id);

DROP TRIGGER IF EXISTS trg_imprint_projection_error_tenant ON imprint_projection_error;
CREATE TRIGGER trg_imprint_projection_error_tenant
  BEFORE INSERT ON imprint_projection_error
  FOR EACH ROW EXECUTE FUNCTION imprint_require_outlet_tenant();

DROP TRIGGER IF EXISTS trg_imprint_projection_error_immutable ON imprint_projection_error;
CREATE TRIGGER trg_imprint_projection_error_immutable
  BEFORE UPDATE OR DELETE ON imprint_projection_error
  FOR EACH ROW EXECUTE FUNCTION imprint_reject_mutation();

COMMENT ON TABLE imprint_claim IS
  'ADR-0054 append-only claim. Storage is not consent, authorization, or operational truth.';
COMMENT ON TABLE imprint_snapshot_head IS
  'Current projection pointer. Freshness may move to STALE or DEGRADED without rewriting snapshot fields.';
