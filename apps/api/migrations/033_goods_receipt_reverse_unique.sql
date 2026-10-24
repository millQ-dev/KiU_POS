-- GoodsReceipt: at most one compensating reverse document per original (ADR-0010).
-- Partial UNIQUE allows many ordinary receipts with NULL reverses_goods_receipt_id.
-- Applied only via transactional migrate runner (no CONCURRENTLY).
-- Do not rewrite or delete historical documents in this migration.

CREATE UNIQUE INDEX uq_goods_receipt_reverses_original
  ON goods_receipt (reverses_goods_receipt_id)
  WHERE reverses_goods_receipt_id IS NOT NULL;

COMMENT ON INDEX uq_goods_receipt_reverses_original IS
  'At most one GoodsReceipt may reverse a given original; NULL reverse pointers remain unrestricted.';
