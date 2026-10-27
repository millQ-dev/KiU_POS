-- ADR-0048 Accepted WITH DELTAS (2026-10-27) — C0-REFUND-B1
-- Refund request / reservation / payout attempt foundation.
-- Docs Accept ≠ production migrate GO. Disposable PG only for apply in CI/dev tests.
-- No CashShift expected subtraction, no VietQR adapter, no public payout confirmation without evidence.

CREATE TABLE IF NOT EXISTS payment_refund (
  payment_refund_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  original_payment_id UUID NOT NULL REFERENCES payment (payment_id),
  settlement_check_id UUID NOT NULL REFERENCES settlement_check (settlement_check_id),
  settlement_group_id UUID NOT NULL REFERENCES settlement_group (settlement_group_id),
  outlet_id UUID NOT NULL,
  tender_definition_id UUID NOT NULL REFERENCES tender_definition (tender_definition_id),
  instrument_family TEXT NOT NULL,
  amount_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL
    CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  financial_status TEXT NOT NULL
    CHECK (financial_status IN (
      'AUTHORIZED',
      'EXECUTION_PENDING',
      'EXECUTION_UNKNOWN',
      'RECONCILE_BLOCKED',
      'EXECUTION_FAILED',
      'MONEY_RETURNED'
    )),
  reservation_holds_capacity BOOLEAN NOT NULL,
  non_payment_proven BOOLEAN NOT NULL DEFAULT FALSE,
  refund_idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  authorized_by_user_id UUID,
  payout_attempt_id UUID,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_refund_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id),
  CONSTRAINT payment_refund_amount_digits_ck CHECK (amount_minor ~ '^[1-9][0-9]*$'),
  CONSTRAINT payment_refund_currency_ck CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_refund_instrument_nonempty_ck CHECK (length(trim(instrument_family)) > 0),
  CONSTRAINT payment_refund_fingerprint_nonempty_ck CHECK (length(trim(semantic_fingerprint)) > 0),
  CONSTRAINT payment_refund_reason_nonempty_ck CHECK (length(trim(reason_text)) > 0),
  CONSTRAINT payment_refund_capacity_status_ck CHECK (
    (
      financial_status IN (
        'AUTHORIZED', 'EXECUTION_PENDING', 'EXECUTION_UNKNOWN', 'RECONCILE_BLOCKED'
      )
      AND reservation_holds_capacity = TRUE
    )
    OR (
      financial_status IN ('EXECUTION_FAILED', 'MONEY_RETURNED')
      AND reservation_holds_capacity = FALSE
    )
  ),
  CONSTRAINT payment_refund_failed_proof_ck CHECK (
    financial_status <> 'EXECUTION_FAILED'
    OR non_payment_proven = TRUE
  ),
  CONSTRAINT payment_refund_money_returned_confirmed_ck CHECK (
    financial_status <> 'MONEY_RETURNED'
    OR confirmed_at IS NOT NULL
  ),
  UNIQUE (legal_entity_id, refund_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_payment_active
  ON payment_refund (original_payment_id)
  WHERE reservation_holds_capacity = TRUE;

CREATE INDEX IF NOT EXISTS idx_payment_refund_payment_confirmed
  ON payment_refund (original_payment_id)
  WHERE financial_status = 'MONEY_RETURNED';

CREATE INDEX IF NOT EXISTS idx_payment_refund_check
  ON payment_refund (settlement_check_id);

-- Durable payout attempt identity (created when leaving AUTHORIZED toward execution).
CREATE TABLE IF NOT EXISTS payment_refund_payout_attempt (
  payout_attempt_id UUID PRIMARY KEY,
  payment_refund_id UUID NOT NULL REFERENCES payment_refund (payment_refund_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL
    CHECK (status IN (
      'EXECUTION_PENDING',
      'EXECUTION_UNKNOWN',
      'RECONCILE_BLOCKED',
      'EXECUTION_FAILED',
      'MONEY_RETURNED'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_refund_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_payout_attempt_refund
  ON payment_refund_payout_attempt (payment_refund_id);

ALTER TABLE payment_refund
  DROP CONSTRAINT IF EXISTS payment_refund_payout_attempt_fk;
ALTER TABLE payment_refund
  ADD CONSTRAINT payment_refund_payout_attempt_fk
    FOREIGN KEY (payout_attempt_id)
    REFERENCES payment_refund_payout_attempt (payout_attempt_id);

-- Append-only immutable evidence (authorization, transitions, proofs).
CREATE TABLE IF NOT EXISTS payment_refund_evidence (
  payment_refund_evidence_id UUID PRIMARY KEY,
  payment_refund_id UUID NOT NULL REFERENCES payment_refund (payment_refund_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  evidence_kind TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_actor_id UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_refund_evidence_kind_nonempty_ck CHECK (length(trim(evidence_kind)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_evidence_refund
  ON payment_refund_evidence (payment_refund_id, recorded_at);
