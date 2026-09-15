# MillQ Current State

**Checkpoint:** ADR-0026 Actual COGS & Food Cost Reporting Semantics — **architecture-only Level C** (this PR)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Block D1.3B PR #32:** merged @ `b2174ee56a7417b4a4db516ae3ea1855ed470f0a` (backup verified)
**Block D1.3A PR #31:** merged @ `d85ea04`
**Accept PR #30:** ADR-0025 @ `8844ccb`
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
| Block D1.3B GoodsIssue & Automatic Sale Write-off | **Merged** (PR #32 → `b2174ee`) + backup verified |
| ADR-0026 Actual COGS & Food Cost Reporting Semantics | **This PR** — architecture-only; no runtime/code/schema |
| D1.4A Actual COGS Read Model | **STOP** until explicit PO launch after ADR-0026 Accept + merge + backup |
| Food Cost Ratio / Gross Profit / Revenue Basis | **Deferred** (ADR-0026) |
| Origin CI | **Attached** — Depot |
| GitHub Actions | Dormant copies only |
| GitHub backup | Post-merge Origin→GitHub via **MillQ Origin Backup** App |

## Accepted decisions

| ADR | Status | Topic |
| --- | --- | --- |
| ADR-0001 … ADR-0025 | Accepted | Prior decisions (see history) |
| ADR-0026 | **Accepted** (this PR records PO LAUNCH binding) | Actual COGS & Food Cost Reporting Semantics |

## Proposed

_None._

### Sale write-off invariant (ADR-0025 / D1.3B)

Charter “Sale” = OrderCompleted. Write-off via Inventory-owned GoodsIssue on CompleteOrder. Exactly one physical path (VIRTUAL explode XOR STOCK_TRACKED consume). ConsumptionPlanSnapshot frozen at completion.

D1.3B atomic orchestration (same PostgreSQL TX):

```text
freeze/persist ConsumptionPlanSnapshot
→ Inventory.postGoodsIssueFromConsumptionPlan (frozen leaves only)
→ POST GoodsIssue + InventoryMovement OUT + cost/certainty
→ Order COMPLETED
→ operational fact mirrors
```

ReverseCompletedOrder uses dedicated reversal entities (not fake Orders/GoodsIssues).

### Actual COGS invariant (ADR-0026)

Actual COGS is a Reporting/Finance **derived read-side** model from D1.3B historical GoodsIssue / movement / certainty. Never mutable `product.cost`. Never re-resolve current recipes for historical Actual COGS. `UNKNOWN` never silently zero. Native currency only in first model. Food Cost Ratio deferred until authoritative Revenue Basis exists.

## Delivered on main (D1.3B)

- Migration `008_goods_issue_sale_writeoff.sql`
- `GoodsIssueService` implements `SaleInventoryWriteOffPort`
- Successful CompleteOrder + ReverseCompletedOrder
- Shared valuation stream, locking, issue-cost certainty
- Facts: `OrderCompleted`, `InventoryConsumed`, `OrderCompletionReversed`

## This PR (ADR-0026)

- Architecture decision only
- Docs hygiene: D1.3B marked merged; Food Cost architecture launched as ADR-0026
- **No** application code, migrations, or D1.4A implementation

## Out of scope

- D1.4A Actual COGS Read Model (implementation)
- Food Cost Ratio / Gross Profit / Revenue Basis / Net Sales / tax
- Settlement / Payments / FX / Theoretical Recipe Cost / Intelligence / dashboard UI

## Next

1. Independent architecture review + CI green on this ADR PR
2. `origin pr merge --auto` → backup → Origin main == GitHub main
3. **STOP** — D1.4A only after explicit PO launch
