-- TAX1.1: Tax domain foundation (ADR-0033 / ADR-0034 narrow / ADR-0037 C0)
-- Vietnam direct-sale Tax runtime tables. No Fiscalization.
-- Resolution: OrderLine → CatalogItem → TaxClassificationAssignment → TaxClassification → TaxPolicyVersion

-- Allow Tax rounding contexts on commercial_rounding_policy (shared RoundingPolicy store).
ALTER TABLE commercial_rounding_policy
  DROP CONSTRAINT IF EXISTS commercial_rounding_policy_context_chk;

ALTER TABLE commercial_rounding_policy
  ADD CONSTRAINT commercial_rounding_policy_context_chk CHECK (
    calculation_context IN (
      'BASE_LIST_LINE_GROSS',
      'TAX_INCLUSIVE_EXTRACTION',
      'TAX_LINE_VAT_AMOUNT'
    )
  );

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS tax_policy (
  tax_policy_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  jurisdiction_code TEXT NOT NULL CHECK (jurisdiction_code ~ '^[A-Z]{2}$'),
  policy_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_policy_code_uq UNIQUE (tenant_id, legal_entity_id, policy_code)
);

CREATE TABLE IF NOT EXISTS tax_policy_version (
  tax_policy_version_id UUID PRIMARY KEY,
  tax_policy_id UUID NOT NULL REFERENCES tax_policy (tax_policy_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  pricing_tax_mode TEXT NOT NULL CHECK (pricing_tax_mode IN ('TAX_INCLUSIVE', 'TAX_EXCLUSIVE')),
  tax_treatment TEXT NOT NULL CHECK (
    tax_treatment IN (
      'STANDARD_RATE',
      'REDUCED_RATE',
      'ZERO_RATE',
      'EXEMPT',
      'NOT_SUBJECT_TO_TAX',
      'UNKNOWN',
      'MISSING_CONFIGURATION'
    )
  ),
  rate_decimal TEXT,
  taxable_base_rule TEXT NOT NULL CHECK (
    taxable_base_rule IN (
      'TB_PRE_DISCOUNT_LIST_GROSS',
      'TB_POST_MERCHANT_FUNDED_DISCOUNT',
      'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      'TB_EXPLICIT_COMPLIMENT_ZERO'
    )
  ),
  tax_rounding_strategy TEXT NOT NULL CHECK (tax_rounding_strategy = 'LINE_ROUND_THEN_SUM'),
  inclusive_extraction_rounding_policy_id UUID REFERENCES commercial_rounding_policy (rounding_policy_id),
  vat_amount_rounding_policy_id UUID REFERENCES commercial_rounding_policy (rounding_policy_id),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT tax_policy_version_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT tax_policy_version_uq UNIQUE (tax_policy_id, policy_version),
  CONSTRAINT tax_policy_version_rate_chk CHECK (
    (
      tax_treatment IN ('STANDARD_RATE', 'REDUCED_RATE', 'ZERO_RATE')
      AND rate_decimal IS NOT NULL
      AND rate_decimal ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    )
    OR (
      tax_treatment IN ('EXEMPT', 'NOT_SUBJECT_TO_TAX', 'UNKNOWN', 'MISSING_CONFIGURATION')
      AND rate_decimal IS NULL
    )
  )
);

ALTER TABLE tax_policy_version
  DROP CONSTRAINT IF EXISTS tax_policy_version_no_overlap;

ALTER TABLE tax_policy_version
  ADD CONSTRAINT tax_policy_version_no_overlap
  EXCLUDE USING gist (
    tax_policy_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

CREATE INDEX IF NOT EXISTS tax_policy_version_lookup_idx
  ON tax_policy_version (tenant_id, legal_entity_id, effective_from);

-- Tax applicability is an explicit LegalEntity decision — never inferred from missing Tax config.
-- TRUE  = TaxOrderSnapshot required before OpenSettlement (Vietnam C0 deduction-method path).
-- FALSE = explicitly not tax-required (legacy / non-tax operation; ABSENT allowed).
-- NULL  = undecided → fail closed on OpenSettlement (new LE must not silently ABSENT).
ALTER TABLE legal_entity
  ADD COLUMN IF NOT EXISTS tax_required BOOLEAN;

COMMENT ON COLUMN legal_entity.tax_required IS
  'TAX1.1 tax applicability: TRUE=required; FALSE=explicitly not required; NULL=undecided (fail closed).';

-- Deprecated: not used for resolution (assignment chain is SoT). Kept for migration compatibility.
ALTER TABLE legal_entity
  ADD COLUMN IF NOT EXISTS default_tax_policy_id UUID REFERENCES tax_policy (tax_policy_id);

CREATE TABLE IF NOT EXISTS tax_classification (
  tax_classification_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  classification_code TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_classification_code_uq UNIQUE (tenant_id, classification_code)
);

CREATE TABLE IF NOT EXISTS tax_classification_assignment (
  tax_classification_assignment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  tax_classification_id UUID NOT NULL REFERENCES tax_classification (tax_classification_id),
  tax_policy_id UUID NOT NULL REFERENCES tax_policy (tax_policy_id),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_classification_assignment_interval_chk CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

ALTER TABLE tax_classification_assignment
  DROP CONSTRAINT IF EXISTS tax_classification_assignment_no_overlap;

ALTER TABLE tax_classification_assignment
  ADD CONSTRAINT tax_classification_assignment_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    legal_entity_id WITH =,
    catalog_item_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

CREATE INDEX IF NOT EXISTS tax_classification_assignment_lookup_idx
  ON tax_classification_assignment (
    tenant_id, legal_entity_id, catalog_item_id, effective_from
  );

CREATE TABLE IF NOT EXISTS tax_order_snapshot (
  tax_order_snapshot_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  commercial_fingerprint TEXT NOT NULL,
  -- Order envelope: NULL when lines resolve heterogeneous policies (line snapshots are SoT).
  tax_policy_id UUID REFERENCES tax_policy (tax_policy_id),
  tax_policy_version_id UUID REFERENCES tax_policy_version (tax_policy_version_id),
  policy_version INTEGER,
  pricing_tax_mode TEXT,
  tax_treatment TEXT,
  rate_decimal TEXT,
  taxable_base_rule TEXT,
  tax_rounding_strategy TEXT NOT NULL DEFAULT 'LINE_ROUND_THEN_SUM',
  algorithm_id TEXT NOT NULL CHECK (algorithm_id = 'LINE_ROUND_THEN_SUM_V1'),
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL,
  taxable_base_total_minor TEXT,
  vat_total_minor TEXT,
  amount_including_tax_total_minor TEXT,
  customer_payable_merchandise_minor TEXT NOT NULL,
  customer_payable_minor TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  accept_idempotency_key TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT tax_order_snapshot_idem_uq UNIQUE (order_id, accept_idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_order_snapshot_current_fp_uq
  ON tax_order_snapshot (order_id, commercial_fingerprint);

CREATE TABLE IF NOT EXISTS tax_line_snapshot (
  tax_line_snapshot_id UUID PRIMARY KEY,
  tax_order_snapshot_id UUID NOT NULL REFERENCES tax_order_snapshot (tax_order_snapshot_id) ON DELETE CASCADE,
  order_line_id UUID NOT NULL,
  line_number INTEGER NOT NULL,
  sold_catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  tax_classification_assignment_id UUID NOT NULL
    REFERENCES tax_classification_assignment (tax_classification_assignment_id),
  tax_classification_id UUID NOT NULL
    REFERENCES tax_classification (tax_classification_id),
  tax_policy_id UUID NOT NULL REFERENCES tax_policy (tax_policy_id),
  tax_policy_version_id UUID NOT NULL REFERENCES tax_policy_version (tax_policy_version_id),
  policy_version INTEGER NOT NULL,
  g_minor TEXT NOT NULL,
  m_minor TEXT NOT NULL,
  r_cf_minor TEXT NOT NULL,
  c_minor TEXT NOT NULL,
  x_minor TEXT NOT NULL,
  taxable_base_minor TEXT,
  vat_minor TEXT,
  amount_including_tax_minor TEXT,
  line_merchandise_payable_minor TEXT NOT NULL,
  tax_treatment TEXT NOT NULL,
  rate_decimal TEXT,
  pricing_tax_mode TEXT NOT NULL,
  taxable_base_rule TEXT NOT NULL,
  algorithm_id TEXT NOT NULL,
  exact_taxable_base TEXT,
  exact_vat TEXT,
  CONSTRAINT tax_line_snapshot_line_uq UNIQUE (tax_order_snapshot_id, order_line_id)
);

CREATE INDEX IF NOT EXISTS tax_order_snapshot_order_idx
  ON tax_order_snapshot (order_id, accepted_at DESC);

COMMENT ON TABLE tax_order_snapshot IS
  'TAX1.1 immutable accepted Tax order snapshot. Fiscalization consumes; does not invent VAT.';

CREATE OR REPLACE FUNCTION tax_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TAX_SNAPSHOT_IMMUTABLE: % is append-only', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tax_order_snapshot_immutable ON tax_order_snapshot;
CREATE TRIGGER tax_order_snapshot_immutable
  BEFORE UPDATE OR DELETE ON tax_order_snapshot
  FOR EACH ROW EXECUTE FUNCTION tax_forbid_mutation();

DROP TRIGGER IF EXISTS tax_line_snapshot_immutable ON tax_line_snapshot;
CREATE TRIGGER tax_line_snapshot_immutable
  BEFORE UPDATE OR DELETE ON tax_line_snapshot
  FOR EACH ROW EXECUTE FUNCTION tax_forbid_mutation();
