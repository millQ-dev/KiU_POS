-- ADR-0033: cash-specific evidence is owned by the cash shift transaction.
-- The generic Payments Core stays provider-neutral.
ALTER TABLE cash_shift_transaction
  ADD COLUMN IF NOT EXISTS tendered_minor TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS change_minor TEXT NOT NULL DEFAULT '0';

ALTER TABLE cash_shift_transaction
  DROP CONSTRAINT IF EXISTS cash_shift_tx_amount_digits_chk;

ALTER TABLE cash_shift_transaction
  ADD CONSTRAINT cash_shift_tx_amount_digits_chk
  CHECK (
    amount_minor ~ '^[0-9]+$'
    AND tendered_minor ~ '^[0-9]+$'
    AND change_minor ~ '^[0-9]+$'
  );
