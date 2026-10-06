-- C0.1 — Register Procurement Goods Receipt permission for SEC-0 HTTP auth.
-- Tenant-wide AccessGrant only (no warehouse/legal-entity scope expansion).

INSERT INTO identity_permission (permission_key, description) VALUES
  (
    'procurement.goods_receipt.manage',
    'Authorize Goods Receipt create/read/update/validate/post/reverse and related inventory balance/costing quote reads (C0.1)'
  )
ON CONFLICT DO NOTHING;
