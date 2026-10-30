-- ADR-0054 I-07 — Restaurant Imprint HTTP read permissions (PO ACCEPT 2026-10-30).
-- Default-deny. Not implied by pos.operate or any other existing key.
-- I-07 HTTP requires exact outlet-scoped grants (outlet_id IS NOT NULL).

INSERT INTO identity_permission (permission_key, description) VALUES
  (
    'imprint.read',
    'Authorize typed Restaurant Imprint outlet summary read (ADR-0054 I-07). Does not authorize provenance/history or JEV/LLM processing.'
  ),
  (
    'imprint.provenance.read',
    'Authorize minimized Restaurant Imprint provenance/history when combined with imprint.read (ADR-0054 I-07). Not a replacement for imprint.read.'
  )
ON CONFLICT DO NOTHING;
