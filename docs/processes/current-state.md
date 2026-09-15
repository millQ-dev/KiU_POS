# MillQ Current State

**Checkpoint:** Block D1.4B Order Commercial Snapshot **in review** — branch from Origin `main` @ `614daed` (2026-09-15)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**ADR-0028 PR #37:** merged @ `614daed6a1e6473b1a1c0e4a3cf8cf9f544d3b74`
**Updated:** 2026-09-15

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A Actual COGS | **Merged** (unchanged by this block) |
| ADR-0028 | **Accepted** |
| Block D1.4B Order Commercial Snapshot | **This PR** |
| Revenue Basis read model / Food Cost Ratio / Operational Gross Profit | **STOP** — not started |

## This PR (D1.4B)

- Migration `011_order_commercial_snapshot.sql`
- `SetOrderCommercialTerms` + immutable freeze at `CompleteOrder`
- Largest-remainder order-discount allocation (domain)
- **No** Revenue reporting / Food Cost / Gross Profit

## Next

Independent review → merge → backup → **STOP**
