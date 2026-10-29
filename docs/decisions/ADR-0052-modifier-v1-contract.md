# ADR-0052: Modifier v1 operational contract

- **Status:** **Accepted WITH CHANGES** (PO contract review 2026-10-29). Does **not** revoke the 2026-10-28 Accept of M1–M8.
- **Authoritative product rules:** [ADR-0049](ADR-0049-modifier-effective-recipe-v1.md) (M1–M8), [ADR-0050](ADR-0050-order-local-allergen-resolution-m6.md). This file records the operational corrections from the 2026-10-29 review. It does not repeat the original fourteen owner questions.
- **Date:** 2026-10-29
- **Autonomy:** Level C decision already given (APPROVE WITH CHANGES). Follow-on code is Level B. No production deploy and no persistent-database migrate GO.
- **Related:** ADR-0002, ADR-0008, ADR-0024, ADR-0025, ADR-0028, ADR-0030, ADR-0049, ADR-0050

## What is already Accepted (2026-10-28)

ADR-0049 owns the product split: Menu Configuration publishes groups and options; price adjustments are additive VND minors; Effective Recipe is structured component deltas; mandatory groups fail closed; kitchen templates are structured; allergen resolution follows ADR-0024 / ADR-0050; counter UI first; snapshots freeze; one GoodsIssue. Those bullets stay binding.

## Operational corrections (Accepted WITH CHANGES 2026-10-29)

### M1 — Ownership

The ADR-0049 ownership split is unchanged.

### M2 — Price

Per-unit signed additive modifier price, then the existing ADR-0030 line-gross rounding of `(base unit price + modifier deltas) × canonical quantity`.

Rounding provenance, quantity semantics, and exact decimal arithmetic stay on that one `BASE_LIST_LINE_GROSS` call. The modifier delta is part of the unit price that enters the call. It is not added after the line has already been rounded.

A configured unit below zero fails closed.

### M3 — Effective Recipe at completion

`CompleteOrder` applies the frozen REMOVE / REPLACE / ADD deltas and posts exactly one GoodsIssue. Lines without a modifier snapshot stay on the base graph.

REMOVE, REPLACE, and ADD carry typed quantities and unit conversion. REPLACE does not keep the same numeric quantity when the component unit or yield differs. Same dimension converts through the accepted unit factors. A published replacement quantity is the yield override. A cross-dimension swap without a conversion rule fails closed. The base recipe is not also issued.

### M4 — Defaults and gates

A valid selected default satisfies a mandatory group unless `askEveryTime` is explicitly enabled. `askEveryTime` requires an explicit operator confirmation and does not auto-apply the default. Configured lines are validated before commercial acceptance, kitchen release, and completion.

### M5 — Kitchen text and guest note

Structured kitchen instruction codes are authoritative for preparation. `guestNote` is non-authoritative and is not an input to allergen resolution or inventory. The two values are logically separated and typed. The existing JSON column holds that typed value. A new column is not added only to split the JSON.

### M6 — Allergy (ADR-0050 remains binding)

Shipping modifier configuration without the full allergy screen does not cancel the accepted order-local allergy flow. That flow is a **required vertical** in this execution sequence, not an open-ended deferral:

- Ask once at Order start.
- `NO_ALLERGIES_CONFIRMED` / `SELECT_ALLERGENS` / `UNABLE_TO_CLARIFY`.
- Deterministic `AVAILABLE` / `AVAILABLE_WITH_MODIFICATION` / `BLOCKED` / `REQUIRES_CONFIRMATION`.
- Actual recipe adaptation and kitchen instructions.
- Never invent SAFE. Do not conceal cross-contact uncertainty.
- Order-local guest scope and the ADR-0050 privacy limits. No CustomerProfile allergy record by default.

### M7 — Grants

Reuse the grants already in migration `037`: `menu.modifiers.configure` for office publish, `orders.line_configure` with `pos.operate` for cashier selection. The cashier does not receive publication authority. An option whose recipe delta is not a complete REMOVE, REPLACE, or ADD is rejected.

### M8 — Channel

Counter POS first. The backend command stays reusable for a later waiter client. No Floor runtime.

## Tests that lock the corrections

| Id | Case |
| --- | --- |
| T9 | Quantity 2: gross equals ADR-0030 rounding of `(base + per-unit delta) × 2`, with that call's basis and delta |
| T4 | Completion leaves follow converted Effective Recipe deltas; one GoodsIssue; base component is not also issued |
| T8 | Stale configuration fingerprint conflicts; `frozen_at` is set when commercial terms are accepted |
| T5 | Allergy flow matches ADR-0050; unknown and cross-contact never become SAFE |

## Implementation PRs (Level B, after this record)

1. Per-unit modifier price through ADR-0030.
2. Effective Recipe consumption inside `CompleteOrder`.
3. Typed kitchen-code / guest-note separation in the existing JSON.
4. Configuration freeze, default-satisfies-mandatory, fingerprint conflict.
5. ADR-0050 allergy vertical.

Disposable CI migrations only. Production migrate is a separate GO.
