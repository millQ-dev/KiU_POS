# ADR-0051: ApplyOrderMerchantDiscount v1

- **Status:** D1–D6 **Accepted** (PO ACCEPT 2026-10-28). Operational contract below **Accepted WITH CHANGES** (PO contract review 2026-10-29). This review does not revoke D1–D6 and does not add `RevokeOrderMerchantDiscount` to v1.
- **Date:** 2026-10-28 (D1–D6); contract corrections 2026-10-29
- **Related:** ADR-0028, ADR-0029, ADR-0030, ADR-0032, ADR-0036
- **Autonomy:** Level C decision already given. Implementation is Level B. No production deploy, no persistent-database migrate GO, no live fiscal or payment provider activation.

## Accepted product rules (2026-10-28) — unchanged

1. **AuthZ:** Cashier may **request**; **Manager/Owner** authorized approval required to apply (LoginChallenge / ApprovalRequest per ADR-0036 patterns).
2. **Scope:** **Order-level** merchant-funded discount only (no line-level in v1).
3. **Amount:** Fixed VND minor **or** percentage; **maximum 20%** of merchandise gross eligible basis.
4. **Reason:** Mandatory non-empty reason text.
5. **Command:** Narrow `ApplyOrderMerchantDiscount` — does **not** expose full arbitrary `setOrderCommercialTerms` on POS.
6. **Lifecycle:** Atomic calculate → apply → accept commercial terms **before** payment collection; never mutate paid/completed economic facts.
7. Snapshot/allocation/tax/settlement follow ADR-0028 / ADR-0030; append-only audit.

## Out of scope (recorded 2026-10-28)

Promo/loyalty engines; payment-method discounts; post-payment history rewrite; inventing thresholds beyond the 20% cap.

## Not in accepted v1 (2026-10-29)

`RevokeOrderMerchantDiscount` is new operational scope. It is excluded until a separate specification is approved. v1 does not treat a zero-amount apply as that command.

## Operational contract (Accepted WITH CHANGES 2026-10-29)

### Authorization

The Manager/Owner grant `orders.merchant_discount.approve` is the authority to apply. A cashier with `pos.operate` and without that grant may request an ApprovalRequest. They cannot apply alone.

ADR-0036 applies. When the workflow requires a second person, the requester cannot approve their own request. A Manager or Owner who already holds `orders.merchant_discount.approve` applies on that grant. This contract does not add a universal two-person rule on top of that direct grant.

### Money

Order-level merchant-funded discount only. Maximum 20% of eligible merchandise gross (list price and per-unit modifier configuration, before this discount, tax excluded). Fixed VND minor or a percentage.

Percentages are exact decimals. They are not restricted to integers. Conversion from percentage to minor uses a separately named, versioned rounding context `MERCHANT_DISCOUNT_PERCENT_TO_MINOR` (HALF_UP, quantum 1, policy version on the snapshot). That context is not `BASE_LIST_LINE_GROSS`. Allocation of the resulting integer uses the existing `allocateOrderMerchantDiscount`.

A request above 20% fails for every grant, including owner. Reason text is mandatory and non-empty. There is no reason-code catalog.

### Command

`ApplyOrderMerchantDiscount` builds terms and calls the existing Orders commercial kernel in one transaction. POS has no `setOrderCommercialTerms` route and rejects a body that sets arbitrary unit prices or line discounts.

The apply is allowed on an OPEN order before payment collection, a fiscal snapshot, and a live settlement. It writes one commercial acceptance. Fingerprint mismatch conflicts. The existing idempotency rule applies: same key and same semantics replay; same key and different semantics conflict. Completed commercial facts, payment rows, and fiscal snapshots stay immutable.

### Tests

| Id | Case |
| --- | --- |
| D4 | 20% is allowed; a request above 20% is rejected for a grant holder |
| D7 | A non-integer percent converts only through `MERCHANT_DISCOUNT_PERCENT_TO_MINOR` |
| D2 | Cashier without the approve grant cannot apply without an ApprovalRequest |
| D3 | When second-person approval is used, requester ≠ approver |
| D10 | Apply after payment, fiscal snapshot, or completion does not change those rows |
| D12 | A sale with no discount still accepts base gross |

### Implementation PRs (Level B)

1. Ceiling and percentage-to-minor arithmetic in the domain package.
2. Grant, atomic command, POS HTTP, and cashier control. No revoke command.
