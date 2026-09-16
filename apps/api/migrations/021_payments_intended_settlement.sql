-- PAY1.1 follow-up: bind Payment intent to Settlement for abort/external-effect integrity
ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS intended_settlement_group_id UUID
    REFERENCES settlement_group (settlement_group_id),
  ADD COLUMN IF NOT EXISTS intended_settlement_check_id UUID
    REFERENCES settlement_check (settlement_check_id);

CREATE INDEX IF NOT EXISTS idx_payment_intended_group_state
  ON payment (intended_settlement_group_id, lifecycle_state)
  WHERE intended_settlement_group_id IS NOT NULL;
