-- D1.3B-R1: Reversal business chronology (ADR-0027).
-- Do not fabricate chronology for existing rows — columns are NOT NULL only after
-- confirming zero legacy rows (or after an explicit PO remediation policy).

-- ---------------------------------------------------------------------------
-- sales_order_completion_reversal
-- ---------------------------------------------------------------------------
ALTER TABLE sales_order_completion_reversal
  ADD COLUMN IF NOT EXISTS business_date DATE,
  ADD COLUMN IF NOT EXISTS business_time TEXT,
  ADD COLUMN IF NOT EXISTS business_order INTEGER;

-- Fail closed if any legacy rows lack chronology (ADR-0027 §9 — no fabricated backfill).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales_order_completion_reversal
    WHERE business_date IS NULL OR business_order IS NULL
  ) THEN
    RAISE EXCEPTION
      'D1.3B-R1 blocked: sales_order_completion_reversal has rows without business chronology; do not fabricate backfill — report to PO';
  END IF;
END $$;

ALTER TABLE sales_order_completion_reversal
  ALTER COLUMN business_date SET NOT NULL,
  ALTER COLUMN business_order SET NOT NULL;

ALTER TABLE sales_order_completion_reversal
  DROP CONSTRAINT IF EXISTS sales_order_completion_reversal_business_order_check;
ALTER TABLE sales_order_completion_reversal
  ADD CONSTRAINT sales_order_completion_reversal_business_order_check
    CHECK (business_order >= 0);

CREATE INDEX IF NOT EXISTS idx_sales_order_completion_reversal_chronology
  ON sales_order_completion_reversal (business_date, business_order);

COMMENT ON COLUMN sales_order_completion_reversal.business_date IS
  'Authoritative ReverseCompletedOrder business date (ADR-0027). Never derive from reversed_at.';
COMMENT ON COLUMN sales_order_completion_reversal.business_order IS
  'Authoritative ReverseCompletedOrder business order (ADR-0027).';
COMMENT ON COLUMN sales_order_completion_reversal.business_time IS
  'Optional ReverseCompletedOrder business time (ADR-0027).';

-- ---------------------------------------------------------------------------
-- goods_issue_reversal
-- ---------------------------------------------------------------------------
ALTER TABLE goods_issue_reversal
  ADD COLUMN IF NOT EXISTS business_date DATE,
  ADD COLUMN IF NOT EXISTS business_time TEXT,
  ADD COLUMN IF NOT EXISTS business_order INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM goods_issue_reversal
    WHERE business_date IS NULL OR business_order IS NULL
  ) THEN
    RAISE EXCEPTION
      'D1.3B-R1 blocked: goods_issue_reversal has rows without business chronology; do not fabricate backfill — report to PO';
  END IF;
END $$;

ALTER TABLE goods_issue_reversal
  ALTER COLUMN business_date SET NOT NULL,
  ALTER COLUMN business_order SET NOT NULL;

ALTER TABLE goods_issue_reversal
  DROP CONSTRAINT IF EXISTS goods_issue_reversal_business_order_check;
ALTER TABLE goods_issue_reversal
  ADD CONSTRAINT goods_issue_reversal_business_order_check
    CHECK (business_order >= 0);

CREATE INDEX IF NOT EXISTS idx_goods_issue_reversal_chronology
  ON goods_issue_reversal (business_date, business_order);

COMMENT ON COLUMN goods_issue_reversal.business_date IS
  'Authoritative reversal business date shared with Orders (ADR-0027). Compensating movements use this position.';
COMMENT ON COLUMN goods_issue_reversal.business_order IS
  'Authoritative reversal business order shared with Orders (ADR-0027).';
COMMENT ON COLUMN goods_issue_reversal.business_time IS
  'Optional reversal business time shared with Orders (ADR-0027).';
