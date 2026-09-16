# MillQ Current State

**Checkpoint:** Block D1.4C Revenue Basis Read Model **in review** — branch from Origin `main` @ `878264f` (2026-09-16)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**D1.4B PR #38:** merged @ `878264fff885f71984cf34df578aa67333d842f1`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A Actual COGS | **Merged** (unchanged by this block) |
| D1.4B Order Commercial Snapshot | **Merged** @ `878264f` |
| ADR-0028 | **Accepted** |
| Block D1.4C Revenue Basis Read Model | **This PR** |
| Food Cost Ratio / Operational Gross Profit | **STOP** — not started |

## This PR (D1.4C)

- `RevenueBasisService` — read-only Reporting query over D1.4B snapshots
- SALE + REVERSAL line/order effects with ADR-0027 reversal chronology
- **No migration** — no reporting ledger / materialized Revenue table
- **No** Food Cost Ratio / Operational Gross Profit

## Next

Independent review → merge → backup → **STOP**
