-- Organization Terminal (ADR-0036 / ADR-0018).
-- Terminal ≠ DeviceIdentity. Do not alias device_id = terminal_id.

CREATE TABLE terminal (
  terminal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT terminal_code_nonempty CHECK (length(trim(code)) > 0),
  CONSTRAINT terminal_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT terminal_tenant_code_uq UNIQUE (tenant_id, code),
  CONSTRAINT terminal_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id)
);

CREATE INDEX terminal_outlet_idx ON terminal (tenant_id, outlet_id);

COMMENT ON TABLE terminal IS
  'Organization operational station. Not DeviceIdentity (ADR-0018).';
