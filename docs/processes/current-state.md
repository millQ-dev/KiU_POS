# MillQ Current State

**Checkpoint:** ADR-0029 Menu Publication / Availability / Base Pricing **in review** — branch from Origin `main` @ `3114b3c` (2026-09-16)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**GOLDEN-1 PR #41:** merged @ `3114b3cde2c279afd2cbd589676d52cfe52b258f`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A–D1.4D economic vertical | **DONE** |
| GOLDEN-1 Golden Restaurant Scenario | **DONE** @ `3114b3c` — foundation proven YES |
| ADR-0029 Menu Publication, Availability & Base Price Resolution | **This PR** — architecture only |
| MenuResolver / Pricing runtime | **STOP** — next after ADR Accept |
| Promotions / Loyalty / POS layout / Channel Menu | **STOP** — not started |

## This PR (ADR-0029)

- `docs/decisions/ADR-0029-menu-publication-pricing-resolution.md`
- Freezes MenuDefinition vs Publication, inheritance, availability, base price, SalesContext, timezone, Orders integration timing
- **No runtime / no migration / no schema**

## Next

Independent architecture review → merge → backup → **STOP**  
(Runtime Menu Configuration + resolvers = separate launch)
