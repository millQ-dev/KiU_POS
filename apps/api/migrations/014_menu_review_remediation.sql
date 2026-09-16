-- M1.1 review remediation: publication effective dating, stronger immutability,
-- session-gated publication membership inserts.

ALTER TABLE menu_publication
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ;

-- Backfill any rows created before this migration (dev only; no production history).
UPDATE menu_publication
SET effective_from = published_at
WHERE effective_from IS NULL;

ALTER TABLE menu_publication
  ALTER COLUMN effective_from SET NOT NULL;

ALTER TABLE menu_publication DROP CONSTRAINT IF EXISTS menu_publication_interval_chk;
ALTER TABLE menu_publication ADD CONSTRAINT menu_publication_interval_chk CHECK (
  effective_to IS NULL OR effective_to > effective_from
);

COMMENT ON COLUMN menu_publication.effective_from IS
  'Business-effective start (ADR-0029). Half-open with effective_to.';
COMMENT ON COLUMN menu_publication.effective_to IS
  'Business-effective end exclusive; NULL = open-ended.';

-- Allow membership INSERT only when publish transaction sets app.menu_publish=1.
CREATE OR REPLACE FUNCTION menu_publication_item_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.menu_publish', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: MenuPublication membership cannot be inserted outside PublishMenu'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_publication_item_insert_guard ON menu_publication_item;
CREATE TRIGGER trg_menu_publication_item_insert_guard
  BEFORE INSERT ON menu_publication_item
  FOR EACH ROW EXECUTE FUNCTION menu_publication_item_guard_insert();

-- Activated PriceRule / AvailabilityRule rows are immutable (corrections = new row).
CREATE OR REPLACE FUNCTION menu_activated_rule_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: activated AvailabilityRule/PriceRule cannot be mutated in place'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_availability_rule_immutable ON availability_rule;
CREATE TRIGGER trg_availability_rule_immutable
  BEFORE UPDATE OR DELETE ON availability_rule
  FOR EACH ROW EXECUTE FUNCTION menu_activated_rule_reject_mutation();

DROP TRIGGER IF EXISTS trg_price_rule_immutable ON price_rule;
CREATE TRIGGER trg_price_rule_immutable
  BEFORE UPDATE OR DELETE ON price_rule
  FOR EACH ROW EXECUTE FUNCTION menu_activated_rule_reject_mutation();
