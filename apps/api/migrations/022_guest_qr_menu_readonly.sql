-- Guest QR Menu read-only surface (ADR-0029 Channel/Public projection)
-- Capability gating without package forks. Opaque PublicMenuLink.
-- Minimal presentation media + localized presentation (not MenuPublication truth).

CREATE TABLE outlet_capability_config (
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  capability_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, outlet_id, capability_key),
  CONSTRAINT outlet_capability_key_nonempty CHECK (length(trim(capability_key)) > 0),
  CONSTRAINT outlet_capability_key_format CHECK (capability_key ~ '^[a-z][a-z0-9_.]*$')
);

CREATE INDEX outlet_capability_config_outlet_idx
  ON outlet_capability_config (outlet_id);

-- Canonical Guest QR capability key: guest_menu.qr

CREATE TABLE presentation_media_asset (
  media_asset_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  storage_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width_px INT NULL,
  height_px INT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT presentation_media_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT presentation_media_storage_nonempty CHECK (length(trim(storage_key)) > 0),
  CONSTRAINT presentation_media_url_nonempty CHECK (length(trim(public_url)) > 0),
  CONSTRAINT presentation_media_mime_nonempty CHECK (length(trim(mime_type)) > 0)
);

CREATE INDEX presentation_media_asset_tenant_idx
  ON presentation_media_asset (tenant_id);

CREATE TABLE catalog_item_presentation (
  catalog_item_id UUID NOT NULL REFERENCES catalog_item (catalog_item_id),
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  media_asset_id UUID NULL REFERENCES presentation_media_asset (media_asset_id),
  PRIMARY KEY (catalog_item_id, locale),
  CONSTRAINT catalog_item_presentation_locale_ck CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT catalog_item_presentation_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE INDEX catalog_item_presentation_media_idx
  ON catalog_item_presentation (media_asset_id)
  WHERE media_asset_id IS NOT NULL;

-- Opaque public routing context (NOT employee auth). token_hash = sha256(opaque token).
-- dining_area_id / table_id are soft references (Floor/Table runtime not present yet).
CREATE TABLE public_menu_link (
  public_menu_link_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL REFERENCES outlet (outlet_id),
  brand_id UUID NOT NULL REFERENCES brand (brand_id),
  dining_area_id UUID NULL,
  table_ref TEXT NULL,
  token_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT public_menu_link_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT public_menu_link_token_hash_nonempty CHECK (length(trim(token_hash)) = 64),
  CONSTRAINT public_menu_link_valid_range_ck CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from
  ),
  CONSTRAINT public_menu_link_table_ref_ck CHECK (
    table_ref IS NULL OR length(trim(table_ref)) > 0
  )
);

CREATE INDEX public_menu_link_outlet_idx
  ON public_menu_link (tenant_id, outlet_id)
  WHERE revoked_at IS NULL AND enabled;
