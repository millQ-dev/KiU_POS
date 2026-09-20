-- CASH1.1 — Canonical CashShift foundation + Open (Cash Management ownership).
-- ADR-0036 / ADR-0002. Opening cash is drawer float — not Payment/Settlement/Tax/Fiscal.
-- Terminal ≠ DeviceIdentity. No device_id column. No orphan counter_service history.

CREATE TABLE cash_shift (
  cash_shift_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL,
  terminal_id UUID NOT NULL REFERENCES terminal (terminal_id),
  status TEXT NOT NULL,
  opening_amount_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INT NOT NULL,
  opened_by_user_id UUID NOT NULL,
  opened_by_employee_id UUID NULL REFERENCES workforce_employee (employee_id),
  auth_mode TEXT NOT NULL,
  approval_request_id UUID NULL REFERENCES identity_approval_request (approval_request_id),
  login_challenge_id UUID NULL REFERENCES identity_login_challenge (login_challenge_id),
  operation_fingerprint JSONB NOT NULL,
  open_idempotency_key TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_shift_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id),
  CONSTRAINT cash_shift_opener_user_fk
    FOREIGN KEY (opened_by_user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT cash_shift_status_ck
    CHECK (status IN ('OPEN', 'CLOSED', 'RECONCILED', 'ACCEPTED')),
  CONSTRAINT cash_shift_opening_digits_ck
    CHECK (opening_amount_minor ~ '^[0-9]+$'),
  CONSTRAINT cash_shift_currency_ck
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT cash_shift_exponent_ck
    CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  CONSTRAINT cash_shift_auth_mode_ck
    CHECK (auth_mode IN ('DIRECT_PERMISSION', 'APPROVAL')),
  CONSTRAINT cash_shift_open_idempotency_uq
    UNIQUE (tenant_id, open_idempotency_key)
);

-- Terminal must belong to the same tenant + outlet as the shift.
CREATE OR REPLACE FUNCTION cash_shift_assert_terminal_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM terminal t
    WHERE t.terminal_id = NEW.terminal_id
      AND t.tenant_id = NEW.tenant_id
      AND t.outlet_id = NEW.outlet_id
  ) THEN
    RAISE EXCEPTION 'cash_shift terminal/outlet/tenant coherence violation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_shift_terminal_scope_trg
  BEFORE INSERT OR UPDATE OF tenant_id, outlet_id, terminal_id ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION cash_shift_assert_terminal_scope();

-- ONE OPEN CashShift per Terminal (ADR-0036 MVP).
CREATE UNIQUE INDEX cash_shift_one_open_per_terminal_uq
  ON cash_shift (terminal_id)
  WHERE status = 'OPEN';

CREATE INDEX cash_shift_outlet_opened_idx
  ON cash_shift (tenant_id, outlet_id, opened_at DESC);

-- Opening historical facts are immutable after insert.
CREATE OR REPLACE FUNCTION cash_shift_protect_open_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'OPEN' AND (
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
    OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
    OR NEW.opened_by_user_id IS DISTINCT FROM OLD.opened_by_user_id
    OR NEW.opened_by_employee_id IS DISTINCT FROM OLD.opened_by_employee_id
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.opening_amount_minor IS DISTINCT FROM OLD.opening_amount_minor
    OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
    OR NEW.minor_unit_exponent IS DISTINCT FROM OLD.minor_unit_exponent
    OR NEW.auth_mode IS DISTINCT FROM OLD.auth_mode
    OR NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id
    OR NEW.login_challenge_id IS DISTINCT FROM OLD.login_challenge_id
    OR NEW.operation_fingerprint IS DISTINCT FROM OLD.operation_fingerprint
    OR NEW.open_idempotency_key IS DISTINCT FROM OLD.open_idempotency_key
  ) THEN
    RAISE EXCEPTION 'cash_shift opening history is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_shift_protect_open_history_trg
  BEFORE UPDATE ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION cash_shift_protect_open_history();

COMMENT ON TABLE cash_shift IS
  'Cash Management CashShift. CASH1.1 implements Open only. Opening cash = drawer float, not Payment.';
COMMENT ON COLUMN cash_shift.terminal_id IS
  'Organization Terminal (ADR-0018). Not DeviceIdentity.';
