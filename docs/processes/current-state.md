# MillQ Current State

**Checkpoint:** P1.1 POS Presentation Runtime & First Cashier Surface — **CURRENT**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Baseline:** Origin/GitHub main @ `862bdc633a43803067f19d2d215ba4d5d0316342`
**ADR-0031:** **ACCEPTED** @ `862bdc6…`
**ADR-0029:** **ACCEPTED**
**M1.1:** **DONE**
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A–D1.4D economic vertical | **DONE** |
| GOLDEN-1 Golden Restaurant Scenario | **DONE** — Live Menu/Pricing **PASS**; Live POS selection **PASS** (this PR) |
| ADR-0029 Menu Publication / Availability / Base Pricing | **ACCEPTED** |
| M1.1 Menu Configuration & Resolution Runtime | **DONE** |
| ADR-0031 POS Presentation, Layout Publication & Cashier Surface | **ACCEPTED** @ `862bdc6…` |
| P1.1 POS Presentation Runtime + first cashier surface | **CURRENT** — backend/read surface; React cashier shell **DEFERRED P1.2** |
| Promotions / Loyalty / Channel Menu / stock stop-list | **STOP** — not started |
| COMMERCIAL ROUNDING POLICY (unit Money × fractional qty → official Money) | **DEFERRED Level C** — **ADR-0030 reserved, NOT created** |

## This PR (P1.1)

- Migration `016_pos_presentation_layout.sql`
- LayoutDefinition / immutable LayoutPublication / MenuPage / MenuSlot / Quick Access ≤10
- LayoutAssignment (Tenant → Brand → Outlet); LegalEntity excluded; Terminal* DEFERRED
- LayoutResolver + PosSurfaceResolver (∩ M1.1 MenuResolver)
- PosSelectionService → existing AddOrderLine; tableless OPEN Order basket
- OPTION A preserved (no unit×qty official Money)
- Frontend: `apps/web` is health-only → **React cashier renderer = DEFERRED P1.2**

## Next

Independent review → merge → backup → **P1.2 First KiU Cashier Frontend Shell**
