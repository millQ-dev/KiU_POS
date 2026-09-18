-- GUEST1.1 — PackageEntitlement (ADR-0008) for capability gating with OutletCapabilityConfig.
-- Both must permit guest_menu.qr. Fail closed. No package-name domain forks.

CREATE TABLE package_entitlement (
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  capability_key TEXT NOT NULL,
  entitled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, capability_key),
  CONSTRAINT package_entitlement_key_nonempty CHECK (length(trim(capability_key)) > 0),
  CONSTRAINT package_entitlement_key_format CHECK (capability_key ~ '^[a-z][a-z0-9_.]*$')
);

CREATE INDEX package_entitlement_tenant_idx
  ON package_entitlement (tenant_id)
  WHERE entitled;
