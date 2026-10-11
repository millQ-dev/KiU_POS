-- FISC1.1: PaymentCollectionEvent + Fiscalization Core foundation
-- ADR-0014 (D1–D38) / ADR-0038 / ADR-0039 Accepted. Provider-neutral. No LEGAL GATE G2 claim.
-- CASH + CARD collection evidence. FiscalCheckoutGate fail-closed until authoritative evidence.

-- ---------------------------------------------------------------------------
-- Payments: collection-time provenance on provider outcomes (CARD)
-- ---------------------------------------------------------------------------
ALTER TABLE payment_provider_outcome
  ADD COLUMN IF NOT EXISTS collection_time_provenance TEXT;

ALTER TABLE payment_provider_outcome
  DROP CONSTRAINT IF EXISTS payment_provider_outcome_collection_provenance_ck;

ALTER TABLE payment_provider_outcome
  ADD CONSTRAINT payment_provider_outcome_collection_provenance_ck CHECK (
    collection_time_provenance IS NULL
    OR collection_time_provenance IN (
      'COLLECTION_OR_CAPTURE',
      'AUTHORIZATION',
      'UNKNOWN'
    )
  );

-- ---------------------------------------------------------------------------
-- Payments: immutable cash collection evidence (CASH ReceiveCash)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_cash_collection_evidence (
  payment_cash_collection_evidence_id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment (payment_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  settlement_check_id UUID NOT NULL REFERENCES settlement_check (settlement_check_id),
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id),
  cash_shift_id UUID NOT NULL REFERENCES cash_shift (cash_shift_id),
  terminal_id UUID NOT NULL REFERENCES terminal (terminal_id),
  outlet_id UUID NOT NULL,
  collected_by_user_id UUID NOT NULL,
  amount_due_minor TEXT NOT NULL,
  amount_tendered_minor TEXT NOT NULL,
  change_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INT NOT NULL,
  human_confirmation BOOLEAN NOT NULL,
  receive_idempotency_key TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT payment_cash_evidence_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id),
  CONSTRAINT payment_cash_evidence_user_fk
    FOREIGN KEY (collected_by_user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT payment_cash_evidence_due_digits_ck
    CHECK (amount_due_minor ~ '^[0-9]+$'),
  CONSTRAINT payment_cash_evidence_tendered_digits_ck
    CHECK (amount_tendered_minor ~ '^[0-9]+$'),
  CONSTRAINT payment_cash_evidence_change_digits_ck
    CHECK (change_minor ~ '^[0-9]+$'),
  CONSTRAINT payment_cash_evidence_currency_ck
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_cash_evidence_exponent_ck
    CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  CONSTRAINT payment_cash_evidence_confirmation_ck
    CHECK (human_confirmation = TRUE),
  CONSTRAINT payment_cash_evidence_payment_uq UNIQUE (payment_id),
  CONSTRAINT payment_cash_evidence_idempotency_uq
    UNIQUE (legal_entity_id, receive_idempotency_key)
);

-- One active qualifying CASH collection per Check (A3.4 / A6 concurrency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_cash_evidence_check
  ON payment_cash_collection_evidence (settlement_check_id);

CREATE INDEX IF NOT EXISTS idx_payment_cash_evidence_shift
  ON payment_cash_collection_evidence (cash_shift_id);

-- ---------------------------------------------------------------------------
-- Payments: immutable PaymentCollectionEvent (Payments-owned chronology SoT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_collection_event (
  payment_collection_event_id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment (payment_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  settlement_check_id UUID NOT NULL REFERENCES settlement_check (settlement_check_id),
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id),
  instrument_family TEXT NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  collection_evidence_kind TEXT NOT NULL,
  payment_provider_outcome_id UUID REFERENCES payment_provider_outcome (payment_provider_outcome_id),
  payment_cash_collection_evidence_id UUID
    REFERENCES payment_cash_collection_evidence (payment_cash_collection_evidence_id),
  amount_collected_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_collection_event_payment_uq UNIQUE (payment_id),
  CONSTRAINT payment_collection_event_amount_digits_ck
    CHECK (amount_collected_minor ~ '^[0-9]+$'),
  CONSTRAINT payment_collection_event_currency_ck
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_collection_event_exponent_ck
    CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  CONSTRAINT payment_collection_event_kind_ck CHECK (
    collection_evidence_kind IN ('CARD_PROVIDER_COLLECTION', 'CASH_RECEIVE')
  ),
  CONSTRAINT payment_collection_event_evidence_xor_ck CHECK (
    (
      collection_evidence_kind = 'CARD_PROVIDER_COLLECTION'
      AND payment_provider_outcome_id IS NOT NULL
      AND payment_cash_collection_evidence_id IS NULL
    )
    OR (
      collection_evidence_kind = 'CASH_RECEIVE'
      AND payment_cash_collection_evidence_id IS NOT NULL
      AND payment_provider_outcome_id IS NULL
    )
  )
);

-- One PaymentCollectionEvent per Check in FISC1.1 narrow shape (A6).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_collection_event_check
  ON payment_collection_event (settlement_check_id);

CREATE INDEX IF NOT EXISTS idx_payment_collection_event_group
  ON payment_collection_event (settlement_group_id);

-- ---------------------------------------------------------------------------
-- Identity: dedicated ReceiveCash permission (provisional key under Accepted A3)
-- Exact key name was RELEASE-BLOCKING OPEN in ADR-0038 A4; runtime binds
-- payments.receive_cash. Manager role alone must not substitute (A4 frozen).
-- ---------------------------------------------------------------------------
INSERT INTO identity_permission (permission_key, description) VALUES
  (
    'payments.receive_cash',
    'Authorize authenticated ReceiveCash tender acceptance (Payments-owned; not fiscal SATISFIED)'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Fiscalization: FiscalPolicy + versioned satisfaction evidence profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscal_policy (
  fiscal_policy_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  jurisdiction_code TEXT NOT NULL CHECK (jurisdiction_code ~ '^[A-Z]{2}$'),
  policy_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_policy_code_uq UNIQUE (tenant_id, legal_entity_id, policy_code)
);

CREATE TABLE IF NOT EXISTS fiscal_policy_version (
  fiscal_policy_version_id UUID PRIMARY KEY,
  fiscal_policy_id UUID NOT NULL REFERENCES fiscal_policy (fiscal_policy_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  -- Explicit FiscalPolicy determination only — never missing-config fallback (ADR-0014 D7).
  fiscal_document_required BOOLEAN NOT NULL,
  satisfaction_evidence_profile JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT fiscal_policy_version_interval_ck CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT fiscal_policy_version_uq UNIQUE (fiscal_policy_id, policy_version),
  CONSTRAINT fiscal_policy_version_profile_object_ck CHECK (
    jsonb_typeof(satisfaction_evidence_profile) = 'object'
  )
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE fiscal_policy_version
  DROP CONSTRAINT IF EXISTS fiscal_policy_version_no_overlap;

ALTER TABLE fiscal_policy_version
  ADD CONSTRAINT fiscal_policy_version_no_overlap
  EXCLUDE USING gist (
    fiscal_policy_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

CREATE INDEX IF NOT EXISTS fiscal_policy_version_lookup_idx
  ON fiscal_policy_version (tenant_id, legal_entity_id, effective_from);

-- Explicit LE fiscal requirement flag (NULL = undecided → fail closed, never NOT_REQUIRED).
ALTER TABLE legal_entity
  ADD COLUMN IF NOT EXISTS fiscal_required BOOLEAN;

COMMENT ON COLUMN legal_entity.fiscal_required IS
  'TRUE=FiscalDocument required; FALSE=explicitly not required; NULL=undecided fail-closed. Never invent NOT_REQUIRED from missing FiscalPolicy.';

-- ---------------------------------------------------------------------------
-- Fiscalization: FiscalDocument / Submission / Attempt / Outcome evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscal_document (
  fiscal_document_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id),
  settlement_check_id UUID NOT NULL REFERENCES settlement_check (settlement_check_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  payment_id UUID NOT NULL REFERENCES payment (payment_id),
  payment_collection_event_id UUID NOT NULL
    REFERENCES payment_collection_event (payment_collection_event_id),
  tax_order_snapshot_id UUID NOT NULL REFERENCES tax_order_snapshot (tax_order_snapshot_id),
  fiscal_policy_id UUID NOT NULL REFERENCES fiscal_policy (fiscal_policy_id),
  fiscal_policy_version_id UUID NOT NULL REFERENCES fiscal_policy_version (fiscal_policy_version_id),
  -- Business time from PaymentCollectionEvent — never ingest/settlement/fiscal ACK clocks.
  collection_business_time TIMESTAMPTZ NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INT NOT NULL,
  document_amount_minor TEXT NOT NULL,
  tax_semantic_fingerprint TEXT NOT NULL,
  issue_idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_document_status_ck CHECK (
    status IN (
      'PENDING_ISSUE',
      'ISSUED_PENDING_EVIDENCE',
      'SATISFIED',
      'FAILED',
      'BLOCKED_SHAPE',
      'BLOCKED_MISSING_COLLECTION',
      'BLOCKED_MISSING_TAX',
      'BLOCKED_POLICY'
    )
  ),
  CONSTRAINT fiscal_document_amount_digits_ck CHECK (document_amount_minor ~ '^[0-9]+$'),
  CONSTRAINT fiscal_document_currency_ck CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT fiscal_document_idempotency_uq
    UNIQUE (legal_entity_id, issue_idempotency_key),
  CONSTRAINT fiscal_document_group_uq UNIQUE (settlement_group_id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_document_order
  ON fiscal_document (order_id);

CREATE TABLE IF NOT EXISTS fiscal_submission (
  fiscal_submission_id UUID PRIMARY KEY,
  fiscal_document_id UUID NOT NULL REFERENCES fiscal_document (fiscal_document_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  submission_idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_submission_status_ck CHECK (
    status IN ('PENDING', 'IN_FLIGHT', 'COMPLETED', 'NEEDS_RECONCILE', 'FAILED')
  ),
  CONSTRAINT fiscal_submission_idempotency_uq
    UNIQUE (fiscal_document_id, submission_idempotency_key)
);

CREATE TABLE IF NOT EXISTS fiscal_provider_attempt (
  fiscal_provider_attempt_id UUID PRIMARY KEY,
  fiscal_submission_id UUID NOT NULL REFERENCES fiscal_submission (fiscal_submission_id),
  fiscal_document_id UUID NOT NULL REFERENCES fiscal_document (fiscal_document_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  attempt_number INT NOT NULL CHECK (attempt_number > 0),
  operation TEXT NOT NULL,
  adapter_identity TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT fiscal_provider_attempt_operation_ck CHECK (
    operation IN (
      'ISSUE',
      'QUERY_STATUS',
      'RETRIEVE_EVIDENCE',
      'IDEMPOTENT_RETRY',
      'RECONCILE_TIMEOUT'
    )
  ),
  CONSTRAINT fiscal_provider_attempt_status_ck CHECK (
    status IN (
      'STARTED',
      'SUCCEEDED',
      'FAILED',
      'TIMEOUT',
      'ADAPTER_UNAVAILABLE',
      'REJECTED'
    )
  ),
  CONSTRAINT fiscal_provider_attempt_number_uq
    UNIQUE (fiscal_submission_id, attempt_number)
);

-- Append-only immutable provider outcomes (never overwrite).
CREATE TABLE IF NOT EXISTS fiscal_provider_outcome_evidence (
  fiscal_provider_outcome_evidence_id UUID PRIMARY KEY,
  fiscal_provider_attempt_id UUID NOT NULL
    REFERENCES fiscal_provider_attempt (fiscal_provider_attempt_id),
  fiscal_document_id UUID NOT NULL REFERENCES fiscal_document (fiscal_document_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  evidence_class TEXT NOT NULL,
  provider_reference TEXT,
  raw_provider_status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  diagnostic_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_provider_outcome_evidence_class_ck CHECK (
    evidence_class IN (
      'AUTHORITY_ACCEPTED',
      'PROVIDER_CONFIRMED_ISSUED',
      'AUTHORITATIVE_RETRIEVAL',
      'TRANSPORT_TIMEOUT',
      'TRANSPORT_FAILURE',
      'ADAPTER_UNAVAILABLE',
      'UNKNOWN',
      'REJECTED'
    )
  ),
  CONSTRAINT fiscal_provider_outcome_verification_ck CHECK (
    verification_status IN ('VERIFIED', 'UNVERIFIED')
  ),
  CONSTRAINT fiscal_provider_outcome_attempt_uq UNIQUE (fiscal_provider_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_provider_outcome_document
  ON fiscal_provider_outcome_evidence (fiscal_document_id);
