-- Company Identification (ADR-0036): user-facing Company ID locator.
-- company_code is NOT a secret/credential/authorization factor.
-- Internal tenant_id UUID remains the canonical key and is never a public DTO field.

ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS company_code TEXT;

-- Deterministic unique backfill: uppercase hex of tenant_id without dashes (32 chars).
UPDATE tenant
SET company_code = upper(replace(tenant_id::text, '-', ''))
WHERE company_code IS NULL OR length(trim(company_code)) = 0;

ALTER TABLE tenant
  ALTER COLUMN company_code SET NOT NULL;

ALTER TABLE tenant
  DROP CONSTRAINT IF EXISTS tenant_company_code_format;

ALTER TABLE tenant
  ADD CONSTRAINT tenant_company_code_format CHECK (
    company_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS tenant_company_code_uq
  ON tenant (company_code);

CREATE OR REPLACE FUNCTION tenant_set_company_code_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_code IS NULL OR length(trim(NEW.company_code)) = 0 THEN
    NEW.company_code := upper(replace(NEW.tenant_id::text, '-', ''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_company_code_default_trg ON tenant;
CREATE TRIGGER tenant_company_code_default_trg
  BEFORE INSERT OR UPDATE OF company_code ON tenant
  FOR EACH ROW
  EXECUTE PROCEDURE tenant_set_company_code_default();

COMMENT ON COLUMN tenant.company_code IS
  'User-facing Company ID (locator only). Not authentication or authorization.';
