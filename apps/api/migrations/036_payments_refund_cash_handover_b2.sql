-- ADR-0048 C0-REFUND-B2 — CASH human handover confirmation + B1 hardenings.
-- Docs Accept ≠ production migrate GO. Disposable PG / CI only until separate PO GO.
-- Expected at Close = opening + Σ CASH PCE − Σ confirmed CASH refunds (cash_shift_id).

INSERT INTO identity_permission (permission_key, description) VALUES
  ('payments.refund_cash', 'Authorize/execute CASH refund path when Owner-assigned (ADR-0048 R8)'),
  ('payments.refund_vietqr', 'Authorize/execute VietQR refund path when Owner-assigned and provider gate open'),
  ('payments.refund.approve', 'Sensitive / future over-limit refund approve (thresholds not set in ADR-0048)'),
  ('payments.refund.reconcile', 'Clear RECONCILE_BLOCKED / UNKNOWN refund with audited decision')
ON CONFLICT (permission_key) DO NOTHING;

-- Bind confirmed CASH payout to the OPEN CashShift that paid out.
ALTER TABLE payment_refund
  ADD COLUMN IF NOT EXISTS cash_shift_id UUID REFERENCES cash_shift (cash_shift_id);

CREATE INDEX IF NOT EXISTS idx_payment_refund_cash_shift_confirmed
  ON payment_refund (cash_shift_id)
  WHERE financial_status = 'MONEY_RETURNED' AND cash_shift_id IS NOT NULL;

ALTER TABLE payment_refund
  DROP CONSTRAINT IF EXISTS payment_refund_cash_shift_money_ck;
ALTER TABLE payment_refund
  ADD CONSTRAINT payment_refund_cash_shift_money_ck CHECK (
    financial_status <> 'MONEY_RETURNED'
    OR instrument_family <> 'CASH'
    OR cash_shift_id IS NOT NULL
  );

-- Durable CASH handover confirmation evidence (production path; not disposable test proof).
CREATE TABLE IF NOT EXISTS payment_refund_cash_handover_evidence (
  payment_refund_cash_handover_evidence_id UUID PRIMARY KEY,
  payment_refund_id UUID NOT NULL REFERENCES payment_refund (payment_refund_id),
  payout_attempt_id UUID NOT NULL REFERENCES payment_refund_payout_attempt (payout_attempt_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  original_payment_id UUID NOT NULL REFERENCES payment (payment_id),
  amount_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL
    CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  outlet_id UUID NOT NULL,
  cash_shift_id UUID NOT NULL REFERENCES cash_shift (cash_shift_id),
  confirmed_by_user_id UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  human_confirmation BOOLEAN NOT NULL,
  confirm_idempotency_key TEXT NOT NULL,
  CONSTRAINT payment_refund_cash_handover_outlet_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id),
  CONSTRAINT payment_refund_cash_handover_user_fk
    FOREIGN KEY (confirmed_by_user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT payment_refund_cash_handover_amount_digits_ck CHECK (amount_minor ~ '^[1-9][0-9]*$'),
  CONSTRAINT payment_refund_cash_handover_currency_ck CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_refund_cash_handover_human_ck CHECK (human_confirmation = TRUE),
  CONSTRAINT payment_refund_cash_handover_refund_uq UNIQUE (payment_refund_id),
  CONSTRAINT payment_refund_cash_handover_idem_uq UNIQUE (legal_entity_id, confirm_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_cash_handover_shift
  ON payment_refund_cash_handover_evidence (cash_shift_id);

-- Append-only: application must not UPDATE/DELETE refund evidence rows.
CREATE OR REPLACE FUNCTION payment_refund_evidence_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_refund_evidence is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS payment_refund_evidence_no_update ON payment_refund_evidence;
CREATE TRIGGER payment_refund_evidence_no_update
  BEFORE UPDATE ON payment_refund_evidence
  FOR EACH ROW EXECUTE FUNCTION payment_refund_evidence_forbid_mutation();

DROP TRIGGER IF EXISTS payment_refund_evidence_no_delete ON payment_refund_evidence;
CREATE TRIGGER payment_refund_evidence_no_delete
  BEFORE DELETE ON payment_refund_evidence
  FOR EACH ROW EXECUTE FUNCTION payment_refund_evidence_forbid_mutation();

CREATE OR REPLACE FUNCTION payment_refund_cash_handover_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_refund_cash_handover_evidence is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS payment_refund_cash_handover_no_update ON payment_refund_cash_handover_evidence;
CREATE TRIGGER payment_refund_cash_handover_no_update
  BEFORE UPDATE ON payment_refund_cash_handover_evidence
  FOR EACH ROW EXECUTE FUNCTION payment_refund_cash_handover_forbid_mutation();

DROP TRIGGER IF EXISTS payment_refund_cash_handover_no_delete ON payment_refund_cash_handover_evidence;
CREATE TRIGGER payment_refund_cash_handover_no_delete
  BEFORE DELETE ON payment_refund_cash_handover_evidence
  FOR EACH ROW EXECUTE FUNCTION payment_refund_cash_handover_forbid_mutation();

COMMENT ON COLUMN cash_shift.expected_source_refs IS
  'JSON array of expected inputs: PCE ids (strings) and/or {kind:"CASH_REFUND",payment_refund_id} objects. Frozen at Close.';
