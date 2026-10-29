-- ADR-0051 ApplyOrderMerchantDiscount v1 (PO ACCEPT 2026-10-28, D1-D6).
-- Disposable/CI first — no production migrate GO (POSV1_NO_GO until separate PO GO).
-- Registers the approver permission only; discount facts live in existing commercial terms
-- (sales_order_commercial_terms.provenance_json) and identity_audit_event.

INSERT INTO identity_permission (permission_key, description) VALUES
  (
    'orders.merchant_discount.approve',
    'Approve a cashier-requested order-level merchant discount (max 20%) via ApprovalRequest (ADR-0051)'
  )
ON CONFLICT DO NOTHING;
