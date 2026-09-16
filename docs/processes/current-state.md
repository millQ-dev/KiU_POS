# MillQ Current State

**Checkpoint:** Block D1.4D Food Cost Ratio & Operational Gross Profit **in review** — branch from Origin `main` @ `22280db` (2026-09-16)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**D1.4C PR #39:** merged @ `22280db5ed5f0b2afc55e0f64f23528dd3a6c8ef`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A Actual COGS | **Merged** (semantics unchanged) |
| D1.4B Order Commercial Snapshot | **Merged** @ `878264f` |
| D1.4C Revenue Basis Read Model | **Merged** @ `22280db` |
| ADR-0026 / ADR-0027 / ADR-0028 | **Accepted** |
| Block D1.4D Food Cost Ratio & Operational Gross Profit | **This PR** |
| Contribution Margin / channel economics / Period Lock | **STOP** — not started |

## This PR (D1.4D)

- `OperatingEconomicsService` — derived Food Cost Ratio + Operational Gross Profit
- Combines `RevenueBasisService` + `ActualCogsService` (no migration / no ledger)
- Commercial coverage-gap detection (`REVENUE_COVERAGE_GAP`)
- Per-metric availability (zero Revenue ≠ disable Operational GP)

## Next

Independent review → merge → backup → **STOP**
