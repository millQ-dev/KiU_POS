# MillQ Current State

**Checkpoint:** ADR-0028 Order Commercial Snapshot & Revenue Basis Semantics **architecture-only** — branch from Origin `main` @ `465dcb9` (2026-09-15)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**D1.4A PR #36:** merged @ `465dcb906304f2e0d9414a2dc80fc888e634f193`
**Updated:** 2026-09-15

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.3B + D1.3B-R1 | **Merged** |
| D1.4A Actual COGS Read Model | **Merged** |
| ADR-0026 / ADR-0027 | **Accepted** |
| ADR-0028 Order Commercial Snapshot & Revenue Basis | **This PR** — docs only |
| Order Commercial Snapshot / Revenue read model / Food Cost Ratio / Operational Gross Profit | **STOP** — not started (await explicit PO launch after Accept) |

## This PR (ADR-0028)

- `docs/decisions/ADR-0028-order-commercial-revenue-basis.md`
- Architecture-only Level C
- **No** runtime / migrations / schema / Revenue implementation

## Next

Independent architecture review → merge → backup → **STOP** (no automatic implementation launch)
