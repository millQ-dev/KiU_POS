-- D1.2B remediation: certainty provenance, valuation-currency stream scope,
-- business-chronology-only replay support, dedicated production_batch_reversal.

-- ---------------------------------------------------------------------------
-- Authoritative valuation currency on legal entity (ADR-0002/0003 stream scope)
-- ---------------------------------------------------------------------------
ALTER TABLE legal_entity
  ADD COLUMN IF NOT EXISTS valuation_currency_code CHAR(3) NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS valuation_minor_unit_exponent SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE legal_entity
  DROP CONSTRAINT IF EXISTS legal_entity_valuation_minor_unit_exponent_check;
ALTER TABLE legal_entity
  ADD CONSTRAINT legal_entity_valuation_minor_unit_exponent_check
    CHECK (valuation_minor_unit_exponent BETWEEN 0 AND 4);

COMMENT ON COLUMN legal_entity.valuation_currency_code IS
  'Authoritative valuation currency for inventory cost streams under this legal entity.';

-- ---------------------------------------------------------------------------
-- Movement certainty / provenance (ADR-0003 / ADR-0019)
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_movement
  ADD COLUMN IF NOT EXISTS cost_certainty TEXT,
  ADD COLUMN IF NOT EXISTS cost_basis TEXT;

ALTER TABLE inventory_movement
  DROP CONSTRAINT IF EXISTS inventory_movement_cost_certainty_check;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_cost_certainty_check
    CHECK (
      cost_certainty IS NULL
      OR cost_certainty IN (
        'FINAL',
        'ESTIMATED_FROM_LAST_KNOWN',
        'UNKNOWN',
        'ORDER_UNRESOLVED'
      )
    );

ALTER TABLE inventory_movement
  DROP CONSTRAINT IF EXISTS inventory_movement_cost_basis_check;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_cost_basis_check
    CHECK (
      cost_basis IS NULL
      OR cost_basis IN ('ACTUAL_STOCK_VALUATION', 'SUPPLIER_PRICE', 'ESTIMATED')
    );

-- Backfill existing movements as FINAL supplier/stock valuation (Block C receipts).
UPDATE inventory_movement
SET cost_certainty = 'FINAL',
    cost_basis = CASE
      WHEN source_document_type LIKE 'GoodsReceipt%' THEN 'SUPPLIER_PRICE'
      ELSE 'ACTUAL_STOCK_VALUATION'
    END
WHERE cost_certainty IS NULL;

ALTER TABLE inventory_movement
  ALTER COLUMN cost_certainty SET NOT NULL,
  ALTER COLUMN cost_certainty SET DEFAULT 'FINAL';

CREATE INDEX IF NOT EXISTS idx_inventory_movement_valuation_stream
  ON inventory_movement (
    legal_entity_id,
    warehouse_id,
    catalog_item_id,
    currency_code,
    business_date,
    business_order
  );

-- ---------------------------------------------------------------------------
-- Balance identity includes valuation currency + carrying certainty
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_balance
  ADD COLUMN IF NOT EXISTS carrying_certainty TEXT NOT NULL DEFAULT 'FINAL';

ALTER TABLE inventory_balance
  DROP CONSTRAINT IF EXISTS inventory_balance_carrying_certainty_check;
ALTER TABLE inventory_balance
  ADD CONSTRAINT inventory_balance_carrying_certainty_check
    CHECK (
      carrying_certainty IN (
        'FINAL',
        'ESTIMATED_FROM_LAST_KNOWN',
        'UNKNOWN',
        'ORDER_UNRESOLVED'
      )
    );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'inventory_balance'
      AND constraint_type = 'PRIMARY KEY'
      AND constraint_name = 'inventory_balance_pkey'
  ) THEN
    ALTER TABLE inventory_balance DROP CONSTRAINT inventory_balance_pkey;
  END IF;
END $$;

ALTER TABLE inventory_balance
  ADD CONSTRAINT inventory_balance_pkey
  PRIMARY KEY (legal_entity_id, warehouse_id, catalog_item_id, currency_code);

-- ---------------------------------------------------------------------------
-- Dedicated production posting reversal entity (not a fake production_batch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_batch_reversal (
  production_batch_reversal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  production_batch_id UUID NOT NULL REFERENCES production_batch (production_batch_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  warehouse_id UUID NOT NULL REFERENCES warehouse (warehouse_id),
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  reason TEXT,
  actor_id UUID,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_production_batch_reversal_batch UNIQUE (production_batch_id),
  CONSTRAINT uq_production_batch_reversal_idempotency UNIQUE (legal_entity_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_production_batch_reversal_batch
  ON production_batch_reversal (production_batch_id);

COMMENT ON TABLE production_batch_reversal IS
  'Immutable posting-reversal fact for a ProductionBatch. Compensating movements use source_document_type=ProductionBatchReversal and this id.';
