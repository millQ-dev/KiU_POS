-- CASH1.2 — CloseCashShift (ADR-0046). OPEN → CLOSED only.
-- Expected = opening + Σ CASH PCE amount_collected_minor (no fake refunds).
-- Close evidence immutable. Permissions: cash_shift.close / cash_shift.close.shortage.

INSERT INTO identity_permission (permission_key, description) VALUES
  ('cash_shift.close', 'Close an OPEN CashShift when balanced or surplus (requires pos.operate composition)'),
  ('cash_shift.close.shortage', 'Close an OPEN CashShift with shortage (Manager/Owner exception path; no cashier bypass)')
ON CONFLICT (permission_key) DO NOTHING;

ALTER TABLE cash_shift
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS closed_by_employee_id UUID,
  ADD COLUMN IF NOT EXISTS actual_amount_minor TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount_minor TEXT,
  ADD COLUMN IF NOT EXISTS difference_minor TEXT,
  ADD COLUMN IF NOT EXISTS variance_kind TEXT,
  ADD COLUMN IF NOT EXISTS close_reason_text TEXT,
  ADD COLUMN IF NOT EXISTS close_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS expected_source_refs JSONB;

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_closed_by_user_fk;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_closed_by_user_fk
    FOREIGN KEY (closed_by_user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id);

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_closed_by_employee_fk;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_closed_by_employee_fk
    FOREIGN KEY (closed_by_employee_id) REFERENCES workforce_employee (employee_id);

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_variance_kind_ck;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_variance_kind_ck CHECK (
    variance_kind IS NULL
    OR variance_kind IN ('BALANCED', 'SURPLUS', 'SHORTAGE')
  );

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_actual_digits_ck;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_actual_digits_ck CHECK (
    actual_amount_minor IS NULL OR actual_amount_minor ~ '^[0-9]+$'
  );

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_expected_digits_ck;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_expected_digits_ck CHECK (
    expected_amount_minor IS NULL OR expected_amount_minor ~ '^[0-9]+$'
  );

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_difference_digits_ck;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_difference_digits_ck CHECK (
    difference_minor IS NULL OR difference_minor ~ '^-?[0-9]+$'
  );

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_open_no_close_ck;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_open_no_close_ck CHECK (
    status <> 'OPEN'
    OR (
      closed_at IS NULL
      AND closed_by_user_id IS NULL
      AND closed_by_employee_id IS NULL
      AND actual_amount_minor IS NULL
      AND expected_amount_minor IS NULL
      AND difference_minor IS NULL
      AND variance_kind IS NULL
      AND close_reason_text IS NULL
      AND close_idempotency_key IS NULL
      AND expected_source_refs IS NULL
    )
  );

ALTER TABLE cash_shift
  DROP CONSTRAINT IF EXISTS cash_shift_closed_coherent_ck;
ALTER TABLE cash_shift
  ADD CONSTRAINT cash_shift_closed_coherent_ck CHECK (
    status <> 'CLOSED'
    OR (
      closed_at IS NOT NULL
      AND closed_by_user_id IS NOT NULL
      AND actual_amount_minor IS NOT NULL
      AND expected_amount_minor IS NOT NULL
      AND difference_minor IS NOT NULL
      AND variance_kind IS NOT NULL
      AND close_idempotency_key IS NOT NULL
      AND expected_source_refs IS NOT NULL
      AND (
        (
          variance_kind = 'BALANCED'
          AND difference_minor = '0'
        )
        OR (
          variance_kind = 'SURPLUS'
          AND difference_minor ~ '^[1-9][0-9]*$'
          AND close_reason_text IS NOT NULL
          AND length(trim(close_reason_text)) > 0
        )
        OR (
          variance_kind = 'SHORTAGE'
          AND difference_minor ~ '^-[1-9][0-9]*$'
          AND close_reason_text IS NOT NULL
          AND length(trim(close_reason_text)) > 0
        )
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS cash_shift_close_idempotency_uq
  ON cash_shift (tenant_id, close_idempotency_key)
  WHERE close_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION cash_shift_protect_close_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'CLOSED' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    OR NEW.closed_by_user_id IS DISTINCT FROM OLD.closed_by_user_id
    OR NEW.closed_by_employee_id IS DISTINCT FROM OLD.closed_by_employee_id
    OR NEW.actual_amount_minor IS DISTINCT FROM OLD.actual_amount_minor
    OR NEW.expected_amount_minor IS DISTINCT FROM OLD.expected_amount_minor
    OR NEW.difference_minor IS DISTINCT FROM OLD.difference_minor
    OR NEW.variance_kind IS DISTINCT FROM OLD.variance_kind
    OR NEW.close_reason_text IS DISTINCT FROM OLD.close_reason_text
    OR NEW.close_idempotency_key IS DISTINCT FROM OLD.close_idempotency_key
    OR NEW.expected_source_refs IS DISTINCT FROM OLD.expected_source_refs
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
    OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
    OR NEW.opening_amount_minor IS DISTINCT FROM OLD.opening_amount_minor
    OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
    OR NEW.minor_unit_exponent IS DISTINCT FROM OLD.minor_unit_exponent
    OR NEW.opened_by_user_id IS DISTINCT FROM OLD.opened_by_user_id
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.open_idempotency_key IS DISTINCT FROM OLD.open_idempotency_key
  ) THEN
    RAISE EXCEPTION 'cash_shift close history is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cash_shift_protect_close_history_trg ON cash_shift;
CREATE TRIGGER cash_shift_protect_close_history_trg
  BEFORE UPDATE ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION cash_shift_protect_close_history();

COMMENT ON TABLE cash_shift IS
  'Cash Management CashShift. CASH1.2: Open + Close (OPEN→CLOSED). Opening/close evidence immutable. Not Payment.';
COMMENT ON COLUMN cash_shift.expected_amount_minor IS
  'Server-computed expected drawer: opening + Σ CASH PCE amount_collected_minor (ADR-0046).';
COMMENT ON COLUMN cash_shift.difference_minor IS
  'Signed exact minor units: actual − expected. Never client-trusted.';
COMMENT ON COLUMN cash_shift.expected_source_refs IS
  'JSON array of payment_collection_event_id values summed into expected.';
