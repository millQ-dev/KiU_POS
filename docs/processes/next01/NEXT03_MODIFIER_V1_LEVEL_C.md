# NEXT-03 G1 — Modifier v1 Level C preparation

**PO ACCEPT:** 2026-10-28 — M1–M8 accepted; implementation authority → **ADR-0049**. This file is **historical audit evidence** (prep + decision list). Do not treat as open STOP.

**Origin baseline (prep):** `de1e79915c867af7f9bf94068f7010477c45b1f1` (#124)  
**Autonomy (prep):** Level C — **closed by PO ACCEPT**  
**Reuses:** Menu, Recipe/Preparation (ADR-0003/0009), Orders, Commercial (ADR-0028/0030), Inventory/GoodsIssue (ADR-0025), Allergen boundary (ADR-0024)  
**Forbidden:** universal rules engine; duplicate financial ledger; free-text bypass of allergen/inventory; inventing Effective Recipe without Accept

## Existing Origin facts (inspected)

| Area | Finding |
| --- | --- |
| Cashier / POS | No modifier UI or API; `select-count` adds base CatalogItem only |
| Orders | Lines are catalog+qty; no modifier configuration identity on OrderLine |
| Commercial | `calculateAndAcceptBaseCommercialTerms` = base list gross only (discount/modifiers not in C1.1 path) |
| Consumption | `sale-consumption.ts` resolves **base** CatalogItem → published Recipe/Preparation only (ADR-0025 §7 OUT OF SCOPE for modifiers) |
| Allergen | ADR-0024 Accepted architecture; **no** allergen runtime module found under `apps/api` |
| Golden scenario | Explicitly marks MODIFIER / Effective Recipe as future |
| ADR-0031 | Modifiers deferred from POS presentation Accept |

## Target vertical (acceptance scenario)

Cappuccino → **mandatory** milk selection → **optional** syrup → correct price → effective recipe/consumption → allergens → kitchen instruction → commercial snapshot → payment → **one** GoodsIssue.

Invariants required by NEXT-03 + Accepted ADRs:

1. Mandatory modifiers cannot be skipped (fail-closed before commercial accept / kitchen send).  
2. Optional modifiers do not interrupt routine sales.  
3. Modifiers belong to the correct OrderLine; identical products with different configs remain distinct.  
4. Price, recipe, consumption, allergens, historical snapshots stay consistent after Complete.  
5. Free-text comments cannot bypass allergen or inventory rules (ADR-0024).  
6. Order without modifiers still valid (counter path / DEMO29_GO preserved).

## Minimal architecture delta (proposal — not Accepted)

```text
CatalogItem (sellable, e.g. Cappuccino)
  → ModifierGroupBinding (mandatory | optional, min/max select)
       → ModifierOption (e.g. Whole milk, Oat; Vanilla syrup)
            → priceAdjustmentMinor (additive | replace — PO)
            → recipeDelta / component bindings (Effective Recipe input)
            → allergen contribution (structured)
            → kitchenInstructionTemplate (structured; free-text = non-authoritative note only)

OrderLine
  → OrderLineConfigurationId (immutable once commercially accepted / sent)
       → selected ModifierOption ids (+ optional guest note NON-AUTHORITATIVE)

CompleteOrder
  → ConsumptionPlanSnapshot from Effective Recipe (configured line), not base-only
  → one GoodsIssue for the Order (existing ADR-0025 causality)
```

**Ownership sketch (for PO):** Catalog/Menu owns published modifier definitions; Orders owns line configuration snapshot; Recipes owns Effective Recipe resolution; Allergen Resolver consumes Effective Recipe (ADR-0024); Inventory posts from ConsumptionPlan only.

## Migration design (disposable only when Accept + implement)

Draft names only — finalize in Accept:

- `modifier_group`, `modifier_option`, `catalog_item_modifier_group`  
- `order_line_configuration`, `order_line_modifier_selection`  
- Extend consumption provenance to include configuration hash  
- **No** prod migrate GO in this packet

## Permissions (draft)

| Key | Intent |
| --- | --- |
| `pos.sell` / existing `pos.operate` | Select options within published groups at sell time |
| `menu.modifiers.configure` | Office publish groups/options (out of first POS vertical if needed) |

Exact grant catalog = PO decision (below).

## Test matrix (when Accept + implement)

| # | Case |
| --- | --- |
| T1 | Mandatory milk missing → cannot accept commercial / cannot complete |
| T2 | Optional syrup omitted → sale proceeds; base+milk config |
| T3 | Same CatalogItem, two configs → two distinct lines / configs; prices differ if options differ |
| T4 | Effective consumption leaves differ by milk option; one GoodsIssue |
| T5 | Allergen UNKNOWN never becomes SAFE; free-text note ignored for allergen SoT |
| T6 | Historical CompleteOrder replay uses frozen configuration, not current menu |
| T7 | Counter Order without any modifier groups still DEMO29-compatible |
| T8 | Concurrent edit of line config → expectedVersion CONFLICT |

## Exact PO decisions required (cannot invent)

Silence ≠ Accept. Implementation STOP until these are answered:

1. **Ownership:** Who publishes ModifierGroup — Catalog vs Menu Configuration vs separate office surface?  
2. **Price model for v1:** Additive option deltas only vs replace/base matrix vs both? Currency = VND integer already accepted.  
3. **Effective Recipe v1:** Explicit component deltas per option (milk → dairy component swap) vs full alternate RecipeVersion per configuration? ADR-0025 currently base-only — Accept must authorize extending CompleteOrder consumption to Effective Recipe.  
4. **Mandatory enforcement point:** Block at add-to-cart, before commercial accept, before kitchen send, or all?  
5. **Kitchen instruction:** Structured templates only in v1, or allow non-authoritative free-text alongside (never allergen/inventory SoT)?  
6. **Allergen runtime:** Is first Modifier vertical allowed to ship without full Allergen Resolver UI if resolution stays UNKNOWN fail-closed for incomplete data?  
7. **Permissions:** New configure grant vs reuse menu publish grants; any manager override to skip mandatory (default propose: **no skip**)?  
8. **Scope:** C0 counter-only first vs waiter/restaurant same Accept?

**Not asked (already Accepted / clear):** no universal rules engine; no second ledger; free-text cannot be allergen SoT; Order valid without Table; DEMO29_GO must not regress; no prod migrate in Accept alone.
