# MillQ Current State

**Checkpoint:** ADR-0031 POS Presentation / Layout / Cashier Surface — **CURRENT** (architecture only)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Baseline:** Origin/GitHub main @ `1f195260c015eb2087cb973fd7fc4490632a579e`
**M1.1:** **DONE** @ `1f19526…` (PR #43)
**ADR-0029:** **ACCEPTED**
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A–D1.4D economic vertical | **DONE** |
| GOLDEN-1 Golden Restaurant Scenario | **DONE** — Live Menu/Pricing **PASS** |
| ADR-0029 Menu Publication / Availability / Base Pricing | **ACCEPTED** |
| M1.1 Menu Configuration & Resolution Runtime | **DONE** @ `1f19526…` |
| ADR-0031 POS Presentation, Layout Publication & Cashier Surface | **This PR** — architecture only |
| P1.1 POS Presentation Runtime + first cashier surface | **STOP** — next after ADR Accept |
| Promotions / Loyalty / Channel Menu / stock stop-list | **STOP** — not started |
| COMMERCIAL ROUNDING POLICY (unit Money × fractional qty → official Money) | **DEFERRED Level C** — **ADR-0030 reserved, NOT created** |

## This PR (ADR-0031)

- `docs/decisions/ADR-0031-pos-presentation-layout-cashier-surface.md`
- Freezes LayoutDefinition vs LayoutPublication, MenuPage/MenuSlot, Quick Access max 10, assignment precedence, Layout × ResolvedMenu intersection, capability model, tables optional, OPTION A rounding boundary
- **No runtime / no migration / no React / no schema**

## Numbering note

Launch suggested ADR-0030 for POS. ADR-0030 remains reserved for Commercial RoundingPolicy. POS Presentation freeze is **ADR-0031**.

## Next

Independent architecture review → merge → backup → **STOP**  
Immediate next product vertical after Accept: **P1.1 — POS Presentation Runtime** + first cashier-ready ResolvedPosSurface.
