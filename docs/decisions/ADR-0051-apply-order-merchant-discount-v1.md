# ADR-0051: ApplyOrderMerchantDiscount v1

- **Status:** Accepted (PO ACCEPT 2026-10-28 — D1–D6)
- **Date:** 2026-10-28
- **Related:** ADR-0028, ADR-0029, ADR-0030, ADR-0036; Notion `40730d5171518185b442d16d4686dea8`

## Decision (D1–D6)

1. **AuthZ:** Cashier may **request**; **Manager/Owner** authorized approval required to apply (LoginChallenge / ApprovalRequest per ADR-0036 patterns).  
2. **Scope:** **Order-level** merchant-funded discount only (no line-level in v1).  
3. **Amount:** Fixed VND minor **or** percentage; **maximum 20%** of merchandise gross eligible basis.  
4. **Reason:** Mandatory non-empty reason text.  
5. **Command:** Narrow `ApplyOrderMerchantDiscount` — does **not** expose full arbitrary `setOrderCommercialTerms` on POS.  
6. **Lifecycle:** Atomic calculate → apply → accept commercial terms **before** payment collection; never mutate paid/completed economic facts.  
7. Snapshot/allocation/tax/settlement follow ADR-0028 / ADR-0030 / TAX1.1; append-only audit.

## Out of scope

Promo/loyalty engines; payment-method discounts; post-payment history rewrite; inventing thresholds beyond 20% cap.
