-- PAY1.1: Payments Core Runtime (ADR-0013 / ADR-0016 / ADR-0032)
-- Provider-neutral TenderDefinition / Payment / Outcome evidence / PaymentAllocation.
-- No provider SDK tables, no wallet, no FiscalDocument, no credentials.

CREATE TABLE IF NOT EXISTS tender_definition (
  tender_definition_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Extensible identity axes (nullable; NOT a closed CASH|CARD enum)
  provider_identity TEXT,
  rail_identity TEXT,
  instrument_family TEXT,
  presentation_capability TEXT,
  external_config_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tender_definition_code_nonempty_chk CHECK (length(trim(code)) > 0),
  CONSTRAINT tender_definition_provider_axes_chk CHECK (
    (provider_identity IS NULL OR length(trim(provider_identity)) > 0)
    AND (rail_identity IS NULL OR length(trim(rail_identity)) > 0)
    AND (instrument_family IS NULL OR length(trim(instrument_family)) > 0)
    AND (presentation_capability IS NULL OR length(trim(presentation_capability)) > 0)
  ),
  UNIQUE (tenant_id, legal_entity_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tender_definition_le
  ON tender_definition (legal_entity_id);

-- Canonical lifecycle: INITIATED | PENDING | SUCCEEDED | FAILED | CANCELLED | EXPIRED | UNKNOWN
CREATE TABLE IF NOT EXISTS payment (
  payment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  tender_definition_id UUID NOT NULL REFERENCES tender_definition (tender_definition_id),
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  requested_amount_minor TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL
    CHECK (lifecycle_state IN (
      'INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'
    )),
  create_idempotency_key TEXT NOT NULL,
  merchant_payment_reference TEXT NOT NULL,
  provider_transaction_reference TEXT,
  reconciliation_state TEXT NOT NULL DEFAULT 'NONE'
    CHECK (reconciliation_state IN ('NONE', 'AWAITING', 'RECONCILED', 'QUARANTINED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_amount_digits_chk CHECK (requested_amount_minor ~ '^[0-9]+$'),
  UNIQUE (legal_entity_id, create_idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_tx_ref
  ON payment (legal_entity_id, tender_definition_id, provider_transaction_reference)
  WHERE provider_transaction_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_le_state
  ON payment (legal_entity_id, lifecycle_state);

-- Immutable provider-outcome evidence (append-only)
CREATE TABLE IF NOT EXISTS payment_provider_outcome (
  payment_provider_outcome_id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment (payment_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  provider_event_identity TEXT NOT NULL,
  merchant_request_identity TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_occurred_at TIMESTAMPTZ,
  raw_provider_status TEXT NOT NULL,
  normalized_outcome TEXT NOT NULL
    CHECK (normalized_outcome IN (
      'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN',
      'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'UNVERIFIED'
    )),
  evidence_amount_minor TEXT,
  evidence_currency_code TEXT,
  verification_status TEXT NOT NULL
    CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED')),
  reconciliation_origin TEXT NOT NULL
    CHECK (reconciliation_origin IN ('CALLBACK', 'INQUIRY', 'DEV_SIMULATOR', 'SYSTEM')),
  diagnostic_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT payment_provider_outcome_amount_digits_chk CHECK (
    evidence_amount_minor IS NULL OR evidence_amount_minor ~ '^[0-9]+$'
  ),
  UNIQUE (payment_id, provider_event_identity)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_outcome_payment
  ON payment_provider_outcome (payment_id);

CREATE TABLE IF NOT EXISTS payment_allocation (
  payment_allocation_id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment (payment_id),
  settlement_check_id UUID NOT NULL REFERENCES settlement_check (settlement_check_id),
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  amount_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  allocation_idempotency_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_allocation_amount_digits_chk CHECK (amount_minor ~ '^[1-9][0-9]*$|^0$'),
  UNIQUE (payment_id, allocation_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocation_check
  ON payment_allocation (settlement_check_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_payment_allocation_group
  ON payment_allocation (settlement_group_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_payment_allocation_payment
  ON payment_allocation (payment_id)
  WHERE active;
