-- Block D1.4B: Order Commercial Snapshot (ADR-0028)
-- Orders-owned accepted commercial terms (OPEN) + immutable freeze at CompleteOrder.
-- No Pricing/Promo engines. No Revenue reporting read model.

-- Current accepted commercial state while Order is OPEN (replaced on explicit reprice).
CREATE TABLE IF NOT EXISTS sales_order_commercial_terms (
  order_id UUID PRIMARY KEY REFERENCES sales_order (order_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  certainty TEXT NOT NULL CHECK (certainty IN ('FINAL', 'UNKNOWN')),
  order_merchant_funded_discount_minor TEXT NOT NULL,
  tax_minor TEXT,
  non_merchandise_charges_minor TEXT,
  tip_minor TEXT,
  customer_payable_minor TEXT,
  commercial_resolution TEXT,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  actor_id UUID,
  device_id UUID,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_order_commercial_terms_order_discount_digits_chk CHECK (
    order_merchant_funded_discount_minor ~ '^[0-9]+$'
  )
);

CREATE TABLE IF NOT EXISTS sales_order_commercial_line_terms (
  order_line_id UUID PRIMARY KEY REFERENCES sales_order_line (order_line_id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES sales_order (order_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  sold_catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  resolved_unit_price_minor TEXT,
  gross_merchandise_minor TEXT NOT NULL,
  line_merchant_funded_discount_minor TEXT NOT NULL,
  eligible_for_order_discount BOOLEAN NOT NULL DEFAULT TRUE,
  third_party_merchandise_funding_minor TEXT NOT NULL DEFAULT '0',
  tax_minor TEXT,
  certainty TEXT NOT NULL CHECK (certainty IN ('FINAL', 'UNKNOWN')),
  funding_provenance TEXT,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT sales_order_commercial_line_terms_gross_digits_chk CHECK (
    gross_merchandise_minor ~ '^[0-9]+$'
  ),
  CONSTRAINT sales_order_commercial_line_terms_line_disc_digits_chk CHECK (
    line_merchant_funded_discount_minor ~ '^[0-9]+$'
  ),
  CONSTRAINT sales_order_commercial_line_terms_third_digits_chk CHECK (
    third_party_merchandise_funding_minor ~ '^[0-9]+$'
  ),
  UNIQUE (order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_commercial_line_terms_order
  ON sales_order_commercial_line_terms (order_id);

-- Immutable historical commercial snapshot (one per completed Order).
CREATE TABLE IF NOT EXISTS order_commercial_snapshot (
  order_commercial_snapshot_id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES sales_order (order_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent >= 0 AND minor_unit_exponent <= 4),
  business_date DATE NOT NULL,
  business_order INTEGER NOT NULL CHECK (business_order >= 0),
  business_time TEXT,
  certainty TEXT NOT NULL CHECK (certainty IN ('FINAL', 'UNKNOWN')),
  gross_merchandise_minor TEXT NOT NULL,
  merchant_funded_discount_minor TEXT NOT NULL,
  third_party_merchandise_funding_minor TEXT NOT NULL,
  net_merchandise_sales_minor TEXT,
  tax_minor TEXT,
  non_merchandise_charges_minor TEXT,
  tip_minor TEXT,
  customer_payable_minor TEXT,
  commercial_resolution TEXT,
  semantic_hash TEXT NOT NULL,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_commercial_snapshot_net_null_when_unknown_chk CHECK (
    (certainty = 'UNKNOWN' AND net_merchandise_sales_minor IS NULL)
    OR (certainty = 'FINAL' AND net_merchandise_sales_minor IS NOT NULL AND net_merchandise_sales_minor ~ '^-?[0-9]+$')
  )
);

CREATE TABLE IF NOT EXISTS order_line_commercial_snapshot (
  order_line_commercial_snapshot_id UUID PRIMARY KEY,
  order_commercial_snapshot_id UUID NOT NULL
    REFERENCES order_commercial_snapshot (order_commercial_snapshot_id) ON DELETE CASCADE,
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id),
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  sold_catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  quantity TEXT NOT NULL,
  resolved_unit_price_minor TEXT,
  gross_merchandise_minor TEXT NOT NULL,
  line_merchant_funded_discount_minor TEXT NOT NULL,
  allocated_order_merchant_discount_minor TEXT NOT NULL,
  third_party_merchandise_funding_minor TEXT NOT NULL,
  net_merchandise_sales_minor TEXT,
  tax_minor TEXT,
  certainty TEXT NOT NULL CHECK (certainty IN ('FINAL', 'UNKNOWN')),
  funding_provenance TEXT,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (order_commercial_snapshot_id, order_line_id),
  UNIQUE (order_commercial_snapshot_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_order_line_commercial_snapshot_snap
  ON order_line_commercial_snapshot (order_commercial_snapshot_id);

ALTER TABLE sales_order
  ADD COLUMN IF NOT EXISTS order_commercial_snapshot_id UUID
    REFERENCES order_commercial_snapshot (order_commercial_snapshot_id);

COMMENT ON TABLE sales_order_commercial_terms IS
  'D1.4B current accepted commercial terms while Order is OPEN (ADR-0028). Replaced by explicit SetOrderCommercialTerms.';
COMMENT ON TABLE order_commercial_snapshot IS
  'D1.4B immutable Order commercial snapshot frozen at CompleteOrder (ADR-0028). Never mutated on reversal.';
