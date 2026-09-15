# Block D1.3B — GoodsIssue & Automatic Sale Write-off

**Status:** Implemented on feature branch (awaiting independent review)  
**ADR:** ADR-0025 (Accepted)  
**Baseline:** Origin `main` @ `d85ea0419333fea73d77596fd45adacc289296d9` (D1.3A merged)

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

## Out of scope

Food Cost, Payment, Settlement, Fiscal, POS UI, Tables/FloorPlan, KDS, modifiers, Effective Recipe, offline local runtime.
