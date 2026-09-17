-- ADR-0033: Counter-service cash checkout vertical slice.
-- This migration adds the smallest runtime needed for a tableless pilot.

-- OPEN remains the persisted technical name for an editable draft Order.
ALTER TABLE sales_order DROP CONSTRAINT IF EXISTS sales_order_status_check;
ALTER TABLE sales_order
  ADD CONSTRAINT sales_order_status_check
  CHECK (status IN ('OPEN', 'SUBMITTED', 'COMPLETED', 'CANCELLED'));

ALTER TABLE sales_order
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by UUID;

ALTER TABLE catalog_item
  ADD COLUMN IF NOT EXISTS requires_production BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Modifier configuration and immutable OrderLine selections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modifier_group (
  modifier_group_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS modifier_option (
  modifier_option_id UUID PRIMARY KEY,
  modifier_group_id UUID NOT NULL REFERENCES modifier_group (modifier_group_id),
  label TEXT NOT NULL,
  price_delta_minor TEXT NOT NULL DEFAULT '0',
  currency_code TEXT NOT NULL DEFAULT 'VND',
  minor_unit_exponent INTEGER NOT NULL DEFAULT 0 CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  position INTEGER NOT NULL CHECK (position > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (modifier_group_id, position),
  CONSTRAINT modifier_option_delta_digits_chk CHECK (price_delta_minor ~ '^-?[0-9]+$')
);

CREATE TABLE IF NOT EXISTS catalog_item_modifier_group (
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id) ON DELETE CASCADE,
  modifier_group_id UUID NOT NULL REFERENCES modifier_group (modifier_group_id),
  position INTEGER NOT NULL CHECK (position > 0),
  min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections INTEGER NOT NULL CHECK (max_selections >= min_selections),
  PRIMARY KEY (catalog_item_id, modifier_group_id),
  UNIQUE (catalog_item_id, position)
);

CREATE TABLE IF NOT EXISTS sales_order_line_modifier (
  order_line_modifier_id UUID PRIMARY KEY,
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id) ON DELETE CASCADE,
  modifier_group_id UUID NOT NULL REFERENCES modifier_group (modifier_group_id),
  modifier_option_id UUID NOT NULL REFERENCES modifier_option (modifier_option_id),
  group_label TEXT NOT NULL,
  option_label TEXT NOT NULL,
  price_delta_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (order_line_id, modifier_option_id),
  CONSTRAINT order_line_modifier_delta_digits_chk CHECK (price_delta_minor ~ '^-?[0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_order_line_modifier_line
  ON sales_order_line_modifier (order_line_id, position);

-- ---------------------------------------------------------------------------
-- CashShift, command idempotency, and receipt source records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_shift (
  cash_shift_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  cashier_id UUID NOT NULL,
  device_id UUID NOT NULL,
  business_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'RECONCILED', 'ACCEPTED')),
  opening_cash_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT cash_shift_opening_digits_chk CHECK (opening_cash_minor ~ '^[0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_cash_shift_outlet_status
  ON cash_shift (outlet_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS cash_checkout_idempotency (
  cash_checkout_idempotency_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  legal_entity_id UUID NOT NULL REFERENCES legal_entity (legal_entity_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  cash_shift_id UUID NOT NULL REFERENCES cash_shift (cash_shift_id),
  settlement_check_id UUID,
  settlement_group_id UUID,
  payment_id UUID REFERENCES payment (payment_id),
  idempotency_key TEXT NOT NULL,
  payable_minor TEXT,
  tendered_minor TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  actor_id UUID NOT NULL,
  device_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (state IN ('RESERVED', 'PAYMENT_RECONCILED', 'FINALIZED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (legal_entity_id, idempotency_key),
  CONSTRAINT cash_checkout_idem_payable_digits_chk CHECK (payable_minor IS NULL OR payable_minor ~ '^[0-9]+$'),
  CONSTRAINT cash_checkout_idem_tendered_digits_chk CHECK (tendered_minor ~ '^[0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_cash_checkout_idem_order
  ON cash_checkout_idempotency (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cash_shift_transaction (
  cash_shift_transaction_id UUID PRIMARY KEY,
  cash_shift_id UUID NOT NULL REFERENCES cash_shift (cash_shift_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  payment_id UUID NOT NULL UNIQUE REFERENCES payment (payment_id),
  transaction_kind TEXT NOT NULL CHECK (transaction_kind = 'SALE'),
  amount_minor TEXT NOT NULL,
  tendered_minor TEXT NOT NULL DEFAULT '0',
  change_minor TEXT NOT NULL DEFAULT '0',
  currency_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cash_shift_id, order_id),
  CONSTRAINT cash_shift_tx_amount_digits_chk CHECK (amount_minor ~ '^[0-9]+$' AND tendered_minor ~ '^[0-9]+$' AND change_minor ~ '^[0-9]+$')
);

CREATE TABLE IF NOT EXISTS receipt (
  receipt_id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES sales_order (order_id),
  payment_id UUID NOT NULL UNIQUE REFERENCES payment (payment_id),
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Minimal production task source record for the first slice
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_task (
  production_task_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  order_id UUID NOT NULL REFERENCES sales_order (order_id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line (order_line_id),
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  status TEXT NOT NULL CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED')),
  quantity TEXT NOT NULL,
  unit TEXT NOT NULL,
  label TEXT NOT NULL,
  modifier_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_task_quantity_nonempty_chk CHECK (length(trim(quantity)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_production_task_outlet_status
  ON production_task (outlet_id, status, created_at);
