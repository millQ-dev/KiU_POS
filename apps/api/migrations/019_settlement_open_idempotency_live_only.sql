-- S1.1 review fix: OpenSettlement idempotency key unique only for live Settlements.
-- After Abort, same key may open a fresh SettlementGroup.

DROP INDEX IF EXISTS uq_settlement_group_open_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_group_open_idempotency
  ON settlement_group (order_id, open_idempotency_key)
  WHERE state IN ('COLLECTING', 'SATISFIED');
