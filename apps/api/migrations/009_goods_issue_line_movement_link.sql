-- D1.3B follow-up: link evidence goods_issue_line rows to aggregated InventoryMovement.
-- Same catalog item across OrderLines shares one OUT at the sale business position.

ALTER TABLE goods_issue_line
  ADD COLUMN IF NOT EXISTS inventory_movement_id UUID;

CREATE INDEX IF NOT EXISTS idx_goods_issue_line_movement
  ON goods_issue_line (inventory_movement_id);

COMMENT ON COLUMN goods_issue_line.inventory_movement_id IS
  'Shared InventoryMovement OUT when multiple physical leaves of the same catalog item are aggregated within one GoodsIssue.';
