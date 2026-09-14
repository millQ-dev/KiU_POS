-- Block D1.2B: ProductionBatch inventory/economic posting state (FINALIZED fact ≠ POSTED).
-- Does not replace D1.2A DRAFT→FINALIZED lifecycle. Inventory movements reuse Block C tables.

ALTER TABLE production_batch
  ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'UNPOSTED'
    CHECK (posting_status IN ('UNPOSTED', 'POSTED', 'REVERSED')),
  ADD COLUMN IF NOT EXISTS legal_entity_id UUID REFERENCES legal_entity (legal_entity_id),
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  ADD COLUMN IF NOT EXISTS minor_unit_exponent INTEGER,
  ADD COLUMN IF NOT EXISTS business_date DATE,
  ADD COLUMN IF NOT EXISTS business_time TIME,
  ADD COLUMN IF NOT EXISTS business_order INTEGER,
  ADD COLUMN IF NOT EXISTS post_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS post_semantic_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by UUID,
  ADD COLUMN IF NOT EXISTS reverses_production_batch_id UUID REFERENCES production_batch (production_batch_id),
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_batch_cost_minor TEXT,
  ADD COLUMN IF NOT EXISTS actual_batch_cost_certainty TEXT
    CHECK (
      actual_batch_cost_certainty IS NULL
      OR actual_batch_cost_certainty IN ('FINAL', 'ESTIMATED_FROM_LAST_KNOWN', 'UNKNOWN', 'ORDER_UNRESOLVED')
    ),
  ADD COLUMN IF NOT EXISTS actual_output_unit_cost_minor TEXT;

-- Idempotency scoped like GoodsReceipt: unique when key is set (NULLs allowed for unposted).
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_batch_post_idempotency
  ON production_batch (legal_entity_id, post_idempotency_key)
  WHERE post_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_batch_posting_status
  ON production_batch (tenant_id, posting_status);

COMMENT ON COLUMN production_batch.posting_status IS
  'D1.2B: UNPOSTED/POSTED/REVERSED. Orthogonal to status DRAFT/FINALIZED (D1.2A production fact).';
COMMENT ON COLUMN production_batch.actual_batch_cost_minor IS
  'Sum of posted input acquisition costs (CostValue minor units). NULL until POSTED.';
