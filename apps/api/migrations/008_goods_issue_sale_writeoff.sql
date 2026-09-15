-- D1.3B: Inventory-owned typed GoodsIssue for sale write-off + dedicated reversals.
-- Document ≠ Movement (ADR-0010). Orders never write these tables directly (ADR-0025).

-- ---------------------------------------------------------------------------
-- GoodsIssue (sale consumption document)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_issue (
  goods_issue_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  warehouse_id UUID NOT NULL REFERENCES warehouse (warehouse_id),
  currency_code CHAR(3) NOT NULL,
  minor_unit_exponent SMALLINT NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  source_type TEXT NOT NULL CHECK (source_type IN ('ORDER')),
  source_order_id UUID NOT NULL REFERENCES sales_order (order_id),
  business_date DATE NOT NULL,
  business_time TEXT,
  business_order INTEGER NOT NULL CHECK (business_order >= 0),
  actor_id UUID,
  device_id UUID,
  post_idempotency_key TEXT NOT NULL,
  post_semantic_fingerprint TEXT NOT NULL,
  provenance_hash TEXT NOT NULL,
  posting_status TEXT NOT NULL CHECK (posting_status IN ('POSTED', 'REVERSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  -- Exactly one effective sale GoodsIssue per completed Order
  CONSTRAINT uq_goods_issue_source_order UNIQUE (source_order_id),
  CONSTRAINT uq_goods_issue_idempotency UNIQUE (legal_entity_id, post_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_goods_issue_warehouse
  ON goods_issue (warehouse_id, business_date, business_order);

CREATE INDEX IF NOT EXISTS idx_goods_issue_legal_entity
  ON goods_issue (legal_entity_id);

COMMENT ON TABLE goods_issue IS
  'Inventory-owned typed sale GoodsIssue (ADR-0025). Movements use source_document_type=GoodsIssue.';

-- ---------------------------------------------------------------------------
-- GoodsIssue lines — OrderLine → physical leaf traceability
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_issue_line (
  goods_issue_line_id UUID PRIMARY KEY,
  goods_issue_id UUID NOT NULL REFERENCES goods_issue (goods_issue_id),
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  quantity_base TEXT NOT NULL,
  unit_base TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('MASS', 'VOLUME', 'COUNT')),
  issue_cost_minor TEXT NOT NULL,
  cost_certainty TEXT NOT NULL CHECK (
    cost_certainty IN (
      'FINAL',
      'ESTIMATED_FROM_LAST_KNOWN',
      'UNKNOWN',
      'ORDER_UNRESOLVED'
    )
  ),
  cost_basis TEXT NOT NULL CHECK (
    cost_basis IN ('ACTUAL_STOCK_VALUATION', 'SUPPLIER_PRICE', 'ESTIMATED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_goods_issue_line_number UNIQUE (goods_issue_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_goods_issue_line_order_line
  ON goods_issue_line (order_line_id);

CREATE INDEX IF NOT EXISTS idx_goods_issue_line_catalog
  ON goods_issue_line (catalog_item_id);

COMMENT ON TABLE goods_issue_line IS
  'Physical leaf consumption lines for a sale GoodsIssue. One OUT movement per line.';

-- ---------------------------------------------------------------------------
-- GoodsIssue reversal (dedicated entity — not a fake GoodsIssue)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_issue_reversal (
  goods_issue_reversal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  goods_issue_id UUID NOT NULL REFERENCES goods_issue (goods_issue_id),
  source_order_id UUID NOT NULL REFERENCES sales_order (order_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  warehouse_id UUID NOT NULL REFERENCES warehouse (warehouse_id),
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  reason TEXT,
  actor_id UUID,
  device_id UUID,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_goods_issue_reversal_issue UNIQUE (goods_issue_id),
  CONSTRAINT uq_goods_issue_reversal_idempotency UNIQUE (legal_entity_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_goods_issue_reversal_order
  ON goods_issue_reversal (source_order_id);

COMMENT ON TABLE goods_issue_reversal IS
  'Immutable GoodsIssue reversal. Compensating movements use source_document_type=GoodsIssueReversal.';

-- ---------------------------------------------------------------------------
-- Order completion reversal record (Orders-owned; Order itself stays COMPLETED)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_completion_reversal (
  sales_order_completion_reversal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  goods_issue_id UUID NOT NULL REFERENCES goods_issue (goods_issue_id),
  goods_issue_reversal_id UUID NOT NULL REFERENCES goods_issue_reversal (goods_issue_reversal_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  idempotency_key TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  reason TEXT,
  actor_id UUID,
  device_id UUID,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sales_order_completion_reversal_order UNIQUE (order_id),
  CONSTRAINT uq_sales_order_completion_reversal_idempotency UNIQUE (legal_entity_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_completion_reversal_gi
  ON sales_order_completion_reversal (goods_issue_id);

COMMENT ON TABLE sales_order_completion_reversal IS
  'Orders-owned immutable completion reversal fact (ADR-0025 §9). Original Order remains COMPLETED.';
