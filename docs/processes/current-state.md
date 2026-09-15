# MillQ Current State

**Checkpoint:** Block D1.4A Actual COGS Read Model **in review** — branch from Origin `main` @ `0cd592b` (2026-09-15)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**D1.3B-R1 PR #35:** merged @ `0cd592bb6ec2c93edd629fa3bb4534af601118f8`
**Updated:** 2026-09-15

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.3B + D1.3B-R1 | **Merged** |
| ADR-0026 / ADR-0027 | **Accepted** |
| Block D1.4A Actual COGS Read Model | **This PR** — Reporting read-side only |
| Revenue Basis / Food Cost Ratio / Gross Profit / Theoretical Recipe Cost | **STOP** — not started |

## This PR (D1.4A)

- `apps/api/src/modules/reporting/actual-cogs-{types,service}.ts`
- Evidence-line grain (`issue_cost_minor`) vs physical-movement grain (unique `inventory_movement_id`)
- ADR-0026 reporting certainty via `mergeReportingCertainty` (ORDER_UNRESOLVED > UNKNOWN)
- Reversal effects at D1.3B-R1 reversal chronology
- **No** migration (pure query)
- **No** Revenue / Food Cost Ratio

## Next

Independent review → merge → backup → **STOP** (no automatic next block)
