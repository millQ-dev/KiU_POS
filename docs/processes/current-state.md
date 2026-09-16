# MillQ Current State

**Checkpoint:** M1.1 Menu Configuration & Resolution Runtime — **CURRENT**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Baseline:** Origin/GitHub main @ `7f859b82831599d4b3d6441ae853fa6ce2a24ed7`
**ADR-0029:** **ACCEPTED** @ `7f859b8…`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| D1.4A–D1.4D economic vertical | **DONE** |
| GOLDEN-1 Golden Restaurant Scenario | **DONE** — foundation proven YES |
| ADR-0029 Menu Publication, Availability & Base Price Resolution | **ACCEPTED** @ `7f859b8…` |
| M1.1 Menu Configuration & Resolution Runtime | **CURRENT** |
| POS Presentation / MenuLayout | **STOP** — next after M1.1 |
| Promotions / Loyalty / Channel Menu / stock stop-list | **STOP** — not started |
| COMMERCIAL ROUNDING POLICY (unit Money × fractional MASS/VOLUME qty → official Money) | **DEFERRED Level C** — ADR-0030 **NOT** created |

## M1.1 (this PR)

- Outlet IANA `timezone` (nullable; runtime `OUTLET_TIMEZONE_REQUIRED`)
- MenuDefinition → immutable MenuPublication (+ membership freeze triggers)
- MenuAssignment (Tenant / Brand / Outlet); LegalEntity excluded; Terminal* deferred
- AvailabilityRule + PricingResolver + MenuResolver
- OPTION A: unit-price resolution only; `grossMerchandiseMinor` explicit caller input
- Orders path: `resolveOrderLinesFromMenu` → `buildMenuResolvedCommercialTermsInput` → `SetOrderCommercialTerms`
- CompleteOrder does **not** call MenuResolver
- Golden live Menu/Pricing variation with `explicitCommercialGrossMinor`

## Next

Independent review → merge → backup → **STOP**
Next product vertical: **POS Presentation / MenuLayout** + first cashier-ready resolved-menu surface (unless Level C gap).
