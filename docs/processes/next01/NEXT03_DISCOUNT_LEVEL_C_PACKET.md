# NEXT-03 Discount — contract after PO review

- **Review:** APPROVE WITH CHANGES, 2026-10-29
- **Does not revoke:** ADR-0051 D1–D6 (2026-10-28)
- **Normative text:** [ADR-0051](../../decisions/ADR-0051-apply-order-merchant-discount-v1.md)

## Accepted vs excluded

| Topic | Status |
| --- | --- |
| D1–D6 | Accepted 2026-10-28 |
| Cashier requests; Manager/Owner grant applies | Accepted. Direct grant is not forced through a second person. Second-person flows still forbid self-approval (ADR-0036). |
| Order-level, max 20%, fixed minor or percentage | Accepted |
| Mandatory reason text, no reason-code catalog | Accepted |
| Exact decimal percent; context `MERCHANT_DISCOUNT_PERCENT_TO_MINOR` | Accepted WITH CHANGES. Not integer-only. Not `BASE_LIST_LINE_GROSS`. |
| Narrow `ApplyOrderMerchantDiscount` | Accepted |
| Atomic prepayment accept, fingerprint, idempotency, frozen facts | Accepted |
| `RevokeOrderMerchantDiscount` | **Excluded from v1** until a separate approval |

## PR sequence

1. Ceiling and percentage arithmetic.
2. Authorization, atomic command, HTTP, cashier UI.

No production migrate. No live payment or fiscal provider.
