# MillQ Current State

**Checkpoint:** GOLDEN-1 Golden Restaurant Scenario / Torture Test **in review** — branch from Origin `main` @ `361ef9b` (2026-09-16)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**D1.4D PR #40:** merged @ `361ef9b8c2255f8d4984c882b0d6f93125689340`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A Actual COGS | **DONE** |
| D1.4B Order Commercial Snapshot | **DONE** |
| D1.4C Revenue Basis Read Model | **DONE** |
| D1.4D Food Cost Ratio & Operational Gross Profit | **DONE** @ `361ef9b` |
| GOLDEN-1 Golden Restaurant Scenario | **This PR** — permanent torture gate |
| Contribution Margin / Period Lock / Menu / POS UX | **STOP** — not started |

## This PR (GOLDEN-1)

- Permanent entry: `apps/api/src/scenarios/golden-restaurant.acceptance.test.ts`
- Manifest: `docs/processes/golden-restaurant-scenario.md`
- Cross-module day: procurement → production → order → commercial → COGS/Revenue/OGP → reversals
- Explicit DEFERRED markers for unsupported torture steps
- **Golden-discovered fix:** business DATE `asIsoDate` UTC shift in positive-offset TZ
- **No migration / no new product runtime**

## Next

Independent review → merge → backup → **STOP**
