# MillQ Current State

**Checkpoint:** Block D1.3B GoodsIssue & Automatic Sale Write-off **in review** — branch from Origin `main` @ `d85ea04` (2026-09-15)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Block D1.3A PR #31:** merged @ `d85ea04`
**Accept PR #30:** ADR-0025 @ `8844ccb`
**Block D1.2B PR #29:** merged @ `57499df`
**Updated:** 2026-09-15

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Foundation Operational Core | Merged |
| Architecture v1.2 / v1.3 | **Merged** |
| Block C Goods Receipt vertical | **Merged** |
| Block D1.1 / D1.2A / D1.2B | **Merged** |
| ADR-0025 Order Completion & Sale Inventory Write-off | **Accepted / Merged** (PR #30 → `8844ccb`) |
| Block D1.3A Orders Foundation & Consumption Plan | **Merged** (PR #31 → `d85ea04`) |
| Block D1.3B GoodsIssue & Automatic Sale Write-off | **This PR** — wires SaleInventoryWriteOffPort; atomic CompleteOrder + ReverseCompletedOrder |
| Food Cost | **STOP** until explicit PO launch after D1.3B merge + backup |
| Origin CI | **Attached** — Depot |
| GitHub Actions | Dormant copies only |
| GitHub backup | Post-merge Origin→GitHub via **MillQ Origin Backup** App |

## Accepted decisions

| ADR | Status | Topic |
| --- | --- | --- |
| ADR-0001 … ADR-0024 | Accepted | Prior decisions (see history) |
| ADR-0025 | **Accepted** | Order Completion & Sale Inventory Write-off Semantics |

## Proposed

_None._

### Sale write-off invariant (ADR-0025)

Charter “Sale” = OrderCompleted. Write-off via Inventory-owned GoodsIssue on CompleteOrder. Exactly one physical path (VIRTUAL explode XOR STOCK_TRACKED consume). ConsumptionPlanSnapshot frozen at completion. Food Cost deferred after D1.3B.

D1.3B atomic orchestration (same PostgreSQL TX):

```text
freeze/persist ConsumptionPlanSnapshot
→ Inventory.postGoodsIssueFromConsumptionPlan (frozen leaves only)
→ POST GoodsIssue + InventoryMovement OUT + cost/certainty
→ Order COMPLETED
→ operational fact mirrors
```

ReverseCompletedOrder uses dedicated reversal entities (not fake Orders/GoodsIssues).

## Delivered in this PR (D1.3B)

- Migration `008_goods_issue_sale_writeoff.sql` — `goods_issue`, `goods_issue_line`, `goods_issue_reversal`, `sales_order_completion_reversal`
- `GoodsIssueService` implements `SaleInventoryWriteOffPort`
- Successful CompleteOrder live; ReverseCompletedOrder live
- Reuses Block C / D1.2B valuation stream, locking, issue-cost certainty
- Facts: `OrderCompleted`, `InventoryConsumed` (sourceOrderId), `OrderCompletionReversed`

## Out of scope (asserted)

- Food Cost report
- Payment / Settlement / Fiscal / POS UI / FloorPlan / KDS / modifiers / offline runtime

## Next

1. Independent full-diff review + Origin CI green
2. `origin pr merge --auto` → backup → Origin main == GitHub main
3. **STOP** — Food Cost only after explicit PO launch
