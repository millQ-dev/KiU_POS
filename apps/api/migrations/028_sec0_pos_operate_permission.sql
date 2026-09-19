-- SEC-0: Identity permission for POS / financial HTTP operations.
-- Binding AccessGrant to Orders / Payments / Settlement routes (ADR-0036).
-- Does not invent payment/settlement product semantics.

INSERT INTO identity_permission (permission_key, description) VALUES
  (
    'pos.operate',
    'Authorize POS order, commercial, payment, and settlement HTTP operations within grant scope'
  )
ON CONFLICT DO NOTHING;
