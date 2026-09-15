# Block D1.3A — Orders Foundation & Consumption Plan

**Status:** Implementation  
**ADRs:** ADR-0025 (Accepted), ADR-0002, ADR-0003, ADR-0008, ADR-0009, ADR-0010, ADR-0016, ADR-0018, ADR-0019  
**Autonomy:** Level B (implementation against Accepted ADR-0025)  
**Baseline:** Origin `main` @ `8844ccb` (ADR-0025 Accept)

## Boundary

Delivers Orders SoT + base RecipeGraphResolver + ConsumptionPlanSnapshot **schema/domain**, without inventory effects.

```text
D1.3A  = OPEN/CANCELLED Orders + line mutations
         + CatalogItem RecipeProfile → Recipe binding
         + resolveConsumptionPlanPreview (no COMPLETED)
         + CompleteOrder orchestration boundary requiring SaleInventoryWriteOffPort

D1.3B  = wire Inventory GoodsIssue port
         → freeze snapshot → POST GoodsIssue → movements → COMPLETED → OrderCompleted
```

**Critical invariant (ADR-0025 §4):** successful operational `CompleteOrder` is atomic with Inventory-owned GoodsIssue.  
D1.3A does **not** wire `SaleInventoryWriteOffPort`. Calling `completeOrder` without the port fails with `SALE_WRITE_OFF_NOT_WIRED` and leaves the Order `OPEN`. No ConsumptionPlanSnapshot row, no `OrderCompleted` fact, no inventory effects.

## Delivered

| Area | Content |
| --- | --- |
| Schema | `sales_order`, `sales_order_line`, consumption_plan_* tables, `outlet.default_sales_issue_warehouse_id`, `catalog_item_recipe_profile` |
| Commands | OpenOrder, Add/Update/Remove OPEN line, CancelOrder |
| Resolver | VIRTUAL explode XOR STOCK_TRACKED consume XOR DIRECT_STOCK; ambiguity reject |
| Preview | `resolveConsumptionPlanPreview` — in-memory plan + provenance hash |
| Binding | CatalogItem RecipeProfile → RecipeSpecification (ADR-0009 direction); `product_variant_id` reserved NULL |
| Warehouse | Authoritative outlet default only; client warehouse fields rejected on CompleteOrder schema |

## Root consumption rules

| Configuration | Result |
| --- | --- |
| CatalogItem RecipeProfile binding | EXPLODE_RECIPE_ON_SALE |
| STOCK_TRACKED prep output, no recipe binding | CONSUME_FINISHED_ITEM |
| Neither | DIRECT_STOCK_OUT |
| Recipe binding **and** STOCK_TRACKED root | `AMBIGUOUS_CONSUMPTION_ROOT` |

Inside a recipe graph: VIRTUAL expands; nested STOCK_TRACKED is a finished leaf (never both).

## Explicitly out of scope

GoodsIssue posting, inventory OUT, COGS, sale reversal, Settlement, Payments, Fiscal, POS/HTTP UI, KDS, modifiers/Effective Recipe, Food Cost, offline runtime.

## D1.3B seam

`OrdersService` accepts optional `saleWriteOffPort: SaleInventoryWriteOffPort`.  
When wired, `completeOrder` posts GoodsIssue **before** persisting snapshot/COMPLETED in the same transaction.

## Tests

`orders.acceptance.test.ts` + domain `sale-consumption.test.ts` cover the PO merge-blocking matrix for D1.3A, including proof of zero GoodsIssue / zero InventoryMovement.
