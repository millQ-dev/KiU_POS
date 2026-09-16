-- S1.1: Settlement / Checkout Runtime Foundation (ADR-0032 / ADR-0016)
-- Orders-coordinated Settlement facet. No Payment / FiscalDocument tables.

CREATE TABLE IF NOT EXISTS settlement_payable_snapshot (
  settlement_payable_snapshot_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  commercial_fingerprint TEXT NOT NULL,
  merchandise_gross_minor TEXT NOT NULL,
  -- Component presence: NULL = ABSENT (not calculated); digit string = present (may be '0')
  customer_borne_discount_or_reduction_minor TEXT,
  tax_minor TEXT,
  service_charges_minor TEXT,
  tips_minor TEXT,
  other_explicit_customer_facing_charges_minor TEXT,
  customer_payable_minor TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settlement_payable_snapshot_merch_digits_chk CHECK (merchandise_gross_minor ~ '^[0-9]+$'),
  CONSTRAINT settlement_payable_snapshot_payable_digits_chk CHECK (customer_payable_minor ~ '^[0-9]+$'),
  CONSTRAINT settlement_payable_snapshot_discount_digits_chk CHECK (
    customer_borne_discount_or_reduction_minor IS NULL
    OR customer_borne_discount_or_reduction_minor ~ '^[0-9]+$'
  ),
  CONSTRAINT settlement_payable_snapshot_tax_digits_chk CHECK (
    tax_minor IS NULL OR tax_minor ~ '^[0-9]+$'
  ),
  CONSTRAINT settlement_payable_snapshot_service_digits_chk CHECK (
    service_charges_minor IS NULL OR service_charges_minor ~ '^[0-9]+$'
  ),
  CONSTRAINT settlement_payable_snapshot_tips_digits_chk CHECK (
    tips_minor IS NULL OR tips_minor ~ '^[0-9]+$'
  ),
  CONSTRAINT settlement_payable_snapshot_other_digits_chk CHECK (
    other_explicit_customer_facing_charges_minor IS NULL
    OR other_explicit_customer_facing_charges_minor ~ '^[0-9]+$'
  )
);

CREATE TABLE IF NOT EXISTS settlement_group (
  settlement_group_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  state TEXT NOT NULL CHECK (state IN ('COLLECTING', 'SATISFIED', 'ABORTED')),
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  commercial_fingerprint TEXT NOT NULL,
  settlement_payable_snapshot_id UUID NOT NULL
    REFERENCES settlement_payable_snapshot (settlement_payable_snapshot_id),
  customer_payable_minor TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  open_idempotency_key TEXT NOT NULL,
  open_semantic_fingerprint TEXT NOT NULL,
  actor_id UUID,
  device_id UUID,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aborted_at TIMESTAMPTZ,
  satisfied_at TIMESTAMPTZ,
  CONSTRAINT settlement_group_payable_digits_chk CHECK (customer_payable_minor ~ '^[0-9]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_group_live_order
  ON settlement_group (order_id)
  WHERE state IN ('COLLECTING', 'SATISFIED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_group_open_idempotency
  ON settlement_group (order_id, open_idempotency_key);

CREATE INDEX IF NOT EXISTS idx_settlement_group_order
  ON settlement_group (order_id);

CREATE TABLE IF NOT EXISTS settlement_check (
  settlement_check_id UUID PRIMARY KEY,
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  state TEXT NOT NULL CHECK (state IN ('COLLECTING', 'SATISFIED')),
  customer_payable_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  check_number INTEGER NOT NULL CHECK (check_number > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT settlement_check_payable_digits_chk CHECK (customer_payable_minor ~ '^[0-9]+$'),
  UNIQUE (settlement_group_id, check_number)
);

CREATE INDEX IF NOT EXISTS idx_settlement_check_group
  ON settlement_check (settlement_group_id);

CREATE TABLE IF NOT EXISTS settlement_check_line_allocation (
  settlement_check_line_allocation_id UUID PRIMARY KEY,
  settlement_check_id UUID NOT NULL REFERENCES settlement_check (settlement_check_id) ON DELETE CASCADE,
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id) ON DELETE CASCADE,
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id),
  allocated_merchandise_gross_minor TEXT NOT NULL,
  CONSTRAINT settlement_check_line_alloc_digits_chk CHECK (
    allocated_merchandise_gross_minor ~ '^[0-9]+$'
  ),
  UNIQUE (settlement_check_id, order_line_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_check_line_alloc_group
  ON settlement_check_line_allocation (settlement_group_id);

CREATE INDEX IF NOT EXISTS idx_settlement_check_line_alloc_line
  ON settlement_check_line_allocation (order_line_id);
