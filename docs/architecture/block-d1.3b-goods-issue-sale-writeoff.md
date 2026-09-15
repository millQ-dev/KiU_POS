# Block D1.3B — GoodsIssue & Automatic Sale Write-off

**Status:** Merged  
**ADR:** ADR-0025 (Accepted)  
**Origin PR:** #32  
**Merge SHA:** `b2174ee56a7417b4a4db516ae3ea1855ed470f0a`  
**Baseline before merge:** Origin `main` @ `d85ea0419333fea73d77596fd45adacc289296d9` (D1.3A)  
**Backup:** Verified via MillQ Origin Backup App (Origin main → GitHub main)

## Boundary

Closes the economic sale transaction:

```text
CompleteOrder
→ freeze/persist ConsumptionPlanSnapshot
→ Inventory creates + POSTS typed GoodsIssue
→ immutable InventoryMovement OUT
→ issue cost / certainty from shared inventory stream
→ Order COMPLETED
→ operational fact mirrors
```

All steps commit atomically in one PostgreSQL transaction, or none commit.

## Ownership

| Owner | Artifact |
| --- | --- |
| Orders | Order, OrderLine, ConsumptionPlanSnapshot, sales_order_completion_reversal, CompleteOrder / ReverseCompletedOrder orchestration |
| Inventory | goods_issue, goods_issue_line, goods_issue_reversal, InventoryMovement, balance rebuild |

Orders never writes Inventory tables; Inventory never re-resolves live recipes after snapshot freeze.

## Reuse

- Issue cost / certainty / valuation currency / stream replay from D1.2B + Block C
- Deterministic sorted `lockValuationStream` deadlock prevention
- D1.3A resolver + snapshot schema + `SaleInventoryWriteOffPort` boundary
- Same GoodsIssue / same business position / same stock item leaf aggregation into one InventoryMovement OUT (separate evidence lines preserved)

## Out of scope (remains out)

Food Cost Ratio, Payment, Settlement, Fiscal, POS UI, Tables/FloorPlan, KDS, modifiers, Effective Recipe, offline local runtime.

## Follow-on architecture

Food Cost / Actual COGS reporting semantics are frozen in **ADR-0026** (Accepted).  
Implementation of the Actual COGS read model is **D1.4A** and starts only after explicit Product Owner launch. Food Cost Ratio remains deferred until Revenue Basis exists.
