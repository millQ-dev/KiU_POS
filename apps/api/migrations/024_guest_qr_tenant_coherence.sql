-- GUEST1.1 — DB-level tenant coherence for PublicMenuLink + capability tables.
-- Prevents cross-tenant outlet/brand binding that application checks alone could miss.

-- outlet_id is PK; composite unique enables (outlet_id, tenant_id) FK.
ALTER TABLE outlet
  ADD CONSTRAINT outlet_id_tenant_unique UNIQUE (outlet_id, tenant_id);

ALTER TABLE brand
  ADD CONSTRAINT brand_id_tenant_unique UNIQUE (brand_id, tenant_id);

ALTER TABLE public_menu_link
  ADD CONSTRAINT public_menu_link_outlet_tenant_fk
  FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id);

ALTER TABLE public_menu_link
  ADD CONSTRAINT public_menu_link_brand_tenant_fk
  FOREIGN KEY (brand_id, tenant_id) REFERENCES brand (brand_id, tenant_id);

-- Capability rows: outlet config must reference coherent outlet/tenant pair.
ALTER TABLE outlet_capability_config
  ADD CONSTRAINT outlet_capability_outlet_tenant_fk
  FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id);

-- Fail-closed booleans remain NOT NULL with DEFAULT FALSE (already in 022/023).
-- No plaintext token column exists on public_menu_link.
