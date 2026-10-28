# NEXT-03 G2 — Operator Discount inspection + Level C STOP

**PO ACCEPT:** 2026-10-28 — D1–D6 accepted; implementation authority → **ADR-0051**. This file remains the pre-Accept audit that proved no cashier E2E path existed.

**Origin baseline (audit):** `de1e79915c867af7f9bf94068f7010477c45b1f1`  
**Pre-Accept verdict:** No Level B without Accept — **superseded by ADR-0051 Accept**.

## Independent inspection

| Layer | Evidence | Discount support |
| --- | --- | --- |
| Domain economics | ADR-0028 Accepted: merchant-funded discounts + deterministic order-level allocation | **Yes** (architecture) |
| Domain command | `OrdersService.setOrderCommercialTerms` + `setOrderCommercialTermsSchema` (`orderMerchantFundedDiscountMinor`, per-line `lineMerchantFundedDiscountMinor`) | **Yes** (service + tests / `acceptFinalMerchandiseTerms` helper) |
| C1.1 POS path | `BaseCommercialAcceptanceService.calculateAndAcceptBaseCommercialTerms` → `assembleBaseCommercialLineTerms` — **no discount fields**; accepts base list gross only | **No** (always zero discount economically via base accept) |
| HTTP POS | `POST .../calculate-and-accept-commercial-terms` and reprice only; `pos.acceptance.test.ts` asserts routes **must not** call `setOrderCommercialTerms` | **No** cashier HTTP |
| Grants | No `*.discount*` identity permission found | **No** |
| Cashier UI | No discount control; commercial accept posts salesContext + idempotency only | **No** |
| ADR-0029 | Manager discretionary discount **excluded** from base/list price definition; promo engine deferred; D1.4B manual terms support merchant-funded discount until Promotion runtime | Manual terms ≠ cashier Authorize |

## Why not Level B “smallest UI”

NEXT-03 allows Level B only if an **approved end-to-end command already supports operator discount without new business semantics**.

Reality: exposing discount requires **new** cashier HTTP (or reversing the intentional POS ban on `setOrderCommercialTerms`), **new** authorization/grant, and policy for who may reduce payable — that is **new authorization / commercial operator semantics**, not a pure wiring of an existing POS command. Inventing thresholds, reason codes, or “anyone with pos.operate may discount” would violate “do not invent defaults.”

## Level C proposal (STOP — no code)

**Command (draft):** `ApplyOrderMerchantDiscount` (narrow) **or** authenticated POS wrapper that builds `setOrderCommercialTerms` from current base gross + requested discount — after Accept.

**Constraints already Accepted (reuse):**

- Exact VND integer minors; deterministic allocation (ADR-0028 §8)  
- Never mutate completed commercial / settlement / PCE facts  
- Available at checkout / pre-accept commercial; must not obstruct product selection  
- After CompleteOrder / payment effects: no silent rewrite  

**Still need PO Accept:**

1. **Authorization:** which grant(s)? cashier self-serve vs manager-only vs approval challenge? Any amount threshold before second grant?  
2. **Scope v1:** order-level only, line-level only, or both?  
3. **Reason:** mandatory reason text / reason code catalog or optional?  
4. **Caps:** max % or max minor — or explicitly unlimited for named roles?  
5. **HTTP shape:** allow POS to call `setOrderCommercialTerms`, or new narrow discount endpoint that cannot alter unit prices arbitrarily?  
6. **Interaction with C1.1:** discount applied before/after base calculate-and-accept; single idempotent accept including discount vs two-step?

## Temporary product stance

**DECLARED_DEFERRED** on POS-v1 matrix until PO ACCEPT. Ordinary base-price sales remain unobstructed (current path).
